import { useEffect, useRef, useState } from "react";
import { IconVolume, IconVolumeOff } from "./icons";
import type { Instance } from "../types";

interface Props {
  instance: Instance;
  running: boolean;
  onPreview: (volume: number, muted: boolean) => void;
  onCommit: (volume: number, muted: boolean) => void;
}

export default function VolumeControl({
  instance,
  running,
  onPreview,
  onCommit,
}: Props) {
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(instance.volume);
  const [muted, setMuted] = useState(instance.muted);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVolume(instance.volume);
    setMuted(instance.muted);
  }, [instance.volume, instance.muted]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function preview(nextVolume: number) {
    setVolume(nextVolume);
    if (running) onPreview(nextVolume, muted);
  }

  // 保存但不一定关闭：滑杆失焦时先保存，避免吞掉随后点击的静音按钮。
  function save(nextVolume = volume, nextMuted = muted, close = false) {
    onCommit(nextVolume, nextMuted);
    if (close) setOpen(false);
  }

  const silent = muted || volume === 0;

  return (
    <div className="volume-control" ref={rootRef}>
      <button
        type="button"
        className={`volume-button ${silent ? "off" : ""}`}
        aria-label={muted ? "已静音，点击调整音量" : `音量 ${volume}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={muted ? "已静音" : `音量 ${volume}%`}
        onClick={() => setOpen((value) => !value)}
      >
        {silent ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
      </button>

      {open && (
        <div className="volume-popover" role="dialog" aria-label="实例音量">
          <div className="volume-head">
            <span>音量</span>
            <strong>{muted ? "静音" : `${volume}%`}</strong>
          </div>
          <input
            className="volume-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            disabled={muted}
            aria-label="音量百分比"
            onChange={(event) => preview(Number(event.target.value))}
            onPointerUp={() => save()}
            onKeyUp={(event) => {
              if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                save();
              }
            }}
            onBlur={() => save()}
          />
          <button
            type="button"
            className={`volume-mute ${muted ? "active" : ""}`}
            onClick={() => save(volume, !muted, true)}
          >
            {muted ? "取消静音" : "静音"}
          </button>
          {!running && <p className="volume-note">实例未运行，设置会在启动后生效。</p>}
        </div>
      )}
    </div>
  );
}