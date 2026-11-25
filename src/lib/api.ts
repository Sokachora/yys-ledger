import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  AppPaths,
  ClientCandidate,
  ClientInfo,
  RuntimeSnapshot,
  ToolDef,
  ToolsSnapshot,
  ToolUpdate,
} from "../types";

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  detectClient: () => invoke<ClientInfo>("detect_client"),
  probeClientRoot: (root: string) => invoke<ClientInfo>("probe_client_root", { root }),
  findClientRoots: () => invoke<ClientCandidate[]>("find_client_roots"),
  appPaths: () => invoke<AppPaths>("app_paths"),
  setIconTheme: (theme: "light" | "dark") => invoke<void>("set_icon_theme", { theme }),
  refresh: () => invoke<RuntimeSnapshot>("refresh_instances"),
  launch: (id: string) => invoke<number>("launch_instance", { id }),
  applyAudio: (ids: string[]) => invoke<number>("apply_audio", { ids }),
  previewAudio: (id: string, volume: number, muted: boolean) =>
    invoke<number>("preview_audio", { id, volume, muted }),
  stop: (id: string) => invoke<void>("stop_instance", { id }),
  stopMany: (ids: string[]) => invoke<void>("stop_instances", { ids }),
  stopAll: () => invoke<void>("stop_all"),
  adopt: () => invoke<number>("adopt_external"),
  setWindowVisible: (ids: string[], visible: boolean) =>
    invoke<number>("set_window_visible", { ids, visible }),
  focus: (id: string) => invoke<void>("focus_window", { id }),
  tile: () => invoke<void>("tile_windows"),
  openGameDir: () => invoke<void>("open_game_dir"),
  openLogDir: () => invoke<string>("open_log_dir"),

  listTools: () => invoke<ToolsSnapshot>("list_tools"),
  installTool: (id: string) => invoke<void>("install_tool", { id }),
  cancelInstall: (id: string) => invoke<void>("cancel_install", { id }),
  checkToolUpdates: () => invoke<ToolUpdate[]>("check_tool_updates"),
  installToolZip: (id: string, path: string) =>
    invoke<void>("install_tool_zip", { id, path }),
  openTool: (id: string) => invoke<void>("open_tool", { id }),
  openToolDir: (id: string) => invoke<void>("open_tool_dir", { id }),
  removeTool: (id: string) => invoke<void>("remove_tool", { id }),
  saveTool: (tool: ToolDef) => invoke<void>("save_tool", { tool }),

  quit: () => invoke<void>("quit_app"),
};

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 夜墨金主题下的墨色：朱、黛蓝、松绿、赭金、青灰、紫、金、绛 */
export const PALETTE = [
  "#c0453a",
  "#6c8aa6",
  "#6e9a7e",
  "#c08a52",
  "#8a9aa8",
  "#a07a9e",
  "#c2a060",
  "#b04a42",
];
