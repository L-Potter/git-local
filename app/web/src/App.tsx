import { useCallback, useEffect, useMemo, useState } from "react";
import { api, FileChange, MeResp, StatusResp, DiffResp } from "./api";
import { ChangeList } from "./components/ChangeList";
import { CommitForm } from "./components/CommitForm";
import { DiffViewer } from "./components/DiffViewer";
import { Header } from "./components/Header";
import { HistoryCommits, HistoryDetail, HistoryProvider } from "./components/History";
import { LoginForm } from "./components/LoginForm";

type Tab = "changes" | "history";

export default function App() {
  const [tab, setTab] = useState<Tab>("changes");
  const [me, setMe] = useState<MeResp | null>(null);

  const [status, setStatus] = useState<StatusResp | null>(null);
  const [error, setError] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [diff, setDiff] = useState<DiffResp | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      setError("");
      setChecked((prev) => {
        const next: Record<string, boolean> = {};
        for (const f of s.files ?? []) {
          const key = changeKey(f);
          next[key] = prev[key] ?? true;
        }
        return next;
      });
    } catch (e) {
      const msg = String(e);
      if (msg === "unauthorized" || msg.toLowerCase().includes("unauthorized")) {
        setMe((prev) =>
          prev && prev.authRequired === true ? { authRequired: true, username: null } : prev,
        );
      }
      setError(msg);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setMe({ authRequired: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needLogin = me !== null && me.authRequired === true && me.username === null;

  useEffect(() => {
    if (me === null || needLogin) return;
    refreshStatus();
  }, [me, needLogin, refreshStatus]);

  const afterLogin = useCallback(async () => {
    const m = await api.me();
    setMe(m);
    setError("");
    try {
      const s = await api.status();
      setStatus(s);
      setChecked((prev) => {
        const next: Record<string, boolean> = {};
        for (const f of s.files ?? []) {
          const key = changeKey(f);
          next[key] = prev[key] ?? true;
        }
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onLogout = useCallback(async () => {
    try {
      await api.logout();
      const m = await api.me();
      setMe(m);
      setStatus(null);
      setSelected(null);
      setDiff(null);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    setDiffLoading(true);
    api
      .diff(selected)
      .then((d) => setDiff(d))
      .catch((e) => setError(String(e)))
      .finally(() => setDiffLoading(false));
  }, [selected, status?.head]);

  const files = status?.files ?? [];
  const checkedCount = useMemo(
    () => files.filter((f) => checked[changeKey(f)]).length,
    [files, checked],
  );

  const onToggleAll = (value: boolean) => {
    const next: Record<string, boolean> = {};
    for (const f of files) next[changeKey(f)] = value;
    setChecked(next);
  };

  const onToggle = (f: FileChange, value: boolean) => {
    setChecked((prev) => ({ ...prev, [changeKey(f)]: value }));
  };

  const onCommit = async (message: string) => {
    const paths = files.filter((f) => checked[changeKey(f)]).map((f) => f.path);
    if (paths.length === 0) {
      setError("No files selected.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.commit(message, paths);
      setError("");
      await refreshStatus();
      setSelected(null);
      console.log("committed", r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async (path: string) => {
    if (!confirm(`Discard changes to ${path}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.discard([path]);
      await refreshStatus();
      if (selected === path) setSelected(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCheckoutFromHead = async (path: string) => {
    if (!confirm(`Checkout "${path}" from HEAD?\nThis will overwrite the working tree file.`)) {
      return;
    }
    setBusy(true);
    try {
      await api.restore(path, "HEAD");
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const sessionUser = me && me.authRequired === true && me.username ? me.username : null;

  const mainArea = (
    <div className="main">
      <aside className="sidebar">
        <div className="sidebar-tabs">
          <div
            className={`tab ${tab === "changes" ? "tab-active" : ""}`}
            onClick={() => setTab("changes")}
          >
            Changes
            <span className="badge">{files.length}</span>
          </div>
          <div
            className={`tab ${tab === "history" ? "tab-active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </div>
        </div>

        {tab === "changes" && (
          <>
            <ChangeList
              files={files}
              checked={checked}
              selected={selected}
              onSelect={setSelected}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              onDiscard={onDiscard}
              onCheckoutFromHead={onCheckoutFromHead}
            />
            <CommitForm
              branch={status?.branch ?? "main"}
              count={checkedCount}
              disabled={busy}
              onCommit={onCommit}
            />
          </>
        )}

        {tab === "history" && <HistoryCommits />}
      </aside>

      <main className="content">
        {error && <div className="error">{error}</div>}

        {tab === "changes" && (
          <>
            {!selected && <div className="empty">Select a file to see its diff.</div>}
            {selected && diffLoading && <div className="empty">Loading diff…</div>}
            {selected && diff && !diffLoading && <DiffViewer diff={diff} />}
          </>
        )}

        {tab === "history" && <HistoryDetail />}
      </main>
    </div>
  );

  if (me === null) {
    return (
      <div className="app">
        <Header branch="—" onRefresh={() => {}} />
        <div className="empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        branch={status?.branch ?? "—"}
        detached={status?.detached}
        sessionUsername={sessionUser}
        onLogout={sessionUser ? onLogout : undefined}
        onRefresh={() => {
          setError("");
          refreshStatus();
        }}
      />

      {needLogin ? (
        <LoginForm onSuccess={afterLogin} />
      ) : tab === "history" ? (
        <HistoryProvider onError={(m) => setError(m)}>{mainArea}</HistoryProvider>
      ) : (
        mainArea
      )}
    </div>
  );
}

function changeKey(f: FileChange) {
  return `${f.section}::${f.path}`;
}
