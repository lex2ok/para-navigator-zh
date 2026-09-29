import { PluginSettingTab } from "obsidian";
import { TFolder } from "obsidian";
import type { App, SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type ParaNavigatorPlugin from "./main";
import { detectParaPaths } from "./para-detect";

/** 匹配 `folders.<id>.<field>` 形式的声明式控件键。 */
const FOLDER_KEY = /^folders\.([^.]*)\.(path|icon)$/;

export class ParaNavigatorSettingTab extends PluginSettingTab {
  private readonly plugin: ParaNavigatorPlugin;

  constructor(app: App, plugin: ParaNavigatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * display() 的声明式镜像，供 Obsidian 设置搜索使用（1.13+）。
   * 与 display() 保持同步；文件夹键形如 `folders.<id>.<field>`，
   * 由下面的 getControlValue/setControlValue 重载解析。
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    const topFolders = this.app.vault
      .getRoot()
      .children.filter((child): child is TFolder => child instanceof TFolder)
      .map((child) => child.path);

    return [
      {
        type: "group",
        heading: "PARA 文件夹",
        items: this.plugin.settings.folders.flatMap(
          (folder): SettingGroupItem[] => {
            const pathOptions: Record<string, string> = {};
            for (const path of topFolders) pathOptions[path] = path;
            pathOptions[folder.path] = folder.path;
            return [
              {
                name: folder.name,
                desc: "映射的库文件夹。",
                control: {
                  type: "dropdown",
                  key: `folders.${folder.id}.path`,
                  options: pathOptions,
                },
              },
              {
                name: `${folder.name} 图标`,
                desc: "Lucide 图标名或 emoji。",
                control: {
                  type: "text",
                  key: `folders.${folder.id}.icon`,
                  placeholder: "图标",
                },
              },
            ];
          }
        ),
      },
      {
        name: "重新检测文件夹",
        desc: "扫描顶层文件夹并匹配到五个 PARA 类别。只读——不会创建或重命名任何内容。",
        action: () => {
          if (detectParaPaths(this.app, this.plugin.settings)) {
            void this.plugin.saveSettings();
          }
          this.update();
        },
      },
      {
        name: "Base 文件文件夹",
        desc: "首次打开表格时写入各分类 .base 文件的文件夹。已存在的文件不会被覆盖。",
        control: {
          type: "text",
          key: "baseFolder",
          placeholder: "仪表盘",
        },
      },
    ];
  }

  override getControlValue(key: string): unknown {
    const match = FOLDER_KEY.exec(key);
    if (match) {
      const folder = this.plugin.settings.folders.find((f) => f.id === match[1]);
      if (folder) return folder[match[2] as "path" | "icon"];
    }
    return super.getControlValue(key);
  }

  override setControlValue(key: string, value: unknown): void {
    if (key === "baseFolder") {
      this.plugin.settings.baseFolder =
        typeof value === "string" && value.trim() ? value.trim() : "仪表盘";
      void this.plugin.saveSettings();
      return;
    }
    const match = FOLDER_KEY.exec(key);
    if (match && typeof value === "string") {
      const folder = this.plugin.settings.folders.find((f) => f.id === match[1]);
      if (folder) {
        if (match[2] === "path") folder.path = value;
        else folder.icon = value.trim() || "folder";
        void this.plugin.saveSettings();
        return;
      }
    }
    void super.setControlValue(key, value);
  }
}
