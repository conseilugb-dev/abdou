import { FormEvent, useState } from "react";
import { LockKeyhole, Mail, LogIn, KeyRound, QrCode, ClipboardCheck, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import Footer from "../components/Footer";

// Domaine utilisé pour les identifiants sans adresse e-mail.
const LOGIN_DOMAIN =
  import.meta.env.VITE_LOGIN_DOMAIN || "mj-membres.app";

const toAuthEmail = (id: string) => {
  const v = id.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${LOGIN_DOMAIN}`;
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: toAuthEmail(email),
        password,
      });

      if (error) {
        console.error("Erreur connexion :", error.message);
        const m = error.message.toLowerCase();

        if (m.includes("email not confirmed")) {
          setError("Compte non confirmé dans Supabase.");
        } else if (m.includes("invalid login credentials")) {
          setError("Identifiant ou mot de passe incorrect.");
        } else {
          setError(`Erreur technique : ${error.message}`);
        }
        return;
      }

      window.location.replace("/");
    } catch {
      setError(
        "Impossible de se connecter. Vérifie ta connexion Internet."
      );
    } finally {
      setLoading(false);
    }
  }

  async function forgotPassword() {
    const normalizedEmail = email.trim().toLowerCase();

    setError("");
    setMessage("");

    if (!normalizedEmail) {
      setError(
        "Saisis ton identifiant ou ton adresse e-mail avant de continuer."
      );
      return;
    }

    if (!normalizedEmail.includes("@")) {
      setError(
        "Avec un identifiant, la réinitialisation par e-mail n'est pas possible. Saisis l'adresse e-mail réelle du compte, ou demande à l'administrateur de changer ton mot de passe dans Supabase."
      );
      return;
    }

    setResetLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${window.location.origin}/reset-password`,
        }
      );

      if (error) {
        setError(
          "Impossible d'envoyer l'e-mail. Vérifie la configuration Supabase."
        );
        return;
      }

      setMessage(
        "Si cette adresse correspond à un compte, un e-mail de réinitialisation a été envoyé. Vérifie aussi les courriers indésirables."
      );
    } catch {
      setError(
        "Une erreur est survenue. Réessaie dans quelques instants."
      );
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="auth-split">
      <aside className="auth-hero">
        <div className="auth-hero-inner">
          <img className="auth-hero-logo" src="/logo.png" alt="Conseil UGB" />
          <h2 className="auth-hero-org">Moustarchidine Junior</h2>
          <div className="auth-hero-lines">
            <div>Commission Administrative</div>
            <div>Conseil UGB</div>
            <div>Comité INTER-UNIVERSITAIRE</div>
          </div>

          <div className="auth-hero-rule" />

          <p className="auth-hero-welcome">
            Bienvenue. Gère tes membres, tes activités et tes présences en toute simplicité.
          </p>

          <ul className="auth-hero-features">
            <li><QrCode size={18} /> Appel rapide par QR code</li>
            <li><ClipboardCheck size={18} /> Suivi des présences et des absences</li>
            <li><Users size={18} /> Cartes et fiches de membres</li>
          </ul>
        </div>
      </aside>

      <main className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <h1>Connexion</h1>
          <p className="auth-sub">Accède à l'espace membres</p>

          <label htmlFor="login-email">
            Identifiant
          </label>

          <div className="input-icon">
            <Mail size={18} />
            <input
              id="login-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              placeholder="Ex. votre identifiant ou e-mail"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          <label htmlFor="login-password">
            Mot de passe
          </label>

          <div className="input-icon">
            <LockKeyhole size={18} />
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="Ton mot de passe"
            />
          </div>

          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}

          {message && (
            <div className="success-box" role="status">
              {message}
            </div>
          )}

          <button
            type="submit"
            className="primary full"
            disabled={loading || resetLoading}
          >
            <LogIn size={18} />
            {loading ? "Connexion…" : "Se connecter"}
          </button>

          <button
            type="button"
            className="forgot-password"
            onClick={forgotPassword}
            disabled={loading || resetLoading}
          >
            <KeyRound size={16} />
            {resetLoading
              ? "Envoi en cours…"
              : "Mot de passe oublié ?"}
          </button>

          <Footer />
        </form>
      </main>
    </div>
  );
}