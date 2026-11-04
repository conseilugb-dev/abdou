import { ReactElement, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabase";
import type { Session } from "@supabase/supabase-js";

import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import CheckIn from "./pages/CheckIn";
import MemberCard from "./pages/MemberCard";
import Scan from "./pages/Scan";

import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import Activities from "./pages/Activities";
import Attendance from "./pages/Attendance";
import Statistics from "./pages/Statistics";
import Absences from "./pages/Absences";
import Settings from "./pages/Settings";
import Users from "./pages/Users";
import Exports from "./pages/Exports";

// Verrouillage automatique : si la page reste cachée plus de 30 secondes
// (changement d'onglet, autre application, écran verrouillé, page fermée),
// l'utilisateur doit se reconnecter. Pour 5 minutes : 5 * 60_000.
const LOCK_AFTER_MS = 30_000;
const LAST_HIDDEN_KEY = "mj_last_hidden_at";

function Protected({ session, children }: { session: Session | null; children: ReactElement }) {
  return session ? children : <Navigate to="/login" replace />;
}

function AppRoutes({ session }: { session: Session | null }) {
  return (
    <Layout session={session}>
      <Routes>
        {/* Pages publiques (sans connexion) */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/activities" element={<Activities canDelete={!!session} />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/absences" element={<Absences />} />

        {/* Pages protégées (identifiant + mot de passe) */}
        <Route path="/members" element={<Protected session={session}><Members /></Protected>} />
        <Route path="/exports" element={<Protected session={session}><Exports /></Protected>} />
        <Route path="/users" element={<Protected session={session}><Users /></Protected>} />
        <Route path="/settings" element={<Protected session={session}><Settings /></Protected>} />
        <Route path="/scan" element={<Protected session={session}><Scan /></Protected>} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;

      if (error) {
        console.error("Erreur de récupération de session :", error.message);
      }

      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;

      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    let timer: number | undefined;

    const lock = () => {
      localStorage.removeItem(LAST_HIDDEN_KEY);
      void supabase.auth.signOut({ scope: "local" });
    };

    const markHidden = () => {
      localStorage.setItem(LAST_HIDDEN_KEY, String(Date.now()));
    };

    const isExpired = () => {
      const last = Number(localStorage.getItem(LAST_HIDDEN_KEY));
      return last > 0 && Date.now() - last > LOCK_AFTER_MS;
    };

    // Page rouverte après plus de 30 s : on redemande le mot de passe
    if (isExpired()) {
      lock();
      return;
    }
    localStorage.removeItem(LAST_HIDDEN_KEY);

    const onVisibility = () => {
      if (document.hidden) {
        markHidden();
        timer = window.setTimeout(lock, LOCK_AFTER_MS);
      } else {
        window.clearTimeout(timer);
        if (isExpired()) lock();
        else localStorage.removeItem(LAST_HIDDEN_KEY);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", markHidden);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", markHidden);
    };
  }, [session]);

  if (loading) {
    return <div className="center-screen">Chargement…</div>;
  }

  return (
    <Routes>
      <Route
        path="/reset-password"
        element={<ResetPassword />}
      />

      <Route path="/checkin/:token" element={<CheckIn />} />
      <Route path="/card/:token" element={<MemberCard />} />

      <Route
        path="/login"
        element={
          session ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Login />
          )
        }
      />

      <Route
        path="/*"
        element={
          session ? (
            <AppRoutes session={session} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}