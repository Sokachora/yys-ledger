import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { PALETTE, api } from "../lib/api";
import type { AppConfig, ClientCandidate, ClientInfo, Instance } from "../types";

interface Props {
  config: AppConfig;
  onCancel: () => void;
  onFinish: (next: AppConfig) => Promise<void>;
}

const MAX_COUNT = 30;

export default function Onboarding({ config, onCancel, onFinish }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [path, setPath] = useState(config.clientRoot);
  const [probe, setProbe] = useState<ClientInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [candidates, setCandidates] = useState<ClientCandidate[]>([]);
  const [count, setCount] = useState(3);
  const [prefix, setPrefix] = useState("小号");

  // 首次进入：自动探测，当前配置无效时默认选中第一个候选。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [list, current] = await Promise.all([
        api.findClientRoots().catch(() => [] as ClientCandidate[]),
        api.probeClientRoot(config.clientRoot).catch(() => null),
      ]);
      if (!alive) return;
      setCandidates(list);
      if (current) setProbe(current);
      if (!current?.found && list.length > 0) setPath(list[0].root);
      setScanning(false);
    })();
    return () => {
      alive = false;
    };
  }, [config.clientRoot]);

  // 手动改路径后延迟校验，避免每按一个键就查一次磁盘。
  useEffect(() => {
    const value = path.trim();
    if (!value) {
      setProbe(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setProbing(true);
      try {
        const next = await api.probeClientRoot(value);
        if (alive) setProbe(next);
      } catch {
        if (alive) setProbe(null);
      } finally {
        if (alive) setProbing(false);
      }
    }, 320);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path]);

  const safeCount = Math.min(MAX_COUNT, Math.max(1, Math.floor(count) || 1));
  const names = useMemo(
    () =>
      Array.from({ length: safeCount }, (_, index) => `${prefix.trim() || "小号"}${index + 1}`),
    [prefix, safeCount],
  );
  const root = path.trim().replace(/[\\/]+$/, "");
  const ready = Boolean(probe?.found);

  function finish() {
    const instances: Instance[] = names.map((name, index) => ({
      id: crypto.randomUUID(),
      name,
      group: "",
      color: PALETTE[index % PALETTE.length],
      note: "",
      args: [],
      autoRestart: false,
      volume: 100,
      muted: false,
    }));
    void onFinish({
      ...config,
      clientRoot: root,
      onboarded: true,
      instances: [...config.instances, ...instances],
    });
  }

  /// 只保存客户端路径，名册留空，之后可以批量创建。
  function skipInstances() {
    void onFinish({ ...config, clientRoot: root, onboarded: true });
  }

  return (
    <Modal
      wide
      title="初次见面"
      onClose={onCancel}
      footer={
        step === 1 ? (
          <>
            <button className="btn ghost" onClick={onCancel}>
              稍后再说
            </button>
            <button className="btn primary" disabled={!ready} onClick={() => setStep(2)}>
              下一步
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost push-left" onClick={skipInstances}>
              跳过，先不建实例
            </button>
            <button className="btn ghost" onClick={() => setStep(1)}>
              上一步
            </button>
            <button className="btn primary" onClick={finish}>
              完成 · 创建 {safeCount} 个实例
            </button>
          </>
        )
      }
    >
      <ol className="wizard-steps" aria-label="设置步骤">
        <li className={step === 1 ? "active" : "done"}>
          <span>一</span>定位客户端
        </li>
        <li className={step === 2 ? "active" : ""}>
          <span>二</span>建立名册
        </li>
      </ol>

      {step === 1 ? (
        <>
          <p className="dialog-text">
            百鬼帐直接调用客户端的 <code>bin\onmyoji.exe</code> 来多开，所以先确认安装位置。
            下面会自动查找本机的客户端，找不到再手动填写。
          </p>

          <div className="scan-note" aria-live="polite">
            {scanning ? (
              <>
                <span className="scan-dot" aria-hidden="true" />
                正在查找安装目录…
              </>
            ) : candidates.length > 0 ? (
              <>找到 {candidates.length} 处候选，点选一个</>
            ) : (
              <>没有自动找到安装目录，请手动填写</>
            )}
          </div>

          {candidates.length > 0 && (
            <div className="candidate-list" role="radiogroup" aria-label="检测到的安装目录">
              {candidates.map((item) => (
                <button
                  key={item.root}
                  type="button"
                  role="radio"
                  aria-checked={root === item.root}
                  className={`candidate ${root === item.root ? "active" : ""}`}
                  onClick={() => setPath(item.root)}
                >
                  <span className="candidate-source">{item.source}</span>
                  <code>{item.root}</code>
                  {item.version && <span className="candidate-version">v{item.version}</span>}
                </button>
              ))}
            </div>
          )}

          <label className="field">
            <span>安装路径</span>
            <input
              value={path}
              placeholder="C:\yys"
              spellCheck={false}
              onChange={(event) => setPath(event.target.value)}
            />
          </label>

          <p
            className={`wizard-probe ${ready ? "ok" : probe ? "warn" : ""}`}
            aria-live="polite"
          >
            {probing
              ? "正在校验路径…"
              : ready
                ? `已找到主程序${probe?.version ? ` · 客户端版本 ${probe.version}` : ""}`
                : probe
                  ? "该目录下没有 bin\\onmyoji.exe，换一个路径试试"
                  : "填写包含 bin 文件夹的安装根目录"}
          </p>
        </>
      ) : (
        <>
          <p className="dialog-text">
            客户端已定位：<code>{root}</code>
          </p>

          <div className="field-row">
            <label className="field narrow">
              <span>实例数量</span>
              <input
                type="number"
                min={1}
                max={MAX_COUNT}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>名称前缀</span>
              <input
                value={prefix}
                placeholder="小号"
                onChange={(event) => setPrefix(event.target.value)}
              />
            </label>
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

          <p className="dialog-text muted">
            创建后可以在名册里改名、加标签、填备注；启动间隔、工具目录等随时能在设置里调整。
            名字只是本地备注，与游戏账号无关。
          </p>
        </>
      )}
    </Modal>
  );
}
