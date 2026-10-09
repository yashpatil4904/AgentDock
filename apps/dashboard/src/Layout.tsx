import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { User } from "./api";

export function Layout({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">AgentDock<span>Team MCP gateway</span></div>
        <NavLink to="/" end>Servers</NavLink>
        <NavLink to="/chat">Chat</NavLink>
        <NavLink to="/keys">API keys</NavLink>
        <NavLink to="/audit">Audit log</NavLink>
        {user.role === "admin" ? <NavLink to="/members">Members</NavLink> : null}
        <div className="who">
          <div>{user.name}</div>
          <div>{user.role}</div>
          <button className="btn secondary" type="button" onClick={onLogout}>Log out</button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
