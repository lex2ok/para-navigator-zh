export interface ParaFolderConfig {
  /** 稳定分类键：inbox | projects | areas | resources | archives */
  id: string;
  /** 导航器中显示的名称 */
  name: string;
  /** 解析后的库路径——加载时自动检测，可在设置中修改 */
  path: string;
  /** Lucide 图标名 */
  icon: string;
}

export interface ParaNavigatorSettings {
  folders: ParaFolderConfig[];
  /** 生成的 .base 文件写入的库文件夹（仅按需创建） */
  baseFolder: string;
  /** 每个文件夹路径的自定义子项排序，由拖拽设置 */
  sortOrder: Record<string, string[]>;
  /** 各子层级节点路径的自定义 lucide 图标（顶层图标存于 folders[].icon） */
  nodeIcons: Record<string, string>;
  /** 各路径的名称显示颜色，全部层级适用 */
  nameColors: Record<string, string>;
  /** 旧任务笔记（task: true）是否已迁移为清单条目 */
  taskNotesMigrated: boolean;
}

export const DEFAULT_SETTINGS: ParaNavigatorSettings = {
  folders: [
    { id: "inbox", name: "收集", path: "收集", icon: "inbox" },
    { id: "projects", name: "项目", path: "项目", icon: "rocket" },
    { id: "areas", name: "领域", path: "领域", icon: "layers" },
    { id: "resources", name: "资源", path: "资源", icon: "library" },
    { id: "archives", name: "归档", path: "归档", icon: "archive" },
  ],
  baseFolder: "仪表盘",
  sortOrder: {},
  nodeIcons: {},
  nameColors: {},
  taskNotesMigrated: false,
};
