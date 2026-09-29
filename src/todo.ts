import { App, Modal, Notice, Setting, TFile, TFolder } from "obsidian";
import type { ParaFolderConfig } from "./settings";

/**
 * 待办 v3：回到 `- [ ]` 清单模型。
 *
 * 任务就是各 PARA 笔记里的 `- [ ]` / `- [x]` 清单项。插件自动生成并维护一页
 * 真实的「待办」笔记（frontmatter `todo-index: true`），里面是统计 + 按文件夹
 * 分组的汇总列表。汇总区（`<!-- todo-auto-start -->` ~ `<!-- todo-auto-end -->`）
 * 由插件重建，之外的手工内容原样保留（快速新建的任务也会加在这里）。
 * 在待办笔记里勾选复选框会写回原笔记。待办笔记是普通笔记，可拖到任意项目/领域，
 * 插件按 frontmatter 标记查找，不依赖路径。
 */

export const TODO_INDEX_KEY = "todo-index";
export const TODO_AUTO_START = "<!-- todo-auto-start -->";
export const TODO_AUTO_END = "<!-- todo-auto-end -->";

export interface TodoItem {
  /** 来源笔记 */
  file: TFile;
  /** 来源笔记中的 0-based 行号（写回用） */
  line: number;
  checked: boolean;
  /** 去掉复选框标记后的文本 */
  text: string;
  /** 文本中的日期（📅 / @YYYY-MM-DD），无则 null */
  date: string | null;
  /** 来源 PARA 文件夹显示名（待办笔记在库外时为"待办"） */
  folderName: string;
}

export interface NewTaskInput {
  title: string;
  due: string | null;
}

export interface TodoRefreshResult {
  /** 写回引用 -> 勾选状态，供待办笔记的勾选写回比对 */
  checked: Map<string, boolean>;
  /** 待办笔记最新全文（识别我们自己的写入） */
  content: string;
  /** 今天到期的未完成条目数（含逾期，供导航栏计数） */
  dueTodayCount: number;
}

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

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

function frontmatterDate(value: unknown): string | null {
  if (value instanceof Date) return toKey(value);
  if (typeof value === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(value.trim())) {
    return normDate(value.trim());
  }
  return null;
}

// ---------------------------------------------------------------------------
// 待办项识别与聚合
// ---------------------------------------------------------------------------

const TODO_LINE_RE = /^(\s*)[-*+] \[([ xX])\] (.*)$/;
const DATE_RES = [/📅\s*(\d{4}-\d{1,2}-\d{1,2})/, /(?:^|\s)[@＠](\d{4}-\d{1,2}-\d{1,2})/];

/** 从清单文本中提取日期（📅 YYYY-MM-DD 或 @YYYY-MM-DD）。 */
export function parseTodoDate(text: string): string | null {
  for (const re of DATE_RES) {
    const m = re.exec(text);
    if (m) return normDate(m[1]);
  }
  return null;
}

/** 写回引用的键：`路径:行号`。 */
export function refKey(path: string, line: number): string {
  return `${path}:${line}`;
}

/**
 * 聚合全部 PARA 笔记中的待办项（跳过代码块与 frontmatter）。
 * 待办笔记只收录自动区之外的手工条目，避免汇总项被重复统计。
 */
export async function collectTodoItems(
  app: App,
  folders: ParaFolderConfig[]
): Promise<TodoItem[]> {
  const todoNote = findTodoNote(app);
  const items: TodoItem[] = [];
  for (const file of app.vault.getFiles()) {
    if (file.extension !== "md") continue;
    const isTodoNote = todoNote !== null && file.path === todoNote.path;
    let folder = folders.find((f) => file.path.startsWith(`${f.path}/`));
    if (!folder) {
      // 待办笔记被拖到 PARA 文件夹之外时，手工条目单独成组。
      if (!isTodoNote) continue;
      folder = { id: "todo", name: "待办", path: "", icon: "list-todo" };
    }
    const content = await app.vault.cachedRead(file);
    const lines = content.split("\n");
    let inCodeBlock = false;
    let inAutoBlock = false;
    let inFrontmatter = false;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (i === 0 && ln.trim() === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (ln.trim() === "---") inFrontmatter = false;
        continue;
      }
      if (ln.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      if (isTodoNote) {
        if (ln.includes(TODO_AUTO_START)) {
          inAutoBlock = true;
          continue;
        }
        if (ln.includes(TODO_AUTO_END)) {
          inAutoBlock = false;
          continue;
        }
        if (inAutoBlock) continue;
      }
      const m = TODO_LINE_RE.exec(ln);
      if (!m) continue;
      items.push({
        file,
        line: i,
        checked: m[2].toLowerCase() === "x",
        text: m[3].trim(),
        date: parseTodoDate(m[3]),
        folderName: folder.name,
      });
    }
  }
  return items;
}

/** 去掉文本中待办笔记自动区的内容（避免汇总项被重复统计）。 */
export function stripTodoAutoBlock(content: string): string {
  const out: string[] = [];
  let inAuto = false;
  for (const ln of content.split("\n")) {
    if (ln.includes(TODO_AUTO_START)) {
      inAuto = true;
      continue;
    }
    if (ln.includes(TODO_AUTO_END)) {
      inAuto = false;
      continue;
    }
    if (!inAuto) out.push(ln);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// 待办笔记的生成与维护
// ---------------------------------------------------------------------------

/** 按 frontmatter 标记找到待办笔记（用户可拖到任意位置）。 */
export function findTodoNote(app: App): TFile | null {
  for (const file of app.vault.getFiles()) {
    if (file.extension !== "md") continue;
    if (app.metadataCache.getFileCache(file)?.frontmatter?.[TODO_INDEX_KEY] === true) {
      return file;
    }
  }
  return null;
}

/** 不存在则在收集箱（不存在则库根目录）创建待办笔记。 */
export async function ensureTodoNote(app: App, inboxPath: string): Promise<TFile> {
  const existing = findTodoNote(app);
  if (existing) return existing;
  const dir = app.vault.getAbstractFileByPath(inboxPath) instanceof TFolder ? inboxPath : "";
  let name = "待办";
  let i = 2;
  while (app.vault.getAbstractFileByPath(dir ? `${dir}/${name}.md` : `${name}.md`)) {
    name = `待办 ${i++}`;
  }
  const path = dir ? `${dir}/${name}.md` : `${name}.md`;
  return app.vault.create(
    path,
    `---\n${TODO_INDEX_KEY}: true\n---\n\n# ${name}\n\n${TODO_AUTO_START}\n${TODO_AUTO_END}\n`
  );
}

function todoRef(path: string, line: number): string {
  return `<!-- todo:${refKey(path, line)} -->`;
}

/** 待办笔记汇总区的完整内容（标记行之间）：统计 + 按文件夹分组。 */
function buildAutoBlock(items: TodoItem[], folders: ParaFolderConfig[]): string {
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const byDate = (a: TodoItem, b: TodoItem) => {
    if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (a.date) return -1;
    if (b.date) return 1;
    return a.file.basename.localeCompare(b.file.basename, "zh");
  };
  const lines: string[] = [];
  lines.push(
    `> 更新于 ${formatDateTime(new Date())} · 未完成 ${open.length} 项 · 已完成 ${done.length} 项`
  );
  lines.push("");
  const groupOrder = folders.map((f) => f.name);
  if (!groupOrder.includes("待办")) groupOrder.push("待办");
  for (const name of groupOrder) {
    const group = open.filter((i) => i.folderName === name).sort(byDate);
    if (group.length === 0) continue;
    lines.push(`### ${name}`);
    for (const item of group) {
      lines.push(
        `- [ ] ${item.text} [[${item.file.path}|${item.file.basename}]] ${todoRef(
          item.file.path,
          item.line
        )}`
      );
    }
    lines.push("");
  }
  if (done.length > 0) {
    lines.push("### 已完成");
    for (const item of done.sort(byDate)) {
      lines.push(
        `- [x] ${item.text} [[${item.file.path}|${item.file.basename}]] ${todoRef(
          item.file.path,
          item.line
        )}`
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * 重建待办笔记的汇总区并写回；没有待办笔记时只做聚合统计。
 * 汇总区之外的手工内容原样保留。
 */
export async function refreshTodoNote(
  app: App,
  folders: ParaFolderConfig[]
): Promise<TodoRefreshResult> {
  const items = await collectTodoItems(app, folders);
  const today = todayKey();
  const dueTodayCount = items.filter(
    (i) => !i.checked && i.date !== null && i.date <= today
  ).length;
  const checked = new Map<string, boolean>();
  for (const item of items) checked.set(refKey(item.file.path, item.line), item.checked);

  const note = findTodoNote(app);
  if (!note) return { checked, content: "", dueTodayCount };

  const block = `${TODO_AUTO_START}\n${buildAutoBlock(items, folders)}\n${TODO_AUTO_END}`;
  const content = await app.vault.read(note);
  const start = content.indexOf(TODO_AUTO_START);
  const end = content.indexOf(TODO_AUTO_END);
  let next: string;
  if (start >= 0 && end > start) {
    next = content.slice(0, start) + block + content.slice(end + TODO_AUTO_END.length);
  } else {
    // 标记被用户删掉：在末尾重新追加自动区。
    const sep = content.endsWith("\n") ? "" : "\n";
    next = `${content}${sep}\n${block}\n`;
  }
  if (next !== content) await app.vault.modify(note, next);
  return { checked, content: next, dueTodayCount };
}

// ---------------------------------------------------------------------------
// 勾选写回
// ---------------------------------------------------------------------------

const TODO_REF_LINE_RE = /^(\s*)[-*+] \[([ xX])\] .*?<!--\s*todo:(.+?)\s*-->\s*$/;

/**
 * 解析待办笔记某行的写回引用，返回 { checked, path, line }。
 * 引用格式：`<!-- todo:路径:行号 -->`（路径用最后一个冒号分隔行号）。
 */
export function parseTodoRef(line: string): { checked: boolean; path: string; line: number } | null {
  const m = TODO_REF_LINE_RE.exec(line);
  if (!m) return null;
  const ref = m[3];
  const sep = ref.lastIndexOf(":");
  if (sep < 0) return null;
  const lineNo = Number(ref.slice(sep + 1));
  if (!Number.isInteger(lineNo)) return null;
  return { checked: m[2].toLowerCase() === "x", path: ref.slice(0, sep), line: lineNo };
}

/**
 * 读取来源笔记指定行当前的勾选状态；行号错位或该行已不是待办项时返回 null。
 */
export async function readSourceLineChecked(
  app: App,
  path: string,
  line: number
): Promise<boolean | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const m = TODO_LINE_RE.exec(lines[line]);
  if (!m) return null;
  return m[2].toLowerCase() === "x";
}

/**
 * 把来源笔记指定行的复选框设为目标状态。
 * 行号错位（该行已不是待办项）时拒绝写入并返回 false，避免写错地方。
 */
export async function setSourceLineChecked(
  app: App,
  path: string,
  line: number,
  checked: boolean
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return false;
  const m = TODO_LINE_RE.exec(lines[line]);
  if (!m) return false;
  lines[line] = `${m[1]}- [${checked ? "x" : " "}] ${m[3]}`;
  await app.vault.modify(file, lines.join("\n"));
  return true;
}

/** 勾选切换：翻转待办项在来源笔记中的复选框（主页/导航共用）。 */
export async function toggleTodoItem(app: App, item: TodoItem): Promise<void> {
  await setSourceLineChecked(app, item.file.path, item.line, !item.checked);
}

// ---------------------------------------------------------------------------
// 一次性迁移：一笔记一任务 -> 清单条目
// ---------------------------------------------------------------------------

/**
 * 把 `task: true` 的任务笔记转为笔记内的 `- [ ]` 条目。
 * 标题 = 笔记名，due → `📅 YYYY-MM-DD`，done → `- [x]`；
 * 任务相关的 frontmatter 键全部清除，其他键和正文原样保留。返回迁移条数。
 */
export async function migrateTaskNotes(app: App): Promise<number> {
  let count = 0;
  for (const file of app.vault.getFiles()) {
    if (file.extension !== "md") continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fm.task !== true) continue;
    const done = fm.done === true;
    const due = frontmatterDate(fm.due);
    const itemLine = `- [${done ? "x" : " "}] ${file.basename}${due ? ` 📅 ${due}` : ""}`;
    await app.fileManager.processFrontMatter(file, (f) => {
      delete f.task;
      delete f.done;
      delete f.doneDate;
      delete f.due;
      delete f.repeat;
    });
    const content = await app.vault.read(file);
    const next = insertAfterFrontmatter(content, itemLine);
    if (next !== content) await app.vault.modify(file, next);
    count++;
  }
  return count;
}

function insertAfterFrontmatter(content: string, line: string): string {
  const m = /^---\n[\s\S]*?\n---(\n|$)/.exec(content);
  if (m) {
    const idx = m.index + m[0].length;
    return `${content.slice(0, idx)}${line}\n${content.slice(idx)}`;
  }
  return `${line}\n${content}`;
}

/** 把新任务插到待办笔记的手工区（自动区之前）；返回写入后的全文。 */
export async function insertTaskIntoTodoNote(
  app: App,
  note: TFile,
  line: string
): Promise<string> {
  const content = await app.vault.read(note);
  const idx = content.indexOf(TODO_AUTO_START);
  let next: string;
  if (idx >= 0) {
    const before = content.slice(0, idx).replace(/\s+$/, "\n\n");
    next = `${before}${line}\n${content.slice(idx)}`;
  } else {
    const sep = content.endsWith("\n") ? "" : "\n";
    next = `${content}${sep}\n${line}\n`;
  }
  await app.vault.modify(note, next);
  return next;
}

// ---------------------------------------------------------------------------
// 弹窗
// ---------------------------------------------------------------------------

/** 快速新建任务：标题 + 可选截止日期，追加到待办笔记的手工区。 */
export class QuickAddTaskModal extends Modal {
  private readonly onSubmit: (input: NewTaskInput) => void;

  constructor(app: App, onSubmit: (input: NewTaskInput) => void) {
    super(app);
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

    contentEl.createDiv({
      cls: "para-quickadd-hint",
      text: "将追加到待办笔记，可拖到任意项目 / 领域。",
    });

    const submit = () => {
      const title = titleInput.value.trim();
      if (!title) {
        new Notice("请填写任务标题。");
        return;
      }
      this.onSubmit({ title, due: dateInput.value || null });
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
      .addButton((button) => button.setButtonText("添加到待办").setCta().onClick(submit));
    titleInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
