import { App, TFolder } from "obsidian";
import type { ParaNavigatorSettings } from "./settings";

/**
 * 每个 PARA 类别的候选匹配模式。对顶层文件夹名做不区分大小写匹配，
 * 容忍数字前缀如 "0-收件箱" 或 "1-项目"。
 */
const PATTERNS: Record<string, RegExp> = {
  inbox: /^(\d+[\s\-_.]*)?(inbox|收集箱|收件箱|闪念)$/i,
  projects: /^(\d+[\s\-_.]*)?(projects?|项目)$/i,
  areas: /^(\d+[\s\-_.]*)?(areas?|领域|职责)$/i,
  resources: /^(\d+[\s\-_.]*)?(resources?|资源|资料)$/i,
  archives: /^(\d+[\s\-_.]*)?(archives?|归档|存档)$/i,
};

/**
 * 把每个 PARA 类别解析到已存在的顶层文件夹。
 * 只读：绝不创建、重命名或删除库中的任何内容。
 * 至少一条路径发生变化时返回 true（调用方负责持久化设置）。
 */
export function detectParaPaths(app: App, settings: ParaNavigatorSettings): boolean {
  const root = app.vault.getRoot();
  const topFolders = root.children.filter((child): child is TFolder => child instanceof TFolder);
  let changed = false;

  for (const folder of settings.folders) {
    const current = app.vault.getAbstractFileByPath(folder.path);
    if (current instanceof TFolder) continue;

    const pattern = PATTERNS[folder.id];
    if (!pattern) continue;
    const match = topFolders.find((candidate) => pattern.test(candidate.name));
    if (match && match.path !== folder.path) {
      folder.path = match.path;
      changed = true;
    }
  }

  return changed;
}
