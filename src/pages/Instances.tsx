import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type MenuAction } from "../components/ContextMenu";
import Modal from "../components/Modal";
import Truncate from "../components/Truncate";
import VolumeControl from "../components/VolumeControl";
import {
  IconGrid,
  IconPlay,
  IconPlus,
  IconSearch,
  IconStop,
  IconTrash,
  IconVolumeOff,
} from "../components/icons";
import { PALETTE, api, sleep } from "../lib/api";
import { cnNumber } from "../lib/format";
import type { AppConfig, Instance, RuntimeSnapshot } from "../types";

interface Props {
  config: AppConfig;
  onConfig: (next: AppConfig) => Promise<void>;
  notify: (text: string) => void;
  snapshot: RuntimeSnapshot | null;
  refresh: () => Promise<void>;
  launching: boolean;
  onLaunchAll: () => Promise<void>;
  onStopAll: () => Promise<void>;
  onTile: () => Promise<void>;
  onBatchCreate: () => void;
  createSignal: number;
}

const EMPTY_INSTANCE: Instance = {
  id: "",
  name: "",
  group: "",
  color: PALETTE[0],
  note: "",
  args: [],
  autoRestart: false,
  volume: 100,
  muted: false,
};

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void | Promise<void>;
}

export default function InstancesPage({
  config,
  onConfig,
  notify,
  snapshot,
  refresh,
  launching,
  onLaunchAll,
  onStopAll,
  onTile,
  onBatchCreate,
  createSignal,
}: Props) {
  const [editing, setEditing] = useState<Instance | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupDialog, setGroupDialog] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState("");
  const [volumeDialog, setVolumeDialog] = useState(false);
  const [batchVolume, setBatchVolume] = useState(100);
  const [batchMuted, setBatchMuted] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; instance: Instance } | null>(null);
  const lastSignal = useRef(createSignal);

  useEffect(() => {
    if (createSignal !== lastSignal.current) {
      lastSignal.current = createSignal;
      openNew();
    }
  }, [createSignal]);

  const runtimeOf = (id: string) => snapshot?.instances.find((item) => item.id === id);
  const runningCount = snapshot?.instances.filter((item) => item.running).length ?? 0;
  const totalMemory = snapshot?.instances.reduce((sum, item) => sum + item.memoryMb, 0) ?? 0;
  const allMuted =
    config.instances.length > 0 && config.instances.every((item) => item.muted);

  const validSelected = useMemo(
    () => new Set([...selected].filter((id) => config.instances.some((item) => item.id === id))),
    [config.instances, selected],
  );

  const tags = useMemo(
    () =>
      Array.from(
        new Set(config.instances.map((item) => item.group.trim()).filter(Boolean)),
      ),
    [config.instances],
  );

  const tagCountFor = (tag: string) =>
    tag === ""
      ? config.instances.length
      : config.instances.filter((item) => item.group.trim() === tag).length;

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return config.instances.filter((instance) => {
      if (activeTag && instance.group !== activeTag) return false;
      if (!keyword) return true;
      const pid = runtimeOf(instance.id)?.pid;
      return (
        instance.name.toLowerCase().includes(keyword) ||
        instance.note.toLowerCase().includes(keyword) ||
        instance.group.toLowerCase().includes(keyword) ||
        (pid ? String(pid).includes(keyword) : false)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.instances, search, activeTag, snapshot]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((item) => item.id)));
  }

  async function copyName(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      notify("已复制名称");
    } catch {
      notify("复制失败");
    }
  }

  function menuItems(instance: Instance): MenuAction[] {
    const running = runtimeOf(instance.id)?.running;
    return [
      running
        ? { label: "关闭", onSelect: () => void stop(instance.id) }
        : { label: "启动", onSelect: () => void launch(instance.id) },
      {
        label: "聚焦窗口",
        disabled: !running,
        onSelect: () => void api.focus(instance.id),
      },
      { label: "编辑", onSelect: () => openEdit(instance) },
      {
        label: instance.autoRestart ? "自动重启：开" : "自动重启：关",
        onSelect: () => void toggleAutoRestart(instance),
      },
      { label: "复制名称", onSelect: () => void copyName(instance.name) },
      { label: "", separator: true, onSelect: () => undefined },
      { label: "移除", danger: true, onSelect: () => remove(instance) },
    ];
  }

  async function launch(id: string) {
    try {
      await api.launch(id);
      notify("已启动");
      await refresh();
    } catch (error) {
      notify(String(error));
    }
  }

  async function toggleAutoRestart(instance: Instance) {
    const next = !instance.autoRestart;
    await onConfig({
      ...config,
      instances: config.instances.map((item) =>
        item.id === instance.id ? { ...item, autoRestart: next } : item,
      ),
    });
    notify(
      next
        ? `「${instance.name}」已开启自动重启：意外退出后会按 5 秒 / 15 秒 / 1 分钟递增重试`
        : `「${instance.name}」已关闭自动重启`,
    );
  }

  async function adopt() {
    try {
      const count = await api.adopt();
      notify(count > 0 ? `已接管 ${count} 个游戏进程` : "没有找到可接管的进程");
      await refresh();
    } catch (error) {
      notify(String(error));
    }
  }

  async function stop(id: string) {
    await api.stop(id);
    notify("已关闭");
    await refresh();
  }

  async function commitVolume(instance: Instance, volume: number, muted: boolean) {
    await onConfig({
      ...config,
      instances: config.instances.map((item) =>
        item.id === instance.id ? { ...item, volume, muted } : item,
      ),
    });
    try {
      await api.applyAudio([instance.id]);
    } catch (error) {
      notify(String(error));
    }
  }

  function previewVolume(instance: Instance, volume: number, muted: boolean) {
    if (!runtimeOf(instance.id)?.running) return;
    void api.previewAudio(instance.id, volume, muted).catch(() => undefined);
  }

  async function toggleMuteAll() {
    const nextMuted = !allMuted;
    await onConfig({
      ...config,
      instances: config.instances.map((item) => ({ ...item, muted: nextMuted })),
    });
    try {
      const changed = await api.applyAudio(config.instances.map((item) => item.id));
      notify(
        nextMuted
          ? `已静音全部实例${changed > 0 ? `（${changed} 个音频会话）` : ""}`
          : "已恢复全部实例声音",
      );
    } catch (error) {
      notify(String(error));
    }
  }

  async function applyBatchVolume() {
    const ids = [...validSelected];
    await onConfig({
      ...config,
      instances: config.instances.map((item) =>
        validSelected.has(item.id)
          ? { ...item, volume: batchVolume, muted: batchMuted }
          : item,
      ),
    });
    try {
      await api.applyAudio(ids);
    } catch (error) {
      notify(String(error));
    }
    setVolumeDialog(false);
    notify(`已设置 ${ids.length} 个实例的音量`);
  }

  async function startTag(tag: string) {
    const targets = config.instances.filter(
      (item) => item.group.trim() === tag && !runtimeOf(item.id)?.running,
    );
    if (targets.length === 0) {
      notify(`「${tag}」下没有待启动的实例`);
      return;
    }
    for (const item of targets) {
      try {
        await api.launch(item.id);
      } catch (error) {
        notify(`${item.name}：${error}`);
      }
      await sleep(config.launchIntervalMs);
    }
    await refresh();
    notify(`已启动「${tag}」的 ${targets.length} 个实例`);
  }

  async function stopTag(tag: string) {
    const running = config.instances.filter(
      (item) => item.group.trim() === tag && runtimeOf(item.id)?.running,
    );
    if (running.length === 0) {
      notify(`「${tag}」下没有运行中的实例`);
      return;
    }
    await api.stopMany(running.map((item) => item.id));
    await refresh();
    notify(`已关闭「${tag}」的 ${running.length} 个实例`);
  }

  async function startSelected() {
    const ids = [...validSelected];
    for (const id of ids) {
      if (runtimeOf(id)?.running) continue;
      try {
        await api.launch(id);
      } catch (error) {
        notify(String(error));
      }
      await sleep(config.launchIntervalMs);
    }
    await refresh();
    notify(`已启动 ${ids.length} 个实例`);
  }

  async function stopSelected() {
    await api.stopMany([...validSelected]);
    await refresh();
    notify("已关闭选中实例");
  }

  function deleteSelected() {
    const ids = [...validSelected];
    setConfirmState({
      title: "删除实例",
      message: `将删除选中的 ${ids.length} 个实例，运行中的会先被关闭。`,
      confirmLabel: "删除",
      action: async () => {
        const runningIds = ids.filter((id) => runtimeOf(id)?.running);
        if (runningIds.length > 0) await api.stopMany(runningIds);
        await onConfig({
          ...config,
          instances: config.instances.filter((item) => !validSelected.has(item.id)),
        });
        setSelected(new Set());
        await refresh();
        notify("已删除");
      },
    });
  }

  function remove(instance: Instance) {
    if (runtimeOf(instance.id)?.running) {
      notify("请先关闭该实例");
      return;
    }
    setConfirmState({
      title: "删除实例",
      message: `删除实例「${instance.name}」？该操作不可撤销。`,
      confirmLabel: "删除",
      action: async () => {
        await onConfig({
          ...config,
          instances: config.instances.filter((item) => item.id !== instance.id),
        });
        notify("已删除");
      },
    });
  }

  async function applyGroup(group: string) {
    await onConfig({
      ...config,
      instances: config.instances.map((item) =>
        validSelected.has(item.id) ? { ...item, group } : item,
      ),
    });
    setGroupDialog(false);
    notify("标签已更新");
  }

  function openNew() {
    setEditing({ ...EMPTY_INSTANCE, color: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
    setIsNew(true);
  }

  function openEdit(instance: Instance) {
    setEditing({ ...instance, args: [...instance.args] });
    setIsNew(false);
  }

  async function saveInstance(draft: Instance) {
    const name = draft.name.trim();
    if (!name) {
      notify("请填写实例名称");
      return;
    }
    if (config.instances.some((item) => item.id !== draft.id && item.name.trim() === name)) {
      notify(`已经有同名实例「${name}」，换一个名字便于区分`);
      return;
    }
    const instances = isNew
      ? [...config.instances, { ...draft, name, id: crypto.randomUUID() }]
      : config.instances.map((item) => (item.id === draft.id ? { ...draft, name } : item));
    await onConfig({ ...config, instances });
    setEditing(null);
    notify(isNew ? "实例已添加" : "实例已保存");
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <h1>实例名册</h1>
          <p className="subtitle">
            运行中 {runningCount} / 共 {config.instances.length} · 内存合计{" "}
            {totalMemory.toFixed(0)} MB
            {snapshot && snapshot.unmanaged > 0 && (
              <span className="warn-text">
                {" "}· {snapshot.unmanaged} 个外部启动的游戏进程
              </span>
            )}

          </p>
        </div>
        <div className="toolbar">
          <div className="search-wrap">
            <IconSearch size={14} />
            <input
              className="search"
              value={search}
              placeholder="搜索名称 / 备注 / PID"
              aria-label="搜索实例"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className="btn ghost" onClick={onBatchCreate}>
            <IconPlus size={14} />
            批量创建
          </button>
          <button
            className="btn ghost"
            onClick={() => void onTile()}
            disabled={runningCount === 0}
          >
            <IconGrid size={14} />
            整理窗口
          </button>
          <button
            className="btn ghost"
            onClick={() => void onStopAll()}
            disabled={runningCount === 0}
          >
            <IconStop size={14} />
            全部关闭
          </button>
          <button
            className="btn ghost"
            onClick={() => void toggleMuteAll()}
            disabled={config.instances.length === 0}
            title="Ctrl+Shift+M"
          >
            <IconVolumeOff size={14} />
            {allMuted ? "恢复声音" : "静音全部"}
          </button>
          <button
            className="btn primary"
            onClick={() => void onLaunchAll()}
            disabled={launching || config.instances.length === 0}
          >
            <IconPlay size={14} />
            {launching ? "启动中…" : "启动全部"}
          </button>
          <button className="btn outline" onClick={openNew}>
            <IconPlus size={14} />
            新建实例
          </button>
        </div>
      </header>
      <div className="rule-double" />

      {snapshot && !snapshot.clientFound && (
        <div className="banner error">未找到游戏主程序，请到「设置」里检查客户端目录。</div>
      )}

      {snapshot && snapshot.unmanaged > 0 && (
        <div className="banner notice">
          <span>
            有 {snapshot.unmanaged} 个游戏进程不是百鬼帐启动的，可以接管到空闲实例上。
          </span>
          <button className="btn small outline" onClick={() => void adopt()}>
            接管
          </button>
        </div>
      )}

      {tags.length > 0 && (
        <div className="chips tag-filter" role="group" aria-label="按标签筛选">
          <button
            className={`chip ${activeTag === "" ? "active" : ""}`}
            onClick={() => setActiveTag("")}
          >
            全部
            <span className="chip-count">{tagCountFor("")}</span>
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              className={`chip ${activeTag === tag ? "active" : ""}`}
              onClick={() => setActiveTag(activeTag === tag ? "" : tag)}
            >
              {tag}
              <span className="chip-count">{tagCountFor(tag)}</span>
            </button>
          ))}
          {activeTag && (
            <div className="tag-actions">
              <button className="btn small ghost" onClick={() => void startTag(activeTag)}>
                <IconPlay size={12} />
                启动此标签
              </button>
              <button className="btn small ghost" onClick={() => void stopTag(activeTag)}>
                <IconStop size={12} />
                关闭此标签
              </button>
            </div>
          )}
        </div>
      )}

      {validSelected.size > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="批量操作">
          <span className="selection-count">已选 {validSelected.size} 条</span>
          <button className="btn small" onClick={() => void startSelected()}>
            <IconPlay size={13} />
            启动选中
          </button>
          <button className="btn small" onClick={() => void stopSelected()}>
            <IconStop size={13} />
            关闭选中
          </button>
          <button className="btn small" onClick={() => setGroupDialog(true)}>
            设置标签
          </button>
          <button
            className="btn small"
            onClick={() => {
              setBatchVolume(100);
              setBatchMuted(false);
              setVolumeDialog(true);
            }}
          >
            <IconVolumeOff size={13} />
            音量
          </button>
          <button className="btn small danger" onClick={deleteSelected}>
            <IconTrash size={13} />
            删除选中
          </button>
          <button className="btn small ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </button>
          <button className="btn small ghost" onClick={selectAll}>
            全选
          </button>
        </div>
      )}

      {config.instances.length === 0 ? (
        <div className="empty">
          <div className="empty-seal" aria-hidden="true">
            空
          </div>
          <h3>名册还是空的</h3>
          <p>先立一个号，之后可以一键启动、查看状态、整理窗口；也可以一次批量建好几个。</p>
          <div className="empty-actions">
            <button className="btn primary" onClick={openNew}>
              新建实例
            </button>
            <button className="btn outline" onClick={onBatchCreate}>
              批量创建
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-seal" aria-hidden="true">
            寻
          </div>
          <h3>没有匹配的实例</h3>
          <p>换个关键词或标签试试。</p>
          <button
            className="btn outline"
            onClick={() => {
              setSearch("");
              setActiveTag("");
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
        <div className="roster">
          <div className="roster-head" aria-hidden="true">
            <span className="col-index">号</span>
            <span className="col-name">名册</span>
            <span className="col-group">标签</span>
            <span className="col-status">状态</span>
            <span className="col-mem">内存</span>
            <span className="col-actions head-actions">操作</span>
          </div>

          {filtered.map((instance, index) => {
            const runtime = runtimeOf(instance.id);
            const checked = validSelected.has(instance.id);
            const state = !runtime?.running
              ? "idle"
              : runtime.responding
                ? "run"
                : "hung";
            const stateText =
              state === "run" ? "运行中" : state === "hung" ? "无响应" : "未启动";
            const sealChar = state === "run" ? "运" : state === "hung" ? "滞" : "止";
            const meta = [
              runtime?.running ? `PID ${runtime.pid}` : "",
              instance.note.trim(),
              instance.autoRestart && !runtime?.running ? "自动重启" : "",
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div
                key={instance.id}
                className={`roster-row ${checked ? "selected" : ""}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY, instance });
                }}
              >
                <label className="col-index index-seal" title={`选择 ${instance.name}`}>
                  <input
                    type="checkbox"
                    className="visually-hidden"
                    checked={checked}
                    onChange={() => toggle(instance.id)}
                    aria-label={`选择 ${instance.name}`}
                  />
                  <span className="index-box">{cnNumber(index + 1)}</span>
                </label>

                <div className="col-name">
                  <span
                    className={`name-mark ${runtime?.running ? "active" : ""}`}
                    style={{ background: instance.color }}
                    aria-hidden="true"
                  />
                  <div className="name-text">
                    <strong>
                      <Truncate text={instance.name} />
                    </strong>
                    {meta && (
                      <small>
                        <Truncate text={meta} />
                      </small>
                    )}
                  </div>
                </div>

                <Truncate
                  className="col-group"
                  text={instance.group ? `「${instance.group}」` : "—"}
                />

                <span className="col-status">
                  <span className={`status-seal ${state}`} aria-hidden="true">
                    {sealChar}
                  </span>
                  <span className="status-text">{stateText}</span>
                </span>

                <span className="col-mem">
                  {runtime?.running ? `${runtime.memoryMb.toFixed(0)} MB` : "—"}
                </span>

                <div className="col-actions">
                  <VolumeControl
                    instance={instance}
                    running={Boolean(runtime?.running)}
                    onPreview={(volume, muted) => previewVolume(instance, volume, muted)}
                    onCommit={(volume, muted) => void commitVolume(instance, volume, muted)}
                  />
                  {runtime?.running ? (
                    <button className="row-action" onClick={() => void stop(instance.id)}>
                      关闭
                    </button>
                  ) : (
                    <button
                      className="row-action primary-text"
                      onClick={() => void launch(instance.id)}
                    >
                      启动
                    </button>
                  )}
                  <button
                    className="row-action"
                    disabled={!runtime?.running}
                    onClick={() => void api.focus(instance.id)}
                  >
                    聚焦
                  </button>
                  <button className="row-action" onClick={() => openEdit(instance)}>
                    编辑
                  </button>
                  <button className="row-action danger" onClick={() => remove(instance)}>
                    移除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <InstanceForm
          value={editing}
          isNew={isNew}
          onCancel={() => setEditing(null)}
          onSubmit={saveInstance}
        />
      )}

      {groupDialog && (
        <GroupDialog
          count={validSelected.size}
          onCancel={() => setGroupDialog(false)}
          onSubmit={applyGroup}
        />
      )}

      {volumeDialog && (
        <Modal
          title={`设置音量（${validSelected.size} 个实例）`}
          onClose={() => setVolumeDialog(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setVolumeDialog(false)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void applyBatchVolume()}>
                应用
              </button>
            </>
          }
        >
          <label className="field">
            <span>音量 {batchMuted ? "（静音）" : `${batchVolume}%`}</span>
            <input
              className="volume-range"
              type="range"
              min={0}
              max={100}
              step={1}
              value={batchVolume}
              disabled={batchMuted}
              onChange={(event) => setBatchVolume(Number(event.target.value))}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={batchMuted}
              onChange={(event) => setBatchMuted(event.target.checked)}
            />
            <span>
              静音
              <small>只改变静音开关，保留每个实例已有的音量数值。</small>
            </span>
          </label>
        </Modal>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.instance)}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          danger
          onCancel={() => setConfirmState(null)}
          onConfirm={() => {
            const action = confirmState.action;
            setConfirmState(null);
            void action();
          }}
        />
      )}
    </div>
  );
}

function InstanceForm({
  value,
  isNew,
  onCancel,
  onSubmit,
}: {
  value: Instance;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (draft: Instance) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [argsText, setArgsText] = useState(value.args.join(" "));
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof Instance>(key: K, next: Instance[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function submit() {
    if (!draft.name.trim()) {
      setError("请填写实例名称");
      return;
    }
    setError(null);
    onSubmit({ ...draft, args: argsText.split(/\s+/).filter(Boolean) });
  }

  return (
    <Modal
      title={isNew ? "添加实例" : "编辑实例"}
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" onClick={submit}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>实例名称 *</span>
        <input
          value={draft.name}
          placeholder="例如：大号 / 小号 1"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "instance-name-error" : undefined}
          onChange={(event) => {
            update("name", event.target.value);
            if (error) setError(null);
          }}
        />
      </label>
      {error && (
        <p className="field-error" id="instance-name-error" role="alert">
          {error}
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span>标签</span>
          <input
            value={draft.group}
            placeholder="日常 / 挂机"
            onChange={(event) => update("group", event.target.value)}
          />
        </label>
        <div className="field">
          <span>颜色</span>
          <div className="swatches">
            {PALETTE.map((color) => (
              <button
                key={color}
                className={`swatch ${draft.color === color ? "active" : ""}`}
                style={{ background: color }}
                onClick={() => update("color", color)}
                aria-label={`颜色 ${color}`}
              />
            ))}
          </div>
        </div>
      </div>
      <label className="field">
        <span>账号备注</span>
        <input
          value={draft.note}
          placeholder="区服、账号末尾几位等"
          onChange={(event) => update("note", event.target.value)}
        />
      </label>
      <label className="field">
        <span>启动参数（可选，空格分隔）</span>
        <input
          value={argsText}
          placeholder="留空即可"
          onChange={(event) => setArgsText(event.target.value)}
        />
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={draft.autoRestart}
          onChange={(event) => update("autoRestart", event.target.checked)}
        />
        <span>
          崩溃后自动重启
          <small>意外退出时按 5 秒 / 15 秒 / 1 分钟递增重试；手动关闭不会触发。</small>
        </span>
      </label>
    </Modal>
  );
}

function GroupDialog({
  count,
  onCancel,
  onSubmit,
}: {
  count: number;
  onCancel: () => void;
  onSubmit: (group: string) => void;
}) {
  const [group, setGroup] = useState("");
  return (
    <Modal
      title={`设置标签（${count} 个实例）`}
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" onClick={() => onSubmit(group.trim())}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>标签名称</span>
        <input
          value={group}
          placeholder="留空表示清除标签"
          onChange={(event) => setGroup(event.target.value)}
          autoFocus
        />
      </label>
    </Modal>
  );
}
