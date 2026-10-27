import { useEffect, useRef } from "preact/hooks";
import { clock } from "./format";
import { MapView } from "./map";
import { CityInspect } from "./panels/city";
import { Economy } from "./panels/economy";
import { Feed } from "./panels/feed";
import { Learn } from "./panels/learn";
import { Market } from "./panels/market";
import { PriceInspect } from "./panels/price";
import { WagonInspect } from "./panels/wagon";
import { type Depth, type SheetSize, type Tab, store, useStore } from "./store";

const TABS: [Tab, string, string][] = [
  ["feed", "Feed", "≡"],
  ["market", "Market", "⚖"],
  ["inspect", "Inspect", "◎"],
  ["economy", "Economy", "¤"],
  ["learn", "Learn", "?"],
];

const DEPTHS: [Depth, string][] = [
  [1, "Simple"],
  [2, "Detailed"],
  [3, "Maths"],
];

const ORDER: SheetSize[] = ["peek", "half", "full"];

function Inspect() {
  const s = useStore();
  const sel = s.selection;
  if (!sel)
    return (
      <div class="empty-inspect">
        <p>Tap a town or a wagon on the map, or a price anywhere, to see how it works.</p>
        <div class="btn-row">
          {s.engine.s.cities.slice(0, 4).map((c, ci) => (
            <button key={ci} type="button" class="chip" onClick={() => s.select({ kind: "city", city: ci })}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
    );
  if (sel.kind === "city") return <CityInspect city={sel.city} />;
  if (sel.kind === "wagon") return <WagonInspect id={sel.id} />;
  return <PriceInspect city={sel.city} good={sel.good} />;
}

function Controls() {
  const s = useStore();
  const learnRun = s.runningUntil !== null;
  return (
    <div class="controls" role="group" aria-label="Time controls">
      <button type="button" class="ctl" onClick={() => s.cycleSpeed()} aria-label={`Speed ${s.speed} times; tap to change`} disabled={learnRun}>
        <span class="num">{s.speed}×</span>
      </button>
      <button type="button" class="ctl" onClick={() => s.advance(1)} aria-label="Step one second" disabled={s.running}>
        <span aria-hidden="true">⏭</span>
      </button>
      <button type="button" class="ctl play" onClick={() => s.setRunning(!s.running)} aria-label={s.running ? "Pause" : "Play"}>
        <span aria-hidden="true">{s.running ? "❚❚" : "▶"}</span>
      </button>
    </div>
  );
}

export function App() {
  const s = useStore();
  const e = s.engine;
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [s.tab, s.selection?.kind, s.selection && "city" in s.selection ? s.selection.city : 0, s.selection?.kind === "wagon" ? s.selection.id : 0]);

  const grow = (dir: 1 | -1) => {
    const i = ORDER.indexOf(s.sheet);
    s.set("sheet", ORDER[Math.max(0, Math.min(ORDER.length - 1, i + dir))]);
  };

  return (
    <div class={`app sheet-${s.sheet}`}>
      <header class="top">
        <div class="brand">
          <span class="brand-name">Let Them Trade</span>
          <span class="brand-sub">economy, opened up</span>
        </div>
        <div class="clock num" aria-label="Simulated time">
          {clock(e.s.t)}
        </div>
        <div class="seg" role="radiogroup" aria-label="How much detail">
          {DEPTHS.map(([d, label]) => (
            <button key={d} type="button" role="radio" aria-checked={s.depth === d} class={s.depth === d ? "on" : ""} onClick={() => s.set("depth", d)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      <main class="stage">
        <MapView />
        <Controls />
      </main>
      <aside class="sheet" aria-label="Panels">
        <button
          type="button"
          class="handle"
          aria-label={`Panel size: ${s.sheet}. Tap to resize.`}
          onPointerDown={(ev) => {
            drag.current = { y: ev.clientY, moved: false };
            (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
          }}
          onPointerUp={(ev) => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            const dy = ev.clientY - d.y;
            if (dy < -30) grow(1);
            else if (dy > 30) grow(-1);
            else s.set("sheet", s.sheet === "full" ? "half" : s.sheet === "half" ? "full" : "half");
          }}
        >
          <span />
        </button>
        <nav class="tabs" role="tablist">
          {TABS.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={s.tab === id}
              class={s.tab === id ? "on" : ""}
              onClick={() => {
                s.tab = id;
                if (s.sheet === "peek") s.sheet = "half";
                s.emit();
              }}
            >
              <span class="tab-icon" aria-hidden="true">
                {icon}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div class="sheet-body" ref={bodyRef}>
          {s.tab === "feed" && <Feed />}
          {s.tab === "market" && <Market />}
          {s.tab === "inspect" && <Inspect />}
          {s.tab === "economy" && <Economy />}
          {s.tab === "learn" && <Learn />}
        </div>
      </aside>
    </div>
  );
}

export { store };
