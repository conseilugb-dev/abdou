import { QRCodeSVG } from "qrcode.react";
import { useBranding } from "../lib/branding";

// Motif géométrique (étoile à 8 branches) très discret, répété en filigrane.
const PATTERN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' fill='none' stroke='#f3d9b1' stroke-width='1'>
     <rect x='16' y='16' width='32' height='32'/>
     <rect x='16' y='16' width='32' height='32' transform='rotate(45 32 32)'/>
     <circle cx='32' cy='32' r='6'/>
   </svg>`
)}")`;

// Carte de membre : fond rouge brique, bande dorée, nom en grand et QR personnel.
// Utilisée à la fois dans l'espace admin (Membres) et sur la page publique de la carte.
export default function MemberCardView({
  firstName,
  lastName,
  memberNumber,
  token,
  photoUrl,
}: {
  firstName: string;
  lastName: string;
  memberNumber: string;
  token: string;
  photoUrl?: string | null;
}) {
  const b = useBranding();
  const footer = [b.conseil, b.comite].filter((l) => l.length > 0).join(" · ");

  return (
    <div
      className="member-card"
      style={{
        position: "relative",
        width: "min(340px, 100%)",
        margin: "0 auto",
        borderRadius: 22,
        overflow: "hidden",
        color: "#fff",
        textAlign: "center",
        background: "linear-gradient(160deg, #a2443a 0%, #7f3129 58%, #5a1f19 100%)",
        boxShadow: "0 14px 34px rgba(90, 31, 25, .35)",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <div style={{ position: "absolute", inset: 0, backgroundImage: PATTERN, opacity: 0.12, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: "linear-gradient(90deg, #d9a066, #f3d9b1, #d9a066)" }} />

      <div style={{ position: "relative", padding: "26px 22px 18px" }}>
        <img
          src={b.logo_url || "/logo.png"}
          alt=""
          style={{ width: 62, height: 62, borderRadius: "50%", objectFit: "cover", border: "2px solid #f3d9b1", background: "#fff" }}
        />
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, letterSpacing: ".04em" }}>{b.organization_name}</div>
        <div style={{ marginTop: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: ".28em", color: "#f3d9b1" }}>CARTE DE MEMBRE</div>

        {photoUrl && (
          <img
            src={photoUrl}
            alt=""
            style={{ display: "block", margin: "16px auto 0", width: 96, height: 96, borderRadius: "50%", objectFit: "cover", border: "3px solid #f3d9b1", background: "#fff" }}
          />
        )}

        <div style={{ height: 1, margin: "16px auto", width: "70%", background: "linear-gradient(90deg, transparent, #d9a066, transparent)" }} />

        <div style={{ fontFamily: "var(--font-title)", fontSize: 26, fontWeight: 700, lineHeight: 1.15, wordBreak: "break-word" }}>
          {firstName}
          <br />
          {lastName}
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: 10,
            padding: "3px 14px",
            borderRadius: 999,
            background: "rgba(243, 217, 177, .16)",
            border: "1px solid rgba(243, 217, 177, .55)",
            color: "#f3d9b1",
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: ".1em",
          }}
        >
          {memberNumber}
        </div>

        <div style={{ margin: "18px auto 4px", background: "#fff", padding: 12, borderRadius: 16, display: "inline-block", boxShadow: "0 4px 14px rgba(0,0,0,.25)" }}>
          <QRCodeSVG value={`MJM:${token}`} size={190} level="M" />
        </div>
      </div>

      {footer && (
        <div style={{ position: "relative", padding: "9px 14px", background: "linear-gradient(90deg, #d9a066, #f3d9b1, #d9a066)", color: "#4a1a14", fontSize: 11, fontWeight: 800, letterSpacing: ".05em" }}>
          {footer}
        </div>
      )}
    </div>
  );
}