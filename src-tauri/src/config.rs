use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub auto_restart: bool,
}

fn default_color() -> String {
    "#c9463d".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkItem {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_category")]
    pub category: String,
}

fn default_category() -> String {
    "工具".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub exe: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_root")]
    pub client_root: String,
    #[serde(default = "default_interval")]
    pub launch_interval_ms: u64,
    #[serde(default)]
    pub instances: Vec<Instance>,
    #[serde(default = "default_links")]
    pub links: Vec<LinkItem>,
    #[serde(default = "default_tools")]
    pub tools: Vec<ToolDef>,
    #[serde(default)]
    pub tools_dir: String,
    #[serde(default)]
    pub proxy: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 是否已经完成过首次设置引导。
    #[serde(default)]
    pub onboarded: bool,
    /// 内置链接的种子版本，用来在升级时补入新增的内置链接。
    #[serde(default)]
    pub builtin_seed: u32,
}

const BUILTIN_SEED: u32 = 4;

fn default_theme() -> String {
    "system".to_string()
}

fn default_root() -> String {
    "C:\\yys".to_string()
}

fn default_interval() -> u64 {
    4500
}

fn link(name: &str, url: &str, description: &str, category: &str) -> LinkItem {
    LinkItem {
        id: format!("builtin-{name}"),
        name: name.to_string(),
        url: url.to_string(),
        description: description.to_string(),
        category: category.to_string(),
    }
}

fn default_links() -> Vec<LinkItem> {
    vec![
        LinkItem {
            id: "builtin-onmyoji-desktop".to_string(),
            name: "阴阳师桌面版 · 维护版".to_string(),
            url: "https://pan.quark.cn/s/37aee33c7944?pwd=KaLi".to_string(),
            description: "阴阳师桌面版客户端下载 · 维护版本 20260814 · 夸克网盘（提取码 KaLi）"
                .to_string(),
            category: "客户端".to_string(),
        },
        link(
            "OnmyojiDesktopAssistant",
            "https://github.com/AquamarineCyan/OnmyojiDesktopAssistant",
            "桌面版辅助程序（御魂/觉醒/活动/词条分析）",
            "辅助",
        ),
        link(
            "OnmyojiAutoScript",
            "https://github.com/runhey/OnmyojiAutoScript",
            "社区自动化脚本项目",
            "辅助",
        ),
        link("网易大神·阴阳师", "https://ds.163.com/", "官方社区与活动", "社区"),
        link(
            "NGA 阴阳师版",
            "https://bbs.nga.cn/thread.php?fid=-152678",
            "玩家攻略、数据与讨论",
            "社区",
        ),
        link("阴阳师官网", "https://yys.163.com/", "官方公告、活动与版本信息", "资料"),
        link("阴阳师 Wiki", "https://wiki.biligame.com/yys/", "式神、御魂与活动资料", "资料"),
    ]
}

fn default_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            id: "onmyoji-desktop-assistant".to_string(),
            name: "OnmyojiDesktopAssistant".to_string(),
            description: "桌面版辅助：御魂、觉醒、活动、词条分析与窗口管理".to_string(),
            category: "辅助".to_string(),
            url: "https://github.com/AquamarineCyan/OnmyojiDesktopAssistant/releases".to_string(),
            exe: "OnmyojiDesktopAssistant.exe".to_string(),
            version: String::new(),
        },
        ToolDef {
            id: "onmyoji-auto-script".to_string(),
            name: "OnmyojiAutoScript".to_string(),
            description: "社区自动化脚本项目，从最新 release 安装".to_string(),
            category: "辅助".to_string(),
            url: "https://github.com/runhey/OnmyojiAutoScript/releases".to_string(),
            exe: String::new(),
            version: String::new(),
        },
    ]
}

fn default_config() -> AppConfig {
    AppConfig {
        client_root: default_root(),
        launch_interval_ms: default_interval(),
        instances: vec![],
        links: default_links(),
        tools: default_tools(),
        tools_dir: String::new(),
        proxy: String::new(),
        theme: default_theme(),
        onboarded: false,
        builtin_seed: BUILTIN_SEED,
    }
}

/// 便携模式：exe 同目录有 `data` 文件夹或 `yys-ledger.portable` 标记时，
/// 配置、日志、窗口状态都放在程序旁边，可直接拷贝 / 放 U 盘。
fn portable_root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| {
        let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        let data = exe_dir.join("data");
        if exe_dir.join("yys-ledger.portable").is_file()
            || exe_dir.join("yys-hub.portable").is_file()
            || data.is_dir()
        {
            let _ = fs::create_dir_all(&data);
            Some(data)
        } else {
            None
        }
    })
    .clone()
}

pub fn is_portable() -> bool {
    portable_root().is_some()
}

pub fn data_dir() -> PathBuf {
    portable_root().unwrap_or_else(|| {
        let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(base).join("yys-ledger")
    })
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

/// 首次以 yys-ledger 身份启动时，从旧的 yys-hub 数据目录搬一份配置过来。
/// 只复制不删除，旧目录留作回退；返回迁移的文件数。
pub fn prepare_data_dir() -> usize {
    let dir = data_dir();
    let _ = fs::create_dir_all(&dir);
    if is_portable() || config_path().exists() {
        return 0;
    }
    let Some(base) = std::env::var_os("APPDATA") else {
        return 0;
    };
    let legacy = PathBuf::from(base).join("yys-hub");
    if !legacy.is_dir() {
        return 0;
    }
    let mut copied = 0;
    for name in ["config.json", "config.bak", "runtime.json", "window.json"] {
        let from = legacy.join(name);
        if from.is_file() && fs::copy(&from, dir.join(name)).is_ok() {
            copied += 1;
        }
    }
    copied
}

/// 先写临时文件再替换，避免断电或崩溃把唯一配置截断；替换前留一份 .bak。
fn write_atomic(path: &PathBuf, text: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, text).map_err(|e| format!("写入失败：{e}"))?;
    if path.exists() {
        let backup = path.with_extension("bak");
        let _ = fs::copy(path, backup);
    }
    fs::rename(&temp, path).map_err(|e| format!("替换配置失败：{e}"))
}

pub fn load() -> AppConfig {
    let path = config_path();
    let mut config = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<AppConfig>(&text).ok())
        .unwrap_or_else(default_config);
    if merge_builtin_links(&mut config) {
        let _ = save(&config);
    }
    config
}

/// 升级时按最新定义重建内置链接（顺序、分类、文案随之同步），用户自己添加的链接
/// （UUID id）保持原有顺序排在后面。每个种子版本只做一次。
fn merge_builtin_links(config: &mut AppConfig) -> bool {
    if config.builtin_seed >= BUILTIN_SEED {
        return false;
    }
    let mut links = default_links();
    links.extend(
        config
            .links
            .iter()
            .filter(|entry| !entry.id.starts_with("builtin-"))
            .cloned(),
    );
    config.links = links;
    config.builtin_seed = BUILTIN_SEED;
    true
}

pub fn save(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_atomic(&path, &text)
}

// ---------------- 运行期状态（PID、窗口位置） ----------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PidRecord {
    pub id: String,
    pub pid: u32,
    /// 进程创建时间（FILETIME），用来避免 PID 被复用时误认。
    pub started_at: u64,
}

fn runtime_path() -> PathBuf {
    data_dir().join("runtime.json")
}

pub fn load_pids() -> Vec<PidRecord> {
    fs::read_to_string(runtime_path())
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<PidRecord>>(&text).ok())
        .unwrap_or_default()
}

pub fn save_pids(records: &[PidRecord]) {
    if let Ok(text) = serde_json::to_string_pretty(records) {
        let _ = fs::create_dir_all(data_dir());
        let _ = write_atomic(&runtime_path(), &text);
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
    pub saved: bool,
}

fn window_path() -> PathBuf {
    data_dir().join("window.json")
}

pub fn load_window() -> WindowState {
    fs::read_to_string(window_path())
        .ok()
        .and_then(|text| serde_json::from_str::<WindowState>(&text).ok())
        .unwrap_or_default()
}

pub fn save_window(state: &WindowState) {
    if let Ok(text) = serde_json::to_string_pretty(state) {
        let _ = fs::create_dir_all(data_dir());
        let _ = write_atomic(&window_path(), &text);
    }
}

pub fn client_exe(root: &str) -> PathBuf {
    PathBuf::from(root).join("bin").join("onmyoji.exe")
}

pub fn client_present(root: &str) -> bool {
    client_exe(root).is_file()
}

pub fn client_version(root: &str) -> Option<String> {
    let path = PathBuf::from(root).join("update.ini");
    let text = fs::read_to_string(path).ok()?;
    let version = text
        .lines()
        .find_map(|line| line.strip_prefix("version"))
        .map(|rest| rest.trim_start_matches([' ', '=']).trim().to_string())?;
    let sub = text
        .lines()
        .find_map(|line| line.strip_prefix("subversion"))
        .map(|rest| rest.trim_start_matches([' ', '=']).trim().to_string());
    match sub {
        Some(sub) if sub != "0" => Some(format!("{version}.{sub}")),
        _ => Some(version),
    }
}

/// 便携工具目录：优先放在程序目录下，不可写时回落到 %APPDATA%。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_merge_orders_defaults_and_keeps_custom_links() {
        let mut config = default_config();
        config.builtin_seed = 0;
        config.links = vec![
            LinkItem {
                id: "builtin-removed".to_string(),
                name: "已经改名的旧内置".to_string(),
                url: "https://example.com".to_string(),
                description: String::new(),
                category: "旧".to_string(),
            },
            LinkItem {
                id: "custom-1".to_string(),
                name: "自己加的".to_string(),
                url: "https://example.org".to_string(),
                description: String::new(),
                category: "自建".to_string(),
            },
        ];

        assert!(merge_builtin_links(&mut config));
        assert_eq!(config.links[0].id, "builtin-onmyoji-desktop");
        assert_eq!(config.links[0].category, "客户端");
        assert!(config.links.iter().all(|item| item.id != "builtin-removed"));
        assert_eq!(config.links.last().unwrap().id, "custom-1");
        assert!(!merge_builtin_links(&mut config));
    }
}

pub fn tools_dir(config: &AppConfig) -> PathBuf {
    let configured = config.tools_dir.trim();
    if !configured.is_empty() {
        return PathBuf::from(configured);
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
    {
        let candidate = exe_dir.join("tools");
        if fs::create_dir_all(&candidate).is_ok() {
            return candidate;
        }
    }
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let fallback = PathBuf::from(base).join("yys-ledger").join("tools");
    let _ = fs::create_dir_all(&fallback);
    fallback
}
