import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import jsQR from "jsqr";
import { AlertTriangle, Camera, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";

type Act = { id: string; name: string; start_datetime: string; status: string };
type Kind = "ok" | "already" | "error";
type Result = { kind: Kind; name?: string; message: string; activity?: string; at: Date };

const PREFIX = "MJM:";
const STYLE: Record<Kind, { bg: string; border: string; color: string }> = {
  ok: { bg: "#e5f5ec", border: "#abefc6", color: "#067647" },
  already: { bg: "#fff8e6", border: "#f5d78a", color: "#8a5a00" },
  error: { bg: "#fef3f2", border: "#fecdca", color: "#b42318" },
};

const VOICE_KEY = "mj_scan_voice";

/** Lit le texte à haute voix avec la voix française de l'appareil. */
function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 0.95;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("fr"));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  } catch {
    /* lecture vocale non disponible sur cet appareil */
  }
}

function feedback(success: boolean) {
  try {
    navigator.vibrate?.(success ? 80 : [60, 40, 60]);
  } catch {
    /* vibration non disponible */
  }
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = success ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    setTimeout(() => void ctx.close(), 300);
  } catch {
    /* son non disponible */
  }
}

export default function Scan() {
  const [acts, setActs] = useState<Act[]>([]);
  const [activityId, setActivityId] = useState("");
  const [running, setRunning] = useState(false);
  const [camError, setCamError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [voiceOn, setVoiceOn] = useState(() => {
    try {
      return localStorage.getItem(VOICE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const lastTickRef = useRef(0);
  const busyRef = useRef(false);
  const lastScanRef = useRef({ token: "", at: 0 });
  const activityRef = useRef("");
  activityRef.current = activityId;
  const actsRef = useRef<Act[]>([]);
  actsRef.current = acts;

  // Activités proposées : de hier à dans 48 h, hors activités annulées
  useEffect(() => {
    const from = new Date(Date.now() - 12 * 3600e3).toISOString();
    const to = new Date(Date.now() + 48 * 3600e3).toISOString();
    supabase
      .from("activities")
      .select("id,name,start_datetime,status")
      .neq("status", "annulée")
      .gte("start_datetime", from)
      .lte("start_datetime", to)
      .order("start_datetime")
      .then(({ data }) => {
        const list = (data as Act[]) || [];
        setActs(list);
        const now = Date.now();
        const current = [...list].reverse().find((a) => new Date(a.start_datetime).getTime() <= now + 30 * 60e3) || list[0];
        if (current) setActivityId(current.id);
      });
  }, []);

  const refreshCount = useCallback(async (id: string) => {
    const { count: total } = await supabase
      .from("attendance")
      .select("member_id", { count: "exact", head: true })
      .eq("activity_id", id)
      .eq("status", "Présent");
    setCount(total ?? 0);
  }, []);

  useEffect(() => {
    if (activityId) void refreshCount(activityId);
    else setCount(null);
  }, [activityId, refreshCount]);

  const push = useCallback((kind: Kind, message: string, name?: string) => {
    const activity = actsRef.current.find((a) => a.id === activityRef.current)?.name;
    setResults((prev) => [{ kind, message, name, activity, at: new Date() }, ...prev].slice(0, 8));
  }, []);

  const handleToken = useCallback(
    async (token: string) => {
      const now = Date.now();
      if (busyRef.current) return;
      if (lastScanRef.current.token === token && now - lastScanRef.current.at < 4000) return;
      lastScanRef.current = { token, at: now };

      const id = activityRef.current;
      if (!id) {
        push("error", "Choisissez d'abord l'activité.");
        feedback(false);
        return;
      }

      busyRef.current = true;
      const { data, error } = await supabase.rpc("checkin_by_card", { p_activity_id: id, p_token: token });
      busyRef.current = false;

      if (error) {
        push("error", error.message);
        feedback(false);
        if (voiceRef.current) speak("Erreur. Réessayez.");
        return;
      }
      const r = data as { ok: boolean; already?: boolean; name?: string; message: string };
      push(r.ok ? (r.already ? "already" : "ok") : "error", r.message, r.name);
      feedback(r.ok && !r.already);
      if (voiceRef.current) {
        if (r.ok && !r.already) speak(`${r.name}, présent`);
        else if (r.ok) speak(`${r.name}, déjà pointé`);
        else speak(r.name ? `${r.name}. ${r.message}` : r.message);
      }
      if (r.ok && !r.already) void refreshCount(id);
    },
    [push, refreshCount]
  );

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const now = performance.now();

    if (video && canvas && now - lastTickRef.current > 120 && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
      lastTickRef.current = now;
      const scale = Math.min(1, 640 / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
        if (code && code.data.startsWith(PREFIX)) void handleToken(code.data.slice(PREFIX.length));
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [handleToken]);

  async function start() {
    setCamError("");
    if (voiceRef.current) speak("Scanner prêt");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();
      setRunning(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCamError(
        "Impossible d'utiliser la caméra. Autorisez l'accès à la caméra dans le navigateur (le site doit être ouvert en https)."
      );
    }
  }

  useEffect(() => stop, [stop]);

  const current = results[0];
  const dateText = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PageHeader title="Scanner l'entrée" description="Scannez la carte de membre pour marquer la présence." />

      <div className="panel">
        <label>
          Activité
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            {!acts.length && <option value="">Aucune activité entre hier et dans 48 h</option>}
            {acts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {dateText(a.start_datetime)}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={voiceOn}
              onChange={(e) => {
                setVoiceOn(e.target.checked);
                try {
                  localStorage.setItem(VOICE_KEY, e.target.checked ? "on" : "off");
                } catch {
                  /* réglage non mémorisé */
                }
              }}
              style={{ width: 20, height: 20, padding: 0 }}
            />
            Lire le nom à haute voix
          </label>
          <button type="button" className="secondary" style={{ minHeight: 36, padding: "6px 12px" }} onClick={() => speak("Awa Diop, présent")}>
            Tester la voix
          </button>
        </div>
        {count !== null && (
          <p style={{ margin: "12px 0 0", fontWeight: 700 }}>
            Présents pour cette activité : <span style={{ color: "#18794e", fontSize: 20 }}>{count}</span>
          </p>
        )}
      </div>

      <div className="panel">
        <div style={{ position: "relative", maxWidth: 520, margin: "0 auto" }}>
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 16, background: "#000", display: "block" }}
          />
          {running && (
            <div
              style={{
                position: "absolute", inset: "16%", border: "3px solid rgba(255,255,255,.9)",
                borderRadius: 18, boxShadow: "0 0 0 9999px rgba(0,0,0,.25)", pointerEvents: "none",
              }}
            />
          )}
          {!running && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <button type="button" className="primary" onClick={start} disabled={!activityId}>
                <Camera size={18} /> Démarrer la caméra
              </button>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {running && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button type="button" className="secondary" onClick={stop}>Arrêter la caméra</button>
          </div>
        )}
        {camError && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{camError}</div>}

        {current && (
          <div
            role="status"
            style={{
              marginTop: 16, padding: "16px 18px", borderRadius: 14, textAlign: "center",
              background: STYLE[current.kind].bg, border: `1px solid ${STYLE[current.kind].border}`, color: STYLE[current.kind].color,
            }}
          >
            {current.kind === "ok" && <CheckCircle2 size={44} />}
            {current.kind === "already" && <AlertTriangle size={44} />}
            {current.kind === "error" && <XCircle size={44} />}
            {current.name && <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{current.name}</div>}
            {current.kind === "ok" && (
              <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: ".08em", marginTop: 2 }}>PRÉSENT</div>
            )}
            {current.kind === "already" && (
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: ".06em", marginTop: 2 }}>DÉJÀ POINTÉ</div>
            )}
            {current.kind === "error" && <div style={{ fontWeight: 700, marginTop: 2 }}>{current.message}</div>}
            {current.kind !== "error" && current.activity && (
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, opacity: 0.85 }}>{current.activity}</div>
            )}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="panel">
          <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>Derniers scans</h2>
          {results.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: i ? "1px solid #f3ece8" : 0 }}>
              <span style={{ color: STYLE[r.kind].color, fontWeight: 700 }}>
                {r.kind === "ok" ? "✓" : r.kind === "already" ? "•" : "✗"} {r.name ? `${r.name} — ${r.kind === "ok" ? "présent" : r.kind === "already" ? "déjà pointé" : r.message}` : r.message}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>{r.at.toLocaleTimeString("fr-FR")}</span>
            </div>
          ))}
        </div>
      )}

      <p className="muted">
        Un membre dont la carte ne se scanne pas peut être marqué à la main dans <Link to="/attendance">Présences</Link>.
      </p>
    </>
  );
}