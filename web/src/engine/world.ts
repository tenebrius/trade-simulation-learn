import type { Scenario } from "./scenario";

export type Pt = [number, number];

/** Distances and drawable paths between every pair of cities. Without roads, cities are joined by
 * straight lines (the Python behaviour); with roads, wagons take the shortest path. */
export interface World {
  dist: number[][];
  path: Pt[][][]; //  path[a][b] = polyline from city a to city b
  roads: Pt[][]; //   drawable road polylines
}

const seg = (a: Pt, b: Pt) => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));

export function polyLength(p: Pt[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += seg(p[i - 1], p[i]);
  return d;
}

export function buildWorld(sc: Scenario): World {
  const n = sc.cities.length;
  const pos = sc.cities.map((c) => c.pos as Pt);
  const dist: number[][] = [];
  const path: Pt[][][] = [];
  if (sc.roads.length === 0) {
    const roads: Pt[][] = [];
    for (let a = 0; a < n; a++) {
      dist.push([]);
      path.push([]);
      for (let b = 0; b < n; b++) {
        dist[a].push(seg(pos[a], pos[b]));
        path[a].push([pos[a], pos[b]]);
        if (a < b) roads.push([pos[a], pos[b]]);
      }
    }
    return { dist, path, roads };
  }
  // road graph: edge weight = polyline length; Dijkstra from every city (n is tiny)
  const edges: { a: number; b: number; pts: Pt[]; len: number }[] = sc.roads.map((r) => {
    const pts: Pt[] = [pos[r.a], ...(r.via ?? []), pos[r.b]];
    return { a: r.a, b: r.b, pts, len: polyLength(pts) };
  });
  for (let s = 0; s < n; s++) {
    const d = Array(n).fill(Infinity);
    const prev: ({ from: number; pts: Pt[] } | null)[] = Array(n).fill(null);
    const done = Array(n).fill(false);
    d[s] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const e of edges) {
        const v = e.a === u ? e.b : e.b === u ? e.a : -1;
        if (v < 0) continue;
        const pts = e.a === u ? e.pts : [...e.pts].reverse();
        if (d[u] + e.len < d[v]) {
          d[v] = d[u] + e.len;
          prev[v] = { from: u, pts };
        }
      }
    }
    dist.push(d);
    path.push(
      d.map((_, t) => {
        if (t === s) return [pos[s], pos[s]];
        const legs: Pt[][] = [];
        for (let v = t; v !== s && prev[v]; v = prev[v]!.from) legs.unshift(prev[v]!.pts);
        const out: Pt[] = [pos[s]];
        for (const l of legs) out.push(...l.slice(1));
        return out;
      }),
    );
  }
  return { dist, path, roads: edges.map((e) => e.pts) };
}

/** Point at fraction f (0..1) along a polyline. */
export function pointAt(p: Pt[], f: number): Pt {
  const total = polyLength(p);
  if (total === 0) return p[0];
  let left = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < p.length; i++) {
    const l = seg(p[i - 1], p[i]);
    if (left <= l) {
      const k = l === 0 ? 0 : left / l;
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k];
    }
    left -= l;
  }
  return p[p.length - 1];
}
