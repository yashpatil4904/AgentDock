import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type User } from "./api";
import { Layout } from "./Layout";
import { AuditPage } from "./pages/Audit";
import { ChatPage } from "./pages/Chat";
import { KeysPage } from "./pages/Keys";
import { LoginPage } from "./pages/Login";
import { MembersPage } from "./pages/Members";
import { MetricsPage } from "./pages/Metrics";
import { ServersPage } from "./pages/Servers";
import { StoresPage } from "./pages/Stores";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <p className="main">Loading…</p>;
  if (!user) return <LoginPage onLogin={setUser} />;

  return (
    <Layout user={user} onLogout={() => { void api.logout().finally(() => setUser(null)); }}>
      <Routes>
        <Route path="/" element={<ServersPage user={user} />} />
        <Route path="/stores" element={<StoresPage user={user} />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/keys" element={<KeysPage user={user} />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/metrics" element={user.role === "admin" ? <MetricsPage /> : <Navigate to="/" replace />} />
        <Route path="/members" element={user.role === "admin" ? <MembersPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
