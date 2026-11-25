export type Page = "instances" | "tools" | "settings";

export type ThemeMode = "system" | "light" | "dark";

export interface Instance {
  id: string;
  name: string;
  group: string;
  color: string;
  note: string;
  args: string[];
  autoRestart: boolean;
  volume: number;
  muted: boolean;
}

export interface LinkItem {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
}

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  exe: string;
  version: string;
}

export interface ToolStatus extends ToolDef {
  installed: boolean;
  exePath: string | null;
  sizeMb: number;
  dir: string;
  installedVersion: string | null;
  installedAt: number | null;
}

export interface ToolUpdate {
  id: string;
  name: string;
  current: string | null;
  latest: string | null;
  hasUpdate: boolean;
  error: string | null;
}

export interface ToolsSnapshot {
  tools: ToolStatus[];
  toolsDir: string;
}

export interface ToolProgress {
  id: string;
  downloaded: number;
  total: number;
}

export interface AppConfig {
  clientRoot: string;
  launchIntervalMs: number;
  instances: Instance[];
  links: LinkItem[];
  tools: ToolDef[];
  toolsDir: string;
  proxy: string;
  theme: ThemeMode;
  onboarded: boolean;
  builtinSeed: number;
}

export interface ClientCandidate {
  root: string;
  source: string;
  version: string | null;
}

export interface AppPaths {
  dataDir: string;
  toolsDir: string;
  portable: boolean;
}

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InstanceRuntime {
  id: string;
  pid: number | null;
  running: boolean;
  hwnd: number | null;
  memoryMb: number;
  responding: boolean;
  visible: boolean;
  rect: WinRect | null;
}

export interface RuntimeSnapshot {
  instances: InstanceRuntime[];
  unmanaged: number;
  clientFound: boolean;
}

export interface ClientInfo {
  found: boolean;
  root: string;
  exe: string;
  version: string | null;
  running: number;
}
