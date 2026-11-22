import { useState, type FormEvent } from "react";
import { login } from "../api";

export default function Login({ onLogin, notice }: { onLogin: (token: string, mode: string) => void; notice: string | null }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await login(username, password);
      onLogin(r.access_token, r.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="brand login-brand">
          QUANT ENGINE <span className="brand-sep">·</span> <span className="brand-sub">Command Center</span>
        </div>
        <h1 id="login-title" className="login-title">Operator sign-in</h1>
        {notice && <div className="alert alert-amber" role="status">{notice}</div>}
        {error && <div className="alert alert-red" role="alert" data-testid="login-error">{error}</div>}
        <label className="field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            maxLength={64}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={256}
          />
        </label>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="login-foot">Access is audit-logged. Sessions expire automatically.</p>
      </form>
    </div>
  );
}
