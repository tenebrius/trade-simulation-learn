// The animated map. Cities, roads and labels render through Preact at panel rate; wagons and trade
// pop-ups are moved straight in the DOM from the animation loop so motion stays smooth on phones.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Engine } from "../engine/engine";
import type { TraderState } from "../engine/types";
import { pointAt, type Pt } from "../engine/world";
import { coins } from "./format";
import { store, useStore } from "./store";

const MARGIN = 14;

export const cityRadius = (residents: number) => 2.6 + Math.sqrt(residents) * 0.42;

export function wagonPos(e: Engine, tr: TraderState, frac: number, slot: number): Pt {
  const cities = e.s.cities;
  if (tr.task === "to_source" || tr.task === "to_dest") {
    const moving = Math.max(0.001, tr.legTime - 2);
    const elapsed = tr.legTime - tr.eta + frac;
    const path = e.world.path[tr.from][tr.to];
    return pointAt(path, elapsed / moving);
  }
  // parked: fan out around the city so wagons don't stack
  const at = tr.task === "unloading" && tr.route ? tr.route.dst : tr.city;
  const c = cities[at];
  const r = cityRadius(c.residents) + 3.4;
  const a = -Math.PI * 0.85 + slot * 0.62; // fan along the upper-left rim, clear of the label below
  return [c.pos[0] + Math.cos(a) * r, c.pos[1] + Math.sin(a) * r];
}

function bounds(e: Engine) {
  const pts: Pt[] = [...e.s.cities.map((c) => c.pos as Pt), ...e.world.roads.flat()];
  for (const f of e.sc.features ?? []) if (f.kind !== "water") pts.push(f.pos);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - MARGIN;
  const y0 = Math.min(...ys) - MARGIN;
  return { x: x0, y: y0, w: Math.max(...xs) + MARGIN - x0, h: Math.max(...ys) + MARGIN + 4 - y0 };
}

type View = { x: number; y: number; w: number; h: number };

/** Worst need shortage: 0 = all needs stocked, 1 = a need has run out. */
function pressure(e: Engine, ci: number) {
  const c = e.s.cities[ci];
  let worst = 0;
  for (const g of e.needGoods) {
    const st = c.storage[g];
    const desired = st.max * st.desiredFill;
    worst = Math.max(worst, 1 - Math.min(1, st.amount / desired));
  }
  return worst;
}

export function MapView() {
  const s = useStore();
  const e = s.engine;
  const home = useMemo(() => bounds(e), [e]);
  const [view, setView] = useState<View>(home);
  const svgRef = useRef<SVGSVGElement>(null);
  const wagonLayer = useRef<SVGGElement>(null);
  const popLayer = useRef<SVGGElement>(null);
  const lastEvent = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; startView: View; startDist: number; mid: { x: number; y: number } } | null>(null);

  useEffect(() => setView(home), [home]);

  // animation: wagons and pop-ups
  useEffect(() => {
    lastEvent.current = store.engine.s.nextEventId;
    const hook = () => {
      const eng = store.engine;
      const layer = wagonLayer.current;
      if (!layer) return;
      const slots = new Map<number, number>();
      for (const tr of eng.s.traders) {
        const el = layer.querySelector<SVGGElement>(`[data-wagon="${tr.id}"]`);
        if (!el) continue;
        const key = tr.task === "unloading" && tr.route ? tr.route.dst : tr.city;
        const slot = slots.get(key) ?? 0;
        if (tr.task === "idle" || tr.task === "unloading") slots.set(key, slot + 1);
        const [x, y] = wagonPos(eng, tr, store.running ? store.frac : 0, slot);
        el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        el.classList.toggle("loaded", tr.cargo.length > 0);
        const glyph = el.querySelector("text");
        const g = tr.cargo[0]?.good ?? (tr.task === "to_source" ? tr.route?.load[0]?.good : undefined);
        if (glyph) glyph.textContent = g === undefined ? "" : eng.goods[g].icon;
      }
      // trade pop-ups for finished trips (sampled when running fast)
      const pops = popLayer.current;
      if (!pops) return;
      const fresh = eng.s.events.filter((ev) => ev.id >= lastEvent.current && (ev.kind === "trip" || ev.kind === "shortage"));
      lastEvent.current = eng.s.nextEventId;
      const budget = store.speed >= 16 ? 1 : store.speed >= 4 ? 2 : 4;
      for (const ev of fresh.slice(-budget)) {
        if (ev.city === undefined) continue;
        const c = eng.s.cities[ev.city];
        const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const n = pops.childElementCount;
        el.setAttribute("x", String(c.pos[0] + ((n % 3) - 1) * 6));
        el.setAttribute("y", String(c.pos[1] - cityRadius(c.residents) - 3 - (n % 2) * 3.5));
        el.setAttribute("class", `pop ${ev.kind}`);
        el.textContent =
          ev.kind === "trip" && ev.receipt
            ? ev.receipt.delivered
                .filter((d) => d.qty > 0)
                .map((d) => `+${d.qty}${eng.goods[d.good].icon}`)
                .join(" ")
            : `out of ${eng.goods[ev.good!].icon}`;
        pops.appendChild(el);
        setTimeout(() => el.remove(), 1600);
      }
    };
    store.frameHooks.add(hook);
    hook();
    return () => {
      store.frameHooks.delete(hook);
    };
  }, []);

  useEffect(() => {
    // after a re-render the wagon nodes are new; place them right away
    for (const h of store.frameHooks) h(store);
  });

  // ---- pan / pinch / wheel
  const toSvg = (cx: number, cy: number, v: View) => {
    const r = svgRef.current!.getBoundingClientRect();
    const scale = Math.max(v.w / r.width, v.h / r.height);
    const ox = (r.width * scale - v.w) / 2;
    const oy = (r.height * scale - v.h) / 2;
    return { x: v.x - ox + (cx - r.left) * scale, y: v.y - oy + (cy - r.top) * scale, scale };
  };

  const zoomAt = (v: View, cx: number, cy: number, k: number): View => {
    const p = toSvg(cx, cy, v);
    const w = Math.min(home.w * 1.6, Math.max(home.w / 5, v.w * k));
    const h = (w / v.w) * v.h;
    const kk = w / v.w;
    return { x: p.x - (p.x - v.x) * kk, y: p.y - (p.y - v.y) * kk, w, h };
  };

  const onDown = (ev: PointerEvent) => {
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const pts = [...pointers.current.values()];
    const d = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gesture.current = { moved: gesture.current?.moved ?? 0, startView: view, startDist: d, mid };
  };

  const onMove = (ev: PointerEvent) => {
    const g = gesture.current;
    const prev = pointers.current.get(ev.pointerId);
    if (!g || !prev) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      g.moved += Math.abs(dx) + Math.abs(dy);
      if (g.moved < 6) return;
      setView((v) => {
        const { scale } = toSvg(0, 0, v);
        return { ...v, x: v.x - dx * scale, y: v.y - dy * scale };
      });
    } else if (pts.length === 2 && g.startDist > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      g.moved += 10;
      setView(zoomAt(g.startView, g.mid.x, g.mid.y, g.startDist / d));
    }
  };

  const onUp = (ev: PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(ev.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (g && g.moved < 6) {
      // a tap: find what was hit
      const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as Element | null)?.closest("[data-hit]");
      const kind = hit?.getAttribute("data-hit");
      if (kind === "city") store.select({ kind: "city", city: Number(hit!.getAttribute("data-id")) });
      else if (kind === "wagon") store.select({ kind: "wagon", id: Number(hit!.getAttribute("data-id")) });
    }
  };

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    setView((v) => zoomAt(v, ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.0015)));
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const sel = s.selection;
  const selWagon = sel?.kind === "wagon" ? e.s.traders.find((t) => t.id === sel.id) : undefined;
  const selCity = sel?.kind === "city" || sel?.kind === "price" ? sel.city : -1;
  const routeLine = (() => {
    if (!selWagon?.route) return null;
    const { src, dst } = selWagon.route;
    const pts: Pt[] =
      selWagon.task === "to_source"
        ? [...e.world.path[selWagon.from][src], ...e.world.path[src][dst]]
        : selWagon.task === "to_dest"
          ? e.world.path[selWagon.from][dst]
          : [];
    return pts.length ? pts.map((p) => p.join(",")).join(" ") : null;
  })();

  const z = view.w / home.w; // < 1 when zoomed in
  const fs = Math.max(2.6, Math.min(4.2, 4 * Math.sqrt(z)));

  return (
    <div class="map-wrap">
      <svg
        ref={svgRef}
        class="map"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label={`Map of ${e.sc.name}: ${e.s.cities.length} towns and ${e.s.traders.length} wagons`}
      >
        <defs>
          <pattern id="grat" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" class="grat" />
          </pattern>
        </defs>
        <rect x={home.x - 200} y={home.y - 200} width={home.w + 400} height={home.h + 400} class="land" />
        <rect x={home.x - 200} y={home.y - 200} width={home.w + 400} height={home.h + 400} fill="url(#grat)" />
        {(e.sc.features ?? []).map((f, i) =>
          f.kind === "water" ? (
            <circle key={i} cx={f.pos[0]} cy={f.pos[1]} r={f.size ?? 20} class="water" />
          ) : f.kind === "mountain" ? (
            <path
              key={i}
              class="mountain"
              d={`M${f.pos[0] - (f.size ?? 6)} ${f.pos[1] + (f.size ?? 6) * 0.55} L${f.pos[0]} ${f.pos[1] - (f.size ?? 6) * 0.6} L${f.pos[0] + (f.size ?? 6)} ${f.pos[1] + (f.size ?? 6) * 0.55}`}
            />
          ) : (
            <text key={i} x={f.pos[0]} y={f.pos[1]} class="place" style={{ fontSize: `${fs * 0.8}px` }}>
              {f.text}
            </text>
          ),
        )}
        {e.world.roads.map((r, i) => (
          <polyline key={i} points={r.map((p) => p.join(",")).join(" ")} class={e.sc.roads.length ? "road" : "road straight"} />
        ))}
        {routeLine && <polyline points={routeLine} class="route-sel" />}
        {e.s.cities.map((c, ci) => {
          const r = cityRadius(c.residents);
          const p = pressure(e, ci);
          const state = p >= 0.999 ? "short" : p > 0.6 ? "strained" : "ok";
          return (
            <g key={ci} data-hit="city" data-id={ci} class={`city ${state}${selCity === ci ? " sel" : ""}`} transform={`translate(${c.pos[0]} ${c.pos[1]})`}>
              <circle r={r + 6} class="hit" />
              <circle r={r + 1.6} class="ring" />
              <circle r={r} class="town" style={{ fill: `var(--c${ci % 7})` }} />
              <text y={r + fs + 1.2} class="name" style={{ fontSize: `${fs}px` }}>
                {c.name}
              </text>
              <text y={r + fs * 2 + 1.4} class="cash" style={{ fontSize: `${fs * 0.72}px` }}>
                {coins(c.cash)} c · {c.residents} ppl
              </text>
            </g>
          );
        })}
        <g ref={wagonLayer}>
          {e.s.traders.map((tr) => (
            <g key={tr.id} data-wagon={tr.id} data-hit="wagon" data-id={tr.id} class={`wagon${selWagon?.id === tr.id ? " sel" : ""}`}>
              <circle r="4.2" class="hit" />
              <rect x="-2.3" y="-1.5" width="4.6" height="3" rx="0.8" style={{ fill: `var(--c${tr.home % 7})` }} />
              <text y="-2.4" class="glyph" />
            </g>
          ))}
        </g>
        <g ref={popLayer} class="pops" />
      </svg>
      <div class="map-tools">
        <button type="button" class="icon-btn" onClick={() => setView(home)} aria-label="Fit map to screen" title="Fit map">
          ⤢
        </button>
      </div>
      <div class="legend" aria-hidden="true">
        <span>
          <i class="dot ok" /> stocked
        </span>
        <span>
          <i class="dot strained" /> running low
        </span>
        <span>
          <i class="dot short" /> ran out
        </span>
      </div>
    </div>
  );
}
