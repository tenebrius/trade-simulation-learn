import * as K from "../../engine/constants";
import type { TripReceipt } from "../../engine/types";
import { DepthOnly, Eq, Link, Section } from "../bits";
import { coins, num } from "../format";
import { useStore } from "../store";
import { Term } from "../term";

export function WagonInspect({ id }: { id: number }) {
  const s = useStore();
  const e = s.engine;
  const tr = e.s.traders.find((t) => t.id === id);
  if (!tr) return <p class="muted">This wagon was retired.</p>;
  const home = e.s.cities[tr.home];
  const name = (i: number) => e.s.cities[i].name;
  const items = (l: { good: number; qty: number }[]) => l.map((x) => `${x.qty} ${e.goods[x.good].icon}`).join(" + ");
  const doing =
    tr.task === "idle"
      ? tr.plan?.outcome ?? "Waiting at home for a route worth driving."
      : tr.task === "to_source"
        ? `Driving to ${name(tr.route!.src)} to buy ${items(tr.route!.load)}. Arrives in ${Math.max(0, Math.round(tr.eta))} s.`
        : tr.task === "to_dest"
          ? `Bringing ${items(tr.cargo)} home to ${name(tr.route!.dst)}. Arrives in ${Math.max(0, Math.round(tr.eta))} s.`
          : `Waiting at ${name(tr.route!.dst)} for storage space to unload ${items(tr.cargo)}.`;
  const p = tr.plan;
  return (
    <div class="inspect">
      <div class="crumbs">
        <Link onClick={() => s.select({ kind: "city", city: tr.home })}>← {home.name}</Link>
      </div>
      <h2 class="title city-title">
        <i class="swatch wagon-swatch" style={{ background: `var(--c${tr.home % 7})` }} />
        {home.name}'s wagon {tr.id + 1}
      </h2>
      <p class="why">{doing}</p>
      <p class="small muted">
        City buyers belong to their town. They only ever fetch goods from other ports and bring them home, borrowing the purchase money from home and handing every
        coin back after each trip.
      </p>

      {p && (
        <Section title={`How it chose (at ${Math.round(p.t)} s)`}>
          <p class="small">
            For each port it could fetch from, the wagon fills its {e.sc.options.wagonCapacity} slots greedily with the goods that earn most (amount × <Term id="margin">margin</Term>),
            {e.quirks ? "" : <>
              {" "}
              subtracts <Term id="haulage">haulage</Term> ({e.sc.options.transportCost} c per unit of road)
            </>} and divides by the trip time to get a <Term id="route-score">route score</Term> per minute.
          </p>
          <p class="small">
            Then it draws a <Term id="noise">random bar</Term>: r = {num(p.r)}. A new route must beat {num(p.noise)} × the current route's score ({num(p.baseline)}).{" "}
            {p.noise > 1.05
              ? "This draw made it stubborn: it needs a clearly better route to switch."
              : p.noise < 0.95
                ? "This draw made it easy-going: almost any working route will do."
                : "This draw is close to 1: it takes the best route."}{" "}
            Random bars spread wagons over routes instead of all piling onto the single best one.
          </p>
          <ul class="cands">
            {p.candidates.map((c, i) => (
              <li key={i} class={i === p.chosen ? "chosen" : c.verdict.startsWith("below") ? "near" : ""}>
                <div class="cand-head">
                  <b>{name(c.src)}</b>
                  <span class="num score">{num(c.value)}/min</span>
                </div>
                <div class="small">{c.load.length ? items(c.load) : "nothing to buy"}</div>
                <DepthOnly min={2}>
                  <div class="small muted num">
                    margin {coins(c.profit)} − haulage {coins(c.transport)}, {Math.round(c.time)} s trip
                  </div>
                </DepthOnly>
                <div class="verdict small">{c.verdict}</div>
              </li>
            ))}
          </ul>
          <DepthOnly min={3}>
            <Eq>
              noise = 1 + sign(r) × {K.MAX_PROFIT_DEV} × r² = {num(p.noise, 3)}; score = (margin − haulage) / trip time × 60
            </Eq>
          </DepthOnly>
        </Section>
      )}

      {tr.lastTrip && (
        <Section title="Last trip: who paid whom">
          <Receipt r={tr.lastTrip} />
        </Section>
      )}
    </div>
  );
}

export function Receipt({ r }: { r: TripReceipt }) {
  const s = useStore();
  const e = s.engine;
  const src = e.s.cities[r.src].name;
  const dst = e.s.cities[r.dst].name;
  const bought = r.bought.reduce((a, b) => a + b.price * b.qty, 0);
  const srcTax = r.bought.reduce((a, b) => a + b.tax, 0);
  const toPort = r.bought.reduce((a, b) => a + b.toPort, 0);
  const impTax = r.delivered.reduce((a, d) => a + d.tax, 0);
  return (
    <div class="receipt">
      <ol class="flow small">
        <li>
          Borrowed <b class="gold">{coins(r.borrowed)} c</b> from {dst}.
        </li>
        {r.bought.map((b, i) => (
          <li key={i}>
            Bought {b.qty} {e.goods[b.good].icon} at {coins(b.price)} in {src}: {coins(b.toPort)} c to {src}'s port, {coins(b.tax)} c tax to the crown.
          </li>
        ))}
        {r.delivered.map((d, i) =>
          d.qty > 0 ? (
            <li key={i}>
              Delivered {d.qty} {e.goods[d.good].icon} to {dst}
              {e.quirks ? `, which paid ${coins(d.price)} each plus ${coins(d.tax / d.qty)} tax` : `: its own goods now, only the ${coins(d.tax)} c import tax is a real payment`}.
            </li>
          ) : null,
        )}
        {r.lost.length > 0 && (
          <li class="neg">
            Dumped {r.lost.map((l) => `${l.qty} ${e.goods[l.good].icon}`).join(" + ")}: no room{e.quirks ? " or no cash" : ""}.
          </li>
        )}
        <li>
          Handed <b class="gold">{coins(r.returned)} c</b> back to {dst}.
        </li>
      </ol>
      <div class="ledger-lines small num">
        <span>
          Paid sellers <b>{coins(bought)}</b>
        </span>
        <span>
          {src} port got <b>{coins(toPort)}</b>
        </span>
        <span>
          Crown got <b>{coins(srcTax + impTax)}</b>
        </span>
        <span>
          Route margin <b>{coins(r.margin)}</b>
        </span>
      </div>
      <p class="small muted">
        The margin is a score: the gap between what {dst} would pay and what {src} asked{e.quirks ? "" : ", minus import tax"}. It isn't profit. The wagon and the
        port are the same owner, so the coins only move from {dst} to {src} and the crown.
      </p>
    </div>
  );
}
