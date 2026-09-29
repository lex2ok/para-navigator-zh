import { App, TFile, TFolder } from "obsidian";

/**
 * 项目状态，存放在项目文件夹笔记（`项目/X/X.md`）的 frontmatter `status` 字段：
 * ---
 * status: 进行
 * ---
 * 取值只有「计划」和「进行」两种；缺失或非法值视为未设置（按「计划」处理，
 * 不会出现在主页的项目板块里）。
 */
export type ProjectStatus = "计划" | "进行";

export interface ActiveProject {
  folder: TFolder;
  noteCount: number;
  /** 文件夹内最近一条笔记的修改时间（毫秒），用于"活跃"排序 */
  latestMtime: number;
}

/** 读取项目文件夹的状态；未设置时返回 null。 */
export function getProjectStatus(app: App, folder: TFolder): ProjectStatus | null {
  const note = app.vault.getAbstractFileByPath(`${folder.path}/${folder.name}.md`);
  if (!(note instanceof TFile)) return null;
  const status = app.metadataCache.getFileCache(note)?.frontmatter?.status;
  return status === "进行" || status === "计划" ? status : null;
}

/** 把项目文件夹的状态写入其文件夹笔记的 frontmatter。 */
export async function setProjectStatus(
  app: App,
  ensureFolderNote: (folder: TFolder) => Promise<TFile>,
  folder: TFolder,
  status: ProjectStatus
): Promise<void> {
  const note = await ensureFolderNote(folder);
  await app.fileManager.processFrontMatter(note, (fm) => {
    fm.status = status;
  });
}

/**
 * 收集「项目」顶层文件夹下状态为「进行」的直接子文件夹（即活跃项目），
 * 按最近修改时间倒序排列。
 */
export function collectActiveProjects(app: App, projectsPath: string | undefined): ActiveProject[] {
  if (!projectsPath) return [];
  const root = app.vault.getAbstractFileByPath(projectsPath);
  if (!(root instanceof TFolder)) return [];
  const result: ActiveProject[] = [];
  for (const child of root.children) {
    if (!(child instanceof TFolder)) continue;
    if (getProjectStatus(app, child) !== "进行") continue;
    const prefix = `${child.path}/`;
    let noteCount = 0;
    let latestMtime = 0;
    for (const file of app.vault.getFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      noteCount++;
      if (file.stat.mtime > latestMtime) latestMtime = file.stat.mtime;
    }
    result.push({ folder: child, noteCount, latestMtime });
  }
  result.sort((a, b) => b.latestMtime - a.latestMtime || a.folder.name.localeCompare(b.folder.name));
  return result;
}
