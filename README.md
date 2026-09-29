# PARA Navigator（中文版）

基于 PARA 方法论的 Obsidian 侧边栏导航插件：五大文件夹（收件箱 / 项目 / 领域 / 资源 / 归档）的树形导航、统计看板、任务管理。

上游原版：[hjxarthuratlas/PARA-Navigator](https://github.com/hjxarthuratlas/PARA-Navigator)（英文）。本仓库为中文 fork，界面文案、设置页、命令、通知均为中文，并新增了任务管理与主页看板。

## 功能

- 📂 PARA 侧边栏导航：文件夹树、拖拽移动笔记、计数徽标
- 🏠 主页看板：全库总览卡片、今日任务、文件夹一览、最近修改（自动刷新）
- 📊 文件夹看板：点文件夹整行进入，与看板共用一个标签页、不叠加
- ✅ 任务管理：一笔记一任务，支持截止日期、重复任务（每天/每周/每月）、拖拽归类
- 📑 Bases 表格：每个文件夹自动生成 `.base` 表格视图

## 安装（推荐：BRAT）

1. 在 Obsidian 设置 → 第三方插件 → 浏览，搜索安装 **BRAT** 并启用。
2. 打开 BRAT 设置 → Add Beta plugin，粘贴本仓库地址并确认。
3. 在插件列表启用 **PARA Navigator**。
4. 以后更新：在 BRAT 面板点 Check for updates → Update，一键完成。

## 手动安装

1. 从 [Releases](../../releases) 下载最新版的 `main.js`、`manifest.json`、`styles.css`。
2. 放到库的 `.obsidian/plugins/para-navigator/` 目录下。
3. 重启 Obsidian，在第三方插件中启用。

## 本地构建

```bash
npm install
npm run build   # 输出 main.js（production）
```

设置环境变量 `OBSIDIAN_PLUGIN_DIR` 可在构建后自动同步到指定库的插件目录：

```bash
OBSIDIAN_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/para-navigator" npm run build
```

## 致谢

- 原作者 [@HJXArthurAtlas](https://github.com/HJXArthurAtlas) 的 [PARA-Navigator](https://github.com/hjxarthuratlas/PARA-Navigator)
