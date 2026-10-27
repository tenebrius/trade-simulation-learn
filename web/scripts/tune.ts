// Headless run of a scenario: prints the numbers that decide whether a world is legible.
//   npx tsx scripts/tune.ts [realm|reference] [seconds] [seed]
import { Engine } from "../src/engine/engine";
import { realm } from "../src/engine/scenarios/realm";
import { reference } from "../src/engine/scenarios/reference";

const sc = process.argv[2] === "reference" ? reference : realm;
const T = Number(process.argv[3] ?? 7200);
const e = new Engine(sc, Number(process.argv[4] ?? 1));
const G = sc.goods.length;
let trips = 0, empties = 0, lost = 0, idleTicks = 0, wagonTicks = 0;
const shortTicks = e.s.cities.map(() => Array(G).fill(0));
for (let t = 1; t <= T; t++) {
  const before = e.s.nextEventId;
  e.step();
  for (const ev of e.s.events) if (ev.id >= before) {
    if (ev.kind === "trip") trips++;
    if (ev.kind === "empty") empties++;
    if (ev.kind === "lost") lost++;
  }
  for (const tr of e.s.traders) { wagonTicks++; if (tr.task === "idle") idleTicks++; }
  e.s.cities.forEach((c, ci) => c.storage.forEach((st, g) => { if (st.amount === 0) shortTicks[ci][g]++; }));
  if (t % (T / 4) === 0) {
    console.log(`\n== t=${t}s seed=${e.s.seedValue.toFixed(2)} moneyDev=${e.s.moneyDev.toFixed(2)} ledger err=${(e.circulating() - e.expectedCirculating()).toExponential(1)} treasury=${e.s.treasury.toFixed(0)}`);
    console.log("good     glob  theo  " + e.s.cities.map((c) => c.name.slice(0, 9).padStart(13)).join(""));
    sc.goods.forEach((g, gi) => {
      console.log(`${g.id.padEnd(7)} ${e.s.glob[gi].toFixed(2).padStart(5)} ${e.s.theo[gi].toFixed(2).padStart(5)} ` +
        e.s.cities.map((c) => { const st = c.storage[gi]; const side = st.trace?.side === "buy" ? "B" : "S";
          return `${String(st.amount).padStart(4)}${side}${(side === "B" ? st.buy : st.sell).toFixed(2).padStart(7)} `; }).join(""));
    });
    console.log("cities: " + e.s.cities.map((c) => `${c.name.slice(0, 6)} ${c.cash.toFixed(0)}c ${c.residents}/${c.capacity} h${c.happiness.toFixed(2)} liq${c.liquidity.toFixed(2)}`).join(" | "));
  }
}
console.log(`\ntrips ${trips}, empty pickups ${empties} (${(100 * empties / Math.max(1, trips + empties)).toFixed(0)}%), lost loads ${lost}, wagons idle ${(100 * idleTicks / wagonTicks).toFixed(0)}% of the time`);
console.log("share of time at zero stock (needs only):");
for (const g of Object.keys(sc.needs)) {
  const gi = sc.goods.findIndex((x) => x.id === g);
  console.log(`  ${g.padEnd(7)} ` + e.s.cities.map((c, ci) => `${c.name.slice(0, 6)} ${(100 * shortTicks[ci][gi] / T).toFixed(0)}%`).join("  "));
}
