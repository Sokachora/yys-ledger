mod audio;
mod config;
mod detect;
mod logs;
mod procs;
mod tools;
mod win32;

use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Serialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

use config::AppConfig;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const TRAY_ID: &str = "main-tray";

#[derive(Clone, Copy, Debug)]
struct PidEntry {
    pid: u32,
    started_at: u64,
}

struct RestartPlan {
    attempts: u32,
    next_at: Instant,
}

struct AppState {
    config: Mutex<AppConfig>,
    pids: Mutex<HashMap<String, PidEntry>>,
    /// 本次运行中出现过的实例，用来区分「崩溃」与「从未启动」。
    seen: Mutex<HashSet<String>>,
    restart: Mutex<HashMap<String, RestartPlan>>,
    cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 已经套用过音量的实例 → 当前 PID，避免每次轮询重复设置。
    audio_applied: Mutex<HashMap<String, u32>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientInfo {
    found: bool,
    root: String,
    exe: String,
    version: Option<String>,
    running: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceRuntime {
    id: String,
    pid: Option<u32>,
    running: bool,
    hwnd: Option<i64>,
    memory_mb: f64,
    responding: bool,
    rect: Option<win32::WinRect>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
    instances: Vec<InstanceRuntime>,
    unmanaged: usize,
    client_found: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolsSnapshot {
    tools: Vec<tools::ToolStatus>,
    tools_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppPaths {
    data_dir: String,
    tools_dir: String,
    portable: bool,
}

fn kill_tree(pid: u32) {
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let _ = command.output();
}

// ---------------- 进程启动与状态 ----------------

fn spawn_for(cfg: &AppConfig, id: &str) -> Result<(u32, u64), String> {
    let instance = cfg
        .instances
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "实例不存在".to_string())?;

    let exe = config::client_exe(&cfg.client_root);
    if !exe.is_file() {
        return Err(format!("找不到游戏主程序：{}", exe.display()));
    }

    let mut command = Command::new(&exe);
    command.current_dir(&cfg.client_root);
    if !instance.args.is_empty() {
        command.args(&instance.args);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let started_at = procs::start_time(pid).unwrap_or(0);
    Ok((pid, started_at))
}

fn persist_pids(state: &AppState) {
    let records: Vec<config::PidRecord> = {
        let pids = state.pids.lock().unwrap();
        pids.iter()
            .map(|(id, entry)| config::PidRecord {
                id: id.clone(),
                pid: entry.pid,
                started_at: entry.started_at,
            })
            .collect()
    };
    config::save_pids(&records);
}

fn client_info_for(root: &str) -> ClientInfo {
    let procs_list = procs::snapshot();
    ClientInfo {
        found: config::client_present(root),
        exe: config::client_exe(root).display().to_string(),
        version: config::client_version(root),
        running: procs::onmyoji_pids(&procs_list).len(),
        root: root.to_string(),
    }
}

// ---------------- 配置 ----------------

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    config::save(&config).map_err(|error| {
        logs::error(&format!("保存配置失败：{error}"));
        error
    })?;
    *state.config.lock().unwrap() = config;
    refresh_tray(&app);
    Ok(())
}

#[tauri::command]
fn detect_client(state: State<'_, AppState>) -> ClientInfo {
    let root = state.config.lock().unwrap().client_root.clone();
    client_info_for(&root)
}

/// 校验任意路径是否为客户端根目录（引导页手动输入时用）。
#[tauri::command]
fn probe_client_root(root: String) -> ClientInfo {
    client_info_for(root.trim().trim_end_matches(['\\', '/']))
}

/// 多路探测本机已安装的客户端，按可靠度排序。
#[tauri::command]
async fn find_client_roots() -> Vec<detect::Candidate> {
    tauri::async_runtime::spawn_blocking(detect::find)
        .await
        .unwrap_or_default()
}


fn apply_audio_pid(
    state: &AppState,
    proc_list: &[procs::ProcInfo],
    id: &str,
    pid: u32,
    volume: u32,
    muted: bool,
) -> Result<usize, String> {
    let tree: HashSet<u32> = procs::tree_pids(proc_list, pid).into_iter().collect();
    let changed = audio::set_volume(&tree, volume as f32 / 100.0, muted)?;
    let mut applied = state.audio_applied.lock().unwrap();
    if changed > 0 {
        applied.insert(id.to_string(), pid);
    } else {
        // 音频会话可能还没创建，后台监控会继续重试。
        applied.remove(id);
    }
    Ok(changed)
}

#[tauri::command]
fn apply_audio(ids: Vec<String>, state: State<'_, AppState>) -> Result<usize, String> {
    let cfg = state.config.lock().unwrap().clone();
    let proc_list = procs::snapshot();
    let mut total = 0;
    for id in ids {
        let Some(instance) = cfg.instances.iter().find(|item| item.id == id) else {
            continue;
        };
        let Some(entry) = state.pids.lock().unwrap().get(&id).copied() else {
            continue;
        };
        total += apply_audio_pid(
            &state,
            &proc_list,
            &id,
            entry.pid,
            instance.volume,
            instance.muted,
        )?;
    }
    Ok(total)
}

/// 拖动音量滑杆时先作用于当前进程，松手后再写入配置。
#[tauri::command]
fn preview_audio(
    id: String,
    volume: u32,
    muted: bool,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let Some(entry) = state.pids.lock().unwrap().get(&id).copied() else {
        return Ok(0);
    };
    let proc_list = procs::snapshot();
    apply_audio_pid(&state, &proc_list, &id, entry.pid, volume, muted)
}

// ---------------- 实例 ----------------

#[tauri::command]
fn refresh_instances(state: State<'_, AppState>) -> RuntimeSnapshot {
    let cfg = state.config.lock().unwrap().clone();
    let proc_list = procs::snapshot();
    let mut instances = Vec::with_capacity(cfg.instances.len());

    {
        let pids = state.pids.lock().unwrap();
        for instance in &cfg.instances {
            // 不在这里摘除已退出的 PID：交给后台监控统一处理，
            // 否则前端先轮询到死亡，崩溃重启就永远等不到事件。
            let entry = pids
                .get(&instance.id)
                .copied()
                .filter(|entry| procs::alive(&proc_list, entry.pid));

            let (hwnd, memory_mb, responding, rect) = match entry {
                Some(entry) => {
                    let hwnd = win32::find_window(entry.pid);
                    let memory = procs::tree_working_set(&proc_list, entry.pid) as f64 / 1024.0 / 1024.0;
                    let responding = hwnd.is_some_and(|handle| !win32::is_hung(handle));
                    (
                        hwnd.map(|handle| handle as i64),
                        memory,
                        responding,
                        hwnd.and_then(win32::window_rect),
                    )
                }
                None => (None, 0.0, false, None),
            };

            instances.push(InstanceRuntime {
                id: instance.id.clone(),
                pid: entry.map(|entry| entry.pid),
                running: entry.is_some(),
                hwnd,
                memory_mb: (memory_mb * 10.0).round() / 10.0,
                responding,
                rect,
            });
        }
    }

    let managed: Vec<u32> = state.pids.lock().unwrap().values().map(|entry| entry.pid).collect();
    let unmanaged = procs::onmyoji_pids(&proc_list)
        .iter()
        .filter(|pid| !managed.contains(pid))
        .count();

    RuntimeSnapshot {
        instances,
        unmanaged,
        client_found: config::client_present(&cfg.client_root),
    }
}

#[tauri::command]
fn launch_instance(app: AppHandle, id: String, state: State<'_, AppState>) -> Result<u32, String> {
    let cfg = state.config.lock().unwrap().clone();
    let proc_list = procs::snapshot();
    if let Some(entry) = state.pids.lock().unwrap().get(&id).copied() {
        if procs::alive(&proc_list, entry.pid) {
            return Err("该实例已在运行".to_string());
        }
    }

    let (pid, started_at) = spawn_for(&cfg, &id)?;
    state
        .pids
        .lock()
        .unwrap()
        .insert(id.clone(), PidEntry { pid, started_at });
    state.seen.lock().unwrap().insert(id.clone());
    state.restart.lock().unwrap().remove(&id);
    state.audio_applied.lock().unwrap().remove(&id);
    persist_pids(&state);
    refresh_tray(&app);
    logs::info(&format!("启动实例 {id}，PID {pid}"));
    Ok(pid)
}

#[tauri::command]
fn stop_instance(app: AppHandle, id: String, state: State<'_, AppState>) {
    if let Some(entry) = state.pids.lock().unwrap().remove(&id) {
        kill_tree(entry.pid);
    }
    // 手动关闭的实例不参与自动重启
    state.seen.lock().unwrap().remove(&id);
    state.restart.lock().unwrap().remove(&id);
    state.audio_applied.lock().unwrap().remove(&id);
    persist_pids(&state);
    refresh_tray(&app);
}

#[tauri::command]
fn stop_instances(app: AppHandle, ids: Vec<String>, state: State<'_, AppState>) {
    for id in &ids {
        if let Some(entry) = state.pids.lock().unwrap().remove(id) {
            kill_tree(entry.pid);
        }
        state.seen.lock().unwrap().remove(id);
        state.restart.lock().unwrap().remove(id);
        state.audio_applied.lock().unwrap().remove(id);
    }
    persist_pids(&state);
    refresh_tray(&app);
}

#[tauri::command]
fn stop_all(app: AppHandle, state: State<'_, AppState>) {
    let entries: Vec<(String, PidEntry)> = {
        let mut pids = state.pids.lock().unwrap();
        pids.drain().collect()
    };
    for (_, entry) in entries {
        kill_tree(entry.pid);
    }
    state.seen.lock().unwrap().clear();
    state.restart.lock().unwrap().clear();
    state.audio_applied.lock().unwrap().clear();
    persist_pids(&state);
    refresh_tray(&app);
}

/// 把外部启动的游戏进程接管到空闲的实例上（按启动时间顺序分配）。
#[tauri::command]
fn adopt_external(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let cfg = state.config.lock().unwrap().clone();
    let proc_list = procs::snapshot();
    let existing: HashSet<String> = state.pids.lock().unwrap().keys().cloned().collect();
    let managed: HashSet<u32> = state.pids.lock().unwrap().values().map(|entry| entry.pid).collect();

    let mut free: Vec<u32> = procs::onmyoji_pids(&proc_list)
        .into_iter()
        .filter(|pid| !managed.contains(pid))
        .collect();
    free.sort_by_key(|pid| procs::start_time(*pid).unwrap_or(0));

    let targets: Vec<String> = cfg
        .instances
        .iter()
        .filter(|item| !existing.contains(&item.id))
        .map(|item| item.id.clone())
        .collect();

    let mut adopted = 0;
    for (id, pid) in targets.iter().zip(free.iter()) {
        let started_at = procs::start_time(*pid).unwrap_or(0);
        state
            .pids
            .lock()
            .unwrap()
            .insert(id.clone(), PidEntry { pid: *pid, started_at });
        state.seen.lock().unwrap().insert(id.clone());
        adopted += 1;
    }

    if adopted > 0 {
        persist_pids(&state);
        refresh_tray(&app);
        logs::info(&format!("接管 {adopted} 个外部启动的游戏进程"));
    }
    Ok(adopted)
}

#[tauri::command]
fn focus_window(id: String, state: State<'_, AppState>) {
    let pid = state.pids.lock().unwrap().get(&id).map(|entry| entry.pid);
    if let Some(hwnd) = pid.and_then(win32::find_window) {
        win32::focus(hwnd);
    }
}

#[tauri::command]
fn tile_windows(state: State<'_, AppState>) {
    let pids: Vec<u32> = state.pids.lock().unwrap().values().map(|entry| entry.pid).collect();
    let hwnds: Vec<_> = pids.iter().filter_map(|pid| win32::find_window(*pid)).collect();
    win32::tile(&hwnds);
}

#[tauri::command]
fn open_game_dir(state: State<'_, AppState>) -> Result<(), String> {
    let root = state.config.lock().unwrap().client_root.clone();
    let mut command = Command::new("explorer");
    command.arg(root);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_log_dir() -> Result<String, String> {
    let dir = logs::dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let display = dir.display().to_string();
    let mut command = Command::new("explorer");
    command.arg(&dir);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|e| e.to_string())?;
    Ok(display)
}

// ---------------- 工具匣 ----------------

/// 跟随主题切换窗口与托盘图标：浅色用墨色单色版，暗色用金色朱印版。
#[tauri::command]
fn set_icon_theme(app: AppHandle, theme: String) {
    let bytes: &[u8] = if theme == "dark" {
        include_bytes!("../icons/theme-dark.png")
    } else {
        include_bytes!("../icons/theme-light.png")
    };
    let Ok(image) = tauri::image::Image::from_bytes(bytes) else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_icon(image.clone());
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(image));
    }
}

#[tauri::command]
fn app_paths(state: State<'_, AppState>) -> AppPaths {
    let cfg = state.config.lock().unwrap().clone();
    AppPaths {
        data_dir: config::data_dir().display().to_string(),
        tools_dir: config::tools_dir(&cfg).display().to_string(),
        portable: config::is_portable(),
    }
}

#[tauri::command]
fn list_tools(state: State<'_, AppState>) -> ToolsSnapshot {
    let cfg = state.config.lock().unwrap().clone();
    let root = config::tools_dir(&cfg);
    ToolsSnapshot {
        tools: cfg.tools.iter().map(|def| tools::status(&root, def)).collect(),
        tools_dir: root.display().to_string(),
    }
}

#[tauri::command]
async fn install_tool(
    app: tauri::AppHandle,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (def, root, proxy) = {
        let cfg = state.config.lock().unwrap();
        let def = cfg
            .tools
            .iter()
            .find(|tool| tool.id == id)
            .cloned()
            .ok_or_else(|| "工具不存在".to_string())?;
        (def, config::tools_dir(&cfg), cfg.proxy.clone())
    };
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancel
        .lock()
        .unwrap()
        .insert(id.clone(), cancel.clone());
    logs::info(&format!("开始安装工具 {}", def.name));
    let result = tools::install_from_url(&app, &root, &def, &proxy, cancel).await;
    state.cancel.lock().unwrap().remove(&id);
    match &result {
        Ok(()) => logs::info(&format!("工具 {} 安装完成", def.name)),
        Err(error) => logs::error(&format!("工具 {} 安装失败：{error}", def.name)),
    }
    result
}

#[tauri::command]
fn cancel_install(id: String, state: State<'_, AppState>) {
    if let Some(flag) = state.cancel.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
async fn check_tool_updates(state: State<'_, AppState>) -> Result<Vec<tools::ToolUpdate>, String> {
    let cfg = state.config.lock().unwrap().clone();
    let root = config::tools_dir(&cfg);
    let proxy = cfg.proxy.clone();
    let mut updates = Vec::new();
    for def in cfg.tools.iter().filter(|def| root.join(&def.id).is_dir()) {
        updates.push(tools::check_update(&root, def, &proxy).await);
    }
    Ok(updates)
}

#[tauri::command]
async fn install_tool_zip(
    id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (def, root) = {
        let cfg = state.config.lock().unwrap();
        let def = cfg
            .tools
            .iter()
            .find(|tool| tool.id == id)
            .cloned()
            .ok_or_else(|| "工具不存在".to_string())?;
        (def, config::tools_dir(&cfg))
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        tools::install_from_zip(&root, &def, &path)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(error) = &result {
        logs::error(&format!("本地 zip 安装失败：{error}"));
    }
    result
}

#[tauri::command]
fn open_tool(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (def, root) = {
        let cfg = state.config.lock().unwrap();
        let def = cfg
            .tools
            .iter()
            .find(|tool| tool.id == id)
            .cloned()
            .ok_or_else(|| "工具不存在".to_string())?;
        (def, config::tools_dir(&cfg))
    };
    tools::open_tool(&root, &def)
}

#[tauri::command]
fn open_tool_dir(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (def, root) = {
        let cfg = state.config.lock().unwrap();
        let def = cfg
            .tools
            .iter()
            .find(|tool| tool.id == id)
            .cloned()
            .ok_or_else(|| "工具不存在".to_string())?;
        (def, config::tools_dir(&cfg))
    };
    tools::open_dir(&root, &def)
}

#[tauri::command]
fn remove_tool(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (def, root) = {
        let cfg = state.config.lock().unwrap();
        let def = cfg
            .tools
            .iter()
            .find(|tool| tool.id == id)
            .cloned()
            .ok_or_else(|| "工具不存在".to_string())?;
        (def, config::tools_dir(&cfg))
    };
    tools::remove_tool(&root, &def)
}

#[tauri::command]
fn save_tool(tool: config::ToolDef, state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if let Some(existing) = cfg.tools.iter_mut().find(|item| item.id == tool.id) {
        *existing = tool;
    } else {
        cfg.tools.push(tool);
    }
    config::save(&cfg)
}

fn exit_app(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        save_window_state(&window);
    }
    logs::info("退出应用");
    app.exit(0);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    exit_app(&app);
}

// ---------------- 托盘 ----------------

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<AppState>();
    let cfg = state.config.lock().unwrap().clone();
    let running: HashSet<String> = state.pids.lock().unwrap().keys().cloned().collect();

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let head_separator = PredefinedMenuItem::separator(app)?;
    let tail_separator = PredefinedMenuItem::separator(app)?;
    let mut focus_items = Vec::new();
    for instance in cfg.instances.iter().filter(|item| running.contains(&item.id)) {
        focus_items.push(MenuItem::with_id(
            app,
            format!("focus:{}", instance.id),
            format!("聚焦 · {}", instance.name),
            true,
            None::<&str>,
        )?);
    }

    let mut refs: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&show];
    if !focus_items.is_empty() {
        refs.push(&head_separator);
        for item in &focus_items {
            refs.push(item);
        }
    }
    refs.push(&tail_separator);
    refs.push(&quit);
    Menu::with_items(app, &refs)
}

fn refresh_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

// ---------------- 窗口状态 ----------------

fn restore_window(window: &tauri::WebviewWindow) {
    let saved = config::load_window();
    if !saved.saved || saved.width == 0 || saved.height == 0 {
        return;
    }
    let (x, y) = win32::clamp_to_screens(saved.x, saved.y, saved.width, saved.height);
    let _ = window.set_size(tauri::PhysicalSize::new(saved.width, saved.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    if saved.maximized {
        let _ = window.maximize();
    }
}

fn save_window_state(window: &tauri::WebviewWindow) {
    let maximized = window.is_maximized().unwrap_or(false);
    let mut state = config::load_window();
    state.saved = true;
    state.maximized = maximized;
    if !maximized {
        if let Ok(size) = window.inner_size() {
            state.width = size.width;
            state.height = size.height;
        }
        if let Ok(position) = window.outer_position() {
            state.x = position.x;
            state.y = position.y;
        }
    }
    config::save_window(&state);
}

fn save_window_state_if_changed(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let current = config::load_window();
    let mut next = current.clone();
    next.saved = true;
    next.maximized = maximized;
    if !maximized {
        if let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) {
            next.width = size.width;
            next.height = size.height;
            next.x = position.x;
            next.y = position.y;
        }
    }
    if next.width != current.width
        || next.height != current.height
        || next.x != current.x
        || next.y != current.y
        || next.maximized != current.maximized
    {
        config::save_window(&next);
    }
}

// ---------------- 后台监控：崩溃重启 ----------------

fn monitor_tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let proc_list = procs::snapshot();

    let died: Vec<String> = {
        let mut pids = state.pids.lock().unwrap();
        let dead: Vec<String> = pids
            .iter()
            .filter(|(_, entry)| !procs::alive(&proc_list, entry.pid))
            .map(|(id, _)| id.clone())
            .collect();
        for id in &dead {
            pids.remove(id);
        }
        dead
    };
    if !died.is_empty() {
        for id in &died {
            state.audio_applied.lock().unwrap().remove(id);
        }
        persist_pids(&state);
        refresh_tray(app);
    }

    let cfg = state.config.lock().unwrap().clone();

    for id in &died {
        let Some(instance) = cfg.instances.iter().find(|item| &item.id == id) else {
            continue;
        };
        if !instance.auto_restart || !state.seen.lock().unwrap().contains(id) {
            continue;
        }
        let mut restart = state.restart.lock().unwrap();
        let attempts = restart.get(id).map(|plan| plan.attempts).unwrap_or(0);
        let delay = match attempts {
            0 => 5,
            1 => 15,
            2 => 60,
            _ => 180,
        };
        restart.insert(
            id.clone(),
            RestartPlan {
                attempts: attempts + 1,
                next_at: Instant::now() + Duration::from_secs(delay),
            },
        );
        logs::warn(&format!(
            "实例 {} 意外退出，{} 秒后尝试重启（第 {} 次）",
            instance.name,
            delay,
            attempts + 1
        ));
        let _ = app.emit(
            "instance-crashed",
            serde_json::json!({ "id": id, "name": instance.name, "delay": delay }),
        );
    }

    // 音频会话通常在窗口出现后才创建，这里持续补套用，直到匹配到会话。
    {
        let running: Vec<(String, u32)> = state
            .pids
            .lock()
            .unwrap()
            .iter()
            .map(|(id, entry)| (id.clone(), entry.pid))
            .collect();
        for (id, pid) in running {
            let applied = state.audio_applied.lock().unwrap().get(&id).copied();
            if applied == Some(pid) {
                continue;
            }
            let Some(instance) = cfg.instances.iter().find(|item| item.id == id) else {
                continue;
            };
            let _ = apply_audio_pid(&state, &proc_list, &id, pid, instance.volume, instance.muted);
        }
    }

    let due: Vec<String> = {
        let restart = state.restart.lock().unwrap();
        restart
            .iter()
            .filter(|(_, plan)| plan.next_at <= Instant::now())
            .map(|(id, _)| id.clone())
            .collect()
    };

    for id in due {
        if state.pids.lock().unwrap().contains_key(&id) {
            state.restart.lock().unwrap().remove(&id);
            continue;
        }
        let Some(instance) = cfg.instances.iter().find(|item| item.id == id).cloned() else {
            state.restart.lock().unwrap().remove(&id);
            continue;
        };
        match spawn_for(&cfg, &id) {
            Ok((pid, started_at)) => {
                state
                    .pids
                    .lock()
                    .unwrap()
                    .insert(id.clone(), PidEntry { pid, started_at });
                state.seen.lock().unwrap().insert(id.clone());
                state.restart.lock().unwrap().remove(&id);
                state.audio_applied.lock().unwrap().remove(&id);
                persist_pids(&state);
                refresh_tray(app);
                logs::info(&format!("实例 {} 已自动重启，PID {}", instance.name, pid));
                let _ = app.emit(
                    "instance-restarted",
                    serde_json::json!({ "id": id, "name": instance.name, "pid": pid }),
                );
            }
            Err(error) => {
                logs::error(&format!("实例 {} 自动重启失败：{}", instance.name, error));
                let mut restart = state.restart.lock().unwrap();
                match restart.get_mut(&id) {
                    Some(plan) if plan.attempts >= 5 => {
                        restart.remove(&id);
                        let _ = app.emit(
                            "instance-restart-failed",
                            serde_json::json!({ "id": id, "name": instance.name, "error": error }),
                        );
                    }
                    Some(plan) => plan.next_at = Instant::now() + Duration::from_secs(180),
                    None => {}
                }
            }
        }
    }
}

fn start_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            tick += 1;
            monitor_tick(&app);
            if tick % 5 == 0 {
                save_window_state_if_changed(&app);
            }
        }
    });
}

// ---------------- 单实例 ----------------

mod single_instance {
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_ALREADY_EXISTS, GetLastError};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    /// 取到互斥体返回句柄（进程退出前一直持有）；已有实例时返回 None。
    pub fn acquire() -> Option<*mut core::ffi::c_void> {
        let name: Vec<u16> = "Local\\yys-ledger-single-instance\0".encode_utf16().collect();
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
            if handle.is_null() {
                return Some(std::ptr::null_mut());
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                return None;
            }
            Some(handle)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 第二次启动只唤起已有窗口，避免两个进程互相覆盖配置。
    if single_instance::acquire().is_none() {
        if let Some(hwnd) = win32::find_window_by_title("百鬼帐") {
            win32::focus(hwnd);
        }
        return;
    }

    let migrated = config::prepare_data_dir();
    let initial = config::load();
    if migrated > 0 {
        logs::info(&format!(
            "从旧目录 yys-hub 迁移了 {migrated} 个文件到 {}",
            config::data_dir().display()
        ));
    }
    logs::info(&format!(
        "启动 yys-ledger {}，客户端目录 {}",
        env!("CARGO_PKG_VERSION"),
        initial.client_root
    ));

    // 恢复上次运行中的实例：PID + 创建时间都一致才算同一个进程。
    let mut initial_pids: HashMap<String, PidEntry> = HashMap::new();
    let mut initial_seen: HashSet<String> = HashSet::new();
    {
        let proc_list = procs::snapshot();
        for record in config::load_pids() {
            let same = procs::alive(&proc_list, record.pid)
                && (record.started_at == 0
                    || procs::start_time(record.pid) == Some(record.started_at));
            if same {
                initial_pids.insert(
                    record.id.clone(),
                    PidEntry {
                        pid: record.pid,
                        started_at: record.started_at,
                    },
                );
                initial_seen.insert(record.id);
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config: Mutex::new(initial),
            pids: Mutex::new(initial_pids),
            seen: Mutex::new(initial_seen),
            restart: Mutex::new(HashMap::new()),
            cancel: Mutex::new(HashMap::new()),
            audio_applied: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            detect_client,
            probe_client_root,
            find_client_roots,
            refresh_instances,
            launch_instance,
            apply_audio,
            preview_audio,
            stop_instance,
            stop_instances,
            stop_all,
            adopt_external,
            focus_window,
            tile_windows,
            open_game_dir,
            open_log_dir,
            app_paths,
            set_icon_theme,
            list_tools,
            install_tool,
            install_tool_zip,
            cancel_install,
            check_tool_updates,
            open_tool,
            open_tool_dir,
            remove_tool,
            save_tool,
            quit_app,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                restore_window(&window);
            }

            let menu = build_tray_menu(app.handle())?;
            let mut builder = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    match id {
                        "show" => show_main(app),
                        "quit" => exit_app(app),
                        other if other.starts_with("focus:") => {
                            let instance_id = other.trim_start_matches("focus:");
                            let state = app.state::<AppState>();
                            if let Some(pid) =
                                state.pids.lock().unwrap().get(instance_id).map(|entry| entry.pid)
                            {
                                if let Some(hwnd) = win32::find_window(pid) {
                                    win32::focus(hwnd);
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder.build(app)?;

            start_monitor(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(main) = window.app_handle().get_webview_window("main") {
                    save_window_state(&main);
                }
                let _ = window.app_handle().emit("hidden-to-tray", ());
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
