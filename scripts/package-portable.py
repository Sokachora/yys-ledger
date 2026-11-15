"""把 release 版 exe 打成一个可随身携带的文件夹 + zip。

用法：python scripts/package-portable.py
前置：已经执行过 `npm run tauri build` 或 `cargo build --release`。
"""

import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT
CONF = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
PRODUCT = CONF["productName"]
BINARY = CONF.get("mainBinaryName", "yys-ledger")
EXE = ROOT / "src-tauri" / "target" / "release" / f"{BINARY}.exe"

DATA_NOTE = f"""这个文件夹存放{PRODUCT}的配置、日志和窗口状态。

- config.json          名册、标签、工具与链接
- runtime.json         运行中的游戏进程
- window.json          窗口位置与大小
- logs/                运行日志
- tools/（在外层）     便携工具安装位置

把整个文件夹一起搬走即可保留设置；删除 data 文件夹会重置本地设置。
"""

TOOLS_NOTE = """下载安装的便携工具会放在这里，每个工具一个子目录。
"""

README = """{product} v{version} 便携版

1. 双击「{product}.exe」即可运行，不需要安装。
2. 配置、日志、窗口状态都写在同目录的 data 文件夹里。
3. 想换电脑或放 U 盘，直接拷贝整个文件夹。
4. 第一次启动会引导你确认游戏客户端目录。

注意：
- 需要一个可写的目录（不要放在 Program Files 或只读盘）。
- 依赖系统的 Microsoft Edge WebView2 运行时；Windows 10/11 一般已自带，
  若打不开，请先从微软官网安装 WebView2 Runtime。
- 不要用桌面快捷方式（Launch.exe）启动游戏，它会把{product}管理的实例全部结束。
"""


def main() -> None:
    if not EXE.is_file():
        raise SystemExit(f"找不到 {EXE}，请先构建 release 版")
    version = CONF["version"]

    release_dir = PROJECT / "release"
    target = release_dir / f"{PRODUCT}-{version}-便携版"
    if target.exists():
        shutil.rmtree(target)
    (target / "data").mkdir(parents=True)
    (target / "tools").mkdir(parents=True)

    shutil.copy2(EXE, target / f"{PRODUCT}.exe")
    (target / "data" / "说明.txt").write_text(DATA_NOTE, encoding="utf-8")
    (target / "tools" / "说明.txt").write_text(TOOLS_NOTE, encoding="utf-8")
    (target / "使用说明.txt").write_text(
        README.format(version=version, product=PRODUCT), encoding="utf-8"
    )

    archive = release_dir / f"{PRODUCT}-{version}-便携版.zip"
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(target.rglob("*")):
            bundle.write(path, path.relative_to(release_dir))

    size_mb = archive.stat().st_size / 1024 / 1024
    print(f"便携版目录：{target}")
    print(f"压缩包：{archive}（{size_mb:.1f} MB）")


if __name__ == "__main__":
    main()
