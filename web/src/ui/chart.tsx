// Small hand-drawn SVG line charts. One scale places every mark; text colours come from tokens.

export interface Series {
  values: number[];
  label: string;
  cls?: string; //   CSS class giving the stroke colour
  dashed?: boolean;
}

interface Props {
  series: Series[];
  t?: number[]; //    x values (seconds); index if absent
  height?: number;
  fmt?: (v: number) => string;
  summary: string; // text alternative, also shown under the chart
  zero?: boolean; //  include 0 on the y axis
  mark?: number; //   a horizontal reference line
  markLabel?: string;
}

const W = 320;

export function Chart({ series, t, height = 96, fmt = (v) => v.toFixed(1), summary, zero, mark, markLabel }: Props) {
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (mark !== undefined) all.push(mark);
  if (zero) all.push(0);
  if (!all.length || series.every((s) => s.values.length < 2)) return <p class="muted small">{summary}</p>;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const n = Math.max(...series.map((s) => s.values.length));
  const L = 34; //    left gutter for labels
  const T = 6;
  const B = 14;
  const H = height;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - 6);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const span = t && t.length > 1 ? t[t.length - 1] - t[0] : 0;
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {[hi - pad, (hi + lo) / 2, lo + pad].map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - 4} y1={y(v)} y2={y(v)} class="grid" />
            <text x={L - 4} y={y(v) + 3} class="axis" text-anchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {mark !== undefined && (
          <g>
            <line x1={L} x2={W - 4} y1={y(mark)} y2={y(mark)} class="mark" />
            {markLabel && (
              <text x={W - 6} y={y(mark) - 3} class="axis" text-anchor="end">
                {markLabel}
              </text>
            )}
          </g>
        )}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          const last = s.values.length - 1;
          return (
            <g key={si} class={s.cls ?? "s-accent"}>
              {series.length === 1 && (
                <polygon points={`${x(0)},${H - B} ${pts} ${x(last)},${H - B}`} class="area" />
              )}
              <polyline points={pts} class={`line${s.dashed ? " dashed" : ""}`} />
              <circle cx={x(last)} cy={y(s.values[last])} r="2.6" class="end" />
            </g>
          );
        })}
        {span > 0 && (
          <>
            <text x={L} y={H - 2} class="axis">
              −{Math.round(span / 60)} min
            </text>
            <text x={W - 6} y={H - 2} class="axis" text-anchor="end">
              now
            </text>
          </>
        )}
      </svg>
      {series.length > 1 && (
        <figcaption class="chart-legend">
          {series.map((s, i) => (
            <span key={i} class={s.cls}>
              <i class={s.dashed ? "dashed" : ""} />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

export function Spark({ values, cls }: { values: number[]; cls?: string }) {
  if (values.length < 2) return <svg class="spark" viewBox="0 0 60 18" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const r = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 58 + 1).toFixed(1)},${(16 - ((v - lo) / r) * 14).toFixed(1)}`).join(" ");
  return (
    <svg class={`spark ${cls ?? "s-accent"}`} viewBox="0 0 60 18" aria-hidden="true">
      <polyline points={pts} class="line" />
    </svg>
  );
}
