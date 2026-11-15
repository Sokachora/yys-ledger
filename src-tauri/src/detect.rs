//! 客户端安装目录探测。
//!
//! 官方安装器不写卸载注册表项，所以探测按可靠度从高到低多路尝试：
//! 运行中的进程 → 桌面/开始菜单快捷方式 → 常见安装路径 → 磁盘浅层扫描。
//! 每条候选都要求包含 `bin\onmyoji.exe`，避免把别的网易游戏误认成阴阳师。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::config;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub root: String,
    pub source: String,
    pub version: Option<String>,
}

/// 安装根目录的特征：带 `bin\onmyoji.exe`。
pub fn is_client_root(path: &Path) -> bool {
    path.join("bin").join("onmyoji.exe").is_file()
}

pub fn find() -> Vec<Candidate> {
    let mut collector = Collector::new();
    scan_processes(&mut collector);
    scan_shortcuts(&mut collector);
    scan_common(&mut collector);
    scan_drive_roots(&mut collector);
    collector.out
}

struct Collector {
    out: Vec<Candidate>,
    seen: HashSet<String>,
}

impl Collector {
    fn new() -> Self {
        Self {
            out: Vec::new(),
            seen: HashSet::new(),
        }
    }

    /// 记录一个安装根目录；已记录过则忽略。
    fn add(&mut self, root: &Path, source: &str) -> bool {
        if !is_client_root(root) {
            return false;
        }
        let root = normalize(root);
        let key = root.to_lowercase();
        if !self.seen.insert(key) {
            return false;
        }
        self.out.push(Candidate {
            version: config::client_version(&root),
            root,
            source: source.to_string(),
        });
        true
    }

    /// 传入一个可执行文件（或目录）路径，回溯到安装根目录再记录。
    fn add_target(&mut self, target: &Path, source: &str) -> bool {
        if self.add(target, source) {
            return true;
        }
        match client_root_of(target) {
            Some(root) => self.add(&root, source),
            None => false,
        }
    }
}

fn normalize(path: &Path) -> String {
    let text = path.to_string_lossy();
    let trimmed = text.trim_end_matches(['\\', '/']);
    if trimmed.is_empty() {
        text.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Launch.exe → 所在目录；bin\onmyoji.exe → 上两级；其它可执行文件 → 所在目录。
fn client_root_of(exe: &Path) -> Option<PathBuf> {
    let name = exe.file_name()?.to_string_lossy().to_ascii_lowercase();
    if name == "onmyoji.exe" {
        let root = exe.parent().and_then(Path::parent)?;
        if is_client_root(root) {
            return Some(root.to_path_buf());
        }
    }
    let dir = exe.parent()?;
    is_client_root(dir).then(|| dir.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_install_root_from_exe_targets() {
        let base = std::env::temp_dir().join(format!("yys-hub-detect-{}", std::process::id()));
        let root = base.join("yys");
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin").join("onmyoji.exe"), b"").unwrap();

        assert!(is_client_root(&root));
        assert_eq!(
            client_root_of(&root.join("bin").join("onmyoji.exe")),
            Some(root.clone())
        );
        assert_eq!(client_root_of(&root.join("Launch.exe")), Some(root.clone()));
        assert!(!is_client_root(&base.join("missing")));

        let _ = fs::remove_dir_all(&base);
    }
}

// ---------------- 运行中的进程 ----------------

fn scan_processes(collector: &mut Collector) {
    for process in crate::procs::snapshot() {
        if !process.name.eq_ignore_ascii_case("onmyoji.exe") {
            continue;
        }
        if let Some(path) = process_path(process.pid) {
            collector.add_target(&path, "运行中进程");
        }
    }
}

fn process_path(pid: u32) -> Option<PathBuf> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok == 0 || size == 0 {
            return None;
        }
        Some(PathBuf::from(String::from_utf16_lossy(
            &buffer[..size as usize],
        )))
    }
}

// ---------------- 快捷方式 ----------------

fn scan_shortcuts(collector: &mut Collector) {
    for dir in shortcut_dirs() {
        walk_lnk(&dir, 0, collector);
    }
}

fn shortcut_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut push = |path: Option<PathBuf>| {
        if let Some(path) = path {
            if path.is_dir() {
                dirs.push(path);
            }
        }
    };
    let env = |key: &str| std::env::var_os(key).map(PathBuf::from);
    push(env("USERPROFILE").map(|base| base.join("Desktop")));
    push(env("PUBLIC").map(|base| base.join("Desktop")));
    push(env("APPDATA").map(|base| base.join("Microsoft").join("Windows").join("Start Menu").join("Programs")));
    push(env("ProgramData").map(|base| base.join("Microsoft").join("Windows").join("Start Menu").join("Programs")));
    dirs
}

fn walk_lnk(dir: &Path, depth: usize, collector: &mut Collector) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            walk_lnk(&path, depth + 1, collector);
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"))
        {
            if let Some(target) = resolve_lnk(&path) {
                collector.add_target(&target, "快捷方式");
            }
        }
    }
}

/// 从 .lnk 的 LinkInfo 里取本地目标路径（优先 Unicode，退回 ANSI）。
fn resolve_lnk(path: &Path) -> Option<PathBuf> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 0x4C {
        return None;
    }
    let flags = u32::from_le_bytes(bytes.get(0x14..0x18)?.try_into().ok()?);

    let mut offset = 0x4C;
    if flags & 0x1 != 0 {
        let size = u16::from_le_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize;
        offset += 2 + size;
    }
    if flags & 0x2 == 0 {
        return None;
    }

    let info = offset;
    let header_size = u32::from_le_bytes(bytes.get(info + 4..info + 8)?.try_into().ok()?) as usize;
    let info_flags = u32::from_le_bytes(bytes.get(info + 8..info + 12)?.try_into().ok()?);
    if info_flags & 0x1 == 0 || header_size < 0x1C || info + header_size > bytes.len() {
        return None;
    }

    if header_size >= 0x24 {
        let local = u32::from_le_bytes(bytes.get(info + 28..info + 32)?.try_into().ok()?) as usize;
        let suffix = u32::from_le_bytes(bytes.get(info + 32..info + 36)?.try_into().ok()?) as usize;
        if local > 0 {
            let mut text = read_utf16(&bytes, info + local);
            if !text.is_empty() {
                if suffix > 0 && !text.ends_with('\\') {
                    let tail = read_utf16(&bytes, info + suffix);
                    if !tail.is_empty() {
                        text.push('\\');
                        text.push_str(&tail);
                    }
                }
                return Some(PathBuf::from(text));
            }
        }
    }

    let local = u32::from_le_bytes(bytes.get(info + 16..info + 20)?.try_into().ok()?) as usize;
    if local == 0 {
        return None;
    }
    let start = info + local;
    let end = start + bytes.get(start..)?.iter().position(|byte| *byte == 0)?;
    String::from_utf8(bytes[start..end].to_vec())
        .ok()
        .map(PathBuf::from)
}

fn read_utf16(bytes: &[u8], start: usize) -> String {
    if start >= bytes.len() {
        return String::new();
    }
    let mut units = Vec::new();
    let mut index = start;
    while index + 1 < bytes.len() {
        let unit = u16::from_le_bytes([bytes[index], bytes[index + 1]]);
        if unit == 0 {
            break;
        }
        units.push(unit);
        index += 2;
    }
    String::from_utf16_lossy(&units)
}

// ---------------- 常见路径与磁盘扫描 ----------------

fn drives() -> Vec<String> {
    (b'C'..=b'J')
        .filter_map(|letter| {
            let root = format!("{}:\\", letter as char);
            Path::new(&root).is_dir().then_some(root)
        })
        .collect()
}

fn scan_common(collector: &mut Collector) {
    const NAMES: [&str; 8] = [
        "yys",
        "Onmyoji",
        "网易\\阴阳师",
        "Program Files\\Onmyoji",
        "Program Files (x86)\\Onmyoji",
        "Games\\yys",
        "Games\\Onmyoji",
        "Software\\yys",
    ];
    for drive in drives() {
        let base = PathBuf::from(drive);
        for name in NAMES {
            collector.add(&base.join(name), "常见路径");
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        collector.add(&PathBuf::from(local).join("Onmyoji"), "常见路径");
    }
}

fn scan_drive_roots(collector: &mut Collector) {
    const SKIP: [&str; 12] = [
        "windows",
        "$recycle.bin",
        "system volume information",
        "users",
        "programdata",
        "recovery",
        "perflogs",
        "msocache",
        "config.msi",
        "node_modules",
        ".git",
        "appdata",
    ];
    const DEEP: [&str; 8] = [
        "games",
        "游戏",
        "software",
        "program files",
        "program files (x86)",
        "netease",
        "网易",
        "games2",
    ];

    for drive in drives() {
        let Ok(entries) = fs::read_dir(&drive) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if !kind.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.starts_with('$') || SKIP.contains(&name.as_str()) {
                continue;
            }
            let dir = entry.path();
            if collector.add(&dir, "磁盘扫描") {
                continue;
            }
            if !DEEP.contains(&name.as_str()) {
                continue;
            }
            let Ok(children) = fs::read_dir(&dir) else {
                continue;
            };
            for child in children.flatten().take(120) {
                if child.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    collector.add(&child.path(), "磁盘扫描");
                }
            }
        }
    }
}
