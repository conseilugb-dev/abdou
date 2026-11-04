// Adresse publique du site : elle sert à fabriquer les liens (carte de membre, QR).
// Depuis « localhost » ou un réseau local, on utilise l'adresse en ligne, car un
// lien « localhost » ne s'ouvre pas sur le téléphone des membres.
export const PUBLIC_SITE_URL = "https://conseil-ugb-presence.netlify.app";

export function siteUrl(): string {
  const host = window.location.hostname;
  const local = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  return local ? PUBLIC_SITE_URL : window.location.origin;
}





// Devise affichée dans le pied de page (police Fraunces, en italique).
// Remplace-la par la devise ou l'invocation de la commission ; mets "" pour la masquer.
export const MOTTO = "Noppi ,tey, maañu ";
