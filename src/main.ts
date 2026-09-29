import { Plugin, MarkdownView, Notice, TFile, TFolder } from "obsidian";
import type { TAbstractFile } from "obsidian";
import { NavigatorView, VIEW_TYPE_NAVIGATOR } from "./navigator-view";
import { StatsView, VIEW_TYPE_STATS } from "./stats-view";
import {
  QuickAddTaskModal,
  TODO_INDEX_KEY,
  insertTaskIntoTodoNote,
  ensureTodoNote,
  migrateTaskNotes,
  parseTodoRef,
  readSourceLineChecked,
  refKey,
  refreshTodoNote,
  setSourceLineChecked,
} from "./todo";
import type { NewTaskInput } from "./todo";
import { ParaNavigatorSettingTab } from "./settings-tab";
import { baseFileContent } from "./bases";
import { detectParaPaths } from "./para-detect";
import { DEFAULT_SETTINGS } from "./settings";
import type { ParaFolderConfig, ParaNavigatorSettings } from "./settings";

/** 主页看板的板块锚点：导航栏「主页」子行点击后滚动到对应板块。 */
export type HomeSection = "tasks" | "projects";

export default class ParaNavigatorPlugin extends Plugin {
  settings!: ParaNavigatorSettings;
  private prevNewFileLocation: unknown = null;
  private prevNewFileFolderPath: unknown = null;

  /** 待办写回快照：写回引用 -> 勾选状态 */
  private todoChecked = new Map<string, boolean>();
  /** 待办笔记最新全文（识别我们自己的写入） */
  private lastTodoContent = "";
  /** 今天到期的未完成待办数（含逾期，供导航栏计数） */
  todoDueTodayCount = 0;
  private todoTimer: number | null = null;

  async onload(): Promise<void> {
    const data = (await this.loadData()) as Partial<ParaNavigatorSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});

    // 「收件箱」→「收集」：老用户无缝迁移（0.1.2 起）。
    await this.migrateInboxToCollect();

    // 将分类解析为库中实际使用的名称（"收集"、"0-收集" 等）。
    // 只读：检测绝不创建、重命名或删除库内容。
    if (detectParaPaths(this.app, this.settings)) {
      await this.saveData(this.settings);
    }

    this.registerView(VIEW_TYPE_NAVIGATOR, (leaf) => new NavigatorView(leaf, this));
    this.registerView(VIEW_TYPE_STATS, (leaf) => new StatsView(leaf, this));

    this.addRibbonIcon("compass", "打开 PARA 导航", () => void this.activateNavigator());
    this.addRibbonIcon("list-todo", "打开待办笔记", () => void this.openTodoNote());

    this.addCommand({
      id: "open-navigator",
      name: "打开导航",
      callback: () => void this.activateNavigator(),
    });
    this.addCommand({
      id: "open-todo",
      name: "打开待办笔记",
      callback: () => void this.openTodoNote(),
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

    // 关掉最后一个标签页时不留空白页，直接回到主页看板。
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.redirectEmptyLeaves())
    );

    // 待办笔记自动维护：库变化时防抖重建汇总区；待办笔记自身的修改走勾选写回。
    const scheduleTodo = () => this.scheduleTodoRefresh();
    this.registerEvent(this.app.vault.on("create", scheduleTodo));
    this.registerEvent(this.app.vault.on("delete", scheduleTodo));
    this.registerEvent(this.app.vault.on("rename", scheduleTodo));
    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultModify(file)));
    this.registerEvent(this.app.metadataCache.on("changed", scheduleTodo));
    this.app.workspace.onLayoutReady(() => {
      void this.initTodoNote();
    });

    this.setInboxAsNewFileLocation();
  }

  onunload(): void {
    if (this.prevNewFileLocation !== null) {
      this.app.vault.setConfig("newFileLocation", this.prevNewFileLocation);
      this.app.vault.setConfig("newFileFolderPath", this.prevNewFileFolderPath);
    }
  }

  /**
   * 「收件箱」→「收集」迁移：显示名直接改；磁盘上的收件箱文件夹在无重名冲突时
   * 一并重命名为「收集」（笔记内链由 fileManager 自动更新）。
   * 用户自定义过的名称/路径（≠"收件箱"）一律不动。
   */
  private async migrateInboxToCollect(): Promise<void> {
    const inbox = this.settings.folders.find((folder) => folder.id === "inbox");
    if (!inbox) return;
    let changed = false;
    if (inbox.name === "收件箱") {
      inbox.name = "收集";
      changed = true;
    }
    if (inbox.path === "收件箱") {
      const oldFolder = this.app.vault.getAbstractFileByPath("收件箱");
      const clash = this.app.vault.getAbstractFileByPath("收集");
      if (oldFolder instanceof TFolder && !(clash instanceof TFolder)) {
        await this.app.fileManager.renameFile(oldFolder, "收集");
      }
      inbox.path = "收集";
      changed = true;
    }
    if (changed) await this.saveData(this.settings);
  }

  /** 原生的"新建笔记"会落到收集，而不是库根目录。 */
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

  /**
   * 把空白标签页（view type "empty"）替换为主页看板：
   * 关闭最后一个标签页（或新建空白标签页）后直接回到主页，而不是停在空白页。
   */
  private redirectEmptyLeaves(): void {
    const leaves = this.app.workspace.getLeavesOfType("empty");
    for (const leaf of leaves) {
      void leaf.setViewState({
        type: VIEW_TYPE_STATS,
        active: true,
        state: { home: true, name: "主页", icon: "home" },
      });
    }
  }

  /** 打开待办笔记（不存在则创建）。待办笔记是普通笔记，可拖到任意项目 / 领域。 */
  async openTodoNote(): Promise<void> {
    const note = await this.ensureTodo();
    this.openFileReusingTab(note);
  }

  private async ensureTodo(): Promise<TFile> {
    const inbox = this.settings.folders.find((folder) => folder.id === "inbox");
    return ensureTodoNote(this.app, inbox?.path ?? "");
  }

  /** 布局就绪后：确保待办笔记、一次性迁移旧任务笔记、初始重建汇总区。 */
  private async initTodoNote(): Promise<void> {
    await this.ensureTodo();
    if (!this.settings.taskNotesMigrated) {
      const n = await migrateTaskNotes(this.app);
      this.settings.taskNotesMigrated = true;
      await this.saveSettings();
      if (n > 0) new Notice(`已将 ${n} 条任务笔记转为待办条目`);
    }
    await this.refreshTodoNoteNow();
  }

  private scheduleTodoRefresh(): void {
    if (this.todoTimer !== null) window.clearTimeout(this.todoTimer);
    this.todoTimer = window.setTimeout(() => {
      this.todoTimer = null;
      void this.refreshTodoNoteNow();
    }, 600);
  }

  private async refreshTodoNoteNow(): Promise<void> {
    const result = await refreshTodoNote(this.app, this.settings.folders);
    this.todoChecked = result.checked;
    this.lastTodoContent = result.content;
    this.todoDueTodayCount = result.dueTodayCount;
    this.refreshNavigatorCounts();
  }

  /** 待办数据变化后刷新导航栏的任务计数。 */
  private refreshNavigatorCounts(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_NAVIGATOR)) {
      if (leaf.view instanceof NavigatorView) leaf.view.refreshCounts();
    }
  }

  private onVaultModify(file: TAbstractFile): void {
    if (file instanceof TFile) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.[TODO_INDEX_KEY] === true) {
        void this.handleTodoNoteModify(file);
        return;
      }
    }
    this.scheduleTodoRefresh();
  }

  /**
   * 待办笔记被用户修改：找出勾选翻转的汇总项，写回原笔记。
   * 我们自己的写入（内容与快照一致）直接忽略。
   * 写回前先读来源笔记的当前状态做二次确认：来源已经是目标状态时，
   * 说明只是汇总重建在"追"来源的变化，更新快照即可，不写回也不打扰用户。
   */
  private async handleTodoNoteModify(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    if (content === this.lastTodoContent) return;
    let synced = 0;
    for (const ln of content.split("\n")) {
      const parsed = parseTodoRef(ln);
      if (!parsed) continue;
      const key = refKey(parsed.path, parsed.line);
      const prev = this.todoChecked.get(key);
      if (prev === undefined || prev === parsed.checked) continue;
      const srcChecked = await readSourceLineChecked(this.app, parsed.path, parsed.line);
      if (srcChecked === null) continue; // 行号错位：等下次重建刷新引用
      if (srcChecked === parsed.checked) {
        this.todoChecked.set(key, parsed.checked);
        continue;
      }
      if (await setSourceLineChecked(this.app, parsed.path, parsed.line, parsed.checked)) {
        this.todoChecked.set(key, parsed.checked);
        synced++;
      }
    }
    if (synced > 0) new Notice(`已同步 ${synced} 项到原笔记`);
    // 来源笔记的 modify 事件会触发防抖重建，这里再排一次确保快照新鲜。
    this.scheduleTodoRefresh();
  }

  promptQuickAddTask(): void {
    new QuickAddTaskModal(this.app, (input) => void this.quickAddTask(input)).open();
  }

  /** 快速新建任务：追加到待办笔记的手工区（汇总区之前）。 */
  async quickAddTask(input: NewTaskInput): Promise<void> {
    const note = await this.ensureTodo();
    const clean = input.title.replace(/[\\/:*?"<>|]/g, "").trim() || "未命名任务";
    const line = `- [ ] ${clean}${input.due ? ` 📅 ${input.due}` : ""}`;
    const next = await insertTaskIntoTodoNote(this.app, note, line);
    this.lastTodoContent = next;
    new Notice("已添加到待办");
    this.scheduleTodoRefresh();
    this.openFileReusingTab(note);
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

  /**
   * 打开主页看板：任务（今天到期）+ 项目（进行中），与文件夹看板共用同一个标签页。
   * 传 section 时打开后滚动到对应板块。
   */
  async openHomeDashboard(section?: HomeSection): Promise<void> {
    await this.openStats({ home: true, name: "主页", icon: "home", section });
    if (section) {
      // 等看板完成显示后再滚动，避免 setViewState 尚未可见时滚动无效。
      requestAnimationFrame(() => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS)[0];
        const el = leaf?.view.containerEl.querySelector(`[data-home-section="${section}"]`);
        el?.scrollIntoView({ block: "start" });
      });
    }
  }

  private async openStats(state: {
    folderPath?: string;
    name?: string;
    icon?: string;
    home?: boolean;
    section?: HomeSection;
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
