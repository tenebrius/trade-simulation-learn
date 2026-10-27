import * as K from "../../engine/constants";
import { DepthOnly, Eq, Link, Section, SidePill, StockBar } from "../bits";
import { Chart } from "../chart";
import { coins, num, pct, signed } from "../format";
import { useStore } from "../store";

const STATE_TEXT = {
  running: "working",
  inputs: "waiting for inputs",
  full: "output full",
  noworkers: "no workers",
  off: "shut down",
} as const;

const TASK_TEXT = {
  idle: "at home",
  to_source: "going to buy",
  to_dest: "bringing goods home",
  unloading: "waiting to unload",
} as const;

export function CityInspect({ city: ci }: { city: number }) {
  const s = useStore();
  const e = s.engine;
  const c = e.s.cities[ci];
  const def = e.sc.cities[ci];
  const hist = e.s.history;
  const shortages = e.needGoods.filter((g) => c.storage[g].amount < c.storage[g].max * c.storage[g].desiredFill * 0.4);
  const m = c.migration;
  const hf = Math.max(0, (c.happiness - K.CRITICAL_HAPPINESS) / (1 - K.CRITICAL_HAPPINESS));
  const wagons = e.s.traders.filter((t) => t.home === ci);
  return (
    <div class="inspect">
      <h2 class="title city-title">
        <i class="swatch" style={{ background: `var(--c${ci % 7})` }} />
        {c.name}
      </h2>
      {def.blurb && <p class="why">{def.blurb}</p>}
      <div class="kv-row">
        <div class="kv">
          <span class="k">People</span>
          <span class="v num">
            {c.residents}/{c.capacity}
          </span>
        </div>
        <div class="kv">
          <span class="k">Happiness</span>
          <span class="v num">{num(c.happiness)}</span>
        </div>
        <div class="kv">
          <span class="k">Cash</span>
          <span class="v num gold">{coins(c.cash)}</span>
        </div>
        <div class="kv">
          <span class="k">Tax</span>
          <span class="v num">{pct(c.tax)}</span>
        </div>
      </div>

      {shortages.length > 0 && (
        <div class="alert">
          Running low on{" "}
          {shortages.map((g, i) => (
            <span key={g}>
              {i > 0 && ", "}
              <Link onClick={() => s.select({ kind: "price", city: ci, good: g })}>
                {e.goods[g].icon} {e.goods[g].name.toLowerCase()} ({c.storage[g].amount})
              </Link>
            </span>
          ))}
          . Tap one to see why and what is being done about it.
        </div>
      )}

      <Section title="Port: what it buys and sells">
        <ul class="stock-list">
          {c.storage.map((st, g) => {
            const t = st.trace;
            const side = t?.side ?? "sell";
            return (
              <li key={g}>
                <button type="button" class="row-btn" onClick={() => s.select({ kind: "price", city: ci, good: g })}>
                  <span class="good-cell">
                    <span aria-hidden="true">{e.goods[g].icon}</span> {e.goods[g].name}
                  </span>
                  <StockBar amount={st.amount} max={st.max} desired={t?.desired ?? 50} incoming={st.reservedIn} />
                  <span class="num amt">{st.amount}</span>
                  <SidePill side={side} />
                  <span class="num price">{coins((side === "buy" ? st.buy : st.sell) / (s.real ? e.s.seedValue : 1))}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p class="small muted">Bar: stock out of 100; the tick is the 50% target; striped = on the way.</p>
      </Section>

      <Section title="Happiness and migration">
        <ul class="parts">
          {c.happinessParts.map((p, i) => (
            <li key={i}>
              <span>{p.label}</span>
              <span class={`num ${p.value < 0 ? "neg" : ""}`}>{i === 0 ? num(p.value) : signed(p.value)}</span>
            </li>
          ))}
          <li class="total">
            <span>Target (clamped 0…1)</span>
            <span class="num">{num(c.target)}</span>
          </li>
        </ul>
        <p class="small">
          Happiness drifts toward the target slowly (at most 1% of the gap a second), so it is {num(c.happiness)} now.{" "}
          {m.direction === "in"
            ? `It beats how full the houses are (${pct(m.occupancy)}), so people move in: each empty home has a ${pct(m.rate)} chance a second.`
            : m.direction === "out"
              ? `It is below how full the houses are (${pct(m.occupancy)}), so people leave: each resident has a ${pct(m.rate)} chance a second.`
              : `Happiness and occupancy (${pct(m.occupancy)}) are in balance: nobody moves.`}
        </p>
        <DepthOnly min={3}>
          <Eq>
            h = clamp(happiness / {K.CRITICAL_HAPPINESS}) = {num(m.h)}; occupancy f = {num(m.occupancy)};{" "}
            {m.direction === "in" ? `rate = (h − f)/(1 − f) × ${K.MAX_MOVE_PROB}` : m.direction === "out" ? `rate = (f − h)/f × ${K.MAX_MOVE_PROB}` : "no move"} ={" "}
            {num(m.rate, 4)}/s
          </Eq>
        </DepthOnly>
      </Section>

      <Section title="Residents pay the coins">
        <p class="small">
          Every {K.PAY_INTERVAL} s each resident pays into the city. Happier people pay a bonus. This is the only way new coins enter the economy. Last payment:{" "}
          <b class="gold">{coins(c.lastPay)} c</b>; {coins(c.minted)} c in total.
        </p>
        <DepthOnly min={3}>
          <Eq>
            pay = {K.PAY_INTERVAL} s × {c.residents} × ({K.BASE_PAY} + {num(hf)} × {K.BONUS_PAY}), where {num(hf)} = (happiness − {K.CRITICAL_HAPPINESS}) / (1 − {K.CRITICAL_HAPPINESS})
          </Eq>
        </DepthOnly>
      </Section>

      <Section title="Workshops">
        <ul class="buildings">
          {c.buildings.map((b, bi) => {
            const r = e.recipeOf[b.good]!;
            return (
              <li key={bi} class={b.state}>
                <span class="bname">
                  {e.goods[b.good].icon} {r.name}
                </span>
                <span class="small muted">
                  {Object.entries(r.inputs)
                    .map(([g, q]) => `${q} ${g}`)
                    .join(" + ") || "labour"}{" "}
                  → {r.out} {e.goods[b.good].name.toLowerCase()} / {r.seconds} s
                </span>
                <span class="progress">
                  <span style={{ width: `${Math.min(100, b.progress * 100)}%` }} />
                </span>
                <span class={`state ${b.state}`}>
                  {STATE_TEXT[b.state]} · {b.workers}/{K.WORKERS_PER_BUILDING} workers
                </span>
                <button type="button" class="btn tiny ghost" onClick={() => (e.toggleBuilding(ci, bi), s.emit())}>
                  {b.enabled ? "Shut" : "Reopen"}
                </button>
              </li>
            );
          })}
        </ul>
        <p class="small muted">
          {c.employed} of {c.residents} people have work. A workshop runs at the share of its {K.WORKERS_PER_BUILDING} posts that are filled.
        </p>
      </Section>

      <Section title={`Wagons (${wagons.length})`}>
        <ul class="wagons">
          {wagons.map((w) => (
            <li key={w.id}>
              <button type="button" class="row-btn" onClick={() => s.select({ kind: "wagon", id: w.id })}>
                <span>Wagon {w.id + 1}</span>
                <span class="muted small">
                  {TASK_TEXT[w.task]}
                  {w.route && w.task !== "idle" ? ` · ${e.s.cities[w.route.src].name}` : ""}
                </span>
                <span>{(w.cargo.length ? w.cargo : w.task === "to_source" ? (w.route?.load ?? []) : []).map((l) => e.goods[l.good].icon).join("")}</span>
              </button>
            </li>
          ))}
        </ul>
        <div class="btn-row">
          <button type="button" class="btn ghost" onClick={() => (e.addBuyer(ci), s.emit())}>
            Add a wagon
          </button>
          <button type="button" class="btn ghost" onClick={() => (e.removeBuyer(ci), s.emit())} disabled={!wagons.some((w) => w.task === "idle")}>
            Retire an idle wagon
          </button>
        </div>
      </Section>

      <Section title="Treasury and cash flow" open={s.depth >= 2}>
        <p class="small">
          Income {coins(c.incomeRate)} c/s, spending {coins(c.spendRate)} c/s.{" "}
          {Number.isFinite(c.liquidityTime) && c.liquidityTime < 1e6
            ? `At this rate the cash lasts ${Math.round(c.liquidityTime)} s.`
            : "It is spending almost nothing."}{" "}
          {c.liquidity > 0
            ? `That is under the ${K.CRIT_LIQ_TIME} s safety window, so every buy price is pushed down by ${num(K.REM_LIQ_W * c.liquidity)}.`
            : `That is beyond the ${K.CRIT_LIQ_TIME} s safety window: no cash worries.`}
        </p>
        {e.quirks && (
          <p class="small note">
            Reference engine: these "rates" are 60-second sums, as in ltt_sim.py, so the cash looks ~60× shorter-lived than it is.
          </p>
        )}
        <Chart
          t={hist.map((h) => h.t)}
          series={[{ values: hist.map((h) => h.cash[ci]), label: "cash", cls: "s-gold" }]}
          fmt={(v) => coins(v)}
          height={80}
          summary={`Cash ${coins(hist[0]?.cash[ci] ?? c.cash)} → ${coins(c.cash)}.`}
        />
        <label class="slider">
          <span>
            Port tax <b class="num">{pct(c.tax)}</b>
          </span>
          <input
            id={`tax-${ci}`}
            type="range"
            min="0"
            max="0.5"
            step="0.05"
            value={c.tax}
            onChange={(ev) => (e.setTax(ci, Number((ev.target as HTMLInputElement).value)), s.emit())}
          />
        </label>
        <p class="small muted">Tax goes to the crown and leaves the economy. It is paid on both sales and imports at this port.</p>
        <button type="button" class="btn ghost" onClick={() => (e.giftCash(ci, 5000), s.emit())}>
          Gift {c.name} 5,000 coins
        </button>
      </Section>
    </div>
  );
}
