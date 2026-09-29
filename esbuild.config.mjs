import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const prod = process.argv[2] === "production";

// 只有显式设置 OBSIDIAN_PLUGIN_DIR 时才把构建产物同步到本地库；
// 默认只在当前目录输出 main.js（供打 Release 包用）。
const pluginDir = process.env.OBSIDIAN_PLUGIN_DIR ?? "";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

const syncToVault = () => {
  if (!pluginDir) return;
  mkdirSync(pluginDir, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    copyFileSync(file, join(pluginDir, file));
  }
  console.log(`Synced to ${pluginDir}`);
};

if (prod) {
  await context.rebuild();
  syncToVault();
  process.exit(0);
} else {
  await context.watch();
  syncToVault();
}
