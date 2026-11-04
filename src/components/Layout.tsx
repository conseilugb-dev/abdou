import { CSSProperties, ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, BarChart3, ClipboardCheck, FileDown, LayoutDashboard,
  LogIn, LogOut, UserX, Menu, Settings, Users, UserCog, X
} from "lucide-react";
import { supabase } from "../lib/supabase";
import Footer from "./Footer";
import type { Session } from "@supabase/supabase-js";

// Couleur propre à chaque module (4e valeur) : l'icône du menu est teintée pour se repérer plus vite.
const publicLinks = [
  ["/dashboard", "Tableau de bord", LayoutDashboard, "#e6b672"],
  ["/activities", "Activités", Activity, "#6aa7ff"],
  ["/attendance", "Présences", ClipboardCheck, "#4cc38a"],
  ["/statistics", "Statistiques", BarChart3, "#b794f6"],
  ["/absences", "Absences Goudi", UserX, "#ff8a7a"],
] as const;

// Réservé aux utilisateurs connectés
const privateLinks = [
  ["/members", "Membres", Users, "#e58a7d"],
  ["/exports", "Exports", FileDown, "#4fd1c5"],
  ["/users", "Utilisateurs", UserCog, "#8fa0ff"],
  ["/settings", "Paramètres", Settings, "#c9b8b2"],
] as const;

export default function Layout({ children, session }: { children: ReactNode; session: Session | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(session?.user.email ?? "Visiteur");
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const navLinks: ReadonlyArray<readonly [string, string, typeof Users, string]> = session
    ? [...publicLinks, ...privateLinks]
    : [...publicLinks];
  const userId = session?.user.id;
  const userEmail = session?.user.email;

  useEffect(() => {
    if (!userId) {
      setName("Visiteur");
      return;
    }
    supabase.from("profiles").select("first_name,last_name").eq("id", userId).single()
      .then(({ data }) => {
        if (data) setName(`${data.first_name} ${data.last_name}`.trim() || userEmail || "Utilisateur");
      });
  }, [userId, userEmail]);

  async function logout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Conseil UGB" />
          <div><strong>Gestion des Membres</strong><small>Moustarchidine Junior</small></div>
          <button className="icon-btn mobile-only" onClick={() => setOpen(false)}><X size={20}/></button>
        </div>
        <nav>
          {navLinks.map(([to, label, Icon, color]) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)} style={{ "--nav-c": color } as CSSProperties}
              className={({isActive}) => isActive ? "nav-link active" : "nav-link"}>
              <span className="nav-ico"><Icon size={18}/></span><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-mini">{name}</div>
          {session ? (
            <button className="nav-link logout" onClick={logout}><LogOut size={19}/> Déconnexion</button>
          ) : (
            <NavLink to="/login" className="nav-link logout"><LogIn size={19}/> Espace membres (connexion)</NavLink>
          )}
        </div>
      </aside>
      {open && <div className="overlay" onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setOpen(true)}><Menu size={22}/></button>
          <div className="topbar-title">Moustarchidine Junior</div>
          <div className="topbar-user">{name}</div>
        </header>
        <div className="content"><div className="page-enter" key={pathname}>{children}</div></div>
        <Footer />
      </main>
    </div>
  );
}