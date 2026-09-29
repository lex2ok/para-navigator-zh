import { ItemView, MarkdownRenderer, TFolder, setIcon } from "obsidian";
import type { TFile, WorkspaceLeaf, ViewStateResult } from "obsidian";
import type ParaNavigatorPlugin from "./main";
import { renderIconValue } from "./pickers";
import { getTaskMeta, collectTaskNotes, toggleTaskDone, formatDueShort, todayKey } from "./tasks-view";

export const VIEW_TYPE_STATS = "para-folder-stats";

interface StatsViewState {
  folderPath?: string;
  name?: string;
  icon?: string;
  /** 主页模式：聚合全部 PARA 文件夹的总览 */
  home?: boolean;
}

interface FileMetrics {
  words: number;
  tasksOpen: number;
  tasksDone: number;
}

interface FolderStats {
  noteCount: number;
  subfolderCount: number;
  totalWords: number;
  totalBytes: number;
  tasksOpen: number;
  tasksDone: number;
  tags: [string, number][];
  recent: { file: TFile; words: number }[];
}


export class StatsView extends ItemView {
  private readonly plugin: ParaNavigatorPlugin;
  private state: StatsViewState = {};
  /** 自动刷新的防抖计时器 */
  private refreshTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ParaNavigatorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_STATS;
  }

  getDisplayText(): string {
    return this.state.name ? `${this.state.name} 看板` : "文件夹统计";
  }

  getIcon(): string {
    return "chart-column";
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  async setState(state: StatsViewState, result: ViewStateResult): Promise<void> {
    this.state = state ?? {};
    await this.refresh();
    result.history = false;
  }

  async onOpen(): Promise<void> {
    // 文件增删改、重命名、任务 frontmatter 变化时自动刷新，不用再点右上角的同步按钮。
    const schedule = () => {
      if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = null;
        void this.refresh();
      }, 600);
    };
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
    this.registerEvent(this.app.metadataCache.on("changed", schedule));
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("para-stats");

    const { folderPath, name, icon, home } = this.state;
    if (home) {
      await this.renderHome(container);
      return;
    }
    if (!folderPath) {
      container.createDiv({ cls: "para-stats-empty", text: "请从 PARA 导航中打开统计面板。" });
      return;
    }

    const abstract = this.app.vault.getAbstractFileByPath(folderPath);
    const folderConfig = this.plugin.settings.folders.find((entry) => entry.path === folderPath);
    if (!(abstract instanceof TFolder)) {
      const empty = container.createDiv("para-stats-empty");
      empty.createEl("p", {
        text: `"${name ?? folderPath}" 尚未映射到已存在的文件夹。`,
      });
      empty.createEl("p", {
        cls: "para-stats-hint",
        text: "创建标准文件夹，或在设置中把该类别映射到已有文件夹。",
      });
      const actions = empty.createDiv("para-stats-empty-actions");
      const createButton = actions.createEl("button", { text: `创建文件夹"${folderPath}"` });
      createButton.addEventListener("click", () => {
        void this.app.vault.createFolder(folderPath).then(() => this.refresh());
      });
      const detectButton = actions.createEl("button", { text: "重新检测文件夹" });
      detectButton.addEventListener("click", () => {
        void this.plugin.redetectFolders().then(() => this.refresh());
      });
      return;
    }

    const stats = await this.collectStats(folderPath);

    const header = container.createDiv("para-stats-header");
    const iconEl = header.createSpan("para-stats-icon");
    renderIconValue(iconEl, icon ?? "folder");
    header.createEl("h2", { text: name ?? folderPath });
    const refreshIcon = header.createSpan("para-stats-refresh");
    refreshIcon.setAttr("role", "button");
    refreshIcon.setAttr("tabindex", "0");
    refreshIcon.setAttr("aria-label", "刷新统计");
    setIcon(refreshIcon, "refresh-cw");
    refreshIcon.addEventListener("click", () => void this.refresh());
    refreshIcon.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        void this.refresh();
      }
    });

    header.createDiv({ cls: "para-stats-path", text: folderPath });

    const cards = container.createDiv("para-stats-cards");
    this.renderCard(cards, "file-text", "笔记", String(stats.noteCount));
    this.renderCard(cards, "folder", "子文件夹", String(stats.subfolderCount));
    this.renderCard(cards, "whole-word", "字数", stats.totalWords.toLocaleString());
    this.renderCard(cards, "hard-drive", "大小", this.formatBytes(stats.totalBytes));
    this.renderCard(
      cards,
      "list-todo",
      "任务",
      stats.tasksOpen + stats.tasksDone > 0
        ? `已完成 ${stats.tasksDone} / ${stats.tasksOpen + stats.tasksDone}`
        : "无"
    );

    if (stats.tags.length > 0) {
      const tagSection = container.createDiv("para-stats-section");
      tagSection.createEl("h3", { text: "热门标签" });
      const tagList = tagSection.createDiv("para-stats-tags");
      for (const [tag, count] of stats.tags) {
        const chip = tagList.createSpan("para-stats-tag");
        chip.createSpan({ text: `#${tag}` });
        chip.createSpan({ cls: "para-stats-tag-count", text: String(count) });
      }
    }

    const recentSection = container.createDiv("para-stats-section");
    recentSection.createEl("h3", { text: "最近修改" });
    if (stats.recent.length === 0) {
      recentSection.createDiv({ cls: "para-stats-empty", text: "该文件夹中还没有笔记。" });
    } else {
      const table = recentSection.createEl("table", { cls: "para-stats-table" });
      const headRow = table.createEl("thead").createEl("tr");
      for (const label of ["笔记", "修改时间", "字数"]) {
        headRow.createEl("th", { text: label });
      }
      const tbody = table.createEl("tbody");
      for (const { file, words } of stats.recent) {
        const row = tbody.createEl("tr");
        const nameCell = row.createEl("td");
        const link = nameCell.createEl("a", { text: file.basename, cls: "internal-link" });
        link.setAttr("aria-label", `打开 ${file.basename}`);
        link.addEventListener("click", () => this.plugin.openFileReusingTab(file));
        row.createEl("td", { text: this.formatDateTime(file.stat.mtime) });
        row.createEl("td", { text: String(words) });
      }
    }
    if (folderConfig) {
      const tableSection = container.createDiv("para-stats-section");
      tableSection.createEl("h3", { text: "表格" });
      const baseContainer = tableSection.createDiv("para-stats-base");
      const baseFile = await this.plugin.ensureBaseFile(folderConfig);
      await MarkdownRenderer.render(this.app, `![[${baseFile.path}]]`, baseContainer, baseFile.path, this);
    }
  }

  /** 主页看板：聚合全部 PARA 文件夹的总览 + 今日任务。 */
  private async renderHome(container: HTMLElement): Promise<void> {
    const folders = this.plugin.settings.folders;
    const existing = folders.filter(
      (f) => this.app.vault.getAbstractFileByPath(f.path) instanceof TFolder
    );

    const header = container.createDiv("para-stats-header");
    const iconEl = header.createSpan("para-stats-icon");
    renderIconValue(iconEl, this.state.icon ?? "home");
    header.createEl("h2", { text: "主页" });
    const refreshIcon = header.createSpan("para-stats-refresh");
    refreshIcon.setAttr("role", "button");
    refreshIcon.setAttr("tabindex", "0");
    refreshIcon.setAttr("aria-label", "刷新统计");
    setIcon(refreshIcon, "refresh-cw");
    refreshIcon.addEventListener("click", () => void this.refresh());
    refreshIcon.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        void this.refresh();
      }
    });
    header.createDiv({ cls: "para-stats-path", text: "全部 PARA 文件夹总览" });

    let noteCount = 0;
    let subfolderCount = 0;
    let totalWords = 0;
    let totalBytes = 0;
    const perFolder: { config: (typeof folders)[number]; stats: FolderStats }[] = [];
    for (const config of existing) {
      const stats = await this.collectStats(config.path);
      perFolder.push({ config, stats });
      noteCount += stats.noteCount;
      subfolderCount += stats.subfolderCount;
      totalWords += stats.totalWords;
      totalBytes += stats.totalBytes;
    }

    const tasks = collectTaskNotes(this.app, folders);
    const openCount = tasks.filter((t) => !t.done).length;

    const cards = container.createDiv("para-stats-cards");
    this.renderCard(cards, "file-text", "笔记", String(noteCount));
    this.renderCard(cards, "folder", "文件夹", String(existing.length));
    this.renderCard(cards, "whole-word", "字数", totalWords.toLocaleString());
    this.renderCard(cards, "hard-drive", "大小", this.formatBytes(totalBytes));
    this.renderCard(cards, "list-todo", "待办任务", String(openCount));

    // 今日任务：逾期 + 今天到期的未完成任务，可直接勾选
    const today = todayKey();
    const dueTasks = tasks
      .filter((t) => !t.done && t.due !== null && t.due <= today)
      .sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0));
    const taskSection = container.createDiv("para-stats-section");
    taskSection.createEl("h3", {
      text: `今日任务${dueTasks.length > 0 ? `（${dueTasks.length}）` : ""}`,
    });
    if (dueTasks.length === 0) {
      taskSection.createDiv({ cls: "para-stats-empty", text: "今天没有到期的任务。" });
    } else {
      const list = taskSection.createDiv("para-home-tasks");
      for (const task of dueTasks) {
        const row = list.createDiv("para-home-task");
        const check = row.createEl("input", { type: "checkbox" });
        check.setAttr("aria-label", `完成 ${task.title}`);
        check.addEventListener("change", () => void toggleTaskDone(this.app, task));
        const title = row.createSpan({ cls: "para-home-task-title", text: task.title });
        title.setAttr("role", "button");
        title.setAttr("tabindex", "0");
        title.setAttr("aria-label", `打开 ${task.title}`);
        const openFile = () => void this.plugin.openFileReusingTab(task.file);
        title.addEventListener("click", openFile);
        title.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            openFile();
          }
        });
        const overdue = task.due! < today;
        row.createSpan({
          cls: `para-home-task-due${overdue ? " is-overdue" : ""}`,
          text: overdue ? `逾期 ${formatDueShort(task.due!)}` : "今天",
        });
        row.createSpan({ cls: "para-task-source", text: task.folderName });
      }
    }

    // 文件夹一览：点行跳转到该文件夹看板
    const folderSection = container.createDiv("para-stats-section");
    folderSection.createEl("h3", { text: "文件夹一览" });
    const table = folderSection.createEl("table", { cls: "para-stats-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["文件夹", "笔记", "待办任务", "最近修改"]) {
      headRow.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    for (const { config, stats } of perFolder) {
      const row = tbody.createEl("tr");
      row.addClass("para-home-folder-row");
      row.setAttr("role", "button");
      row.setAttr("tabindex", "0");
      row.setAttr("aria-label", `打开「${config.name}」看板`);
      const open = () => void this.plugin.openFolderDashboard(config);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          open();
        }
      });
      row.createEl("td", { text: config.name });
      row.createEl("td", { text: String(stats.noteCount) });
      row.createEl("td", { text: String(stats.tasksOpen) });
      const latest = stats.recent[0]?.file.stat.mtime;
      row.createEl("td", { text: latest ? this.formatDateTime(latest) : "—" });
    }

    // 最近修改：横跨全部文件夹
    const recent = perFolder
      .flatMap(({ config, stats }) =>
        stats.recent.map((r) => ({ ...r, folderName: config.name }))
      )
      .sort((a, b) => b.file.stat.mtime - a.file.stat.mtime)
      .slice(0, 10);
    const recentSection = container.createDiv("para-stats-section");
    recentSection.createEl("h3", { text: "最近修改" });
    if (recent.length === 0) {
      recentSection.createDiv({ cls: "para-stats-empty", text: "还没有笔记。" });
    } else {
      const recentTable = recentSection.createEl("table", { cls: "para-stats-table" });
      const recentHead = recentTable.createEl("thead").createEl("tr");
      for (const label of ["笔记", "所属", "修改时间", "字数"]) {
        recentHead.createEl("th", { text: label });
      }
      const recentBody = recentTable.createEl("tbody");
      for (const { file, words, folderName } of recent) {
        const row = recentBody.createEl("tr");
        const nameCell = row.createEl("td");
        const link = nameCell.createEl("a", { text: file.basename, cls: "internal-link" });
        link.setAttr("aria-label", `打开 ${file.basename}`);
        link.addEventListener("click", () => this.plugin.openFileReusingTab(file));
        row.createEl("td", { text: folderName });
        row.createEl("td", { text: this.formatDateTime(file.stat.mtime) });
        row.createEl("td", { text: String(words) });
      }
    }
  }

  private formatDateTime(mtime: number): string {
    const d = new Date(mtime);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private renderCard(parent: HTMLElement, iconName: string, label: string, value: string): void {
    const card = parent.createDiv("para-stats-card");
    const icon = card.createSpan("para-stats-card-icon");
    setIcon(icon, iconName);
    card.createDiv({ cls: "para-stats-card-value", text: value });
    card.createDiv({ cls: "para-stats-card-label", text: label });
  }

  private async collectStats(folderPath: string): Promise<FolderStats> {
    const prefix = `${folderPath}/`;
    const files = this.app.vault.getFiles().filter((file) => file.path.startsWith(prefix));
    const subfolders = new Set<string>();
    const tagCounts: Record<string, number> = {};
    const metrics = new Map<string, FileMetrics>();

    let totalWords = 0;
    let totalBytes = 0;
    let tasksOpen = 0;
    let tasksDone = 0;

    for (const file of files) {
      totalBytes += file.stat.size;
      const relativeParent = file.parent?.path.slice(prefix.length) ?? "";
      if (relativeParent.includes("/")) {
        subfolders.add(relativeParent.split("/")[0]);
      } else if (relativeParent.length > 0) {
        subfolders.add(relativeParent);
      }

      const cache = this.app.metadataCache.getFileCache(file);
      for (const tag of cache?.tags ?? []) {
        const key = tag.tag.replace(/^#/, "");
        tagCounts[key] = (tagCounts[key] ?? 0) + 1;
      }

      const taskMeta = getTaskMeta(this.app, file);
      const content = await this.app.vault.cachedRead(file);
      const words = content.split(/\s+/).filter((word) => word.length > 0).length;
      totalWords += words;
      if (taskMeta) {
        // 任务笔记：按 frontmatter 的完成状态计数，不再数里面的复选框，避免重复
        if (taskMeta.done) tasksDone++;
        else tasksOpen++;
        metrics.set(file.path, { words, tasksOpen: 0, tasksDone: 0 });
      } else {
        const open = (content.match(/^\s*[-*+] \[ \]/gm) ?? []).length;
        const done = (content.match(/^\s*[-*+] \[x\]/gim) ?? []).length;
        tasksOpen += open;
        tasksDone += done;
        metrics.set(file.path, { words, tasksOpen: open, tasksDone: done });
      }
    }

    const recent = files
      .slice()
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 10)
      .map((file) => ({ file, words: metrics.get(file.path)?.words ?? 0 }));

    const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    return {
      noteCount: files.length,
      subfolderCount: subfolders.size,
      totalWords,
      totalBytes,
      tasksOpen,
      tasksDone,
      tags,
      recent,
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
