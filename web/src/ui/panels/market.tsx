import { SidePill, StockBar } from "../bits";
import { Spark } from "../chart";
import { coins, num, signed } from "../format";
import { useStore } from "../store";
import { Term } from "../term";

export function Market() {
  const s = useStore();
  const e = s.engine;
  const g = s.marketGood ?? e.needGoods[0] ?? 0;
  const setG = (i: number) => s.set("marketGood", i);
  const good = e.goods[Math.min(g, e.goods.length - 1)];
  const gi = e.goods.indexOf(good);
  const div = s.real ? e.s.seedValue : 1;
  const hist = e.s.history.slice(-72); // last 6 minutes
  const pinned = s.pinned?.state;
  const drift = e.s.global?.drift[gi];
  return (
    <div class="market">
      <div class="chips scroll" role="tablist" aria-label="Good">
        {e.goods.map((x, i) => (
          <button key={x.id} type="button" role="tab" class={`chip${i === gi ? " on" : ""}`} aria-selected={i === gi} onClick={() => setG(i)}>
            <span aria-hidden="true">{x.icon}</span> {x.name}
          </button>
        ))}
      </div>
      <div class="kv-row">
        <div class="kv">
          <span class="k">
            <Term id="realm-price">Realm-wide</Term>
          </span>
          <span class="v num">{coins(e.s.glob[gi] / div)}</span>
        </div>
        <div class="kv">
          <span class="k">
            <Term id="cost-to-make">Cost to make</Term>
          </span>
          <span class="v num">{coins(e.s.theo[gi] / div)}</span>
        </div>
        <div class="kv">
          <span class="k">
            <Term id="stock">In stock</Term>
          </span>
          <span class="v num">{e.s.global?.volume[gi] ?? 0}</span>
        </div>
        <div class="kv">
          <span class="k">
            <Term id="shortage">Wanted</Term>
          </span>
          <span class="v num">{e.s.global?.orders[gi].volume ?? 0}</span>
        </div>
      </div>
      {drift && s.depth >= 2 && (
        <p class="small">
          The realm-wide price moved {signed((drift.after - drift.before) / div, 4)} this tick: {signed(drift.meanPull / div, 4)} toward what ports bid,{" "}
          {signed(drift.theoPull / div, 4)} toward the cost to make it, {signed(drift.money / div, 4)} from the money supply.
        </p>
      )}
      <div class="btn-row">
        <label class="toggle inline">
          <input id="real-prices" type="checkbox" checked={s.real} onChange={() => s.set("real", !s.real)} />
          <Term id="real-prices">Real prices</Term> (÷ <Term id="labour-seed">labour seed</Term>)
        </label>
        <button type="button" class="btn tiny ghost" onClick={() => s.pin()}>
          {pinned ? "Re-pin now" : "Pin “before”"}
        </button>
        {pinned && (
          <button type="button" class="btn tiny ghost" onClick={() => s.set("pinned", null)}>
            Unpin
          </button>
        )}
      </div>
      {pinned && <p class="small muted">Δ columns compare with the pin taken at {Math.round(s.pinned!.t)} s.</p>}
      <ul class="mkt">
        {e.s.cities.map((c, ci) => {
          const st = c.storage[gi];
          const side = st.trace?.side ?? "sell";
          const price = (side === "buy" ? st.buy : st.sell) / div;
          const ps = pinned?.cities[ci].storage[gi];
          const pPrice = ps ? ((ps.trace?.side ?? "sell") === "buy" ? ps.buy : ps.sell) / (s.real ? pinned!.seedValue : 1) : 0;
          return (
            <li key={ci}>
              <button type="button" class="row-btn mkt-row" onClick={() => s.select({ kind: "price", city: ci, good: gi })}>
                <span class="mkt-city">
                  <i class="swatch" style={{ background: `var(--c${ci % 7})` }} />
                  {c.name}
                </span>
                <SidePill side={side} />
                <span class="num price">{coins(price)}</span>
                <Spark values={hist.map((h) => h.price[ci][gi] / (s.real ? h.seed : 1))} cls={side === "buy" ? "s-buy" : "s-sell"} />
                <span class="mkt-stock">
                  <StockBar amount={st.amount} max={st.max} desired={st.trace?.desired ?? 50} incoming={st.reservedIn} />
                  <span class="num small">{st.amount}</span>
                </span>
                {ps && (
                  <span class="delta small num">
                    {signed(price - pPrice)} c · {st.amount - ps.amount >= 0 ? "+" : "−"}
                    {Math.abs(st.amount - ps.amount)} u
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p class="small muted">
        Blue rows are buying: they post a price they are willing to pay. Amber rows are selling. A wagon takes a route only if the buyer's price beats the seller's by
        more than the haulage. Labour seed now {num(e.s.seedValue)}.
      </p>
    </div>
  );
}
