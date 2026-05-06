import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, ChangedFile, CommitDetail, CommitInfo, DiffResp } from "../api";
import { ContextMenu, MenuItem } from "./ContextMenu";
import { DiffViewer } from "./DiffViewer";

type ContextState =
  | { kind: "file"; x: number; y: number; commitHash: string; file: ChangedFile }
  | null;

type Ctx = {
  commits: CommitInfo[] | null;
  selectedHash: string | null;
  setSelectedHash: (h: string) => void;
  detail: CommitDetail | null;
  selectedFile: string | null;
  setSelectedFile: (p: string | null) => void;
  diff: DiffResp | null;
  diffLoading: boolean;
  ctx: ContextState;
  setCtx: (c: ContextState) => void;
  onCheckoutFile: (commitHash: string, path: string) => void;
};

const HistoryCtx = createContext<Ctx | null>(null);

function useHistory(): Ctx {
  const v = useContext(HistoryCtx);
  if (!v) throw new Error("History components must be inside <HistoryProvider>");
  return v;
}

export function HistoryProvider({
  onError,
  children,
}: {
  onError: (msg: string) => void;
  children: ReactNode;
}) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResp | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [ctx, setCtx] = useState<ContextState>(null);

  useEffect(() => {
    api.history(500).then(setCommits).catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    if (commits && commits.length > 0 && !selectedHash) {
      setSelectedHash(commits[0].hash);
    }
  }, [commits, selectedHash]);

  useEffect(() => {
    if (!selectedHash) return;
    setDetail(null);
    setSelectedFile(null);
    setDiff(null);
    api
      .commitDetail(selectedHash)
      .then((d) => {
        setDetail(d);
        if (d.files && d.files.length > 0) setSelectedFile(d.files[0].path);
      })
      .catch((e) => onError(String(e)));
  }, [selectedHash, onError]);

  useEffect(() => {
    if (!selectedHash || !selectedFile) {
      setDiff(null);
      return;
    }
    setDiffLoading(true);
    api
      .diff(selectedFile, { commit: selectedHash })
      .then(setDiff)
      .catch((e) => onError(String(e)))
      .finally(() => setDiffLoading(false));
  }, [selectedHash, selectedFile, onError]);

  const onCheckoutFile = useCallback(
    async (commitHash: string, path: string) => {
      if (
        !confirm(
          `Checkout "${path}" to ${commitHash.slice(0, 7)}?\nThis will overwrite the working tree file.`,
        )
      ) {
        return;
      }
      try {
        await api.restore(path, commitHash);
      } catch (e) {
        onError(String(e));
      }
    },
    [onError],
  );

  const value: Ctx = {
    commits,
    selectedHash,
    setSelectedHash,
    detail,
    selectedFile,
    setSelectedFile,
    diff,
    diffLoading,
    ctx,
    setCtx,
    onCheckoutFile,
  };

  return <HistoryCtx.Provider value={value}>{children}</HistoryCtx.Provider>;
}

export function HistoryCommits() {
  const { commits, selectedHash, setSelectedHash } = useHistory();
  return (
    <div className="history-commits">
      {!commits && <div className="empty">Loading…</div>}
      {commits && commits.length === 0 && <div className="empty">No commits yet</div>}
      {commits?.map((c) => (
        <div
          key={c.hash}
          className={`commit-row ${c.hash === selectedHash ? "is-selected" : ""}`}
          onClick={() => setSelectedHash(c.hash)}
          title={c.hash}
        >
          <div className="commit-subject">{c.subject || "(no message)"}</div>
          <div className="commit-meta">
            <span className="commit-author">{c.authorName}</span>
            <span className="commit-time">{c.timeLocal}</span>
            <span className="commit-short">{c.short}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistoryDetail() {
  const {
    selectedHash,
    detail,
    selectedFile,
    setSelectedFile,
    diff,
    diffLoading,
    ctx,
    setCtx,
    onCheckoutFile,
  } = useHistory();

  const fileMenuItems = (commitHash: string, file: ChangedFile): MenuItem[] => [
    {
      label: `Checkout file to ${commitHash.slice(0, 7)}`,
      onClick: () => onCheckoutFile(commitHash, file.path),
      disabled: file.status === "deleted",
      hint:
        file.status === "deleted"
          ? "File was deleted in this commit; nothing to restore."
          : "Overwrite the working tree copy with this commit's version.",
    },
  ];

  return (
    <div className="history-detail">
      <div className="history-files">
        {!detail && selectedHash && <div className="empty">Loading…</div>}
        {detail && (
          <>
            <div className="files-header">
              {(detail.files?.length ?? 0)} changed file
              {detail.files?.length === 1 ? "" : "s"}
            </div>
            <ul className="files-list">
              {detail.files?.map((f) => (
                <li
                  key={f.path}
                  className={`file-row ${selectedFile === f.path ? "is-selected" : ""}`}
                  onClick={() => setSelectedFile(f.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelectedFile(f.path);
                    setCtx({
                      kind: "file",
                      x: e.clientX,
                      y: e.clientY,
                      commitHash: detail.hash,
                      file: f,
                    });
                  }}
                >
                  <span className={`status-icon status-${f.status}`}>
                    {iconFor(f.status)}
                  </span>
                  <span className="path" title={f.path}>{f.path}</span>
                  {f.isSql && <span className="tag tag-sql">SQL</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="history-diff">
        {detail && (
          <div className="commit-banner">
            <div className="commit-banner-subject">{detail.subject}</div>
            {detail.body && <pre className="commit-banner-body">{detail.body}</pre>}
            <div className="commit-banner-meta">
              <span>{detail.authorName} &lt;{detail.authorEmail}&gt;</span>
              <span className="commit-banner-time">{detail.timeLocal}</span>
              <span className="commit-banner-hash">{detail.hash}</span>
            </div>
          </div>
        )}
        {!selectedFile && <div className="empty">Select a file to view its diff.</div>}
        {selectedFile && diffLoading && <div className="empty">Loading diff…</div>}
        {selectedFile && diff && !diffLoading && <DiffViewer diff={diff} />}
      </div>

      {ctx && ctx.kind === "file" && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={fileMenuItems(ctx.commitHash, ctx.file)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}

function iconFor(s: ChangedFile["status"]): string {
  switch (s) {
    case "added": return "+";
    case "modified": return "M";
    case "deleted": return "−";
    case "renamed": return "R";
    default: return "•";
  }
}
