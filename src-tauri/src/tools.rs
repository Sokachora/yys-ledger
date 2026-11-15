use crate::config::ToolDef;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const META_FILE: &str = ".yys-ledger.json";
const LEGACY_META_FILE: &str = ".yys-hub.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub url: String,
    pub exe: String,
    pub version: String,
    pub installed: bool,
    pub exe_path: Option<String>,
    pub size_mb: f64,
    pub dir: String,
    pub installed_version: Option<String>,
    pub installed_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
struct InstalledMeta {
    version: String,
    installed_at: u64,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUpdate {
    pub id: String,
    pub name: String,
    pub current: Option<String>,
    pub latest: Option<String>,
    pub has_update: bool,
    pub error: Option<String>,
}

pub fn sanitize_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("工具 ID 只能包含字母、数字、- 和 _".to_string());
    }
    Ok(trimmed.to_string())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn read_meta(dir: &Path) -> InstalledMeta {
    // 兼容改名前的 .yys-hub.json，避免旧安装工具的版本信息丢失
    for name in [META_FILE, LEGACY_META_FILE] {
        if let Some(meta) = fs::read_to_string(dir.join(name))
            .ok()
            .and_then(|text| serde_json::from_str::<InstalledMeta>(&text).ok())
        {
            return meta;
        }
    }
    InstalledMeta::default()
}

fn write_meta(dir: &Path, meta: &InstalledMeta) -> Result<(), String> {
    let text = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(dir.join(META_FILE), text).map_err(|e| e.to_string())
}

pub fn status(root: &Path, def: &ToolDef) -> ToolStatus {
    let dir = root.join(&def.id);
    let installed_dir = dir.is_dir();
    let exe = if installed_dir {
        find_exe(&dir, &def.exe)
    } else {
        None
    };
    let size = dir_size(&dir);
    let meta = if installed_dir { read_meta(&dir) } else { InstalledMeta::default() };
    let fallback_time = fs::metadata(&dir)
        .and_then(|info| info.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs());
    ToolStatus {
        id: def.id.clone(),
        name: def.name.clone(),
        description: def.description.clone(),
        category: def.category.clone(),
        url: def.url.clone(),
        exe: def.exe.clone(),
        version: def.version.clone(),
        installed: size > 0,
        exe_path: exe.as_ref().map(|path| path.display().to_string()),
        size_mb: (size as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0,
        dir: dir.display().to_string(),
        installed_version: (!meta.version.is_empty()).then_some(meta.version),
        installed_at: (meta.installed_at > 0)
            .then_some(meta.installed_at)
            .or(if installed_dir { fallback_time } else { None }),
    }
}

fn collect_exes(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_exes(&path, depth + 1, out);
        } else if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            if name.contains("unins") || name.contains("setup") || name.contains("vc_redist") {
                continue;
            }
            out.push(path);
        }
    }
}

pub fn find_exe(dir: &Path, hint: &str) -> Option<PathBuf> {
    if !hint.trim().is_empty() {
        let relative = dir.join(hint.trim().replace('/', "\\"));
        if relative.is_file() {
            return Some(relative);
        }
    }
    let mut exes = Vec::new();
    collect_exes(dir, 0, &mut exes);
    exes.sort_by_key(|path| path.components().count());
    exes.into_iter().next()
}

fn dir_size(dir: &Path) -> u64 {
    if !dir.is_dir() {
        return 0;
    }
    let mut total = 0;
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            total += dir_size(&path);
        } else if let Ok(info) = entry.metadata() {
            total += info.len();
        }
    }
    total
}

pub async fn install_from_url(
    app: &AppHandle,
    root: &Path,
    def: &ToolDef,
    proxy: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let raw_url = def.url.trim();
    if raw_url.is_empty() {
        return Err("该工具还没有配置下载地址".to_string());
    }
    let is_github = raw_url.contains("github.com");
    let (download_url, tag) = if is_github && raw_url.contains("releases") {
        let asset = resolve_github_zip(raw_url, proxy)
            .await
            .map_err(|error| with_network_hint(error, is_github))?;
        (asset.url, asset.tag)
    } else {
        (raw_url.to_string(), String::new())
    };

    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = root.join(format!(".download-{}.zip", def.id));
    download(app, &def.id, &download_url, &temp, proxy, &cancel)
        .await
        .map_err(|error| {
            let _ = fs::remove_file(&temp);
            if cancel.load(Ordering::Relaxed) {
                "已取消安装".to_string()
            } else {
                with_network_hint(error, is_github)
            }
        })?;

    let id = sanitize_id(&def.id)?;
    let destination = root.join(&id);
    let staging = root.join(format!(".staging-{id}"));
    let _ = fs::remove_dir_all(&staging);
    let temp_for_extract = temp.clone();
    let staging_for_extract = staging.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        extract_zip(&temp_for_extract, &staging_for_extract)
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&temp);
    result?;

    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|e| format!("替换旧版本失败：{e}"))?;
    }
    fs::rename(&staging, &destination).map_err(|e| format!("安装失败：{e}"))?;
    write_meta(
        &destination,
        &InstalledMeta {
            version: tag,
            installed_at: now_secs(),
            source: download_url,
        },
    )?;
    Ok(())
}

pub fn install_from_zip(root: &Path, def: &ToolDef, zip_path: &str) -> Result<(), String> {
    let id = sanitize_id(&def.id)?;
    let destination = root.join(&id);
    let staging = root.join(format!(".staging-{id}"));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    extract_zip(Path::new(zip_path), &staging)?;
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|e| format!("替换旧版本失败：{e}"))?;
    }
    fs::rename(&staging, &destination).map_err(|e| format!("安装失败：{e}"))?;
    write_meta(
        &destination,
        &InstalledMeta {
            version: String::new(),
            installed_at: now_secs(),
            source: format!("zip:{zip_path}"),
        },
    )
}

fn with_network_hint(error: String, is_github: bool) -> String {
    if is_github {
        format!(
            "{error}。如果无法访问 GitHub，可以在「设置」里填写本地代理地址，或改用「本地 zip」安装。"
        )
    } else {
        error
    }
}

fn build_client(proxy: &str) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("yys-ledger/0.1")
        .connect_timeout(Duration::from_secs(15))
        // 整体上限，防止连接卡死后无限等待；单次下载通常远小于这个时间。
        .timeout(Duration::from_secs(1800));
    let proxy = proxy.trim();
    if !proxy.is_empty() {
        builder = builder
            .proxy(reqwest::Proxy::all(proxy).map_err(|e| format!("代理地址无效：{e}"))?);
    }
    builder.build().map_err(|e| e.to_string())
}

struct GitHubAsset {
    url: String,
    tag: String,
}

async fn resolve_github_zip(url: &str, proxy: &str) -> Result<GitHubAsset, String> {
    let parts: Vec<&str> = url.split('/').collect();
    let index = parts
        .iter()
        .position(|part| *part == "github.com")
        .ok_or_else(|| "无法解析 GitHub 地址".to_string())?;
    let owner = parts.get(index + 1).ok_or_else(|| "缺少仓库所有者".to_string())?;
    let repo = parts.get(index + 2).ok_or_else(|| "缺少仓库名".to_string())?;
    let release = fetch_latest_release(owner, repo, proxy).await?;

    let tag = release
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let assets = release
        .get("assets")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "该 release 没有附件".to_string())?;
    for asset in assets {
        let name = asset
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if name.to_lowercase().ends_with(".zip") {
            if let Some(download) = asset
                .get("browser_download_url")
                .and_then(|value| value.as_str())
            {
                return Ok(GitHubAsset {
                    url: download.to_string(),
                    tag,
                });
            }
        }
    }
    Err("最新 release 里没有 zip 附件".to_string())
}

async fn fetch_latest_release(
    owner: &str,
    repo: &str,
    proxy: &str,
) -> Result<serde_json::Value, String> {
    let api = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
    let client = build_client(proxy)?;
    let response = client
        .get(api)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("查询 GitHub Release 失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "查询 GitHub Release 失败：HTTP {}（未登录的接口每小时限 60 次）",
            response.status()
        ));
    }
    response.json().await.map_err(|e| e.to_string())
}

/// 检查已安装工具是否有新版本；只支持 GitHub releases 页面形式的地址。
pub async fn check_update(root: &Path, def: &ToolDef, proxy: &str) -> ToolUpdate {
    let meta = read_meta(&root.join(&def.id));
    let current = (!meta.version.is_empty()).then_some(meta.version);
    let url = def.url.trim();
    let mut update = ToolUpdate {
        id: def.id.clone(),
        name: def.name.clone(),
        current: current.clone(),
        latest: None,
        has_update: false,
        error: None,
    };
    if !url.contains("github.com") || !url.contains("releases") {
        update.error = Some("该地址不支持自动检查更新".to_string());
        return update;
    }
    let parts: Vec<&str> = url.split('/').collect();
    let Some(index) = parts.iter().position(|part| *part == "github.com") else {
        update.error = Some("无法解析 GitHub 地址".to_string());
        return update;
    };
    let (Some(owner), Some(repo)) = (parts.get(index + 1), parts.get(index + 2)) else {
        update.error = Some("无法解析 GitHub 地址".to_string());
        return update;
    };
    match fetch_latest_release(owner, repo, proxy).await {
        Ok(release) => {
            let tag = release
                .get("tag_name")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            update.has_update = !tag.is_empty() && current.as_deref() != Some(tag.as_str());
            update.latest = (!tag.is_empty()).then_some(tag);
        }
        Err(error) => update.error = Some(error),
    }
    update
}

async fn download(
    app: &AppHandle,
    id: &str,
    url: &str,
    destination: &Path,
    proxy: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let client = build_client(proxy)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败：HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let mut file = File::create(destination).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消安装".to_string());
        }
        let chunk = chunk.map_err(|e| format!("下载中断：{e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "tool-progress",
            serde_json::json!({ "id": id, "downloaded": downloaded, "total": total }),
        );
    }
    file.flush().ok();
    Ok(())
}

/// 解压到调用方给的临时目录，成功后再整体替换，避免失败时把旧版本删掉。
fn extract_zip(zip_path: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;

    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("不是有效的 zip：{e}"))?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut buffer = Vec::new();
            entry.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            fs::write(&output, buffer).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn open_tool(root: &Path, def: &ToolDef) -> Result<(), String> {
    let dir = root.join(sanitize_id(&def.id)?);
    let exe =
        find_exe(&dir, &def.exe).ok_or_else(|| "尚未安装，或目录里找不到可执行文件".to_string())?;
    let mut command = Command::new(&exe);
    if let Some(parent) = exe.parent() {
        command.current_dir(parent);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn open_dir(root: &Path, def: &ToolDef) -> Result<(), String> {
    let dir = root.join(sanitize_id(&def.id)?);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut command = Command::new("explorer");
    command.arg(dir);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_tool(root: &Path, def: &ToolDef) -> Result<(), String> {
    let dir = root.join(sanitize_id(&def.id)?);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_ids_cannot_escape_the_tools_dir() {
        assert!(sanitize_id("../evil").is_err());
        assert!(sanitize_id("C:\\Windows").is_err());
        assert!(sanitize_id("a b").is_err());
        assert_eq!(sanitize_id("good-id_1").unwrap(), "good-id_1");
    }

    #[test]
    fn zip_entries_cannot_escape_destination() {
        use std::io::Write as _;

        let base = std::env::temp_dir().join(format!("yys-hub-zip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let zip_path = base.join("evil.zip");
        {
            let file = File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("../escaped.txt", options).unwrap();
            writer.write_all(b"x").unwrap();
            writer.finish().unwrap();
        }

        let destination = base.join("out");
        extract_zip(&zip_path, &destination).unwrap();
        assert!(!base.join("escaped.txt").exists());
        assert!(destination.is_dir());

        let _ = fs::remove_dir_all(&base);
    }
}
