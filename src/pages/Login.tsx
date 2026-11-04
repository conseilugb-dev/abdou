import { FormEvent, KeyboardEvent, useState } from "react";
import { LockKeyhole, UserRound, LogIn, Eye, EyeOff, TriangleAlert } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState("CapsLock"));

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

        </div>
      </aside>

      <main className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <h1>Connexion</h1>
          <p className="auth-sub">Accède à l'espace membres</p>

          <label htmlFor="login-email">Identifiant ou e-mail</label>
          <div className="input-icon">
            <UserRound size={18} />
            <input
              id="login-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              placeholder="Ton identifiant ou ton e-mail"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div className="auth-label-row">
            <label htmlFor="login-password">Mot de passe</label>
            <button
              type="button"
              className="auth-link"
              onClick={forgotPassword}
              disabled={loading || resetLoading}
            >
              {resetLoading ? "Envoi en cours…" : "Mot de passe oublié ?"}
            </button>
          </div>
          <div className="input-icon">
            <LockKeyhole size={18} />
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={checkCaps}
              onKeyDown={checkCaps}
              onBlur={() => setCapsLock(false)}
              autoComplete="current-password"
              required
              placeholder="Ton mot de passe"
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              aria-pressed={showPassword}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {capsLock && (
            <div className="caps-hint" role="status">
              <TriangleAlert size={15} /> Verrouillage majuscules activé
            </div>
          )}

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
            {loading ? <span className="btn-spinner" aria-hidden="true" /> : <LogIn size={18} />}
            {loading ? "Connexion en cours…" : "Se connecter"}
          </button>

          <Footer />
        </form>
      </main>
    </div>
  );
}