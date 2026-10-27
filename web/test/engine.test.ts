import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine";
import { realm } from "../src/engine/scenarios/realm";
import { reference } from "../src/engine/scenarios/reference";

const run = (e: Engine, n: number, each?: (e: Engine) => void) => {
  for (let i = 0; i < n; i++) {
    e.step();
    each?.(e);
  }
};

describe.each([
  ["realm", realm],
  ["reference", reference],
])("%s invariants", (_, sc) => {
  it("is deterministic for a seed", () => {
    const a = new Engine(sc, 5);
    const b = new Engine(sc, 5);
    run(a, 600);
    run(b, 600);
    expect(JSON.stringify(a.snapshot())).toEqual(JSON.stringify(b.snapshot()));
  });

  it("closes the money ledger every tick: circulation = start + minted + gifts - taxes", () => {
    const e = new Engine(sc, 3);
    run(e, 3000, (e) => {
      const diff = Math.abs(e.circulating() - e.expectedCirculating());
      expect(diff).toBeLessThan(1e-6 * Math.max(1, e.circulating()));
      if (e.s.t === 1000) e.giftCash(0, 5000);
    });
  });

  it("never lets stock or cash go negative", () => {
    const e = new Engine(sc, 9);
    run(e, 3000, (e) => {
      for (const c of e.s.cities) {
        expect(c.cash).toBeGreaterThanOrEqual(-1e-9);
        for (const st of c.storage) {
          expect(st.amount).toBeGreaterThanOrEqual(0);
          expect(st.amount).toBeLessThanOrEqual(st.max);
        }
      }
    });
  });

  it("keeps the active side's price inside its band", () => {
    const e = new Engine(sc, 4);
    run(e, 2000, (e) => {
      for (const c of e.s.cities)
        for (const st of c.storage) {
          const t = st.trace!;
          const [lo, hi] = t.side === "buy" ? t.buyBand : t.sellBand;
          expect(t.after).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(t.after).toBeLessThanOrEqual(hi + 1e-9);
        }
    });
  });

  it("restores a snapshot exactly", () => {
    const e = new Engine(sc, 2);
    run(e, 300);
    const snap = e.snapshot();
    run(e, 300);
    const after = JSON.stringify(e.snapshot());
    e.restore(snap);
    run(e, 300);
    expect(JSON.stringify(e.snapshot())).toEqual(after);
  });
});

describe("theoretical price (2.1)", () => {
  it("converges to the recipe fixed point", () => {
    const e = new Engine(realm, 1);
    let v = e.recipeValues(2.0, null);
    for (let i = 0; i < 2000; i++) v = e.recipeValues(2.0, v);
    const gi = e.gi;
    expect(v[gi.grain]).toBeCloseTo(2 / 3, 4); //          labour 1 x seed 2 / 3 out
    expect(v[gi.flour]).toBeCloseTo((2 * v[gi.grain] + 2) / 2, 4);
    expect(v[gi.bread]).toBeCloseTo((2 * v[gi.flour] + 2) / 3, 4);
  });
});

describe("fixes over ltt_sim.py (Realm)", () => {
  it("liquidity reads per-second spending, so a rich port is not 'broke'", () => {
    const e = new Engine(realm, 1);
    run(e, 1200);
    for (const c of e.s.cities) {
      // cash lasting longer than the 300 s critical window must give a zero liquidity term
      if (c.cash / Math.max(c.spendRate, 1e-3) > 300) expect(c.liquidity).toBe(0);
      expect(c.spendRate).toBeLessThan(c.cash + 1000); // a rate, not a 60 s sum
    }
  });

  it("noisy switching makes some wagons stick to their route when a better one exists (5.2)", () => {
    const e = new Engine(realm, 1);
    let sticky = 0;
    run(e, 4000, (e) => {
      for (const tr of e.s.traders) {
        const p = tr.plan;
        if (!p || p.t !== e.s.t || p.noise <= 1) continue;
        // a route better than the current one, turned down because the draw raised the bar
        if (p.candidates.some((c) => c.value > p.baseline && c.verdict.startsWith("below the bar"))) sticky++;
      }
    });
    expect(sticky).toBeGreaterThan(0);
  });

  it("keeps reservations consistent with what wagons hold", () => {
    const e = new Engine(realm, 6);
    run(e, 3000, (e) => {
      const G = e.goods.length;
      const out = e.s.cities.map(() => Array(G).fill(0));
      const inn = e.s.cities.map(() => Array(G).fill(0));
      for (const tr of e.s.traders) {
        if (!tr.route) continue;
        for (const r of tr.reserved) {
          if (tr.task === "to_source") out[tr.route.src][r.good] += r.qty;
          inn[tr.route.dst][r.good] += r.qty;
        }
      }
      e.s.cities.forEach((c, ci) =>
        c.storage.forEach((st, g) => {
          expect(st.reservedOut).toBeCloseTo(out[ci][g], 9);
          expect(st.reservedIn).toBeCloseTo(inn[ci][g], 9);
        }),
      );
    });
  });

  it("returns borrowed cash when a pickup comes back empty", () => {
    const e = new Engine(realm, 2);
    run(e, 3000, (e) => {
      for (const tr of e.s.traders) if (tr.task === "idle") expect(tr.budget).toBe(0);
    });
  });

  it("does not start a cycle (or use inputs) without workers", () => {
    const e = new Engine(realm, 1);
    const mb = e.s.cities[1];
    mb.residents = 0;
    mb.capacity = 0; // nobody can move in
    const flour = e.gi.flour;
    mb.buildings.forEach((b) => (b.running = false));
    const before = mb.storage[e.gi.grain].amount;
    e.produce(1);
    expect(mb.storage[e.gi.grain].amount).toBe(before);
    expect(mb.buildings.filter((b) => b.good === flour).every((b) => b.state === "noworkers")).toBe(true);
  });

  it("keeps a healthy Realm: few empty pickups, no lost loads, towns rarely without bread", () => {
    const e = new Engine(realm, 1);
    let next = e.s.nextEventId;
    let trips = 0;
    let empty = 0;
    let lost = 0;
    let breadOut = 0;
    let cityTicks = 0;
    run(e, 3600, (e) => {
      for (const ev of e.s.events)
        if (ev.id >= next) {
          if (ev.kind === "trip") trips++;
          if (ev.kind === "empty") empty++;
          if (ev.kind === "lost") lost++;
        }
      next = e.s.nextEventId;
      for (const c of e.s.cities) {
        cityTicks++;
        if (c.storage[e.gi.bread].amount === 0) breadOut++;
      }
    });
    expect(trips).toBeGreaterThan(300);
    expect(empty / (trips + empty)).toBeLessThan(0.1);
    expect(lost).toBe(0);
    expect(breadOut / cityTicks).toBeLessThan(0.15);
  });
});
