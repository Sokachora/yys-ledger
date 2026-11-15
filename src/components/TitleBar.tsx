import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../lib/api";
import { IconMoon, IconSun } from "./icons";
import type { Page } from "../types";

interface Props {
  page: Page;
  runningCount: number;
  isDark: boolean;
  onToggleTheme: () => void;
  onNavigate: (page: Page) => void;
  onNewInstance: () => void;
  onBatchCreate: () => void;
  onLaunchAll: () => void;
  onStopAll: () => void;
  onTile: () => void;
  onRefresh: () => void;
  onAbout: () => void;
  onOnboarding: () => void;
}

interface MenuItemDef {
  label: string;
  action?: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
}

const MENUS: { label: string; items: MenuItemDef[] }[] = [
  {
    label: "文件",
    items: [
      { label: "新建实例", action: "new", shortcut: "Ctrl+N" },
      { label: "批量创建", action: "batch", shortcut: "Ctrl+B" },
      { separator: true, label: "" },
      { label: "退出", action: "quit" },
    ],
  },
  {
    label: "实例",
    items: [
      { label: "启动全部", action: "launchAll" },
      { label: "全部关闭", action: "stopAll" },
      { label: "整理窗口", action: "tile" },
    ],
  },
  {
    label: "视图",
    items: [
      { label: "名册", action: "nav-instances" },
      { label: "工具匣", action: "nav-tools" },
      { label: "设置", action: "nav-settings" },
      { separator: true, label: "" },
      { label: "刷新状态", action: "refresh", shortcut: "F5" },
    ],
  },
  {
    label: "帮助",
    items: [
      { label: "首次设置向导", action: "onboarding" },
      { separator: true, label: "" },
      { label: "关于", action: "about" },
    ],
  },
];

const PAGE_LABEL: Record<Page, string> = {
  instances: "名册",
  tools: "工具匣",
  settings: "设置",
};

export default function TitleBar({
  page,
  runningCount,
  isDark,
  onToggleTheme,
  onNavigate,
  onNewInstance,
  onBatchCreate,
  onLaunchAll,
  onStopAll,
  onTile,
  onRefresh,
  onAbout,
  onOnboarding,
}: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const win = getCurrentWindow();

  useEffect(() => {
    if (!openMenu) return;

    const onDown = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const trigger = triggerRefs.current[openMenu];
        setOpenMenu(null);
        trigger?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);

    const frame = requestAnimationFrame(() => {
      dropdownRef.current
        ?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")
        ?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  function onDropdownKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)") ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "End") next = items.length - 1;
    items[next]?.focus();
  }

  function run(action?: string) {
    setOpenMenu(null);
    switch (action) {
      case "new":
        onNewInstance();
        break;
      case "batch":
        onBatchCreate();
        break;
      case "quit":
        // 真正退出；关闭按钮才是收进托盘
        void api.quit();
        break;
      case "launchAll":
        onLaunchAll();
        break;
      case "stopAll":
        onStopAll();
        break;
      case "tile":
        onTile();
        break;
      case "nav-instances":
        onNavigate("instances");
        break;
      case "nav-tools":
        onNavigate("tools");
        break;
      case "nav-settings":
        onNavigate("settings");
        break;
      case "refresh":
        onRefresh();
        break;
      case "about":
        onAbout();
        break;
      case "onboarding":
        onOnboarding();
        break;
      default:
        break;
    }
  }

  return (
    <div className="titlebar" ref={barRef}>
      <div className="titlebar-brand">
        <span>百鬼帐</span>
        {runningCount > 0 && (
          <span className="titlebar-badge" aria-label={`${runningCount} 个实例运行中`}>
            {runningCount}
          </span>
        )}
      </div>

      <nav className="menubar" aria-label="应用菜单">
        {MENUS.map((menu, menuIndex) => {
          const open = openMenu === menu.label;
          return (
            <div className="menu-root" key={menu.label}>
              <button
                className={`menu-trigger ${open ? "open" : ""}`}
                ref={(element) => {
                  triggerRefs.current[menu.label] = element;
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? `menu-${menuIndex}` : undefined}
                onClick={() => setOpenMenu((current) => (current === menu.label ? null : menu.label))}
                onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setOpenMenu(menu.label);
                  }
                }}
              >
                {menu.label}
              </button>
              {open && (
                <div
                  className="menu-dropdown"
                  id={`menu-${menuIndex}`}
                  role="menu"
                  aria-label={menu.label}
                  ref={dropdownRef}
                  onKeyDown={onDropdownKeyDown}
                >
                  {menu.items.map((item, index) =>
                    item.separator ? (
                      <div className="menu-sep" key={`sep-${index}`} role="separator" />
                    ) : (
                      <button
                        key={item.label}
                        className="menu-item"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={() => run(item.action)}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && <em aria-hidden="true">{item.shortcut}</em>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
        <span className="menubar-page" aria-hidden="true">
          {PAGE_LABEL[page]}
        </span>
      </nav>

      <div className="titlebar-drag" data-tauri-drag-region />

      <div className="win-controls">
        <button
          className="win-btn theme-btn"
          title={isDark ? "切换到亮色" : "切换到暗色"}
          aria-label={isDark ? "切换到亮色" : "切换到暗色"}
          onClick={onToggleTheme}
        >
          {isDark ? <IconSun size={13} /> : <IconMoon size={13} />}
        </button>
        <button
          className="win-btn"
          title="最小化"
          aria-label="最小化"
          onClick={() => void win.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 5h6" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="win-btn"
          title="最大化"
          aria-label="最大化"
          onClick={() => void win.toggleMaximize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="2"
              y="2"
              width="6"
              height="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
        <button
          className="win-btn close"
          title="关闭到托盘"
          aria-label="关闭到托盘"
          onClick={() => void win.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
