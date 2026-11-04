import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Branding = {
  organization_name: string;
  section: string;
  conseil: string;
  comite: string;
  logo_url: string;
};

// Valeurs affichées tant que la base n'a pas répondu (ou si branding.sql n'a pas été lancé)
export const DEFAULT_BRANDING: Branding = {
  organization_name: "Moustarchidine Junior",
  section: "Commission Administrative",
  conseil: "Conseil UGB",
  comite: "Comité INTER-UNIVERSITAIRE",
  logo_url: "",
};

type Raw = Partial<Record<keyof Branding, string | null>>;

// null / absent  -> valeur par défaut ; texte vide -> ligne volontairement masquée
const pick = (value: string | null | undefined, fallback: string) =>
  value === null || value === undefined ? fallback : value.trim();

function merge(raw: Raw): Branding {
  return {
    organization_name: pick(raw.organization_name, DEFAULT_BRANDING.organization_name) || DEFAULT_BRANDING.organization_name,
    section: pick(raw.section, DEFAULT_BRANDING.section),
    conseil: pick(raw.conseil, DEFAULT_BRANDING.conseil),
    comite: pick(raw.comite, DEFAULT_BRANDING.comite),
    logo_url: pick(raw.logo_url, ""),
  };
}

let current: Branding = DEFAULT_BRANDING;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<(b: Branding) => void>();

export function refreshBranding(): Promise<void> {
  if (!inflight) {
    inflight = (async () => {
      const { data, error } = await supabase.rpc("public_branding");
      if (!error && data) current = merge(data as Raw);
      loaded = true;
      listeners.forEach((listener) => listener(current));
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(current);

  useEffect(() => {
    listeners.add(setBranding);
    if (loaded) setBranding(current);
    else void refreshBranding();
    return () => {
      listeners.delete(setBranding);
    };
  }, []);

  return branding;
}