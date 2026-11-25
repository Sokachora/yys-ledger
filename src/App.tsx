import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import Modal from "./components/Modal";
import Onboarding from "./components/Onboarding";
import TitleBar from "./components/TitleBar";
import { IconExternal, IconInstances, IconSettings, IconTools } from "./components/icons";
import InstancesPage from "./pages/Instances";
import SettingsPage from "./pages/Settings";
import ToolsPage from "./pages/Tools";
import { PALETTE, api, sleep } from "./lib/api";
import type { AppConfig, Instance, Page, RuntimeSnapshot, ThemeMode } from "./types";

const NAV = [
  { key: "instances" as Page, label: "名册", hint: "实例、状态与窗口", Icon: IconInstances },
  { key: "tools" as Page, label: "工具匣", hint: "资源下载与已下载管理", Icon: IconTools },
  { key: "settings" as Page, label: "设置", hint: "客户端与启动参数", Icon: IconSettings },
];

export default function App() {
  const [page, setPage] = useState<Page>("instances");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [version, setVersion] = useState("0.1.1");
  const [createSignal, setCreateSignal] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem("yys-theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [isDark, setIsDark] = useState(
    () => document.documentElement.dataset.theme !== "light",
  );

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((err) => setError(String(err)));
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const next = await api.refresh();
        if (alive) setSnapshot(next);
      } catch {
        /* 保持上一次快照 */
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const effective: "light" | "dark" =
        themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = effective;
      setIsDark(effective === "dark");
      window.localStorage.setItem("yys-theme", themeMode);
      const icon = effective === "dark" ? "/brand/icon-dark.png" : "/brand/icon-light.png";
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) link.href = icon;
      void api.setIconTheme(effective).catch(() => undefined);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  useEffect(() => {
    const mode = config?.theme;
    if (mode === "system" || mode === "light" || mode === "dark") {
      setThemeMode((current) => (current === mode ? current : mode));
    }
  }, [config?.theme]);

  const notify = useCallback((text: string) => setToast(text), []);

  const applyConfig = useCallback(async (next: AppConfig) => {
    setConfig(next);
    try {
      await api.saveConfig(next);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // 首次启动：没有走完引导且名册为空时弹出向导；已有实例的老用户静默标记完成。
  const onboardedRef = useRef(false);
  useEffect(() => {
    if (!config || onboardedRef.current) return;
    onboardedRef.current = true;
    if (config.onboarded) return;
    if (config.instances.length === 0) {
      setOnboarding(true);
    } else {
      void applyConfig({ ...config, onboarded: true });
    }
  }, [applyConfig, config]);

  const refreshNow = useCallback(async () => {
    try {
      setSnapshot(await api.refresh());
    } catch {
      /* ignore */
    }
  }, []);

  // 收进托盘时窗口已经隐藏，提示要等下次回到窗口再显示（只提示一次）
  const trayHintPending = useRef(false);
  useEffect(() => {
    const showHint = () => {
      if (!trayHintPending.current) return;
      trayHintPending.current = false;
      window.localStorage.setItem("yys-tray-hint", "1");
      setToast("窗口已收进托盘，双击托盘图标可以回到这里");
    };
    window.addEventListener("focus", showHint);
    document.addEventListener("visibilitychange", showHint);
    return () => {
      window.removeEventListener("focus", showHint);
      document.removeEventListener("visibilitychange", showHint);
    };
  }, []);

  // 后台事件：收进托盘、崩溃重启、自动拉起结果
  useEffect(() => {
    const pending = Promise.all([
      listen("hidden-to-tray", () => {
        if (!window.localStorage.getItem("yys-tray-hint")) {
          trayHintPending.current = true;
        }
      }),
      listen<{ name: string; delay: number }>("instance-crashed", (event) => {
        setToast(`${event.payload.name} 意外退出，${event.payload.delay} 秒后自动重启`);
        void refreshNow();
      }),
      listen<{ name: string }>("instance-restarted", (event) => {
        setToast(`${event.payload.name} 已自动重启`);
        void refreshNow();
      }),
      listen<{ name: string; error: string }>("instance-restart-failed", (event) => {
        setToast(`${event.payload.name} 自动重启失败：${event.payload.error}`);
      }),
    ]);
    return () => {
      void pending.then((stops) => stops.forEach((stop) => stop()));
    };
  }, [refreshNow]);

  const toggleMuteAll = useCallback(async () => {
    if (!config || config.instances.length === 0) return;
    const nextMuted = !config.instances.every((item) => item.muted);
    await applyConfig({
      ...config,
      instances: config.instances.map((item) => ({ ...item, muted: nextMuted })),
    });
    try {
      await api.applyAudio(config.instances.map((item) => item.id));
    } catch (error) {
      setError(String(error));
    }
    notify(nextMuted ? "已静音全部实例" : "已恢复全部实例声音");
  }, [applyConfig, config, notify]);

  // 快捷键
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        void refreshNow();
        return;
      }
      if (document.querySelector(".modal-mask")) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "m") {
        event.preventDefault();
        void toggleMuteAll();
      } else if (key === "n") {
        event.preventDefault();
        setPage("instances");
        setCreateSignal((value) => value + 1);
      } else if (key === "b") {
        event.preventDefault();
        setPage("instances");
        setBatchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshNow, toggleMuteAll]);

  const changeTheme = useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode);
      window.localStorage.setItem("yys-theme", mode);
      if (config) void applyConfig({ ...config, theme: mode });
    },
    [applyConfig, config],
  );

  const toggleTheme = useCallback(() => {
    changeTheme(isDark ? "light" : "dark");
  }, [changeTheme, isDark]);

  const runningCount = snapshot?.instances.filter((item) => item.running).length ?? 0;

  const launchAll = useCallback(async () => {
    if (!config || launching) return;
    if (config.instances.length === 0) {
      notify("还没有实例，先创建一个");
      return;
    }
    setLaunching(true);
    const runningIds = new Set(
      (snapshot?.instances ?? []).filter((item) => item.running).map((item) => item.id),
    );
    try {
      for (const instance of config.instances) {
        if (runningIds.has(instance.id)) continue;
        try {
          await api.launch(instance.id);
        } catch (err) {
          notify(`${instance.name}：${err}`);
        }
        await sleep(config.launchIntervalMs);
      }
      notify("启动流程完成");
    } finally {
      setLaunching(false);
      await refreshNow();
    }
  }, [config, launching, notify, refreshNow, snapshot]);

  const stopAll = useCallback(async () => {
    await api.stopAll();
    notify("已关闭全部实例");
    await refreshNow();
  }, [notify, refreshNow]);

  const tile = useCallback(async () => {
    await api.tile();
    notify("窗口已整理");
  }, [notify]);

  function openNewInstance() {
    setPage("instances");
    setCreateSignal((value) => value + 1);
  }

  function openBatchCreate() {
    setPage("instances");
    setBatchOpen(true);
  }

  return (
    <div className="app">
      <TitleBar
        page={page}
        runningCount={runningCount}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onNavigate={setPage}
        onNewInstance={openNewInstance}
        onBatchCreate={openBatchCreate}
        onLaunchAll={() => void launchAll()}
        onStopAll={() => void stopAll()}
        onTile={() => void tile()}
        onRefresh={() => void refreshNow()}
        onAbout={() => setAboutOpen(true)}
        onOnboarding={() => setOnboarding(true)}
      />

      <div className="app-body">
        <aside className="sidebar">
          <div className="workspace">
            <img
              className="sidebar-logo"
              src={isDark ? "/brand/icon-dark.png" : "/brand/icon-light.png"}
              alt=""
              aria-hidden="true"
            />
            <span className="sidebar-line" aria-hidden="true" />
            <div className="workspace-meta">
              <strong>我的工作区</strong>
              <small>
                <span className={`workspace-dot ${snapshot?.clientFound ? "ok" : ""}`} />
                {config?.clientRoot ?? "C:\\yys"}
              </small>
            </div>
            <button
              className="workspace-action"
              title="打开游戏目录"
              aria-label="打开游戏目录"
              onClick={() => void api.openGameDir()}
            >
              <IconExternal size={13} />
            </button>
          </div>

          <div className="sidebar-label">管理</div>
          <nav className="nav" aria-label="主导航">
            {NAV.map((item) => (
              <button
                key={item.key}
                className={`nav-item ${page === item.key ? "active" : ""}`}
                onClick={() => setPage(item.key)}
                title={item.hint}
                aria-current={page === item.key ? "page" : undefined}
              >
                <span className="nav-icon">
                  <item.Icon size={15} />
                </span>
                <span className="nav-label">{item.label}</span>
                {item.key === "instances" && runningCount > 0 && (
                  <span className="nav-count">{runningCount}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <span>v{version}</span>
            <span>本地管理 · 不修改游戏文件</span>
          </div>
        </aside>

        <main className="content">
          {error && (
            <button
              type="button"
              className="banner error"
              role="alert"
              onClick={() => setError(null)}
            >
              {error}
            </button>
          )}
          {!config ? (
            <div className="loading">正在读取配置…</div>
          ) : page === "instances" ? (
            <InstancesPage
              config={config}
              onConfig={applyConfig}
              notify={notify}
              snapshot={snapshot}
              refresh={refreshNow}
              launching={launching}
              onLaunchAll={launchAll}
              onStopAll={stopAll}
              onTile={tile}
              onBatchCreate={openBatchCreate}
              createSignal={createSignal}
            />
          ) : page === "tools" ? (
            <ToolsPage config={config} onConfig={applyConfig} notify={notify} />
          ) : (
            <SettingsPage
              config={config}
              onConfig={applyConfig}
              notify={notify}
              theme={themeMode}
              onThemeChange={changeTheme}
            />
          )}
        </main>
      </div>

      {toast && (
        <div
          className="toast"
          role="status"
          aria-live="polite"
          title="点击关闭"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}

      {onboarding && config && (
        <Onboarding
          config={config}
          onCancel={() => {
            setOnboarding(false);
            void applyConfig({ ...config, onboarded: true });
            notify("可以随时从「帮助 → 首次设置向导」重新打开");
          }}
          onFinish={async (next) => {
            const created = next.instances.length - config.instances.length;
            await applyConfig(next);
            setOnboarding(false);
            setPage("instances");
            notify(created > 0 ? `已创建 ${created} 个实例` : "设置完成");
          }}
        />
      )}

      {batchOpen && config && (
        <BatchCreateDialog
          onCancel={() => setBatchOpen(false)}
          onConfirm={async (instances) => {
            const existing = new Set(config.instances.map((item) => item.name.trim()));
            const clash = instances.find((item) => existing.has(item.name.trim()));
            if (clash) {
              notify(`已经有同名实例「${clash.name}」，换个前缀或起始编号`);
              return;
            }
            await applyConfig({
              ...config,
              instances: [...config.instances, ...instances],
            });
            setBatchOpen(false);
            notify(`已创建 ${instances.length} 个实例`);
          }}
        />
      )}

      {aboutOpen && (
        <Modal
          title="关于"
          onClose={() => setAboutOpen(false)}
          footer={
            <button className="btn primary" onClick={() => setAboutOpen(false)}>
              好的
            </button>
          }
        >
          <p className="dialog-text">
            百鬼帐 v{version} —— 官方 PC 版多开管理、窗口整理与便携工具箱。
          </p>
          <p className="dialog-text muted">
            启动方式为直接拉起 bin\onmyoji.exe（工作目录设为安装根目录），因此可以同目录多开。
            不要用 Launch.exe 启动游戏，它会关闭现有实例。
          </p>
          <p className="dialog-text muted">
            工具不保存账号密码、不注入游戏进程、不修改游戏文件。多开行为请自行评估账号风险。
          </p>
        </Modal>
      )}
    </div>
  );
}

function BatchCreateDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (instances: Instance[]) => void;
}) {
  const [count, setCount] = useState(3);
  const [prefix, setPrefix] = useState("小号");
  const [start, setStart] = useState(1);
  const [group, setGroup] = useState("");
  const [colorIndex, setColorIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const safeCount = Math.min(30, Math.max(1, Math.floor(count) || 1));
  const names = Array.from({ length: safeCount }, (_, index) => `${prefix}${start + index}`);

  function submit() {
    if (!prefix.trim()) {
      setError("请填写名称前缀");
      return;
    }
    setError(null);
    const instances: Instance[] = names.map((name, index) => ({
      id: crypto.randomUUID(),
      name,
      group: group.trim(),
      color: PALETTE[(colorIndex + index) % PALETTE.length],
      note: "",
      args: [],
      autoRestart: false,
      volume: 100,
      muted: false,
    }));
    onConfirm(instances);
  }

  return (
    <Modal
      title="批量创建实例"
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" onClick={submit}>
            创建 {safeCount} 个实例
          </button>
        </>
      }
    >
      <div className="field-row">
        <label className="field">
          <span>数量</span>
          <input
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <label className="field">
          <span>名称前缀</span>
          <input
            value={prefix}
            placeholder="小号"
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setPrefix(event.target.value);
              if (error) setError(null);
            }}
          />
        </label>
        <label className="field narrow">
          <span>起始编号</span>
          <input
            type="number"
            min={0}
            value={start}
            onChange={(event) => setStart(Number(event.target.value))}
          />
        </label>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span>标签（可选）</span>
        <input
          value={group}
          placeholder="例如：日常 / 挂机"
          onChange={(event) => setGroup(event.target.value)}
        />
      </label>

      <div className="field">
        <span>起始颜色</span>
        <div className="swatches">
          {PALETTE.map((color, index) => (
            <button
              key={color}
              className={`swatch ${colorIndex === index ? "active" : ""}`}
              style={{ background: color }}
              onClick={() => setColorIndex(index)}
              aria-label={`颜色 ${index + 1}`}
              aria-pressed={colorIndex === index}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <span>将要创建</span>
        <div className="name-preview">
          {names.map((name) => (
            <span className="tag" key={name}>
              {name}
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}
