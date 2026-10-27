import { useState } from "preact/hooks";
import type { EventKind } from "../../engine/types";
import { clock } from "../format";
import { useStore } from "../store";
import { Receipt } from "./wagon";

const ICON: Record<EventKind, string> = {
  trip: "⇄",
  empty: "∅",
  shortage: "!",
  restocked: "✓",
  price: "↕",
  migration: "⌂",
  blocked: "■",
  broke: "¢",
  lost: "✕",
  player: "★",
  seed: "∿",
  info: "i",
};

export function Feed() {
  const s = useStore();
  const e = s.engine;
  const [level, setLevel] = useState<1 | 2 | 3>(2);
  const [onlySel, setOnlySel] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const selCity = s.selection?.kind === "city" || s.selection?.kind === "price" ? s.selection.city : null;
  const list = e.s.events
    .filter((ev) => ev.sig <= level && (!onlySel || selCity === null || ev.city === selCity))
    .slice(-120)
    .reverse();
  return (
    <div class="feed">
      <div class="chips" role="group" aria-label="How much to show">
        {(
          [
            [1, "Headlines"],
            [2, "Notable"],
            [3, "Everything"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" class={`chip${level === v ? " on" : ""}`} aria-pressed={level === v} onClick={() => setLevel(v)}>
            {label}
          </button>
        ))}
        {selCity !== null && (
          <button type="button" class={`chip${onlySel ? " on" : ""}`} aria-pressed={onlySel} onClick={() => setOnlySel(!onlySel)}>
            Only {e.s.cities[selCity].name}
          </button>
        )}
      </div>
      {list.length === 0 && (
        <p class="muted empty">{e.s.t === 0 ? "Nothing has happened yet. Press play: events appear here as the economy moves." : "No events at this level yet."}</p>
      )}
      <ul class="events">
        {list.map((ev) => (
          <li key={ev.id} class={`ev k-${ev.kind} sig${ev.sig}`}>
            <button
              type="button"
              class="ev-btn"
              aria-expanded={ev.receipt ? open === ev.id : undefined}
              onClick={() => {
                if (ev.receipt) setOpen(open === ev.id ? null : ev.id);
                else if (ev.city !== undefined && ev.good !== undefined) s.select({ kind: "price", city: ev.city, good: ev.good });
                else if (ev.city !== undefined) s.select({ kind: "city", city: ev.city });
              }}
            >
              <span class="ev-icon" aria-hidden="true">
                {ICON[ev.kind]}
              </span>
              <span class="ev-text">
                {ev.text}
                {ev.count > 1 && <span class="count"> ×{ev.count}</span>}
              </span>
              <span class="ev-time num">{clock(ev.t)}</span>
            </button>
            {ev.receipt && open === ev.id && (
              <div class="ev-detail">
                <Receipt r={ev.receipt} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
