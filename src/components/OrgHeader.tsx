import { useBranding } from "../lib/branding";

// Nom de l'organisation + les trois lignes (section, conseil, comité).
// À placer sous le titre des pages de connexion, de mot de passe et de pointage.
export default function OrgHeader() {
  const b = useBranding();
  const lines = [b.section, b.conseil, b.comite].filter((line) => line.length > 0);

  return (
    <>
      <p style={{ margin: "8px 0 6px" }}>{b.organization_name}</p>
      {lines.length > 0 && (
        <div style={{ textAlign: "center", margin: "0 0 6px", fontSize: 13, fontWeight: 600, lineHeight: 1.65, color: "var(--brand)" }}>
          {lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </>
  );
}