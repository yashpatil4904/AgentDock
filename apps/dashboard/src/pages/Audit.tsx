import { useEffect, useState } from "react";
import { api, type AuditRow } from "../api";

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => api.audit().then(setRows).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load audit log"));
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Audit log</h1>
        <p className="lede">Every tool call through the gateway or the chat agent, attributed to the caller.</p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="panel">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Server</th><th>Tool</th><th>Duration</th><th>Outcome</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.startedAt).toLocaleString()}</td>
                <td>{row.userEmail}</td>
                <td>{row.serverSlug}</td>
                <td><code>{row.tool}</code></td>
                <td>{row.durationMs} ms</td>
                <td>
                  <span className={`pill ${row.success ? "ok" : "bad"}`}>{row.success ? "succeeded" : "failed"}</span>
                  {row.error ? <div className="error">{row.error}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted">No tool calls yet.</p> : null}
      </div>
    </div>
  );
}
