import { useMemo } from "react";
import { diffLines, Change } from "diff";
import { DiffResp } from "../api";

type Props = { diff: DiffResp };

export function DiffViewer({ diff }: Props) {
  const rows = useMemo(() => buildRows(diff), [diff]);

  return (
    <div className="diff">
      <div className="diff-header">
        <span className="diff-path">{diff.path}</span>
        {diff.isSql && (
          <span className="diff-badge" title="Compared as SQL text dump (modernc.org/sqlite)">
            SQLite → SQL diff
          </span>
        )}
        {diff.binary && !diff.isSql && (
          <span className="diff-badge diff-badge-warn">Binary file</span>
        )}
      </div>

      {diff.binary && !diff.isSql ? (
        <div className="empty">Binary content not shown.</div>
      ) : rows.length === 0 ? (
        <div className="empty">No textual differences.</div>
      ) : (
        <pre className="diff-body">
          {rows.map((r, i) => (
            <div
              key={i}
              className={`diff-row diff-row-${r.kind}`}
              title={r.kind}
            >
              <span className="ln ln-old">{r.oldNo ?? ""}</span>
              <span className="ln ln-new">{r.newNo ?? ""}</span>
              <span className="diff-mark">{markFor(r.kind)}</span>
              <span className="diff-text">{r.text}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

type Row = {
  kind: "add" | "del" | "ctx";
  text: string;
  oldNo?: number;
  newNo?: number;
};

function buildRows(d: DiffResp): Row[] {
  if (d.binary && !d.isSql) return [];
  const changes: Change[] = diffLines(d.oldText ?? "", d.newText ?? "");
  const rows: Row[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const c of changes) {
    const lines = c.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      if (c.added) {
        rows.push({ kind: "add", text: line, newNo: newNo++ });
      } else if (c.removed) {
        rows.push({ kind: "del", text: line, oldNo: oldNo++ });
      } else {
        rows.push({ kind: "ctx", text: line, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }
  return rows;
}

function markFor(k: Row["kind"]) {
  if (k === "add") return "+";
  if (k === "del") return "−";
  return " ";
}
