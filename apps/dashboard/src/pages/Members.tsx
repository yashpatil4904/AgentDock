import { useEffect, useState } from "react";
import { api, ApiError, type User } from "../api";

export function MembersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [error, setError] = useState("");

  function load() {
    return api.users().then(setUsers);
  }

  useEffect(() => { load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load members")); }, []);

  return (
    <div className="stack">
      <div>
        <h1>Members</h1>
        <p className="lede">Invite someone, then issue or revoke their gateway API key from API keys.</p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <form
        className="card grid-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          api.createUser({ name, email, password, role }).then(() => {
            setName(""); setEmail(""); setPassword(""); setRole("member");
            return load();
          }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not invite"));
        }}
      >
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Temporary password<input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Role
          <select value={role} onChange={(event) => setRole(event.target.value as "member" | "admin")}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="btn" type="submit">Invite</button>
      </form>
      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.role}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
