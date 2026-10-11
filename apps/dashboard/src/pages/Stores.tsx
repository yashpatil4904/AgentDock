import { useEffect, useState } from "react";
import { api, ApiError, type Store, type User } from "../api";

const labels: Record<Store["status"], string> = {
  provisioning: "Provisioning",
  ready: "Ready",
  failed: "Failed",
  deleting: "Deleting",
};

export function StoresPage({ user }: { user: User }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    return api.stores().then(setStores);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load stores"));
    const timer = setInterval(() => { void load().catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Stores</h1>
        <p className="lede">
          Each store gets its own namespace, database, and WooCommerce tools. The platform store stays at the shop address and uses the <code>woocommerce__</code> prefix.
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <form
        className="card grid-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
          }
          setBusy(true);
          api.createStore(name, password, confirmPassword).then(() => {
            setName("");
            setPassword("");
            setConfirmPassword("");
            return load();
          }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not create the store")).finally(() => setBusy(false));
        }}
      >
        <label>Store name<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="East" /></label>
        <p className="muted">WooCommerce admin username is shopadmin. This password is for that shop only.</p>
        <label>Password<input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Confirm password<input type="password" value={confirmPassword} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
        <button className="btn" type="submit" disabled={busy}>Create store</button>
      </form>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              {user.role === "admin" ? <th>Owner</th> : null}
              <th>URL</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.id}>
                <td>
                  <div>{store.name}</div>
                  <div className="muted"><code>{store.toolPrefix}list_orders</code></div>
                </td>
                <td>
                  <span className={`pill ${store.status}`}>{labels[store.status]}</span>
                  {store.error ? <div className="error">{store.error}</div> : null}
                  {store.detail ? <div className="muted">{store.detail}</div> : null}
                </td>
                {user.role === "admin" ? <td>{store.ownerEmail}</td> : null}
                <td><a href={store.url}>{store.url}</a></td>
                <td>{new Date(store.createdAt).toLocaleString()}</td>
                <td className="row">
                  {store.status === "failed" ? (
                    <button className="btn secondary" type="button" onClick={() => api.retryStore(store.id).then(load).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not retry"))}>Retry</button>
                  ) : null}
                  {store.status === "deleting" ? null : (
                    <button
                      className="btn danger"
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`Delete ${store.name}? This removes its namespace, database, and tools.`)) return;
                        api.deleteStore(store.id).then(load).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not delete"));
                      }}
                    >Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stores.length === 0 ? <p className="muted">No extra stores yet. Create one and another can be created at the same time.</p> : null}
      </div>
    </div>
  );
}
