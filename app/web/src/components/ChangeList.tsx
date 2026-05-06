import { useState } from "react";
import { FileChange } from "../api";
import { ContextMenu, MenuItem } from "./ContextMenu";

type Props = {
  files: FileChange[];
  checked: Record<string, boolean>;
  selected: string | null;
  onSelect: (path: string) => void;
  onToggle: (f: FileChange, value: boolean) => void;
  onToggleAll: (value: boolean) => void;
  onDiscard: (path: string) => void;
  onCheckoutFromHead: (path: string) => void;
};

type Ctx = { x: number; y: number; file: FileChange } | null;

export function ChangeList({
  files,
  checked,
  selected,
  onSelect,
  onToggle,
  onToggleAll,
  onDiscard,
  onCheckoutFromHead,
}: Props) {
  const allChecked = files.length > 0 && files.every((f) => checked[key(f)]);
  const someChecked = files.some((f) => checked[key(f)]);
  const [ctx, setCtx] = useState<Ctx>(null);

  const itemsFor = (f: FileChange): MenuItem[] => {
    const checkoutSupported = f.status === "modified" || f.status === "deleted";
    return [
      {
        label: "Checkout file from HEAD",
        onClick: () => onCheckoutFromHead(f.path),
        disabled: !checkoutSupported,
        hint: checkoutSupported
          ? "Restore this file's contents to match the latest commit"
          : "Only modified/deleted files can be checked out from HEAD",
      },
      {
        label: "Discard changes",
        onClick: () => onDiscard(f.path),
        danger: true,
        hint: "Reset this file (index + worktree) to HEAD",
      },
    ];
  };

  return (
    <div className="change-list">
      <div className="change-summary">
        <label className="check-row">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = !allChecked && someChecked;
            }}
            onChange={(e) => onToggleAll(e.target.checked)}
          />
          <span>{files.length} changed file{files.length === 1 ? "" : "s"}</span>
        </label>
      </div>

      <ul className="change-items">
        {files.map((f) => {
          const k = key(f);
          const isSelected = selected === f.path;
          return (
            <li
              key={k}
              className={`change-item ${isSelected ? "is-selected" : ""}`}
              onClick={() => onSelect(f.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(f.path);
                setCtx({ x: e.clientX, y: e.clientY, file: f });
              }}
            >
              <input
                type="checkbox"
                checked={!!checked[k]}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onToggle(f, e.target.checked)}
              />
              <span className={`status-icon status-${f.status}`} title={`${f.status} (${f.section})`}>
                {iconFor(f)}
              </span>
              <span className="path" title={f.path}>
                {f.path}
              </span>
              {f.isSql && <span className="tag tag-sql" title="SQLite database">SQL</span>}
              {f.binary && !f.isSql && <span className="tag tag-bin">BIN</span>}
              <button
                className="discard"
                title="Discard changes"
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard(f.path);
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      {files.length === 0 && (
        <div className="change-empty">
          No local changes. Working tree is clean.
        </div>
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={itemsFor(ctx.file)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}

function key(f: FileChange) {
  return `${f.section}::${f.path}`;
}

function iconFor(f: FileChange): string {
  switch (f.status) {
    case "added":
      return "+";
    case "modified":
      return "M";
    case "deleted":
      return "−";
    case "renamed":
      return "R";
    case "untracked":
      return "?";
    case "unmerged":
      return "!";
    default:
      return "•";
  }
}
