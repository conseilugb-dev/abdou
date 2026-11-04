// Rond coloré avec les initiales du membre (la couleur reste la même pour une même personne).
const PALETTE = [
  ["#f8e3de", "#8f3a31"], ["#fbebd3", "#9a5b14"], ["#e3f3ea", "#17613f"], ["#e2edfb", "#2556a3"],
  ["#ece6fa", "#5b3aa6"], ["#fbe4ee", "#a4306a"], ["#dff3f1", "#157a73"], ["#eceff6", "#44506b"],
];

const initials = (first: string, last: string) =>
  ((first.trim()[0] ?? "") + (last.trim()[0] ?? "")).toUpperCase() || "?";

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export default function Avatar({ first, last, size = 34 }: { first: string; last: string; size?: number }) {
  const [bg, fg] = PALETTE[hash(`${first} ${last}`.toLowerCase()) % PALETTE.length];
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-grid", placeItems: "center", flexShrink: 0, width: size, height: size, borderRadius: "50%",
        background: bg, color: fg, border: `1.5px solid ${fg}33`,
        fontSize: Math.round(size * 0.38), fontWeight: 800, letterSpacing: ".02em", verticalAlign: "middle",
      }}
    >
      {initials(first, last)}
    </span>
  );
}