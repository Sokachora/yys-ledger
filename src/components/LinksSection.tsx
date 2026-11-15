import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";
import Truncate from "./Truncate";
import { cnNumber } from "../lib/format";
import type { LinkItem } from "../types";

interface Props {
  links: LinkItem[];
  query: string;
  addSignal: number;
  onChange: (links: LinkItem[]) => Promise<void>;
  notify: (text: string) => void;
}

const EMPTY_LINK: LinkItem = {
  id: "",
  name: "",
  url: "",
  description: "",
  category: "辅助",
};

export default function LinksSection({
  links,
  query,
  addSignal,
  onChange,
  notify,
}: Props) {
  const [category, setCategory] = useState("全部");
  const [editing, setEditing] = useState<LinkItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const lastSignal = useRef(addSignal);

  useEffect(() => {
    if (addSignal !== lastSignal.current) {
      lastSignal.current = addSignal;
      setEditing({ ...EMPTY_LINK });
      setIsNew(true);
    }
  }, [addSignal]);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    action: () => void | Promise<void>;
  } | null>(null);

  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(links.map((item) => item.category || "其他")))],
    [links],
  );

  const countFor = (categoryName: string) =>
    categoryName === "全部"
      ? links.length
      : links.filter((item) => (item.category || "其他") === categoryName).length;

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return links.filter((item) => {
      if (category !== "全部" && (item.category || "其他") !== category) return false;
      if (!keyword) return true;
      return (
        item.name.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword) ||
        item.url.toLowerCase().includes(keyword)
      );
    });
  }, [links, category, query]);

  async function save(draft: LinkItem) {
    const name = draft.name.trim();
    const url = draft.url.trim();
    if (!name || !url) {
      notify("名称和地址不能为空");
      return;
    }
    const next = isNew
      ? [...links, { ...draft, name, url, id: crypto.randomUUID() }]
      : links.map((item) => (item.id === draft.id ? { ...draft, name, url } : item));
    await onChange(next);
    setEditing(null);
    notify(isNew ? "链接已添加" : "链接已保存");
  }

  function remove(item: LinkItem) {
    setConfirmState({
      title: "删除链接",
      message: `删除「${item.name}」？`,
      action: async () => {
        await onChange(links.filter((entry) => entry.id !== item.id));
        notify("已删除");
      },
    });
  }

  return (
    <section aria-label="常用链接">
      {categories.length > 1 && (
        <div className="chips">
          {categories.map((item) => (
            <button
              key={item}
              className={`chip ${category === item ? "active" : ""}`}
              onClick={() => setCategory(item)}
            >
              {item}
              <span className="chip-count">{countFor(item)}</span>
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="subsection-empty">
          {links.length === 0 ? "还没有链接，点右上角添加。" : "没有匹配的链接。"}
        </p>
      ) : (
        <div className="roster links-roster">
          <div className="roster-head" aria-hidden="true">
            <span className="col-index">序</span>
            <span className="col-name">名称</span>
            <span className="col-group">分类</span>
            <span className="col-actions head-actions">操作</span>
          </div>

          {visible.map((item, index) => (
            <div key={item.id} className="roster-row">
              <span className="col-index">
                <span className="index-box static">{cnNumber(index + 1)}</span>
              </span>

              <div className="col-name">
                <span
                  className="name-mark active"
                  style={{ background: colorFor(item.name) }}
                  aria-hidden="true"
                />
                <div className="name-text">
                  <strong>
                    <Truncate text={item.name} />
                  </strong>
                  {item.description && (
                    <small>
                      <Truncate text={item.description} />
                    </small>
                  )}
                </div>
              </div>

              <Truncate className="col-group" text={item.category || "—"} />

              <div className="col-actions">
                <button
                  className="row-action primary-text"
                  onClick={() => void openUrl(item.url).catch((error) => notify(String(error)))}
                >
                  打开
                </button>
                <button
                  className="row-action"
                  onClick={() => {
                    setEditing({ ...item });
                    setIsNew(false);
                  }}
                >
                  编辑
                </button>
                <button className="row-action danger" onClick={() => remove(item)}>
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <LinkForm
          value={editing}
          isNew={isNew}
          onCancel={() => setEditing(null)}
          onSubmit={save}
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
    </section>
  );
}

function LinkForm({
  value,
  isNew,
  onCancel,
  onSubmit,
}: {
  value: LinkItem;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (draft: LinkItem) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof LinkItem>(key: K, next: LinkItem[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function submit() {
    if (!draft.name.trim()) {
      setError("请填写名称");
      return;
    }
    if (!draft.url.trim()) {
      setError("请填写地址");
      return;
    }
    setError(null);
    onSubmit(draft);
  }

  return (
    <Modal
      title={isNew ? "添加链接" : "编辑链接"}
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
          placeholder="例如：NGA 阴阳师版"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "link-error" : undefined}
          onChange={(event) => {
            update("name", event.target.value);
            if (error) setError(null);
          }}
        />
      </label>
      <label className="field">
        <span>地址 *</span>
        <input
          value={draft.url}
          placeholder="https://"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "link-error" : undefined}
          onChange={(event) => {
            update("url", event.target.value);
            if (error) setError(null);
          }}
        />
      </label>
      {error && (
        <p className="field-error" id="link-error" role="alert">
          {error}
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span>分类</span>
          <input
            value={draft.category}
            placeholder="辅助 / 社区 / 资料"
            onChange={(event) => update("category", event.target.value)}
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
      </div>
    </Modal>
  );
}

function colorFor(name: string) {
  const palette = ["#c0453a", "#6c8aa6", "#6e9a7e", "#c08a52", "#8a9aa8", "#a07a9e", "#c2a060"];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return palette[hash % palette.length];
}
