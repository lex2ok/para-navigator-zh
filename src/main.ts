import { Plugin, MarkdownView, Notice, TFile, TFolder } from "obsidian";
import { NavigatorView, VIEW_TYPE_NAVIGATOR } from "./navigator-view";
import { StatsView, VIEW_TYPE_STATS } from "./stats-view";
import {
  QuickAddTaskModal,
  TasksView,
  VIEW_TYPE_TASKS,
} from "./tasks-view";
import type { NewTaskOptions, TaskTab } from "./tasks-view";
import { ParaNavigatorSettingTab } from "./settings-tab";
import { baseFileContent } from "./bases";
import { detectParaPaths } from "./para-detect";
import { DEFAULT_SETTINGS } from "./settings";
import type { ParaFolderConfig, ParaNavigatorSettings } from "./settings";

export default class ParaNavigatorPlugin extends Plugin {
  settings!: ParaNavigatorSettings;
  private prevNewFileLocation: unknown = null;
  private prevNewFileFolderPath: unknown = null;

  async onload(): Promise<void> {
    const data = (await this.loadData()) as Partial<ParaNavigatorSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});

    // 将分类解析为库中实际使用的名称（"收件箱"、"0-收件箱" 等）。
    // 只读：检测绝不创建、重命名或删除库内容。
    if (detectParaPaths(this.app, this.settings)) {
      await this.saveData(this.settings);
    }

    this.registerView(VIEW_TYPE_NAVIGATOR, (leaf) => new NavigatorView(leaf, this));
    this.registerView(VIEW_TYPE_STATS, (leaf) => new StatsView(leaf, this));
    this.registerView(VIEW_TYPE_TASKS, (leaf) => new TasksView(leaf, this));

    this.addRibbonIcon("compass", "打开 PARA 导航", () => void this.activateNavigator());
    this.addRibbonIcon("list-todo", "打开任务面板", () => void this.openTasks("today"));

    this.addCommand({
      id: "open-navigator",
      name: "打开导航",
      callback: () => void this.activateNavigator(),
    });
    this.addCommand({
      id: "open-tasks",
      name: "打开任务面板",
      callback: () => void this.openTasks("today"),
    });
    this.addCommand({
      id: "quick-add-task",
      name: "快速新建任务",
      callback: () => this.promptQuickAddTask(),
    });

    for (const folder of this.settings.folders) {
      this.addCommand({
        id: `open-dashboard-${folder.id}`,
        name: `打开「${folder.name}」看板`,
        callback: () => void this.openFolderDashboard(folder),
      });
    }

    this.addSettingTab(new ParaNavigatorSettingTab(this.app, this));

    this.setInboxAsNewFileLocation();
  }

  onunload(): void {
    if (this.prevNewFileLocation !== null) {
      this.app.vault.setConfig("newFileLocation", this.prevNewFileLocation);
      this.app.vault.setConfig("newFileFolderPath", this.prevNewFileFolderPath);
    }
  }

  /** 原生的"新建笔记"会落到收件箱，而不是库根目录。 */
  private setInboxAsNewFileLocation(): void {
    const inbox = this.settings.folders.find((folder) => folder.id === "inbox");
    if (!inbox) return;
    if (!(this.app.vault.getAbstractFileByPath(inbox.path) instanceof TFolder)) return;
    this.prevNewFileLocation = this.app.vault.getConfig("newFileLocation");
    this.prevNewFileFolderPath = this.app.vault.getConfig("newFileFolderPath");
    this.app.vault.setConfig("newFileLocation", "folder");
    this.app.vault.setConfig("newFileFolderPath", inbox.path);
  }

  /** 打开已打开 `file` 的标签页（如果存在），否则打开新标签页。 */
  openFileReusingTab(file: TFile): void {
    const existing = this.app.workspace
      .getLeavesOfType("markdown")
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      // revealLeaf alone does not reliably activate already-visible leaves.
      this.app.workspace.setActiveLeaf(existing, { focus: true });
    } else {
      void this.app.workspace.getLeaf("tab").openFile(file);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
  async redetectFolders(): Promise<void> {
    if (detectParaPaths(this.app, this.settings)) {
      await this.saveData(this.settings);
    }
  }
  /**
   * 创建所有配置中缺失的 PARA 文件夹。
   * 仅在用户明确点击引导按钮时执行。
   * 返回创建的文件夹数量。
   */
  async createMissingParaFolders(): Promise<number> {
    let created = 0;
    for (const folder of this.settings.folders) {
      if (!this.app.vault.getAbstractFileByPath(folder.path)) {
        await this.app.vault.createFolder(folder.path);
        created++;
      }
    }
    return created;
  }
  /**
   * 直接在 basePath 下创建一条笔记。缺少 ".md" 时自动补上。
   * 名称无效或已存在时返回 null。
   */
  async createNote(basePath: string, name: string): Promise<TFile | null> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/") || trimmed === "." || trimmed === "..") {
      new Notice("名称无效。");
      return null;
    }
    const fileName = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
    const path = `${basePath}/${fileName}`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`已存在：${path}`);
      return null;
    }
    return this.app.vault.create(path, "");
  }
  /** 返回文件夹的文件夹笔记（`X/X.md`），缺失时创建空笔记。 */
  async ensureFolderNote(folder: TFolder): Promise<TFile> {
    const path = `${folder.path}/${folder.name}.md`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    return this.app.vault.create(path, "");
  }

  /**
   * 把叶子笔记 `P/X.md` 转换为文件夹笔记 `P/X/X.md`，使其可以拥有子项。
   * 全库链接由 renameFile 自动更新。
   * 无法转换时返回 null。
   */
  async convertLeafToFolderNote(file: TFile): Promise<TFolder | null> {
    if (file.extension !== "md") return null;
    const folderPath = file.path.slice(0, -".md".length);
    const targetNotePath = `${folderPath}/${file.name}`;
    if (this.app.vault.getAbstractFileByPath(targetNotePath)) {
      new Notice(`无法转换：${targetNotePath} 已存在。`);
      return null;
    }
    const existing = this.app.vault.getAbstractFileByPath(folderPath);
    if (existing instanceof TFile) {
      new Notice(`无法转换：${folderPath} 被文件占用。`);
      return null;
    }
    if (!existing) {
      await this.app.vault.createFolder(folderPath);
    }
    await this.app.fileManager.renameFile(file, targetNotePath);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    return folder instanceof TFolder ? folder : null;
  }

  async activateNavigator(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_NAVIGATOR)[0];
    if (!leaf) {
      const left = workspace.getLeftLeaf(false);
      if (!left) return;
      await left.setViewState({ type: VIEW_TYPE_NAVIGATOR, active: true });
      leaf = left;
    }
    await workspace.revealLeaf(leaf);
  }

  /** 在右侧边栏打开任务面板（已打开则聚焦），并切到指定页签。 */
  async openTasks(tab: TaskTab = "today"): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASKS)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      await right.setViewState({ type: VIEW_TYPE_TASKS, active: true });
      leaf = right;
    }
    if (leaf.view instanceof TasksView) leaf.view.setTab(tab);
    await workspace.revealLeaf(leaf);
  }

  promptQuickAddTask(): void {
    const inbox = this.settings.folders.find((folder) => folder.id === "inbox");
    new QuickAddTaskModal(
      this.app,
      this.settings.folders,
      inbox?.path ?? "",
      (opts) => void this.quickAddTask(opts)
    ).open();
  }

  /**
   * 新建任务：创建一条独立的任务笔记（frontmatter 标记 task: true）。
   * 任务笔记就是普通笔记，可在导航器里拖进项目 / 领域。
   */
  async quickAddTask(opts: NewTaskOptions): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(opts.folderPath);
    if (!(folder instanceof TFolder)) {
      new Notice("目标文件夹不存在，请先创建或映射。");
      return;
    }
    const clean = opts.title.replace(/[\\/:*?"<>|]/g, "").trim() || "未命名任务";
    let name = clean;
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(`${folder.path}/${name}.md`)) {
      name = `${clean} ${i++}`;
    }
    const fm = ["---", "task: true"];
    if (opts.due) fm.push(`due: ${opts.due}`);
    if (opts.repeat) fm.push(`repeat: ${opts.repeat}`);
    fm.push("done: false", "---", "");
    const file = await this.app.vault.create(`${folder.path}/${name}.md`, fm.join("\n"));
    new Notice("已创建任务");
    this.openFileReusingTab(file);
  }

  /**
   * 返回该 PARA 文件夹专属的 .base 文件，仅在第一次按需创建。
   * 已存在的文件永远不会被覆盖。
   */
  async ensureBaseFile(folder: ParaFolderConfig): Promise<TFile> {
    const baseDir = this.settings.baseFolder.trim() || "仪表盘";
    if (!this.app.vault.getAbstractFileByPath(baseDir)) {
      await this.app.vault.createFolder(baseDir);
    }

    const basePath = `${baseDir}/${folder.name}.base`;
    const existing = this.app.vault.getAbstractFileByPath(basePath);
    return existing instanceof TFile ? existing : this.app.vault.create(basePath, baseFileContent(folder));
  }

  async openFolderDashboard(folder: ParaFolderConfig): Promise<void> {
    await this.openStats({
      folderPath: folder.path,
      name: folder.name,
      icon: folder.icon,
    });
  }

  /** 打开主页看板：全库总览 + 今日任务，与文件夹看板共用同一个标签页。 */
  async openHomeDashboard(): Promise<void> {
    await this.openStats({ home: true, name: "主页", icon: "home" });
  }

  private async openStats(state: {
    folderPath?: string;
    name?: string;
    icon?: string;
    home?: boolean;
  }): Promise<void> {
    // 看板全局只保留一个标签页：已打开就直接切换内容，绝不叠加新选项卡。
    // 未映射的文件夹也允许进入——看板会显示引导，
    // 并提供用户手动"创建文件夹"的操作，而不是死胡同。
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_STATS, active: true, state });
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
}
