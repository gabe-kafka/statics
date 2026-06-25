"use client";

import { useRef, useState, type ReactNode } from "react";
import { OrthoIcon } from "./OrthoIcon";
import { OsnapIcon } from "./OsnapIcon";

export type OsnapTypes = {
  endpoint: boolean;
  midpoint: boolean;
  center: boolean;
  intersection: boolean;
  perpendicular: boolean;
  nearest: boolean;
};

export const OSNAP_TYPES_DEFAULT: OsnapTypes = {
  endpoint: true,
  midpoint: true,
  center: false,
  intersection: true,
  perpendicular: false,
  nearest: false,
};

export type Tool = "select" | "node" | "member" | "hinge";

export function StatusBar({
  tool,
  onSetTool,
  orthoMode,
  onToggleOrtho,
  osnapMode,
  onToggleOsnap,
  osnapTypes,
  onChangeOsnapTypes,
  cursor,
}: {
  tool: Tool;
  onSetTool: (t: Tool) => void;
  orthoMode: boolean;
  onToggleOrtho: () => void;
  osnapMode: boolean;
  onToggleOsnap: () => void;
  osnapTypes: OsnapTypes;
  onChangeOsnapTypes: (t: OsnapTypes) => void;
  cursor: [number, number] | null;
}) {
  const [openPopover, setOpenPopover] = useState<null | "osnap" | "ortho">(null);

  return (
    <div className="flex h-7 select-none items-center gap-0.5 border-t border-border bg-surface px-2 font-mono text-[10px] text-text">
      <ToolButton label="SEL" active={tool === "select"} onClick={() => onSetTool("select")} />
      <ToolButton label="NODE" active={tool === "node"} onClick={() => onSetTool("node")} />
      <ToolButton label="MBR" active={tool === "member"} onClick={() => onSetTool("member")} />
      <ToolButton
        label="EMR"
        active={tool === "hinge"}
        onClick={() => onSetTool("hinge")}
        title="End moment release"
      />

      <div className="mx-2 h-4 w-px bg-border" />

      <span className="text-dim">
        {cursor ? `${cursor[0].toFixed(2)}, ${cursor[1].toFixed(2)}` : "—, —"}
      </span>

      <div className="flex-1" />

      <StatusTool
        tooltip="Object Snap"
        shortcut="F"
        active={osnapMode}
        onToggle={onToggleOsnap}
        icon={<OsnapIcon />}
        ariaLabel="Object snap"
        popoverOpen={openPopover === "osnap"}
        onOpenPopover={() =>
          setOpenPopover((p) => (p === "osnap" ? null : "osnap"))
        }
        popover={
          <OsnapSettingsPopover
            types={osnapTypes}
            onChange={onChangeOsnapTypes}
            onClose={() => setOpenPopover(null)}
          />
        }
      />

      <StatusTool
        tooltip="Ortho Mode"
        shortcut="L"
        active={orthoMode}
        onToggle={onToggleOrtho}
        icon={<OrthoIcon />}
        ariaLabel="Ortho mode"
        popoverOpen={openPopover === "ortho"}
        onOpenPopover={() =>
          setOpenPopover((p) => (p === "ortho" ? null : "ortho"))
        }
        popover={<OrthoSettingsPopover onClose={() => setOpenPopover(null)} />}
      />
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title ?? label}
      className={
        "h-6 px-2 uppercase tracking-[0.08em] transition-colors " +
        (active
          ? "bg-accent text-bg"
          : "text-muted hover:bg-subtle hover:text-text")
      }
    >
      {label}
    </button>
  );
}

function StatusTool({
  tooltip,
  shortcut,
  active,
  onToggle,
  icon,
  ariaLabel,
  popoverOpen,
  onOpenPopover,
  popover,
}: {
  tooltip: string;
  shortcut?: string;
  active: boolean;
  onToggle: () => void;
  icon: ReactNode;
  ariaLabel: string;
  popoverOpen: boolean;
  onOpenPopover: () => void;
  popover: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const onPointerLeave = (e: React.PointerEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && wrapperRef.current?.contains(to)) return;
    setHover(false);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative inline-flex"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={onPointerLeave}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={ariaLabel}
        aria-pressed={active}
        className={
          "flex h-6 w-7 items-center justify-center leading-none transition-colors " +
          (active
            ? "bg-accent text-bg"
            : "text-muted hover:bg-subtle hover:text-text")
        }
      >
        {icon}
      </button>

      {hover && !popoverOpen && (
        <div className="absolute bottom-full left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1 pb-1">
          <div className="pointer-events-none whitespace-nowrap border border-text bg-text px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-bg">
            {tooltip}
            {shortcut && <span className="ml-2 opacity-60">{shortcut}</span>}
          </div>
          <button
            type="button"
            onClick={onOpenPopover}
            aria-label={`${ariaLabel} settings`}
            className="flex h-6 w-6 items-center justify-center border border-border bg-bg text-text shadow hover:bg-subtle"
          >
            <GearIcon />
          </button>
        </div>
      )}

      {popoverOpen && popover}
    </div>
  );
}

function PopoverShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[200px] border border-border bg-bg text-text shadow-xl">
      <header className="flex select-none items-center gap-2 bg-text px-3 py-1.5 text-[11px] font-semibold tracking-wider text-bg">
        <span className="flex-1 uppercase">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 cursor-pointer items-center justify-center hover:opacity-70"
          aria-label={`Close ${title}`}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="p-2 text-[11px]">{children}</div>
    </div>
  );
}

function OsnapSettingsPopover({
  types,
  onChange,
  onClose,
}: {
  types: OsnapTypes;
  onChange: (t: OsnapTypes) => void;
  onClose: () => void;
}) {
  const toggle = (k: keyof OsnapTypes) =>
    onChange({ ...types, [k]: !types[k] });
  const ROWS: { key: keyof OsnapTypes; label: string }[] = [
    { key: "endpoint", label: "Endpoint" },
    { key: "midpoint", label: "Midpoint" },
    { key: "center", label: "Center" },
    { key: "intersection", label: "Intersection" },
    { key: "perpendicular", label: "Perpendicular" },
    { key: "nearest", label: "Nearest" },
  ];
  return (
    <PopoverShell title="Object Snap" onClose={onClose}>
      <div className="flex flex-col gap-1">
        {ROWS.map(({ key, label }) => (
          <label
            key={key}
            className="flex cursor-pointer select-none items-center gap-2 px-1 py-0.5 hover:bg-subtle"
          >
            <input
              type="checkbox"
              checked={types[key]}
              onChange={() => toggle(key)}
              className="h-3 w-3 accent-accent"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 border-t border-border pt-1.5 text-[9px] uppercase tracking-wider text-muted">
        center · perpendicular land next pass
      </div>
    </PopoverShell>
  );
}

function OrthoSettingsPopover({ onClose }: { onClose: () => void }) {
  return (
    <PopoverShell title="Ortho Mode" onClose={onClose}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-1">
          <span className="text-muted">Locked axes</span>
          <span className="font-semibold">0° / 90°</span>
        </div>
      </div>
      <div className="mt-2 border-t border-border pt-1.5 text-[9px] uppercase tracking-wider text-muted">
        polar angle presets coming later
      </div>
    </PopoverShell>
  );
}

function GearIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <path
        d="M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.5 3.5l1.4 1.4 M11.1 11.1l1.4 1.4 M3.5 12.5l1.4-1.4 M11.1 4.9l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M 3 3 L 13 13 M 13 3 L 3 13"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}
