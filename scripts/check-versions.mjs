// 版本号在 package.json / Cargo.toml / tauri.conf.json 各有一份，
// 构建前校验一次，避免安装包与界面显示的版本对不上。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];

const versions = {
  "package.json": pkg.version,
  "Cargo.toml": cargoVersion,
  "tauri.conf.json": conf.version,
};
const values = new Set(Object.values(versions));
if (values.size !== 1) {
  console.error("版本号不一致：", versions);
  process.exit(1);
}
console.log(`版本 ${pkg.version}`);
