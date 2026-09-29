import { ItemView, MarkdownRenderer, TFolder, setIcon } from "obsidian";
import type { TFile, WorkspaceLeaf, ViewStateResult } from "obsidian";
import type ParaNavigatorPlugin from "./main";
import type { HomeSection } from "./main";
import { renderIconValue } from "./pickers";
import {
  collectTodoItems,
  findTodoNote,
  formatDueShort,
  stripTodoAutoBlock,
  todayKey,
  toggleTodoItem,
} from "./todo";
import type { TodoItem } from "./todo";
import { collectActiveProjects } from "./projects";

export const VIEW_TYPE_STATS = "para-folder-stats";

interface StatsViewState {
  folderPath?: string;
  name?: string;
  icon?: string;
  /** 主页模式：只显示任务 + 项目两个板块 */
  home?: boolean;
  /** 主页滚动锚点：导航栏「主页」子行跳转用 */
  section?: HomeSection;
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

  /** 主页看板：两个板块——今天到期的任务 + 进行中的项目。 */
  private async renderHome(container: HTMLElement): Promise<void> {
    const folders = this.plugin.settings.folders;

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
    header.createDiv({ cls: "para-stats-path", text: "今天到期任务 · 进行中项目" });

    // 板块一：任务——今天到期的未完成待办条目（含逾期），可直接勾选
    const items = await collectTodoItems(this.app, folders);
    const today = todayKey();
    const dueTasks = items
      .filter((t) => !t.checked && t.date !== null && t.date <= today)
      .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
    const taskSection = container.createDiv("para-stats-section");
    taskSection.setAttr("data-home-section", "tasks");
    taskSection.createEl("h3", {
      text: `任务${dueTasks.length > 0 ? `（${dueTasks.length}）` : ""}`,
    });
    if (dueTasks.length === 0) {
      taskSection.createDiv({ cls: "para-stats-empty", text: "今天没有到期的任务。" });
    } else {
      const list = taskSection.createDiv("para-home-tasks");
      for (const task of dueTasks) {
        const row = list.createDiv("para-home-task");
        const check = row.createEl("input", { type: "checkbox" });
        check.setAttr("aria-label", `完成 ${task.text}`);
        check.addEventListener("change", () => void toggleTodoItem(this.app, task));
        const title = row.createSpan({ cls: "para-home-task-title", text: task.text });
        title.setAttr("role", "button");
        title.setAttr("tabindex", "0");
        title.setAttr("aria-label", `打开 ${task.text}`);
        const openFile = () => void this.plugin.openFileReusingTab(task.file);
        title.addEventListener("click", openFile);
        title.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            openFile();
          }
        });
        const overdue = task.date! < today;
        row.createSpan({
          cls: `para-home-task-due${overdue ? " is-overdue" : ""}`,
          text: overdue ? `逾期 ${formatDueShort(task.date!)}` : "今天",
        });
        row.createSpan({ cls: "para-task-source", text: task.file.basename });
      }
    }

    // 板块二：项目——状态为「进行」的项目（状态存在项目文件夹笔记的 frontmatter）
    const projectsPath = folders.find((f) => f.id === "projects")?.path;
    const active = collectActiveProjects(this.app, projectsPath);
    const projSection = container.createDiv("para-stats-section");
    projSection.setAttr("data-home-section", "projects");
    projSection.createEl("h3", {
      text: `项目${active.length > 0 ? `（${active.length}）` : ""}`,
    });
    if (active.length === 0) {
      const empty = projSection.createDiv("para-stats-empty");
      empty.createEl("p", { text: "还没有进行中的项目。" });
      empty.createEl("p", {
        cls: "para-stats-hint",
        text: "在「项目」文件夹的子文件夹上点右键，选择「设为进行」即可显示在这里。",
      });
    } else {
      const list = projSection.createDiv("para-home-projects");
      for (const { folder, noteCount, latestMtime } of active) {
        const row = list.createDiv("para-home-project");
        const nameEl = row.createSpan({ cls: "para-home-project-name", text: folder.name });
        nameEl.setAttr("role", "button");
        nameEl.setAttr("tabindex", "0");
        nameEl.setAttr("aria-label", `打开项目 ${folder.name} 的笔记`);
        const openProject = async () => {
          const note = await this.plugin.ensureFolderNote(folder);
          this.plugin.openFileReusingTab(note);
        };
        nameEl.addEventListener("click", () => void openProject());
        nameEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            void openProject();
          }
        });
        row.createSpan({ cls: "para-task-source", text: `${noteCount} 条笔记` });
        if (latestMtime > 0) {
          row.createSpan({
            cls: "para-home-project-latest",
            text: `最近修改 ${this.formatDateTime(latestMtime)}`,
          });
        }
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
    const todoNote = findTodoNote(this.app);

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

      let content = await this.app.vault.cachedRead(file);
      // 待办笔记：只统计手工条目，汇总区是其他笔记的镜像，不重复计数
      if (todoNote !== null && file.path === todoNote.path) {
        content = stripTodoAutoBlock(content);
      }
      const words = content.split(/\s+/).filter((word) => word.length > 0).length;
      totalWords += words;
      const open = (content.match(/^\s*[-*+] \[ \]/gm) ?? []).length;
      const done = (content.match(/^\s*[-*+] \[x\]/gim) ?? []).length;
      tasksOpen += open;
      tasksDone += done;
      metrics.set(file.path, { words, tasksOpen: open, tasksDone: done });
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
