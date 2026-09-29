import type { ParaFolderConfig } from "./settings";

/**
 * 生成某个 PARA 文件夹专属 `.base` 文件的 YAML 内容。
 * 仅在文件不存在时写入——用户已做的修改永远不会被覆盖。
 */
export function baseFileContent(folder: ParaFolderConfig): string {
  return [
    "filters:",
    "  and:",
    `    - file.inFolder("${folder.path}")`,
    `    - 'file.ext == "md"'`,
    "",
    "views:",
    "  - type: table",
    '    name: "全部笔记"',
    "    order:",
    "      - file.name",
    "      - file.ctime",
    "      - file.mtime",
    "      - file.tags",
    "      - file.size",
    "",
    "  - type: cards",
    '    name: "卡片"',
    "    order:",
    "      - file.name",
    "      - file.mtime",
    "",
  ].join("\n");
}
