export const coins = (x: number) =>
  Math.abs(x) >= 10000 ? `${(x / 1000).toFixed(1)}k` : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2);

export const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "∞");

export const signed = (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function clock(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
}

export const ago = (now: number, t: number) => {
  const d = Math.max(0, Math.round(now - t));
  return d < 60 ? `${d}s ago` : d < 3600 ? `${Math.floor(d / 60)}m ago` : `${Math.floor(d / 3600)}h ago`;
};
