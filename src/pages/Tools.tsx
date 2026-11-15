import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type MenuAction } from "../components/ContextMenu";
import LinksSection from "../components/LinksSection";
import Modal from "../components/Modal";
import Truncate from "../components/Truncate";
import { IconPlus, IconRefresh, IconSearch } from "../components/icons";
import { api } from "../lib/api";
import { cnNumber } from "../lib/format";
import type { AppConfig, ToolDef, ToolProgress, ToolStatus, ToolUpdate } from "../types";

interface Props {
  config: AppConfig;
  onConfig: (next: AppConfig) => Promise<void>;
  notify: (text: string) => void;
}

type Tab = "resources" | "downloaded" | "links";
type SortKey = "recent" | "name" | "size";

const EMPTY_TOOL: ToolDef = {
  id: "",
  name: "",
  description: "",
  category: "辅助",
  url: "",
  exe: "",
  version: "",
};

export default function ToolsPage({ config, onConfig, notify }: Props) {
  const [tab, setTab] = useState<Tab>("resources");
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [toolsDir, setToolsDir] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [updates, setUpdates] = useState<Record<string, ToolUpdate>>({});
  const [checking, setChecking] = useState(false);
  const [linkSignal, setLinkSignal] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ToolProgress>>({});
  const [editingTool, setEditingTool] = useState<ToolDef | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; tool: ToolStatus } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    action: () => void | Promise<void>;
  } | null>(null);

  const loadTools = useCallback(async () => {
    try {
      const snapshot = await api.listTools();
      setTools(snapshot.tools);
      setToolsDir(snapshot.toolsDir);
    } catch (error) {
      notify(String(error));
    }
  }, [notify]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  useEffect(() => {
    const unlisten = listen<ToolProgress>("tool-progress", (event) => {
      setProgress((current) => ({ ...current, [event.payload.id]: event.payload }));
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const matchesQuery = (tool: ToolStatus, keyword: string) =>
    !keyword ||
    tool.name.toLowerCase().includes(keyword) ||
    tool.description.toLowerCase().includes(keyword) ||
    (tool.category || "").toLowerCase().includes(keyword);

  const resourceTools = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tools.filter((tool) => matchesQuery(tool, keyword));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, query]);

  const downloadedTools = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = tools.filter((tool) => tool.installed && matchesQuery(tool, keyword));
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    else if (sort === "size") sorted.sort((a, b) => b.sizeMb - a.sizeMb);
    else sorted.sort((a, b) => (b.installedAt ?? 0) - (a.installedAt ?? 0));
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, query, sort]);

  async function install(tool: ToolStatus) {
    if (!tool.url.trim()) {
      notify("先编辑该工具填入下载地址，或使用「本地 zip」安装");
      return;
    }
    setInstalling(tool.id);
    setProgress((current) => ({
      ...current,
      [tool.id]: { id: tool.id, downloaded: 0, total: 0 },
    }));
    try {
      await api.installTool(tool.id);
      notify(`${tool.name} 安装完成`);
    } catch (error) {
      notify(String(error));
    } finally {
      setInstalling(null);
      await loadTools();
    }
  }

  async function cancelInstall(tool: ToolStatus) {
    try {
      await api.cancelInstall(tool.id);
      notify("正在取消，稍等片刻");
    } catch (error) {
      notify(String(error));
    }
  }

  async function checkUpdates() {
    setChecking(true);
    try {
      const result = await api.checkToolUpdates();
      const map: Record<string, ToolUpdate> = {};
      let pending = 0;
      let failed = 0;
      for (const item of result) {
        map[item.id] = item;
        if (item.hasUpdate) pending += 1;
        if (item.error) failed += 1;
      }
      setUpdates(map);
      if (pending > 0) notify(`有 ${pending} 个工具有新版本`);
      else if (failed > 0) notify("部分工具无法检查更新，请检查网络或代理设置");
      else notify("已是最新版本");
    } catch (error) {
      notify(String(error));
    } finally {
      setChecking(false);
    }
  }

  async function installZip(tool: ToolStatus) {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Zip 压缩包", extensions: ["zip"] }],
    });
    if (typeof picked !== "string") return;
    setInstalling(tool.id);
    try {
      await api.installToolZip(tool.id, picked);
      notify(`${tool.name} 安装完成`);
    } catch (error) {
      notify(String(error));
    } finally {
      setInstalling(null);
      setUpdates((current) => {
        const next = { ...current };
        delete next[tool.id];
        return next;
      });
      await loadTools();
    }
  }

  async function openTool(tool: ToolStatus) {
    try {
      await api.openTool(tool.id);
    } catch (error) {
      notify(String(error));
    }
  }

  function removeTool(tool: ToolStatus) {
    setConfirmState({
      title: "移除本地工具",
      message: `删除「${tool.name}」在本机安装的文件？定义仍保留在常用工具里。`,
      action: async () => {
        try {
          await api.removeTool(tool.id);
          await loadTools();
          notify("已移除");
        } catch (error) {
          notify(String(error));
        }
      },
    });
  }

  async function saveTool(def: ToolDef) {
    const nextTools = config.tools.some((item) => item.id === def.id)
      ? config.tools.map((item) => (item.id === def.id ? def : item))
      : [...config.tools, def];
    await onConfig({ ...config, tools: nextTools });
    setEditingTool(null);
    await loadTools();
    notify("工具已保存");
  }

  function menuItems(tool: ToolStatus): MenuAction[] {
    const running = installing === tool.id;
    const items: MenuAction[] = [];

    if (tab === "resources") {
      if (tool.installed) {
        items.push({
          label: "打开",
          disabled: !tool.exePath,
          onSelect: () => void openTool(tool),
        });
      } else {
        items.push({
          label: running ? "安装中…" : "下载安装",
          disabled: running,
          onSelect: () => void install(tool),
        });
        items.push({
          label: "本地 zip 安装",
          disabled: running,
          onSelect: () => void installZip(tool),
        });
      }
      items.push({ label: "打开目录", onSelect: () => void api.openToolDir(tool.id) });
      items.push({ label: "编辑定义", onSelect: () => setEditingTool({ ...tool }) });
      if (tool.installed) {
        items.push(
          { label: "", separator: true, onSelect: () => undefined },
          { label: "移除本地文件", danger: true, onSelect: () => removeTool(tool) },
        );
      }
      return items;
    }

    items.push({
      label: "打开",
      disabled: !tool.exePath,
      onSelect: () => void openTool(tool),
    });
    items.push({ label: "打开目录", onSelect: () => void api.openToolDir(tool.id) });
    items.push(
      { label: "", separator: true, onSelect: () => undefined },
      { label: "移除本地文件", danger: true, onSelect: () => removeTool(tool) },
    );
    return items;
  }

  function renderToolRoster(list: ToolStatus[], mode: Tab) {
    return (
      <div className="roster tools-roster">
        <div className="roster-head" aria-hidden="true">
          <span className="col-index">序</span>
          <span className="col-name">工具</span>
          <span className="col-group">分类</span>
          <span className="col-status">状态</span>
          <span className="col-mem">占用</span>
          <span className="col-actions head-actions">操作</span>
        </div>

        {list.map((tool, index) => {
          const running = installing === tool.id;
          const current = progress[tool.id];
          const percent =
            current && current.total > 0
              ? Math.min(100, Math.round((current.downloaded / current.total) * 100))
              : null;

          return (
            <div
              key={tool.id}
              className="roster-row"
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, tool });
              }}
            >
              <span className="col-index">
                <span className="index-box static">{cnNumber(index + 1)}</span>
              </span>

              <div className="col-name">
                <span
                  className={`name-mark ${tool.installed ? "active" : ""}`}
                  style={{ background: colorFor(tool.name) }}
                  aria-hidden="true"
                />
                <div className="name-text">
                  <strong>
                    <Truncate text={tool.name} />
                  </strong>
                  {tool.description && (
                    <small>
                      <Truncate text={tool.description} />
                    </small>
                  )}
                  {updates[tool.id]?.hasUpdate && (
                    <small className="update-note">
                      可更新至 {updates[tool.id].latest ?? "新版本"}
                    </small>
                  )}
                  {running && (
                    <div
                      className="progress"
                      role="progressbar"
                      aria-label={`${tool.name} 下载进度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent ?? undefined}
                    >
                      <div
                        className="progress-bar"
                        style={{ width: percent !== null ? `${percent}%` : "35%" }}
                      />
                      <span className="progress-text">
                        {percent !== null
                          ? `${percent}%`
                          : current
                            ? `${(current.downloaded / 1024 / 1024).toFixed(1)} MB`
                            : "准备中…"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <Truncate className="col-group" text={tool.category || "—"} />

              <span className="col-status">
                <span
                  className={`status-seal ${running ? "hung" : tool.installed ? "run" : "idle"}`}
                  aria-hidden="true"
                >
                  {running ? "装" : tool.installed ? "备" : "未"}
                </span>
                <span className="status-text">
                  {running
                    ? percent !== null
                      ? `安装中 ${percent}%`
                      : "安装中"
                    : tool.installed
                      ? tool.installedVersion
                        ? `已安装 ${tool.installedVersion}`
                        : "已安装"
                      : "未安装"}
                </span>
              </span>

              <span className="col-mem">
                {tool.installed ? `${tool.sizeMb.toFixed(1)} MB` : "—"}
              </span>

              <div className="col-actions">
                {mode === "resources" ? (
                  <>
                    {tool.installed ? (
                      <>
                        {updates[tool.id]?.hasUpdate && (
                          <button
                            className="row-action primary-text"
                            disabled={running}
                            onClick={() => void install(tool)}
                          >
                            更新
                          </button>
                        )}
                        <button
                          className="row-action primary-text"
                          disabled={!tool.exePath}
                          title={tool.exePath ? tool.exePath : "已安装，但目录里没有可执行文件"}
                          onClick={() => void openTool(tool)}
                        >
                          打开
                        </button>
                      </>
                    ) : running ? (
                      <button className="row-action danger" onClick={() => void cancelInstall(tool)}>
                        取消
                      </button>
                    ) : (
                      <button
                        className="row-action primary-text"
                        onClick={() => void install(tool)}
                      >
                        安装
                      </button>
                    )}
                    {!tool.installed && !running && (
                      <button className="row-action" onClick={() => void installZip(tool)}>
                        本地 zip
                      </button>
                    )}
                    <button
                      className="row-action"
                      onClick={() => void api.openToolDir(tool.id)}
                    >
                      目录
                    </button>
                    <button
                      className="row-action"
                      onClick={() => setEditingTool({ ...tool })}
                    >
                      编辑
                    </button>
                    {tool.installed && (
                      <button className="row-action danger" onClick={() => removeTool(tool)}>
                        移除
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {updates[tool.id]?.hasUpdate && (
                      <button
                        className="row-action primary-text"
                        disabled={running}
                        onClick={() => void install(tool)}
                      >
                        更新
                      </button>
                    )}
                    <button
                      className="row-action primary-text"
                      disabled={!tool.exePath}
                      onClick={() => void openTool(tool)}
                    >
                      打开
                    </button>
                    <button
                      className="row-action"
                      onClick={() => void api.openToolDir(tool.id)}
                    >
                      目录
                    </button>
                    <button className="row-action danger" onClick={() => removeTool(tool)}>
                      移除
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <h1>工具匣</h1>
          <p className="subtitle" title={toolsDir || undefined}>
            资源、常用链接与已下载，各自成页
          </p>
        </div>
      </header>
      <div className="rule-double" />

      <div className="tabs" role="tablist" aria-label="工具匣分区">
        <button
          className={`tab ${tab === "resources" ? "active" : ""}`}
          role="tab"
          aria-selected={tab === "resources"}
          onClick={() => {
            setTab("resources");
            setQuery("");
          }}
        >
          资源
        </button>
        <button
          className={`tab ${tab === "links" ? "active" : ""}`}
          role="tab"
          aria-selected={tab === "links"}
          onClick={() => {
            setTab("links");
            setQuery("");
          }}
        >
          常用链接
        </button>
        <button
          className={`tab ${tab === "downloaded" ? "active" : ""}`}
          role="tab"
          aria-selected={tab === "downloaded"}
          onClick={() => {
            setTab("downloaded");
            setQuery("");
          }}
        >
          已下载
        </button>
      </div>

      <div className="subpage-toolbar">
        <div className="search-wrap">
          <IconSearch size={14} />
          <input
            className="search"
            value={query}
            placeholder={
              tab === "links"
                ? "搜索链接"
                : tab === "downloaded"
                  ? "搜索已下载工具"
                  : "搜索工具"
            }
            aria-label="搜索"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {tab === "resources" && (
          <button className="btn outline" onClick={() => setEditingTool({ ...EMPTY_TOOL })}>
            <IconPlus size={14} />
            添加工具
          </button>
        )}
        {tab === "links" && (
          <button
            className="btn outline"
            onClick={() => setLinkSignal((value) => value + 1)}
          >
            <IconPlus size={14} />
            添加链接
          </button>
        )}
        {tab === "downloaded" && (
          <div className="toolbar">
            <label className="sort-select">
              <span className="visually-hidden">排序方式</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                <option value="recent">按安装时间</option>
                <option value="name">按名称</option>
                <option value="size">按占用</option>
              </select>
            </label>
            <button className="btn ghost" disabled={checking} onClick={() => void checkUpdates()}>
              <IconRefresh size={14} />
              {checking ? "检查中…" : "检查更新"}
            </button>
          </div>
        )}
      </div>

      <div
        role="tabpanel"
        aria-label={
          tab === "resources" ? "资源" : tab === "downloaded" ? "已下载" : "常用链接"
        }
      >
        {tab === "resources" ? (
          resourceTools.length > 0 ? (
            renderToolRoster(resourceTools, "resources")
          ) : (
            <div className="empty">
              <div className="empty-seal" aria-hidden="true">
                器
              </div>
              {query.trim() ? (
                <>
                  <h3>没有匹配的工具</h3>
                  <p>换个关键词试试，或清空搜索。</p>
                  <button className="btn outline" onClick={() => setQuery("")}>
                    清空搜索
                  </button>
                </>
              ) : (
                <>
                  <h3>工具目录还是空的</h3>
                  <p>添加常用工具，或把便携版 zip 导入进来；装好后会出现在「已下载」。</p>
                  <div className="empty-actions">
                    <button
                      className="btn primary"
                      onClick={() => setEditingTool({ ...EMPTY_TOOL })}
                    >
                      添加工具
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        ) : tab === "downloaded" ? (
          downloadedTools.length > 0 ? (
            renderToolRoster(downloadedTools, "downloaded")
          ) : (
            <div className="empty">
              <div className="empty-seal" aria-hidden="true">
                器
              </div>
              {query.trim() ? (
                <>
                  <h3>没有匹配的工具</h3>
                  <p>换个关键词试试，或清空搜索。</p>
                  <button className="btn outline" onClick={() => setQuery("")}>
                    清空搜索
                  </button>
                </>
              ) : (
                <>
                  <h3>还没有已下载的工具</h3>
                  <p>到「资源」里下载或导入 zip，装好后就会出现在这里。</p>
                  <button className="btn primary" onClick={() => setTab("resources")}>
                    去资源
                  </button>
                </>
              )}
            </div>
          )
        ) : (
          <LinksSection
            links={config.links}
            query={query}
            addSignal={linkSignal}
            onChange={(links) => onConfig({ ...config, links })}
            notify={notify}
          />
        )}
      </div>
      {editingTool && (
        <ToolForm
          value={editingTool}
          isNew={!config.tools.some((item) => item.id === editingTool.id)}
          onCancel={() => setEditingTool(null)}
          onSubmit={saveTool}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.tool)}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel="删除"
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

function ToolForm({
  value,
  isNew,
  onCancel,
  onSubmit,
}: {
  value: ToolDef;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (draft: ToolDef) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof ToolDef>(key: K, next: ToolDef[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function submit() {
    const name = draft.name.trim();
    if (!name) {
      setError("请填写工具名称");
      return;
    }
    setError(null);
    const id =
      draft.id.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") ||
      `tool-${crypto.randomUUID().slice(0, 8)}`;
    onSubmit({ ...draft, name, id });
  }

  return (
    <Modal
      title={isNew ? "添加工具" : "编辑工具"}
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
        <span>名称 *</span>
        <input
          value={draft.name}
          placeholder="例如：OnmyojiDesktopAssistant"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "tool-name-error" : undefined}
          onChange={(event) => {
            update("name", event.target.value);
            if (error) setError(null);
          }}
        />
      </label>
      {error && (
        <p className="field-error" id="tool-name-error" role="alert">
          {error}
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span>分类</span>
          <input
            value={draft.category}
            placeholder="辅助 / 资料 / 系统"
            onChange={(event) => update("category", event.target.value)}
          />
        </label>
        <label className="field">
          <span>可执行文件（相对路径，可留空）</span>
          <input
            value={draft.exe}
            placeholder="App.exe"
            onChange={(event) => update("exe", event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>下载地址（zip 直链或 GitHub releases 页面）</span>
        <input
          value={draft.url}
          placeholder="https://github.com/owner/repo/releases"
          onChange={(event) => update("url", event.target.value)}
        />
      </label>
      <label className="field">
        <span>说明</span>
        <input
          value={draft.description}
          placeholder="一句话描述"
          onChange={(event) => update("description", event.target.value)}
        />
      </label>
    </Modal>
  );
}

function colorFor(name: string) {
  const palette = ["#c0453a", "#6c8aa6", "#6e9a7e", "#c08a52", "#8a9aa8", "#a07a9e", "#c2a060"];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return palette[hash % palette.length];
}
