import { useEffect, useState } from "react";
import { api, ApiError, type ApiKey, type User } from "../api";

export function KeysPage({ user }: { user: User }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("laptop");
  const [userId, setUserId] = useState(user.id);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  function load() {
    return api.keys().then(setKeys);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load keys"));
    if (user.role === "admin") api.users().then(setUsers).catch(() => undefined);
  }, [user.role]);

  return (
    <div className="stack">
      <div>
        <h1>API keys</h1>
        <p className="lede">Use one gateway URL and this key in Cursor, Claude Code, or MCP Inspector. The full key is shown once.</p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {token ? (
        <div className="card stack">
          <strong>Copy this key now. It will not be shown again.</strong>
          <div className="token">{token}</div>
        </div>
      ) : null}
      <form
        className="card row"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          api.createKey({ name, userId: user.role === "admin" ? userId : undefined }).then((created) => {
            setToken(created.token);
            return load();
          }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not create key"));
        }}
      >
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        {user.role === "admin" ? (
          <label>User
            <select value={userId} onChange={(event) => setUserId(event.target.value)}>
              {users.map((member) => <option key={member.id} value={member.id}>{member.email}</option>)}
            </select>
          </label>
        ) : null}
        <button className="btn" type="submit">Create key</button>
      </form>
      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>User</th><th>Prefix</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>{key.name}</td>
                <td>{key.userEmail}</td>
                <td><code>{key.prefix}…</code></td>
                <td>{new Date(key.createdAt).toLocaleString()}{key.revokedAt ? " · revoked" : ""}</td>
                <td>{key.revokedAt ? null : <button className="btn danger" type="button" onClick={() => api.revokeKey(key.id).then(load).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not revoke"))}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
