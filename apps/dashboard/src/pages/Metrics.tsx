import { useEffect, useState } from "react";
import { api, type McpServer, type ServerMetric } from "../api";

export function MetricsPage() {
  const [rows, setRows] = useState<ServerMetric[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => {
      Promise.all([api.metrics(), api.servers()]).then(([metrics, listed]) => {
        setRows(metrics);
        setServers(listed);
      }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load metrics"));
    };
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, []);

  const errors = new Map(servers.map((server) => [server.slug, server.lastError]));

  return (
    <div className="stack">
      <div>
        <h1>Metrics</h1>
        <p className="lede">Tool calls, failures, and average latency for each upstream. The same numbers are on the gateway at <code>/metrics</code>.</p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="panel">
        <table>
          <thead>
            <tr><th>Server</th><th>Calls</th><th>Errors</th><th>Error rate</th><th>Avg latency</th><th>Last error</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rate = row.calls === 0 ? 0 : Math.round((row.errors / row.calls) * 100);
              const avg = row.calls === 0 ? 0 : Math.round(row.totalDurationMs / row.calls);
              return (
                <tr key={row.serverSlug}>
                  <td>{row.serverSlug}</td>
                  <td>{row.calls}</td>
                  <td>{row.errors}</td>
                  <td>{rate}%</td>
                  <td>{avg} ms</td>
                  <td>{errors.get(row.serverSlug) ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted">No tool calls yet.</p> : null}
      </div>
    </div>
  );
}
