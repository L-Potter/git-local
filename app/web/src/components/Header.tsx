type Props = {
  branch: string;
  detached?: boolean;
  onRefresh: () => void;
  /** 有值時顯示登出（後端有開 -auth-dir） */
  sessionUsername?: string | null;
  onLogout?: () => void;
};

export function Header({ branch, detached, onRefresh, sessionUsername, onLogout }: Props) {
  return (
    <header className="header">
      <div className="header-section">
        <span className="logo">my-git-tool</span>
      </div>
      <div className="header-section header-center">
        <span className="branch-pill">
          <span className="branch-icon">⎇</span>
          {detached ? `detached @ ${branch.slice(0, 7)}` : branch}
        </span>
      </div>
      <div className="header-section header-right">
        {sessionUsername && onLogout && (
          <span className="session-user" title="Signed in">
            {sessionUsername}
          </span>
        )}
        {sessionUsername && onLogout && (
          <button className="btn btn-ghost" type="button" onClick={onLogout}>
            Sign out
          </button>
        )}
        <button className="btn btn-ghost" onClick={onRefresh} title="Refresh">
          ⟳ Fetch
        </button>
      </div>
    </header>
  );
}
