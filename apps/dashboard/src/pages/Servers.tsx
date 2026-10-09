import { useEffect, useState } from "react";
import { api, ApiError, type McpServer, type User } from "../api";

const emptyForm = {
  name: "",
  url: "",
  authType: "none" as "none" | "bearer" | "header",
  authHeader: "",
  credential: "",
  enabled: true,
};

export function ServersPage({ user }: { user: User }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setServers(await api.servers());
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load servers"));
    const timer = setInterval(() => { void load().catch(() => undefined); }, 8000);
    return () => clearInterval(timer);
  }, []);

  function onError(err: unknown) {
    setError(err instanceof ApiError ? err.message : "Request failed");
  }

  return (
    <div className="stack">
      <div>
        <h1>MCP servers</h1>
        <p className="lede">Tools are exposed as <code>slug__tool</code>. Upstream credentials stay on the gateway.</p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {user.role === "admin" ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const body = {
              name: form.name,
              url: form.url,
              authType: form.authType,
              authHeader: form.authHeader || undefined,
              credential: form.credential || undefined,
              enabled: form.enabled,
            };
            const action = editing ? api.updateServer(editing.id, body) : api.createServer(body);
            action.then(() => {
              setForm(emptyForm);
              setEditing(null);
              return load();
            }).catch(onError).finally(() => setBusy(false));
          }}
        >
          <strong>{editing ? `Edit ${editing.slug}` : "Add a server"}</strong>
          <div className="grid-2">
            <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
            <label>URL<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="http://host/mcp" required /></label>
            <label>Auth
              <select value={form.authType} onChange={(event) => setForm({ ...form, authType: event.target.value as typeof form.authType })}>
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="header">Static header</option>
              </select>
            </label>
            {form.authType === "header" ? <label>Header name<input value={form.authHeader} onChange={(event) => setForm({ ...form, authHeader: event.target.value })} required /></label> : <span />}
            {form.authType !== "none" ? (
              <label>{editing ? "New credential (blank keeps the current one)" : "Credential"}
                <input value={form.credential} onChange={(event) => setForm({ ...form, credential: event.target.value })} type="password" required={!editing} />
              </label>
            ) : null}
          </div>
          <label className="row"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Enabled</label>
          <div className="row">
            <button className="btn" disabled={busy} type="submit">{editing ? "Save" : "Add server"}</button>
            {editing ? <button className="btn secondary" type="button" onClick={() => { setEditing(null); setForm(emptyForm); }}>Cancel</button> : null}
            <button className="btn secondary" type="button" onClick={() => { setBusy(true); api.refreshServers().then(setServers).catch(onError).finally(() => setBusy(false)); }}>Refresh status</button>
          </div>
        </form>
      ) : null}
      <div className="panel">
        <table>
          <thead>
            <tr><th>Server</th><th>Status</th><th>Tools</th><th></th></tr>
          </thead>
          <tbody>
            {servers.map((server) => (
              <tr key={server.id}>
                <td>
                  <strong>{server.name}</strong>
                  <div className="muted">{server.slug}</div>
                  <div className="muted">{server.url}</div>
                  {server.lastError ? <div className="error">{server.lastError}</div> : null}
                </td>
                <td><span className={`pill ${server.status}`}>{server.status}</span></td>
                <td>
                  <div className="tools">
                    {server.tools.length ? server.tools.map((tool) => <code key={tool.name}>{server.slug}__{tool.name}</code>) : <span className="muted">No tools cached</span>}
                  </div>
                </td>
                <td>
                  {user.role === "admin" ? (
                    <div className="row">
                      <button className="btn secondary" type="button" onClick={() => {
                        setEditing(server);
                        setForm({ name: server.name, url: server.url, authType: server.authType, authHeader: server.authHeader ?? "", credential: "", enabled: server.enabled });
                      }}>Edit</button>
                      <button className="btn secondary" type="button" onClick={() => {
                        api.updateServer(server.id, { name: server.name, url: server.url, authType: server.authType, authHeader: server.authHeader ?? undefined, enabled: !server.enabled }).then(load).catch(onError);
                      }}>{server.enabled ? "Disable" : "Enable"}</button>
                      <button className="btn danger" type="button" onClick={() => {
                        if (confirm(`Remove ${server.name}?`)) api.deleteServer(server.id).then(load).catch(onError);
                      }}>Remove</button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
