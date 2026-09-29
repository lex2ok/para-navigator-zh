import "obsidian";

declare module "obsidian" {
  interface Vault {
    /** Reads a vault config value (runtime API, missing from the public d.ts). */
    getConfig(key: string): unknown;
    /** Writes a vault config value (runtime API, missing from the public d.ts). */
    setConfig(key: string, value: unknown): void;
  }
}
