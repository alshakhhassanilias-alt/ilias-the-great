import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { clearSession, loadSession, saveSession, setUnauthorizedHandler } from "./api";
import Login from "./components/Login";

// The dashboard pulls in plotly (~4.7 MB); load it only after sign-in so the login screen is instant.
const Dashboard = lazy(() => import("./components/Dashboard"));

export default function App() {
  const [session, setSession] = useState<{ token: string | null; mode: string | null }>(() => loadSession());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setNotice("Your session has expired or was rejected. Please log in again.");
      setSession({ token: null, mode: null });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const onLogin = useCallback((token: string, mode: string) => {
    saveSession(token, mode);
    setNotice(null);
    setSession({ token, mode });
  }, []);

  const onLogout = useCallback(() => {
    clearSession();
    setNotice(null);
    setSession({ token: null, mode: null });
  }, []);

  if (!session.token) return <Login onLogin={onLogin} notice={notice} />;
  return (
    <Suspense fallback={<div className="boot">Loading command center…</div>}>
      <Dashboard token={session.token} loginMode={session.mode} onLogout={onLogout} />
    </Suspense>
  );
}
