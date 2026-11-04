import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole, KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import Footer from "../components/Footer";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    // Supabase traite le lien de récupération et sa session.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (
        event === "PASSWORD_RECOVERY" ||
        (event === "SIGNED_IN" && session)
      ) {
        setError("");
        setReady(true);
      }
    });

    async function checkSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) return;

      if (error) {
        setError("Impossible de vérifier le lien de récupération.");
        return;
      }

      if (data.session) {
        setReady(true);
      } else {
        setError(
          "Lien invalide ou expiré. Retourne à la connexion pour demander un nouveau lien."
        );
      }
    }

    void checkSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session) {
        setError(
          "Ta session de récupération a expiré. Demande un nouveau lien."
        );
        setReady(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setError(
          "Le changement de mot de passe a échoué. Demande un nouveau lien si nécessaire."
        );
        return;
      }

      setPassword("");
      setConfirmation("");
      setMessage(
        "Ton mot de passe a été modifié. Tu peux maintenant te connecter."
      );

      // Ferme la session de récupération avant de revenir à la connexion.
      await supabase.auth.signOut();
    } catch {
      setError("Une erreur est survenue. Réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/logo.png" alt="Conseil UGB" />

        <h1>Nouveau mot de passe</h1>
        <p>Moustarchidine Junior</p>

        {!ready && !message && (
          <p role="status">
            Vérification du lien de récupération…
          </p>
        )}

        {ready && !message && (
          <>
            <label htmlFor="new-password">Nouveau mot de passe</label>
            <div className="input-icon">
              <LockKeyhole size={18} />
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                placeholder="8 caractères minimum"
              />
            </div>

            <label htmlFor="confirm-password">
              Confirmer le mot de passe
            </label>
            <div className="input-icon">
              <KeyRound size={18} />
              <input
                id="confirm-password"
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                placeholder="Répète le mot de passe"
              />
            </div>

            <button
              type="submit"
              className="primary full"
              disabled={loading}
            >
              {loading ? "Modification…" : "Enregistrer le nouveau mot de passe"}
            </button>
          </>
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
          type="button"
          className="forgot-password"
          onClick={() => {
            window.location.replace("/login");
          }}
        >
          Retour à la connexion
        </button>
        <Footer />
      </form>
    </div>
  );
}