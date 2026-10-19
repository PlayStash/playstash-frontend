export const coverPalettes = [
  {
    bg: "var(--color-ps-panel-strong)",
    border: "var(--color-ps-line)",
  },
  {
    bg: "color-mix(in srgb, var(--color-ps-accent) 8%, var(--color-ps-panel))",
    border: "var(--color-ps-line)",
  },
  {
    bg: "var(--color-ps-panel-soft)",
    border: "var(--color-ps-line)",
  },
  {
    bg: "color-mix(in srgb, var(--color-ps-accent) 13%, var(--color-ps-shell))",
    border: "var(--color-ps-line)",
  },
] as const;

export function hashedPalette(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return coverPalettes[Math.abs(hash) % coverPalettes.length];
}
