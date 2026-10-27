/** Sum with Neumaier compensation, identical to CPython >= 3.12 `sum()` over floats.
 * The reference simulation relies on it, so the engine uses it wherever Python calls sum(). */
export function psum(xs: readonly number[]): number {
  let f = 0;
  let c = 0;
  for (const x of xs) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
