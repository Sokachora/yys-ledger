import { useEffect, useState } from "react";
import { IconCheck, IconFolder, IconRefresh, IconSearch } from "../components/icons";
import { api } from "../lib/api";
import type { AppConfig, AppPaths, ClientCandidate, ClientInfo, ThemeMode } from "../types";

interface Props {
  config: AppConfig;
  onConfig: (next: AppConfig) => Promise<void>;
  notify: (text: string) => void;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
];

export default function SettingsPage({
  config,
  onConfig,
  notify,
  theme,
  onThemeChange,
}: Props) {
  const [root, setRoot] = useState(config.clientRoot);
  const [intervalSeconds, setIntervalSeconds] = useState(config.launchIntervalMs / 1000);
  const [toolsDir, setToolsDir] = useState(config.toolsDir);
  const [proxy, setProxy] = useState(config.proxy);
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const [effectiveToolsDir, setEffectiveToolsDir] = useState("");
  const [candidates, setCandidates] = useState<ClientCandidate[]>([]);
  const [scanning, setScanning] = useState(false);
  const [paths, setPaths] = useState<AppPaths | null>(null);

  useEffect(() => {
    setRoot(config.clientRoot);
    setIntervalSeconds(config.launchIntervalMs / 1000);
    setToolsDir(config.toolsDir);
    setProxy(config.proxy);
  }, [config]);

  useEffect(() => {
    let alive = true;
    api
      .detectClient()
      .then((next) => alive && setInfo(next))
      .catch(() => undefined);
    api
      .listTools()
      .then((snapshot) => alive && setEffectiveToolsDir(snapshot.toolsDir))
      .catch(() => undefined);
    api
      .appPaths()
      .then((next) => alive && setPaths(next))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [config.clientRoot]);

  async function detect() {
    try {
      setInfo(await api.detectClient());
      notify("检测完成");
    } catch (error) {
      notify(String(error));
    }
  }

  async function autoDetect() {
    setScanning(true);
    try {
      const list = await api.findClientRoots();
      setCandidates(list);
      if (list.length === 0) {
        notify("没找到已安装的客户端，请手动填写安装路径");
      } else {
        setRoot(list[0].root);
        notify(list.length === 1 ? "已定位安装目录" : `找到 ${list.length} 处候选，点选确认`);
      }
    } catch (error) {
      notify(String(error));
    } finally {
      setScanning(false);
    }
  }

  async function openLogs() {
    try {
      const dir = await api.openLogDir();
      notify(`日志目录：${dir}`);
    } catch (error) {
      notify(String(error));
    }
  }

  async function save() {
    await onConfig({
      ...config,
      clientRoot: root.trim().replace(/[\\/]+$/, ""),
      launchIntervalMs: Math.max(1000, Math.round(intervalSeconds * 1000)),
      toolsDir: toolsDir.trim(),
      proxy: proxy.trim(),
    });
    notify("设置已保存");
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <h1>案头设置</h1>
          <p className="subtitle">客户端路径、启动节奏、工具目录与网络</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={detect}>
            <IconRefresh size={14} />
            重新检测
          </button>
          <button className="btn primary" onClick={() => void save()}>
            <IconCheck size={14} />
            保存设置
          </button>
        </div>
      </header>
      <div className="rule-double" />

      <div className="ledger">
        <section className="ledger-section">
          <h3>游戏客户端</h3>

          <div className="ledger-row">
            <span className="ledger-label">安装路径</span>
            <div className="ledger-field">
              <input
                className="ledger-input"
                value={root}
                placeholder="C:\yys"
                onChange={(event) => setRoot(event.target.value)}
              />
              {candidates.length > 0 && (
                <div className="candidate-list inline" aria-label="检测到的安装目录">
                  {candidates.map((item) => (
                    <button
                      key={item.root}
                      type="button"
                      className={`candidate ${root === item.root ? "active" : ""}`}
                      onClick={() => setRoot(item.root)}
                    >
                      <span className="candidate-source">{item.source}</span>
                      <code>{item.root}</code>
                      {item.version && (
                        <span className="candidate-version">v{item.version}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ledger-row">
            <span className="ledger-label">启动间隔</span>
            <div className="ledger-field ledger-inline">
              <input
                className="ledger-input"
                type="number"
                min={1}
                step={0.5}
                value={intervalSeconds}
                onChange={(event) => setIntervalSeconds(Number(event.target.value))}
              />
              <span>秒</span>
            </div>
          </div>

          <p className="ledger-note">
            指向包含 Launch.exe 与 bin 文件夹的安装根目录。逐个启动时，每个实例之间等待这个时长。
          </p>

          <div className="ledger-actions">
            <button className="btn small outline" onClick={() => void api.openGameDir()}>
              <IconFolder size={13} />
              打开游戏目录
            </button>
            <button
              className="btn small outline"
              disabled={scanning}
              onClick={() => void autoDetect()}
            >
              <IconSearch size={13} />
              {scanning ? "检测中…" : "自动检测"}
            </button>
          </div>
        </section>

        <section className="ledger-section">
          <h3>便携工具目录</h3>

          <div className="ledger-row">
            <span className="ledger-label">自定义目录</span>
            <div className="ledger-field">
              <input
                className="ledger-input"
                value={toolsDir}
                placeholder={effectiveToolsDir || "留空使用默认目录"}
                onChange={(event) => setToolsDir(event.target.value)}
              />
            </div>
          </div>

          <p className="ledger-note">
            留空时使用程序目录下的 tools，不可写时回落到 %APPDATA%\yys-ledger\tools。
            当前生效：<code>{effectiveToolsDir || "…"}</code>
          </p>
        </section>

        <section className="ledger-section">
          <h3>外观</h3>

          <div className="ledger-row">
            <span className="ledger-label">主题</span>
            <div className="ledger-field theme-options" role="group" aria-label="主题模式">
              {THEMES.map((item) => (
                <button
                  key={item.value}
                  className={`chip ${theme === item.value ? "active" : ""}`}
                  aria-pressed={theme === item.value}
                  onClick={() => onThemeChange(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <p className="ledger-note">
            跟随系统会随 Windows 的浅色 / 深色设置自动切换；标题栏右上角的日/月按钮可以快速切换。
          </p>
        </section>

        <section className="ledger-section">
          <h3>网络与下载</h3>

          <div className="ledger-row">
            <span className="ledger-label">HTTP 代理</span>
            <div className="ledger-field">
              <input
                className="ledger-input"
                value={proxy}
                placeholder="http://127.0.0.1:7890"
                onChange={(event) => setProxy(event.target.value)}
              />
            </div>
          </div>

          <p className="ledger-note">
            工具匣默认从 GitHub 下载 release 包。若本机无法直连，可填写本地代理，
            或者把便携版 zip 下载好后用「本地 zip」导入。
          </p>
        </section>

        <section className="ledger-section">
          <h3>检测结果</h3>
          {info ? (
            <ul className="info-list">
              <li>
                <span>主程序</span>
                <code>{info.exe}</code>
                <b className={info.found ? "ok-text" : "warn-text"}>
                  {info.found ? "已找到" : "未找到"}
                </b>
              </li>
              <li>
                <span>客户端版本</span>
                <code>{info.version ?? "未知"}</code>
              </li>
              <li>
                <span>运行中的游戏进程</span>
                <code>{info.running} 个</code>
              </li>
            </ul>
          ) : (
            <p className="ledger-note">尚未检测。</p>
          )}
        </section>

        <section className="ledger-section">
          <h3>诊断</h3>
          <p className="ledger-note">
            启动、安装、崩溃重启等操作都会记进本地日志，遇到找不到客户端或下载失败时可以先看这里。
            {paths?.portable ? (
              <>
                便携模式：配置、日志与窗口状态都在程序目录的 <code>data</code> 下，拷贝整个文件夹即可带走。
              </>
            ) : (
              <>
                数据目录：<code>{paths?.dataDir ?? "%APPDATA%\\yys-ledger"}</code>
              </>
            )}
          </p>
          <div className="ledger-actions">
            <button className="btn small outline" onClick={() => void openLogs()}>
              <IconFolder size={13} />
              打开日志目录
            </button>
          </div>
        </section>

        <section className="ledger-section">
          <h3>启动方式</h3>
          <p className="ledger-note">
            本工具直接启动 <code>bin\onmyoji.exe</code>（工作目录设为安装根目录），因此可以同目录多开。
            不要再用 Launch.exe 启动游戏——它会把正在运行的实例全部关闭并接管。
          </p>
          <p className="ledger-note">
            游戏更新仍需官方启动器完成，更新前请先关闭所有实例。工具只做进程、窗口与本地便携工具管理：
            不保存账号密码、不注入游戏进程、不修改游戏文件。
          </p>
        </section>
      </div>
    </div>
  );
}
