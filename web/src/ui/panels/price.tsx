import { useState } from "preact/hooks";
import * as K from "../../engine/constants";
import { Chart } from "../chart";
import { DepthOnly, Eq, GoodName, Link, Section, SidePill, StockBar, TermBars } from "../bits";
import { bandSentence, priceWhy, shortageChain, topTerms } from "../explain";
import { coins, num, pct } from "../format";
import { store, useStore } from "../store";

/** Horizontal number line: sell band, buy band, global, theoretical, price and target. */
function BandStrip({ t }: { t: NonNullable<ReturnType<typeof getTrace>> }) {
  const lo = Math.min(t.sellBand[0], t.global, t.theo, t.after) * 0.92;
  const hiRaw = Math.max(t.buyBand[1], t.global, t.theo, t.after);
  const hi = Math.min(hiRaw, Math.max(t.sellBand[1], t.buyBand[0], t.global, t.after, t.target) * 1.6) * 1.04; // construction goods: x10 band, clipped
  const x = (v: number) => `${Math.max(0, Math.min(100, (100 * (v - lo)) / (hi - lo)))}%`;
  const w = (a: number, b: number) => `${Math.max(0, Math.min(100, (100 * (b - a)) / (hi - lo)))}%`;
  const price = t.after;
  return (
    <div class="band" role="img" aria-label={`Sell band ${coins(t.sellBand[0])} to ${coins(t.sellBand[1])}, buy band ${coins(t.buyBand[0])} to ${coins(t.buyBand[1])}, price ${coins(price)}, target ${coins(t.target)}`}>
      <div class="lane sell">
        <span class="lane-label">sell band</span>
        <div class={`range${t.side === "sell" ? " active" : ""}`} style={{ left: x(t.sellBand[0]), width: w(t.sellBand[0], t.sellBand[1]) }} />
      </div>
      <div class="lane buy">
        <span class="lane-label">buy band{hiRaw > hi ? " (continues)" : ""}</span>
        <div class={`range${t.side === "buy" ? " active" : ""}`} style={{ left: x(t.buyBand[0]), width: w(t.buyBand[0], Math.min(t.buyBand[1], hi)) }} />
      </div>
      <div class="marks">
        <span class="mk global" style={{ left: x(t.global) }} title="realm-wide price">
          G
        </span>
        <span class="mk theo" style={{ left: x(t.theo) }} title="cost of production">
          T
        </span>
        <span class="mk target" style={{ left: x(t.target) }} title="target" />
        <span class={`mk price ${t.side}`} style={{ left: x(price) }} title="price" />
      </div>
      <div class="band-legend small">
        <span>
          <i class={`mk-i price ${t.side}`} /> price {coins(price)}
        </span>
        <span>
          <i class="mk-i target" /> target {coins(t.target)}
        </span>
        <span>G realm-wide {coins(t.global)}</span>
        <span>T cost to make {coins(t.theo)}</span>
      </div>
    </div>
  );
}

const getTrace = (ci: number, g: number) => store.engine.s.cities[ci].storage[g].trace;

export function PriceInspect({ city: ci, good: g }: { city: number; good: number }) {
  const s = useStore();
  const e = s.engine;
  const c = e.s.cities[ci];
  const st = c.storage[g];
  const t = st.trace;
  const [chain, setChain] = useState(false);
  if (!t) return <p class="muted">Press play or step once: the port prices its goods on the first tick.</p>;
  const real = s.real ? e.s.seedValue : 1;
  const terms = s.depth >= 3 ? t.terms : topTerms(t.terms, 3);
  const hist = e.s.history;
  const [lo, hi] = t.side === "buy" ? t.buyBand : t.sellBand;
  return (
    <div class="inspect">
      <div class="crumbs">
        <Link onClick={() => s.select({ kind: "city", city: ci })}>← {c.name}</Link>
      </div>
      <h2 class="title">
        <GoodName g={g} /> <span class="muted">in</span> {c.name} <SidePill side={t.side} />
      </h2>
      <p class="why">{priceWhy(e, ci, g)}</p>

      <div class="kv-row">
        <div class="kv">
          <span class="k">{t.side === "buy" ? "Offers" : "Asks"}</span>
          <span class="v num">{coins((t.side === "buy" ? st.buy : st.sell) / real)}</span>
        </div>
        <div class="kv">
          <span class="k">Realm-wide</span>
          <span class="v num">{coins(t.global / real)}</span>
        </div>
        <div class="kv">
          <span class="k">Priority</span>
          <span class="v num">{num(t.priority)}</span>
        </div>
        <div class="kv">
          <span class="k">Stock</span>
          <span class="v num">
            {st.amount}/{t.desired}
          </span>
        </div>
      </div>
      {s.real && <p class="small muted">Real prices: coins ÷ labour seed {num(e.s.seedValue)}, i.e. in units of labour.</p>}

      <Section title="Stock vs target">
        <StockBar amount={st.amount} max={st.max} desired={t.desired} incoming={st.reservedIn} />
        <p class="small">
          The port aims to keep its storage {pct(st.desiredFill)} full: {t.desired} of {st.max}.{" "}
          {t.side === "buy"
            ? `Below that it buys; the shortfall is ${pct(t.rel)} of the target.`
            : `Above that it sells; the surplus is ${pct(t.rel)} of the room above the target.`}
          {st.reservedIn > 0 && ` ${st.reservedIn} more are on the way in wagons.`}
          {st.reservedOut > 0 && ` Wagons have claimed ${st.reservedOut} of the surplus.`}
        </p>
        {t.side === "buy" && st.amount < t.desired && (
          <>
            <button type="button" class="btn ghost" onClick={() => setChain(!chain)}>
              {chain ? "Hide the chain" : "Why is it short, and what happens next?"}
            </button>
            {chain && <Chain ci={ci} g={g} />}
          </>
        )}
      </Section>

      <Section title="Priority: how eager the port is">
        <p class="small">
          Each tick the port adds up reasons to {t.side === "buy" ? "pay more" : "sell cheaper"}. The sum, clamped to {t.side === "buy" ? "0.0001…1" : "0…1"}, is
          its priority.
        </p>
        <TermBars terms={terms} showFormula={s.depth >= 3} />
        <p class="sum num small">
          sum {num(t.raw)} → priority <b>{num(t.priority)}</b>
        </p>
      </Section>

      <DepthOnly min={2}>
        <Section title="Band: where the price may go">
          <BandStrip t={t} />
          <p class="small">
            Bands are built around the realm-wide price M = {coins(t.mean)}. Buying runs from 0.7 M to 1.5 M, selling from 0.5 M to 1.3 M, so buyers pay a bit more than
            sellers ask on average: that gap pays for the wagons. {bandSentence(t)}
          </p>
        </Section>
      </DepthOnly>

      <DepthOnly min={3}>
        <Section title="The maths, with this tick's numbers">
          <div class="eqs">
            <Eq>
              {t.side === "buy"
                ? `band = [${num(1 - K.MAX_DEV + K.BUY_SELL_SHIFT, 1)}·M, max(${num(1 + K.MAX_DEV + K.BUY_SELL_SHIFT, 1)}·M, T)${e.construction[g] ? " ×10 (construction)" : ""}] = [${coins(lo)}, ${coins(hi)}]`
                : `band = [${num(1 - K.MAX_DEV - K.BUY_SELL_SHIFT, 1)}·M, ${num(1 + K.MAX_DEV - K.BUY_SELL_SHIFT, 1)}·M] = [${coins(lo)}, ${coins(hi)}]`}
            </Eq>
            <Eq>
              {t.side === "buy"
                ? `target = ${coins(lo)} + (${coins(hi)} − ${coins(lo)}) × ${num(t.priority, 3)} = ${coins(t.target)}`
                : `target = ${coins(hi)} − (${coins(hi)} − ${coins(lo)}) × ${num(t.priority, 3)} = ${coins(t.target)}`}
            </Eq>
            <Eq>
              urgency = min(0.5, 0.1·√|Δ/p|) = {num(t.urgency, 3)}; cap = p × {t.subsidised ? "4" : "1"}%/s × (1 + urgency) = {num(t.stepCap, 3)}
            </Eq>
            <Eq>
              step = clamp(target − p, ±cap) = {num(t.step, 3)}; smoothed over 6 s → {num(t.smooth, 3)}
            </Eq>
            <Eq>
              price {coins(t.before)} → {coins(t.after)}
              {t.clamped ? " (held at the band edge)" : ""}
            </Eq>
          </div>
        </Section>
      </DepthOnly>

      <Section title="History" open={s.depth >= 2}>
        <Chart
          t={hist.map((h) => h.t)}
          series={[
            { values: hist.map((h) => h.price[ci][g] / (s.real ? h.seed : 1)), label: `${c.name} price`, cls: t.side === "buy" ? "s-buy" : "s-sell" },
            { values: hist.map((h) => h.glob[g] / (s.real ? h.seed : 1)), label: "realm-wide", cls: "s-muted", dashed: true },
          ]}
          fmt={(v) => coins(v)}
          summary={`${e.goods[g].name} in ${c.name}: ${coins(hist[0]?.price[ci][g] ?? 0)} → ${coins(t.after)} over the last ${Math.round((hist.length * 5) / 60)} minutes.`}
        />
        <Chart
          t={hist.map((h) => h.t)}
          series={[{ values: hist.map((h) => h.stock[ci][g]), label: "stock", cls: "s-stock" }]}
          height={70}
          fmt={(v) => v.toFixed(0)}
          mark={t.desired}
          markLabel="target"
          summary={`Stock now ${st.amount}, target ${t.desired}.`}
        />
      </Section>

      <Section title="Your levers" open={false}>
        <label class="toggle">
          <input id={`sub-${ci}-${g}`} type="checkbox" checked={st.subsidy} onChange={() => (e.setSubsidy(ci, g, !st.subsidy), s.emit())} />
          Subsidise {e.goods[g].name.toLowerCase()} in {c.name}: +{K.SUBSIDY_W} buy priority, price may move 4%/s.
        </label>
        <button type="button" class="btn ghost" onClick={() => (e.loseStock(ci, g, 0.8), s.emit())}>
          Fire: destroy 80% of the stock
        </button>
      </Section>
    </div>
  );
}

function Chain({ ci, g }: { ci: number; g: number }) {
  const s = useStore();
  const steps = shortageChain(s.engine, ci, g);
  return (
    <ol class="chain">
      {steps.map((st, i) => (
        <li key={i} class={st.state}>
          <b>{st.title}</b>
          <span>{st.text}</span>
          {st.jump && st.jump.kind === "wagon" && (
            <Link onClick={() => s.select(st.jump as { kind: "wagon"; id: number })}>Follow that wagon →</Link>
          )}
        </li>
      ))}
    </ol>
  );
}
