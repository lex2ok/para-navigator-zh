import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const prod = process.argv[2] === "production";

// Runtime files are copied here after every build so the vault always runs
// the latest code. Override with OBSIDIAN_PLUGIN_DIR for another vault.
const pluginDir =
  process.env.OBSIDIAN_PLUGIN_DIR ??
  "/Users/arthuratlas/obsidian/Brain/.obsidian/plugins/para-navigator";

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
  // CI runners have no local vault; release builds must not touch the filesystem.
  if (process.env.CI === "true") return;
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
