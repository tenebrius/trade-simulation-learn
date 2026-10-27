// Plain-language explanations built only from engine traces, so the words always match the numbers.

import type { Engine } from "../engine/engine";
import type { PriceTrace, Term } from "../engine/types";
import { coins, num, pct } from "./format";

/** Terms sorted by size, with the smallest folded into "other" (Simple and Detailed depth). */
export function topTerms(terms: Term[], n = 3): Term[] {
  const sorted = [...terms].filter((t) => Math.abs(t.value) > 1e-6).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (sorted.length <= n + 1) return sorted;
  const rest = sorted.slice(n);
  const other = rest.reduce((a, t) => a + t.value, 0);
  return [...sorted.slice(0, n), { key: "other", label: `${rest.length} smaller terms`, value: other, formula: rest.map((t) => t.label).join(", ") }];
}

const PUSH: Record<string, string> = {
  p: "the shortage right now",
  d1: "the stock trend",
  i: "a shortage that has lasted a while",
  l2g: "the gap to the realm-wide price",
  liq: "low cash",
  disp: "spending more than it earns",
  cheap: "buying being cheaper than making it",
  over: "paying more than the good is worth locally",
  new: "the new-port bonus",
  sub: "the subsidy",
  under: "selling below what the good is worth here",
};

const SELLPUSH: Record<string, string> = {
  p: "the surplus in storage",
  d1: "stock still piling up",
  l2g: "being dearer than the realm-wide price",
  liq: "needing cash",
  under: "not wanting to sell below value",
  new: "the new-port bonus",
};

export function priceWhy(e: Engine, ci: number, g: number): string {
  const st = e.s.cities[ci].storage[g];
  const t = st.trace;
  if (!t) return "";
  const city = e.s.cities[ci].name;
  const good = e.goods[g].name.toLowerCase();
  const dict = t.side === "buy" ? PUSH : SELLPUSH;
  const sorted = [...t.terms].sort((a, b) => b.value - a.value);
  const up = sorted[0];
  const down = [...t.terms].sort((a, b) => a.value - b.value)[0];
  const moving = t.after - t.before;
  const dir = Math.abs(moving) < 1e-4 * t.before ? "holding steady" : moving > 0 ? "rising" : "falling";
  if (t.side === "buy") {
    const short = t.desired - t.amount;
    const lead = `${city} wants ${t.desired} ${good} and has ${t.amount}, so it is buying (${short} short).`;
    const push = up && up.value > 0.01 ? ` Its eagerness comes mostly from ${dict[up.key] ?? up.label}` : " It is barely eager";
    const brake = down && down.value < -0.01 ? `, held back by ${dict[down.key] ?? down.label}.` : ".";
    return `${lead}${push}${brake} The price it offers is ${dir}${t.clamped ? " and sits at the edge of its band" : ""}.`;
  }
  const extra = t.amount - t.desired;
  const lead =
    extra > 0
      ? `${city} has ${t.amount} ${good}, ${extra} more than the ${t.desired} it wants, so it is selling.`
      : `${city} is exactly at its ${t.desired} ${good} target, so it offers what comes in.`;
  const push = up && up.value > 0.01 ? ` It is keen to sell because of ${dict[up.key] ?? up.label}` : " It is in no hurry to sell";
  const brake = down && down.value < -0.01 ? `, held back by ${dict[down.key] ?? down.label}.` : ".";
  return `${lead}${push}${brake} Its asking price is ${dir}.`;
}

export function bandSentence(t: PriceTrace): string {
  const [lo, hi] = t.side === "buy" ? t.buyBand : t.sellBand;
  return t.side === "buy"
    ? `Priority ${num(t.priority)} puts the target at ${pct(t.priority)} of the way from ${coins(lo)} to ${coins(hi)}: ${coins(t.target)}.`
    : `Priority ${num(t.priority)} puts the target at ${pct(t.priority)} of the way down from ${coins(hi)} to ${coins(lo)}: ${coins(t.target)}.`;
}

export interface ChainStep {
  title: string;
  text: string;
  state: "ok" | "active" | "blocked";
  jump?: { kind: "price"; city: number; good: number } | { kind: "wagon"; id: number } | { kind: "city"; city: number };
}

/** The causal chain behind one shortage: stock -> priority -> price -> route score -> wagons. */
export function shortageChain(e: Engine, ci: number, g: number): ChainStep[] {
  const s = e.s;
  const c = s.cities[ci];
  const st = c.storage[g];
  const t = st.trace;
  const good = e.goods[g].name.toLowerCase();
  const steps: ChainStep[] = [];
  if (!t) return steps;
  const desired = t.desired;
  const short = desired - st.amount;
  steps.push({
    title: "1 · Stock below target",
    text:
      short > 0
        ? `${c.name} holds ${st.amount} of the ${desired} ${good} it wants: ${short} short.`
        : `${c.name} holds ${st.amount} ${good}, at or above its ${desired} target: no shortage.`,
    state: short > 0 ? "active" : "ok",
    jump: { kind: "price", city: ci, good: g },
  });
  if (short <= 0) return steps;
  steps.push({
    title: "2 · Priority rises",
    text: `The port adds up its reasons to buy: ${t.terms
      .filter((x) => Math.abs(x.value) > 0.01)
      .map((x) => `${x.label} ${x.value > 0 ? "+" : "−"}${Math.abs(x.value).toFixed(2)}`)
      .join(", ")}. Clamped, that is a priority of ${num(t.priority)}.`,
    state: "active",
    jump: { kind: "price", city: ci, good: g },
  });
  steps.push({
    title: "3 · Buy price follows",
    text: `${bandSentence(t)} The price moves at most ~1% a second toward it: now ${coins(st.buy)}.`,
    state: "active",
    jump: { kind: "price", city: ci, good: g },
  });
  // which sources could supply it, and is the margin worth a trip?
  const sources: { src: number; qty: number; margin: number }[] = [];
  s.cities.forEach((_, src) => {
    if (src === ci) return;
    const o = e.transportOrders(src, ci).find((x) => x.good === g);
    if (o) sources.push({ src, qty: o.amount, margin: o.buy - o.sell });
  });
  sources.sort((a, b) => b.margin - a.margin);
  steps.push({
    title: "4 · A route becomes worth it",
    text: sources.length
      ? `${sources
          .slice(0, 3)
          .map((x) => `${s.cities[x.src].name} can spare ${x.qty} at a margin of ${coins(x.margin)} each`)
          .join("; ")}. Wagons score each route by margin minus haulage, per minute.`
      : `No other port has spare ${good} that it sells for less than ${c.name} offers. The price keeps climbing until one does, or until a producer makes more.`,
    state: sources.length ? "active" : "blocked",
  });
  const wagons = s.traders.filter((tr) => tr.home === ci);
  const carrying = wagons.filter((tr) => tr.cargo.some((cg) => cg.good === g) || tr.route?.load.some((l) => l.good === g));
  steps.push({
    title: "5 · Wagons go and fetch",
    text: carrying.length
      ? `${carrying.length} of ${c.name}'s ${wagons.length} wagons ${carrying.length === 1 ? "is" : "are"} bringing ${good}${st.reservedIn ? ` (${st.reservedIn} units on the way)` : ""}.`
      : `None of ${c.name}'s ${wagons.length} wagons is on it yet: ${
          wagons.filter((w) => w.task !== "idle").length
        } are busy with other routes and the rest found nothing that scores higher.`,
    state: carrying.length ? "active" : "blocked",
    jump: carrying[0] ? { kind: "wagon", id: carrying[0].id } : { kind: "city", city: ci },
  });
  steps.push({
    title: "6 · Stock refills, price relaxes",
    text: `As stock climbs back toward ${desired}, the shortage term shrinks and the price eases back toward the realm-wide ${coins(t.global)}.`,
    state: "ok",
  });
  return steps;
}
