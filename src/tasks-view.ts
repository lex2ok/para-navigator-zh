import { App, ItemView, Modal, Notice, Setting, TFile, TFolder, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type ParaNavigatorPlugin from "./main";
import type { ParaFolderConfig } from "./settings";
import { renderIconValue } from "./pickers";

export const VIEW_TYPE_TASKS = "para-tasks";

export type TaskTab = "today" | "open" | "done";
export type RepeatKind = "" | "daily" | "weekly" | "monthly";

/**
 * 任务 = 一条独立笔记，用 frontmatter 标记：
 * ---
 * task: true
 * due: 2026-10-05      # 可选，截止日期
 * repeat: daily        # 可选：daily | weekly | monthly
 * done: false
 * doneDate: 2026-09-29 # 完成时写入
 * ---
 * 任务笔记就是普通笔记，可以在导航器里拖进项目 / 领域。
 */
export interface TaskNote {
  file: TFile;
  folderId: string;
  folderName: string;
  title: string;
  due: string | null;
  repeat: RepeatKind;
  done: boolean;
  doneDate: string | null;
}

export interface NewTaskOptions {
  title: string;
  due: string | null;
  repeat: RepeatKind;
  folderPath: string;
}

const REPEAT_LABEL: Record<Exclude<RepeatKind, "">, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
};
const REPEAT_CYCLE: RepeatKind[] = ["", "daily", "weekly", "monthly"];

// ---------------------------------------------------------------------------
// 日期工具
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normDate(raw: string): string {
  const [y, m, d] = raw.split("-").map(Number);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** "M月d日"，如 10月5日。 */
export function formatDueShort(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}月${d}日`;
}

function parseLocal(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 按重复周期顺延到下一个到期日。 */
function addInterval(dateKey: string, repeat: Exclude<RepeatKind, "">): string {
  const d = parseLocal(dateKey);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return toKey(d);
}

// ---------------------------------------------------------------------------
// 任务识别与收集（只读 metadataCache，不读文件内容）
// ---------------------------------------------------------------------------

function frontmatterDate(value: unknown): string | null {
  if (value instanceof Date) return toKey(value);
  if (typeof value === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(value.trim())) {
    return normDate(value.trim());
  }
  return null;
}

/** 笔记是否为任务笔记；是则返回其任务属性。 */
export function getTaskMeta(
  app: App,
  file: TFile
): Pick<TaskNote, "due" | "repeat" | "done" | "doneDate"> | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm || fm.task !== true) return null;
  const repeat: RepeatKind =
    fm.repeat === "daily" || fm.repeat === "weekly" || fm.repeat === "monthly"
      ? fm.repeat
      : "";
  return {
    due: frontmatterDate(fm.due),
    repeat,
    done: fm.done === true,
    doneDate: frontmatterDate(fm.doneDate),
  };
}

/** 收集全部 PARA 文件夹中的任务笔记。 */
export function collectTaskNotes(app: App, folders: ParaFolderConfig[]): TaskNote[] {
  const notes: TaskNote[] = [];
  for (const file of app.vault.getFiles()) {
    if (file.extension !== "md") continue;
    const meta = getTaskMeta(app, file);
    if (!meta) continue;
    const folder = folders.find((f) => file.path.startsWith(`${f.path}/`));
    notes.push({
      file,
      folderId: folder?.id ?? "",
      folderName: folder?.name ?? "未分类",
      title: file.basename,
      ...meta,
    });
  }
  return notes;
}

/** 今日到期（含逾期）的未完成任务数，供导航栏「今日」徽标使用。 */
export function countTodayTasks(app: App, folders: ParaFolderConfig[]): number {
  const today = todayKey();
  return collectTaskNotes(app, folders).filter(
    (t) => !t.done && t.due !== null && t.due <= today
  ).length;
}

/**
 * 勾选任务（任务面板与主页看板共用）。
 * 重复任务不会进入已完成，而是顺延到下一个到期日；
 * 普通任务标记完成并记录完成日期；已完成的再次点击会重新打开。
 */
export async function toggleTaskDone(app: App, task: TaskNote): Promise<void> {
  const today = todayKey();
  const update = (fn: (fm: Record<string, unknown>) => void) =>
    app.fileManager.processFrontMatter(task.file, fn);
  if (task.done) {
    await update((fm) => {
      fm.done = false;
      delete fm.doneDate;
    });
  } else if (task.repeat) {
    const base = task.due && task.due >= today ? task.due : today;
    const next = addInterval(base, task.repeat);
    await update((fm) => {
      fm.due = next;
    });
    new Notice(`重复任务已顺延到 ${formatDueShort(next)}`);
  } else {
    await update((fm) => {
      fm.done = true;
      fm.doneDate = today;
    });
  }
}

// ---------------------------------------------------------------------------
// 任务面板
// ---------------------------------------------------------------------------

export class TasksView extends ItemView {
  private readonly plugin: ParaNavigatorPlugin;
  private tab: TaskTab = "today";
  private folderId = "all";

  constructor(leaf: WorkspaceLeaf, plugin: ParaNavigatorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKS;
  }

  getDisplayText(): string {
    return "任务";
  }

  getIcon(): string {
    return "list-todo";
  }

  /** 供导航栏「今日」入口调用：打开面板并切到指定页签。 */
  setTab(tab: TaskTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    void this.render();
  }

  async onOpen(): Promise<void> {
    await this.render();
    const rerender = () => void this.render();
    this.registerEvent(this.app.vault.on("create", rerender));
    this.registerEvent(this.app.vault.on("delete", rerender));
    this.registerEvent(this.app.vault.on("rename", rerender));
    this.registerEvent(this.app.metadataCache.on("changed", rerender));
  }

  private async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("para-tasks");

    const today = todayKey();
    const folders = this.plugin.settings.folders;
    const notes = collectTaskNotes(this.app, folders);
    const open = notes.filter((t) => !t.done);
    const done = notes.filter((t) => t.done);
    const dueToday = open.filter((t) => t.due !== null && t.due <= today);

    const header = container.createDiv("para-tasks-header");
    header.createEl("h2", { text: "任务" });
    const actions = header.createDiv("para-tasks-actions");
    const folderSelect = actions.createEl("select", { cls: "para-tasks-folder-filter" });
    folderSelect.setAttr("aria-label", "按文件夹筛选");
    const allOpt = folderSelect.createEl("option", { text: "全部文件夹" });
    allOpt.value = "all";
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", { text: folder.name });
      opt.value = folder.id;
    }
    folderSelect.value = this.folderId;
    folderSelect.addEventListener("change", () => {
      this.folderId = folderSelect.value;
      void this.render();
    });
    const addBtn = actions.createEl("button", { text: "＋ 新任务", cls: "para-tasks-add" });
    addBtn.addEventListener("click", () => this.plugin.promptQuickAddTask());

    const tabs = container.createDiv("para-task-tabs");
    const tabDefs: [TaskTab, string, number][] = [
      ["today", "今日", dueToday.length],
      ["open", "待办", open.length],
      ["done", "已完成", done.length],
    ];
    for (const [id, label, count] of tabDefs) {
      const tab = tabs.createEl("button", {
        cls: `para-task-tab${this.tab === id ? " is-active" : ""}`,
        text: `${label} ${count}`,
      });
      tab.addEventListener("click", () => this.setTab(id));
    }

    const body = container.createDiv("para-tasks-body");
    if (this.tab === "today") this.renderToday(body, open, today);
    else if (this.tab === "open") this.renderOpen(body, open, today, folders);
    else this.renderDone(body, done, folders);
  }

  /** 今日页签：逾期 + 今天到期。 */
  private renderToday(body: HTMLElement, open: TaskNote[], today: string): void {
    const overdue = open
      .filter((t) => t.due !== null && t.due < today)
      .sort((a, b) => (a.due as string) < (b.due as string) ? -1 : 1);
    const todayDue = open
      .filter((t) => t.due === today)
      .sort((a, b) => a.title.localeCompare(b.title, "zh"));
    this.renderSection(body, "逾期", overdue, today, "没有逾期的任务，干得漂亮");
    this.renderSection(body, "今天", todayDue, today, "今天没有到期的任务");
  }

  /** 待办页签：按文件夹分组的全部未完成任务。 */
  private renderOpen(
    body: HTMLElement,
    open: TaskNote[],
    today: string,
    folders: ParaFolderConfig[]
  ): void {
    let shown = 0;
    for (const folder of folders) {
      if (this.folderId !== "all" && folder.id !== this.folderId) continue;
      const tasks = open
        .filter((t) => t.folderId === folder.id)
        .sort((a, b) => {
          if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
          if (a.due) return -1;
          if (b.due) return 1;
          return a.title.localeCompare(b.title, "zh");
        });
      if (tasks.length === 0) continue;
      shown += tasks.length;
      body.appendChild(this.renderGroup(folder.name, folder.icon, tasks, today));
    }
    const uncategorized = open.filter((t) => !t.folderId);
    if (uncategorized.length > 0 && this.folderId === "all") {
      shown += uncategorized.length;
      body.appendChild(this.renderGroup("未分类", "folder", uncategorized, today));
    }
    if (shown === 0) {
      body.createDiv({ cls: "para-stats-empty", text: "暂无待办任务" });
    }
  }

  /** 已完成页签：按文件夹分组，按完成日期倒序。 */
  private renderDone(body: HTMLElement, done: TaskNote[], folders: ParaFolderConfig[]): void {
    let shown = 0;
    for (const folder of folders) {
      if (this.folderId !== "all" && folder.id !== this.folderId) continue;
      const tasks = done
        .filter((t) => t.folderId === folder.id)
        .sort((a, b) => {
          if (a.doneDate && b.doneDate) return a.doneDate < b.doneDate ? 1 : -1;
          if (a.doneDate) return -1;
          if (b.doneDate) return 1;
          return b.file.stat.mtime - a.file.stat.mtime;
        });
      if (tasks.length === 0) continue;
      shown += tasks.length;
      body.appendChild(this.renderGroup(folder.name, folder.icon, tasks, todayKey()));
    }
    if (shown === 0) {
      body.createDiv({ cls: "para-stats-empty", text: "还没有完成的任务" });
    }
  }

  private renderSection(
    body: HTMLElement,
    title: string,
    tasks: TaskNote[],
    today: string,
    emptyText: string
  ): void {
    const section = body.createDiv("para-tasks-group");
    const header = section.createDiv("para-tasks-group-header");
    header.createSpan({ cls: "para-tasks-group-name", text: title });
    header.createSpan({ cls: "para-tasks-group-count", text: String(tasks.length) });
    if (tasks.length === 0) {
      section.createDiv({ cls: "para-tasks-section-empty", text: emptyText });
      return;
    }
    for (const task of tasks) {
      section.appendChild(this.renderTaskRow(task, today));
    }
  }

  private renderGroup(
    name: string,
    icon: string,
    tasks: TaskNote[],
    today: string
  ): HTMLElement {
    const section = createDiv("para-tasks-group");
    const header = section.createDiv("para-tasks-group-header");
    const iconEl = header.createSpan("para-tasks-group-icon");
    renderIconValue(iconEl, icon);
    header.createSpan({ cls: "para-tasks-group-name", text: name });
    header.createSpan({ cls: "para-tasks-group-count", text: String(tasks.length) });
    for (const task of tasks) {
      section.appendChild(this.renderTaskRow(task, today));
    }
    return section;
  }

  private renderTaskRow(task: TaskNote, today: string): HTMLElement {
    const row = createDiv("para-task-row");

    const check = row.createSpan(`para-task-check${task.done ? " is-done" : ""}`);
    check.setAttr("role", "checkbox");
    check.setAttr("aria-checked", String(task.done));
    check.setAttr("aria-label", task.done ? "重新打开" : "标记完成");
    check.setAttr("tabindex", "0");
    const toggle = () => void this.toggleTask(task);
    check.addEventListener("click", toggle);
    check.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        toggle();
      }
    });

    const main = row.createDiv("para-task-main");
    const textEl = main.createDiv({
      cls: `para-task-text${task.done ? " is-done" : ""}`,
      text: task.title,
    });
    textEl.setAttr("role", "button");
    textEl.setAttr("aria-label", `打开任务 ${task.title}`);
    textEl.addEventListener("click", () => this.plugin.openFileReusingTab(task.file));

    const meta = main.createDiv("para-task-meta");
    if (task.due) {
      const overdue = !task.done && task.due < today;
      const isToday = !task.done && task.due === today;
      const badge = meta.createSpan({
        cls: `para-task-due${overdue ? " is-overdue" : ""}${isToday ? " is-today" : ""}`,
        text: `${overdue ? "逾期 " : ""}${isToday ? "今天" : formatDueShort(task.due)}`,
      });
      badge.setAttr("aria-label", `截止日期 ${task.due}`);
    }
    if (task.repeat) {
      const rep = meta.createSpan({
        cls: "para-task-repeat",
        text: `🔁${REPEAT_LABEL[task.repeat]}`,
      });
      rep.setAttr("role", "button");
      rep.setAttr("tabindex", "0");
      rep.setAttr("aria-label", `重复：${REPEAT_LABEL[task.repeat]}（点击切换）`);
      const cycle = () => void this.cycleRepeat(task);
      rep.addEventListener("click", cycle);
      rep.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          cycle();
        }
      });
    } else if (!task.done) {
      const rep = meta.createSpan({ cls: "para-task-repeat is-none", text: "设为重复" });
      rep.setAttr("role", "button");
      rep.setAttr("tabindex", "0");
      rep.setAttr("aria-label", "设为重复任务");
      const cycle = () => void this.cycleRepeat(task);
      rep.addEventListener("click", cycle);
      rep.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          cycle();
        }
      });
    }
    const dueBtn = meta.createSpan("para-task-due-btn");
    setIcon(dueBtn, "calendar");
    dueBtn.setAttr("role", "button");
    dueBtn.setAttr("tabindex", "0");
    dueBtn.setAttr("aria-label", task.due ? `修改截止日期（当前 ${task.due}）` : "设置截止日期");
    const pickDue = () => {
      new SetDueDateModal(this.app, task.due, (date) => void this.setTaskDue(task, date)).open();
    };
    dueBtn.addEventListener("click", pickDue);
    dueBtn.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        pickDue();
      }
    });
    meta.createSpan({ cls: "para-task-source", text: task.folderName });

    return row;
  }

  private async updateFrontmatter(
    file: TFile,
    fn: (fm: Record<string, unknown>) => void
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, fn);
  }

  /**
   * 勾选任务（任务面板与主页看板共用）。
   * 重复任务不会进入已完成，而是顺延到下一个到期日；
   * 普通任务标记完成并记录完成日期。
   */
  private async toggleTask(task: TaskNote): Promise<void> {
    await toggleTaskDone(this.app, task);
  }

  /** 设置 / 清除截止日期，写回 frontmatter。 */
  private async setTaskDue(task: TaskNote, date: string | null): Promise<void> {
    await this.updateFrontmatter(task.file, (fm) => {
      if (date) fm.due = date;
      else delete fm.due;
    });
  }

  /** 点击切换重复周期：不重复 → 每天 → 每周 → 每月 → 不重复。 */
  private async cycleRepeat(task: TaskNote): Promise<void> {
    const next = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(task.repeat) + 1) % REPEAT_CYCLE.length];
    await this.updateFrontmatter(task.file, (fm) => {
      if (next) fm.repeat = next;
      else delete fm.repeat;
    });
    if (next) new Notice(`已设为${REPEAT_LABEL[next]}重复`);
  }
}

// ---------------------------------------------------------------------------
// 弹窗
// ---------------------------------------------------------------------------

/** 截止日期选择器：确定设置，清除日期，或取消。 */
export class SetDueDateModal extends Modal {
  private readonly current: string | null;
  private readonly onSet: (date: string | null) => void;

  constructor(app: App, current: string | null, onSet: (date: string | null) => void) {
    super(app);
    this.current = current;
    this.onSet = onSet;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("设置截止日期");
    const input = contentEl.createEl("input", { cls: "para-duedate-input" });
    input.setAttr("type", "date");
    if (this.current) input.value = this.current;
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText("清除日期").onClick(() => {
          this.onSet(null);
          this.close();
        })
      )
      .addButton((button) =>
        button.setButtonText("确定").setCta().onClick(() => {
          this.onSet(input.value || null);
          this.close();
        })
      );
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 新建任务：标题 + 截止日期 + 重复周期 + 保存位置，创建为独立笔记。 */
export class QuickAddTaskModal extends Modal {
  private readonly folders: ParaFolderConfig[];
  private readonly defaultFolderPath: string;
  private readonly onSubmit: (opts: NewTaskOptions) => void;

  constructor(
    app: App,
    folders: ParaFolderConfig[],
    defaultFolderPath: string,
    onSubmit: (opts: NewTaskOptions) => void
  ) {
    super(app);
    this.folders = folders;
    this.defaultFolderPath = defaultFolderPath;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("新建任务");

    const titleInput = contentEl.createEl("input", { cls: "para-quickadd-input" });
    titleInput.setAttr("type", "text");
    titleInput.setAttr("placeholder", "任务标题…");

    const dateRow = contentEl.createDiv("para-quickadd-row");
    dateRow.createEl("span", { text: "截止日期", cls: "para-quickadd-label" });
    const dateInput = dateRow.createEl("input", { cls: "para-quickadd-field" });
    dateInput.setAttr("type", "date");

    const repeatRow = contentEl.createDiv("para-quickadd-row");
    repeatRow.createEl("span", { text: "重复", cls: "para-quickadd-label" });
    const repeatSelect = repeatRow.createEl("select", { cls: "para-quickadd-field" });
    const repeatOpts: [RepeatKind, string][] = [
      ["", "不重复"],
      ["daily", "每天"],
      ["weekly", "每周"],
      ["monthly", "每月"],
    ];
    for (const [value, label] of repeatOpts) {
      const opt = repeatSelect.createEl("option", { text: label });
      opt.value = value;
    }

    const folderRow = contentEl.createDiv("para-quickadd-row");
    folderRow.createEl("span", { text: "保存到", cls: "para-quickadd-label" });
    const folderSelect = folderRow.createEl("select", { cls: "para-quickadd-field" });
    for (const folder of this.folders) {
      if (!(this.app.vault.getAbstractFileByPath(folder.path) instanceof TFolder)) continue;
      const opt = folderSelect.createEl("option", { text: folder.name });
      opt.value = folder.path;
    }
    if (this.defaultFolderPath) folderSelect.value = this.defaultFolderPath;

    const submit = () => {
      const title = titleInput.value.trim();
      if (!title) {
        new Notice("请填写任务标题。");
        return;
      }
      this.onSubmit({
        title,
        due: dateInput.value || null,
        repeat: (repeatSelect.value || "") as RepeatKind,
        folderPath: folderSelect.value,
      });
      this.close();
    };
    titleInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submit();
      }
    });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("创建任务").setCta().onClick(submit));
    titleInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
