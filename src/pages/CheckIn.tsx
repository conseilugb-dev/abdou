import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import OrgHeader from "../components/OrgHeader";
import Footer from "../components/Footer";

type State = "ok" | "early" | "late" | "cancelled";
type Info = { found: boolean; name?: string; start?: string; state?: State };
type MemberName = { id: string; first_name: string; last_name: string };

const CLOSED_MESSAGE: Record<string, string> = {
  early: "Le pointage n'est pas encore ouvert. Reviens 30 minutes avant le début.",
  late: "Le pointage est fermé : cette activité est terminée.",
  cancelled: "Cette activité est annulée.",
};

// Lecture à haute voix (synthèse vocale du navigateur).
function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 0.95;
    u.volume = 1;
    const fr = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("fr"));
    if (fr) u.voice = fr;
    window.speechSynthesis.speak(u);
  } catch {
    /* la voix est un bonus : on ignore les erreurs */
  }
}

export default function CheckIn() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [members, setMembers] = useState<MemberName[]>([]);
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function init() {
      const { data, error: infoError } = await supabase.rpc("checkin_info", { p_token: token });
      if (!active) return;

      if (infoError) {
        setError("Impossible de charger l'activité : " + infoError.message);
        setBooting(false);
        return;
      }

      const result = data as Info;
      setInfo(result);

      if (result?.found && result.state === "ok") {
        const { data: list, error: listError } = await supabase.rpc("checkin_members", { p_token: token });
        if (!active) return;
        if (listError) {
          setError("Impossible de charger la liste des membres : " + listError.message);
        } else {
          setMembers((list as MemberName[]) || []);
        }
      }
      setBooting(false);
    }

    void init();
    return () => {
      active = false;
    };
  }, [token]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter((m) => `${m.first_name} ${m.last_name} ${m.last_name} ${m.first_name}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [members, query]);

  const chosen = members.find((m) => m.id === memberId);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!memberId) {
      setError("Choisis ton nom dans la liste.");
      return;
    }
    if (code.length !== 4) {
      setError("Tape les 4 derniers chiffres de ton numéro de téléphone.");
      return;
    }

    setLoading(true);
    // Active la voix pendant le clic (nécessaire sur iPhone/Safari).
    try {
      const warm = new SpeechSynthesisUtterance(" ");
      warm.volume = 0;
      window.speechSynthesis.speak(warm);
    } catch {
      /* ignore */
    }
    try {
      const { data, error: rpcError } = await supabase.rpc("checkin", {
        p_token: token,
        p_member_id: memberId,
        p_code: code,
      });

      if (rpcError) {
        setError("Erreur technique : " + rpcError.message);
        return;
      }

      const result = data as { ok: boolean; message: string };
      if (result.ok) {
        setDone(result.message);
        if (chosen) {
          speak(`${chosen.first_name} ${chosen.last_name}. Présence enregistrée.`);
        }
      } else {
        setError(result.message);
        setCode("");
      }
    } catch {
      setError("Connexion impossible. Vérifie ton réseau et réessaie.");
    } finally {
      setLoading(false);
    }
  }

  const dateText = info?.start
    ? new Date(info.start).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "";

  return (
    <div className="login-screen">
      <div className="login-card">
        <img className="login-logo" src="/logo.png" alt="Conseil UGB" />
        <h1>Pointage de présence</h1>
        <OrgHeader />

        {booting && <p role="status">Chargement…</p>}

        {!booting && info && !info.found && (
          <div className="error-box" role="alert">QR code invalide ou expiré.</div>
        )}

        {!booting && info?.found && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, textAlign: "center" }}>{info.name}</h2>
            <p style={{ margin: "0 0 8px" }}>{dateText}</p>
          </>
        )}

        {!booting && info?.found && info.state && info.state !== "ok" && (
          <div className="error-box" role="alert">{CLOSED_MESSAGE[info.state]}</div>
        )}

        {done && (
          <div style={{ textAlign: "center", marginTop: 18 }} role="status">
            <CheckCircle2 size={56} color="#18794e" />
            <p style={{ margin: "10px 0 0", fontWeight: 700, color: "#18794e", fontSize: 18 }}>{done}</p>
          </div>
        )}

        {!booting && !done && info?.found && info.state === "ok" && (
          <form onSubmit={submit}>
            {!chosen ? (
              <>
                <label htmlFor="member-search">Ton nom</label>
                <div className="input-icon">
                  <Search size={18} />
                  <input
                    id="member-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Écris ton prénom ou ton nom"
                    autoComplete="off"
                  />
                </div>

                {matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="secondary full"
                    style={{ marginTop: 8, justifyContent: "flex-start" }}
                    onClick={() => {
                      setMemberId(m.id);
                      setError("");
                    }}
                  >
                    {m.last_name} {m.first_name}
                  </button>
                ))}

                {query.trim() && !matches.length && (
                  <p style={{ margin: "12px 0 0" }}>Aucun nom trouvé. Vérifie l'orthographe.</p>
                )}
              </>
            ) : (
              <>
                <p style={{ margin: "18px 0 0", fontWeight: 700, color: "#172033" }}>
                  {chosen.last_name} {chosen.first_name}
                </p>
                <button
                  type="button"
                  className="forgot-password"
                  style={{ justifyContent: "flex-start", margin: "0 0 4px", padding: 0 }}
                  onClick={() => {
                    setMemberId("");
                    setCode("");
                    setError("");
                  }}
                >
                  Ce n'est pas moi
                </button>

                <label htmlFor="member-code">4 derniers chiffres de ton téléphone</label>
                <input
                  id="member-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="0000"
                  style={{ fontSize: 22, letterSpacing: 8, textAlign: "center" }}
                />

                <button type="submit" className="primary full" disabled={loading}>
                  {loading ? "Enregistrement…" : "Je suis présent"}
                </button>
              </>
            )}

            {error && <div className="error-box" role="alert">{error}</div>}
          </form>
        )}

        {!done && error && (!info?.found || info.state !== "ok") && (
          <div className="error-box" role="alert">{error}</div>
        )}
        <Footer />
      </div>
    </div>
  );
}