import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Term } from "../engine/types";
import { signed } from "./format";
import { store } from "./store";

export function SidePill({ side }: { side: "buy" | "sell" }) {
  return <span class={`pill ${side}`}>{side === "buy" ? "buying" : "selling"}</span>;
}

/** Stock bar: fill, the target line, and units on the way. */
export function StockBar({ amount, max, desired, incoming = 0 }: { amount: number; max: number; desired: number; incoming?: number }) {
  return (
    <div class="stockbar" role="img" aria-label={`${amount} of ${max} in stock, target ${desired}${incoming ? `, ${incoming} on the way` : ""}`}>
      <div class="fill" style={{ width: `${(100 * amount) / max}%` }} />
      {incoming > 0 && <div class="incoming" style={{ left: `${(100 * amount) / max}%`, width: `${(100 * Math.min(incoming, max - amount)) / max}%` }} />}
      <div class="target" style={{ left: `${(100 * desired) / max}%` }} />
    </div>
  );
}

/** Signed term bars around a zero line. */
export function TermBars({ terms, showFormula }: { terms: Term[]; showFormula: boolean }) {
  const span = Math.max(0.25, ...terms.map((t) => Math.abs(t.value)));
  return (
    <ul class="terms">
      {terms.map((t) => (
        <li key={t.key}>
          <span class="tlabel">{t.label}</span>
          <span class="tbar">
            <span class="zero" />
            <span
              class={`bar ${t.value >= 0 ? "pos" : "neg"}`}
              style={
                t.value >= 0
                  ? { left: "50%", width: `${(50 * Math.abs(t.value)) / span}%` }
                  : { right: "50%", width: `${(50 * Math.abs(t.value)) / span}%` }
              }
            />
          </span>
          <span class="tval num">{signed(t.value)}</span>
          {showFormula && <span class="tformula">{t.formula}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Section({ title, children, aside, open = true }: { title: string; children: ComponentChildren; aside?: ComponentChildren; open?: boolean }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <section class="sec">
      <header>
        <button type="button" class="sec-toggle" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
          <span class="chev" aria-hidden="true">
            {isOpen ? "▾" : "▸"}
          </span>
          <h3>{title}</h3>
        </button>
        {aside}
      </header>
      {isOpen && <div class="sec-body">{children}</div>}
    </section>
  );
}

/** A formula line: monospace, wraps inside its own box. */
export function Eq({ children }: { children: ComponentChildren }) {
  return <code class="eq">{children}</code>;
}

export function GoodName({ g }: { g: number }) {
  const good = store.engine.goods[g];
  return (
    <span class="good">
      <span aria-hidden="true">{good.icon}</span> {good.name}
    </span>
  );
}

export function Link({ onClick, children }: { onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="link" onClick={onClick}>
      {children}
    </button>
  );
}

export function DepthOnly({ min, children }: { min: 1 | 2 | 3; children: ComponentChildren }) {
  return store.depth >= min ? <>{children}</> : null;
}
