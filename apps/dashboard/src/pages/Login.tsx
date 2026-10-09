import { useState } from "react";
import { api, ApiError, type User } from "../api";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-wrap">
      <form
        className="card login stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          api.login(email, password).then(onLogin).catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : "Login failed");
          }).finally(() => setBusy(false));
        }}
      >
        <div>
          <h1>AgentDock</h1>
          <p className="lede">Sign in to use the team MCP gateway.</p>
        </div>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label>
        <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></label>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="submit" disabled={busy}>Sign in</button>
      </form>
    </div>
  );
}
