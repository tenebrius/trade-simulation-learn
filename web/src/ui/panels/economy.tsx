import * as K from "../../engine/constants";
import { DepthOnly, Eq, Section } from "../bits";
import { Chart } from "../chart";
import { coins, num, pct } from "../format";
import { SCENARIOS, store, useStore } from "../store";
import { Term } from "../term";

export function Economy() {
  const s = useStore();
  const e = s.engine;
  const g = e.s.global;
  const hist = e.s.history;
  const l = e.s.ledger;
  const circ = e.circulating();
  const target = g ? K.DESIRED_CASH_TO_GOODS * g.goodsValue : 0;
  return (
    <div class="economy">
      <Section title="Where coins come from and go">
        <div class="ledger">
          <div>
            <span class="k">At the start</span>
            <span class="num">{coins(l.start)}</span>
          </div>
          <div>
            <span class="k">
              + <Term id="pay">paid by residents</Term>
            </span>
            <span class="num pos">{coins(l.minted)}</span>
          </div>
          {l.gifts > 0 && (
            <div>
              <span class="k">+ your gifts</span>
              <span class="num pos">{coins(l.gifts)}</span>
            </div>
          )}
          <div>
            <span class="k">
              − <Term id="tax">taxes</Term> to the <Term id="crown">crown</Term>
            </span>
            <span class="num neg">{coins(l.taxed)}</span>
          </div>
          <div class="total">
            <span class="k">= in circulation</span>
            <span class="num gold">{coins(circ)}</span>
          </div>
        </div>
        <p class="small">
          Residents create coins; taxes remove them. Nothing else creates or destroys money, so the sum always balances (the engine checks this every tick; the two differ by{" "}
          {Math.abs(circ - e.expectedCirculating()) < 0.001 ? "less than 0.001 coin" : `${coins(Math.abs(circ - e.expectedCirculating()))} c`}, which is rounding).
        </p>
        <Chart
          t={hist.map((h) => h.t)}
          series={[
            { values: hist.map((h) => h.minted), label: "created", cls: "s-gold" },
            { values: hist.map((h) => h.taxed), label: "taxed away", cls: "s-sell", dashed: true },
          ]}
          fmt={(v) => coins(v)}
          summary={`Created ${coins(l.minted + l.gifts)} c, taxed ${coins(l.taxed)} c so far.`}
        />
      </Section>

      <Section title="Money vs goods: the money supply term">
        {g && (
          <>
            <div class="meter" role="img" aria-label={`Cities hold ${coins(g.cash)} coins; the target is ${coins(target)}`}>
              <div class="meter-bar">
                <span class="cash" style={{ width: `${Math.min(100, (50 * g.cash) / Math.max(1, target))}%` }} />
                <span class="meter-target" style={{ left: "50%" }} />
              </div>
              <div class="small meter-labels">
                <span>
                  cities' cash <b class="gold num">{coins(g.cash)}</b>
                </span>
                <span>
                  target 2 × goods value <b class="num">{coins(target)}</b>
                </span>
              </div>
            </div>
            <p class="small">
              The economy wants cities to hold twice the value of all goods in stock. They hold{" "}
              {g.cash > target ? `more (money_dev ${num(g.moneyDev)}), so every realm-wide price drifts up` : `less (money_dev ${num(g.moneyDev)}), so prices drift down`},
              fastest for goods that make up more of the stock.
            </p>
            <DepthOnly min={3}>
              <Eq>
                money_dev = (C − 2 × goods value) / C = ({coins(g.cash)} − {coins(target)}) / {coins(g.cash)} = {num(g.moneyDev, 3)}
              </Eq>
              <Eq>global += min(0.05, share) × global × dt × 0.05 × money_dev, every second, for each good</Eq>
            </DepthOnly>
          </>
        )}
      </Section>

      <Section title="The labour seed: what an hour of work is worth">
        {g && (
          <>
            <p class="small">
              Every good's <Term id="cost-to-make">cost to make</Term> is a recipe of labour, priced at one number, the <Term id="labour-seed">labour seed</Term>: now <b class="num">{num(e.s.seedValue, 3)}</b>. The seed steers
              itself so that cash ≈ 2 × the cost-value of the stock. Cash is {g.seedErr > 0 ? "above" : "below"} that, so the step was multiplied by{" "}
              <b class="num">{g.seedFactor === 1 ? "1" : g.seedFactor > 0 ? "1.1 (keep going)" : "−0.9 (turn around)"}</b>.
            </p>
            <Chart
              t={hist.map((h) => h.t)}
              series={[{ values: hist.map((h) => h.seed), label: "labour seed", cls: "s-accent" }]}
              fmt={(v) => num(v)}
              summary={`Labour seed ${num(hist[0]?.seed ?? e.s.seedValue)} → ${num(e.s.seedValue)}.`}
            />
            <DepthOnly min={3}>
              <Eq>
                error = C − 2 × cost-value = {coins(g.seedErr)}; step ×= {g.seedFactor === 1 ? "1" : g.seedFactor}; seed = {num(g.seedBefore, 4)} + {num(e.s.seedDelta, 4)} ={" "}
                {num(e.s.seedValue, 4)}
              </Eq>
              <Eq>cost(good) = (Σ input qty × cost(input) + labour × seed) / output, solved with at most 1% change per pass</Eq>
            </DepthOnly>
          </>
        )}
      </Section>

      <DepthOnly min={2}>
        <Section title="Realm-wide prices">
          <table class="tbl small">
            <thead>
              <tr>
                <th scope="col">Good</th>
                <th scope="col">Realm</th>
                <th scope="col">Cost</th>
                <th scope="col">Bids</th>
                <th scope="col">÷ seed</th>
              </tr>
            </thead>
            <tbody>
              {e.goods.map((x, i) => (
                <tr key={x.id}>
                  <td>
                    {x.icon} {x.name}
                  </td>
                  <td class="num">{coins(e.s.glob[i])}</td>
                  <td class="num">{coins(e.s.theo[i])}</td>
                  <td class="num">{g?.orders[i].volume ? coins(g.orders[i].mean) : "–"}</td>
                  <td class="num">{num(e.s.glob[i] / e.s.seedValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="small muted">
            Each second the realm price moves 1% of the way to what ports bid and 0.2% of the way to the cost to make it, plus the money term. Ports then price around
            it.
          </p>
        </Section>
      </DepthOnly>

      <Section title="World and settings" open={false}>
        <label class="field">
          <span>World</span>
          <select id="scenario" value={s.scenarioId} onChange={(ev) => store.reset((ev.target as HTMLSelectElement).value, s.seed)}>
            {SCENARIOS.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </label>
        <p class="small muted">{e.sc.blurb}</p>
        <label class="field">
          <span>Random seed</span>
          <input id="seed" type="number" min="1" value={s.seed} onChange={(ev) => store.reset(s.scenarioId, Math.max(1, Number((ev.target as HTMLInputElement).value) || 1))} />
        </label>
        <div class="btn-row">
          <button type="button" class="btn" onClick={() => store.reset()}>
            Restart this world
          </button>
        </div>
        <p class="small muted">
          Treasury (crown): {coins(e.s.treasury)} c. Tax rates: {e.s.cities.map((c) => `${c.name} ${pct(c.tax)}`).join(", ")}.
        </p>
      </Section>
    </div>
  );
}
