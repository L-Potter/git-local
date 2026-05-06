export type FileChange = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "unmerged" | "?";
  staged: boolean;
  section: "staged" | "unstaged" | "untracked";
  binary: boolean;
  isSql: boolean;
};

export type StatusResp = {
  branch: string;
  detached: boolean;
  head: string;
  clean: boolean;
  files: FileChange[] | null;
};

export type DiffResp = {
  path: string;
  oldText: string;
  newText: string;
  isSql: boolean;
  binary: boolean;
  renderer: "text" | "sql" | "binary";
};

export type CommitInfo = {
  hash: string;
  short: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  time: string; // RFC3339
  timeLocal: string; // e.g. "2026-05-01 02:32:38 +08:00"
  hasParent: boolean;
  parentHash?: string;
};

export type ChangedFile = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  isSql: boolean;
};

export type CommitDetail = CommitInfo & { files: ChangedFile[] | null };

/** GET /api/me — 後端未開 auth 時 authRequired 為 false */
export type MeResp =
  | { authRequired: false }
  | { authRequired: true; username: string | null };

const cred: RequestInit = { credentials: "include" };

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const e = await r.json();
      if (e?.error) msg = e.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  me: () => fetch("/api/me", cred).then(jsonOrThrow<MeResp>),

  login: (username: string, password: string) =>
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...cred,
      body: JSON.stringify({ username, password }),
    }).then(jsonOrThrow<{ ok: true; username: string }>),

  logout: () =>
    fetch("/api/logout", { method: "POST", ...cred }).then(jsonOrThrow<{ ok: true }>),

  status: () => fetch("/api/status", cred).then(jsonOrThrow<StatusResp>),

  diff: (path: string, opts?: { commit?: string; from?: string; to?: string }) => {
    const p = new URLSearchParams({ path });
    if (opts?.commit) p.set("commit", opts.commit);
    if (opts?.from) p.set("from", opts.from);
    if (opts?.to) p.set("to", opts.to);
    return fetch("/api/diff?" + p.toString(), cred).then(jsonOrThrow<DiffResp>);
  },

  history: (limit = 200) =>
    fetch("/api/history?limit=" + limit, cred).then(jsonOrThrow<CommitInfo[]>),

  commitDetail: (hash: string) =>
    fetch("/api/commit/detail?hash=" + encodeURIComponent(hash), cred).then(
      jsonOrThrow<CommitDetail>,
    ),

  restore: (path: string, ref: string) =>
    fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...cred,
      body: JSON.stringify({ path, ref }),
    }).then(jsonOrThrow<{ ok: true; path: string; ref: string; short: string }>),

  stage: (paths: string[]) =>
    fetch("/api/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...cred,
      body: JSON.stringify({ paths }),
    }).then(jsonOrThrow<{ ok: true }>),

  unstage: (paths: string[]) =>
    fetch("/api/unstage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...cred,
      body: JSON.stringify({ paths }),
    }).then(jsonOrThrow<{ ok: true }>),

  discard: (paths: string[]) =>
    fetch("/api/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...cred,
      body: JSON.stringify({ paths }),
    }).then(jsonOrThrow<{ ok: true }>),

  commit: (message: string, paths: string[], stageAll = false) =>
    fetch("/api/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...cred,
      body: JSON.stringify({ message, paths, stageAll }),
    }).then(jsonOrThrow<{ ok: true; hash: string; short: string }>),
};
