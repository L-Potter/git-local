import { FormEvent, useState } from "react";
import { api } from "../api";

type Props = {
  onSuccess: () => void;
};

export function LoginForm({ onSuccess }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api.login(username.trim(), password);
      setPassword("");
      onSuccess();
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-overlay">
      <form className="login-card" onSubmit={onSubmit}>
        <h1 className="login-title">Sign in</h1>
        <p className="login-hint">Use an account from the server&apos;s credentials folder.</p>
        <label className="login-label">
          Username
          <input
            className="login-input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="login-label">
          Password
          <input
            className="login-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {err && <div className="login-error">{err}</div>}
        <button className="login-submit" type="submit" disabled={busy || !username.trim()}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
