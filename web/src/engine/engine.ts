// The economy engine: a TypeScript port of ltt_sim.py (economy_model.md sections 2, 3, 4, 5.1-5.4,
// 6.1-6.2) without the dormant guild layer. With `quirks` on it reproduces ltt_sim.py exactly,
// including the arithmetic order, so the Reference scenario can be checked against Python. With
// `quirks` off the fixes listed in docs/PLAN.md apply. Each tick also records why every number
// changed (traces and events), which the UI shows as-is.

import * as K from "./constants";
import { clamp, psum } from "./math";
import { Rng } from "./rng";
import type { NeedDef, RecipeDef, Scenario } from "./scenario";
import type {
  Building,
  Candidate,
  CityState,
  DriftParts,
  EventKind,
  HistorySample,
  Load,
  PlanTrace,
  PortGood,
  SimEvent,
  SimState,
  Term,
  TraderState,
  TripReceipt,
} from "./types";
import { buildWorld, type World } from "./world";

const MAX_EVENTS = 600;
const HISTORY_EVERY = 5;
const HISTORY_LEN = 1440; //   2 simulated hours at one sample per 5 s
const UNLOAD_WAIT = 60; //     seconds a wagon waits for storage space before its cargo is lost
const f2 = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Order {
  good: number;
  amount: number;
  sell: number;
  buy: number;
}

export class Engine {
  readonly sc: Scenario;
  readonly world: World;
  readonly quirks: boolean;
  s: SimState;
  private rng: Rng;
  readonly gi: Record<string, number>;
  readonly needGoods: number[];
  readonly needDefs: NeedDef[];
  readonly recipeOf: (RecipeDef | null)[];
  readonly recipeOrder: number[];
  readonly inputsOf: [number, number][][];
  readonly construction: boolean[];

  constructor(sc: Scenario, seed = 1) {
    this.sc = sc;
    this.world = buildWorld(sc);
    this.quirks = sc.options.quirks;
    this.rng = new Rng(seed);
    this.gi = Object.fromEntries(sc.goods.map((g, i) => [g.id, i]));
    this.needGoods = Object.keys(sc.needs).map((g) => this.gi[g]);
    this.needDefs = Object.values(sc.needs);
    this.recipeOf = sc.goods.map((g) => sc.recipes[g.id] ?? null);
    this.recipeOrder = Object.keys(sc.recipes).map((g) => this.gi[g]);
    this.inputsOf = sc.goods.map((g) =>
      Object.entries(sc.recipes[g.id]?.inputs ?? {}).map(([i, q]) => [this.gi[i], q] as [number, number]),
    );
    this.construction = sc.goods.map((g) => sc.options.construction.includes(g.id));
    this.s = this.initState();
  }

  get goods() {
    return this.sc.goods;
  }

  // ------------------------------------------------------------------ setup
  private initState(): SimState {
    const sc = this.sc;
    const G = sc.goods.length;
    const seedValue = 1.0;
    let theo = this.recipeValues(seedValue, null);
    for (let i = 0; i < 200; i++) theo = this.recipeValues(seedValue, theo); // settle the solver
    const cities: CityState[] = sc.cities.map((cd) => {
      const storage: PortGood[] = [];
      for (let g = 0; g < G; g++) {
        const drawn = this.rng.randint(sc.options.startStock[0], sc.options.startStock[1]);
        const amount = cd.stock?.[sc.goods[g].id] ?? drawn;
        storage.push({
          amount,
          max: K.STORAGE_SIZE,
          desiredFill: K.DESIRED_FILL,
          buy: -1,
          sell: -1,
          trend: 0,
          integral: 0,
          smooth: 0,
          smoothSell: 0,
          priority: 0,
          flowAcc: 0,
          localValue: 0,
          reservedOut: 0,
          reservedIn: 0,
          subsidy: false,
          trace: null,
          announced: 0,
          short: false,
        });
      }
      return {
        name: cd.name,
        pos: cd.pos,
        residents: cd.residents,
        capacity: cd.capacity,
        buildings: cd.buildings.map(
          (b): Building => ({ good: this.gi[b], progress: 0, running: false, workers: 0, state: "inputs", enabled: true }),
        ),
        cash: cd.cash ?? K.CITY_START_BUDGET,
        tax: sc.options.tax,
        taxPaid: 0,
        storage,
        incomeRate: 0,
        spendRate: 0,
        tickIncome: 0,
        tickSpend: 0,
        newPortTimer: K.NEW_PORT_BONUS_T,
        happiness: K.BASE_HAPPINESS,
        target: K.BASE_HAPPINESS,
        happinessParts: [],
        satisfaction: this.needGoods.map(() => 1.0),
        consumeAcc: Array(G).fill(0),
        payTimer: 0,
        lastPay: 0,
        minted: 0,
        employed: 0,
        migration: { occupancy: 0, h: 0, direction: "none", rate: 0, moved: 0 },
        liquidity: 0,
        liquidityTime: Infinity,
        disparity: 0,
        broke: false,
      };
    });
    const traders: TraderState[] = [];
    let id = 0;
    cities.forEach((_, ci) => {
      for (let k = 0; k < (sc.cities[ci].buyers ?? K.NUM_CITY_BUYERS); k++) traders.push(this.newTrader(id++, ci));
    });
    const start = psum(cities.map((c) => c.cash));
    return {
      t: 0,
      rngState: this.rng.state,
      seedValue,
      seedDelta: 0.1,
      theo,
      mean: [...theo],
      glob: [...theo],
      moneyDev: 0,
      cities,
      traders,
      nextTraderId: id,
      global: null,
      ledger: { start, minted: 0, gifts: 0, taxed: 0 },
      treasury: 0,
      events: [],
      nextEventId: 1,
      history: [],
    };
  }

  private newTrader(id: number, home: number): TraderState {
    return {
      id,
      home,
      city: home,
      from: home,
      to: home,
      task: "idle",
      route: null,
      routeValue: 0,
      cargo: [],
      budget: 0,
      eta: 0,
      legTime: 0,
      switchTimer: 0,
      profitAvg: 0,
      reserved: [],
      waitTimer: 0,
      plan: null,
      trip: null,
      lastTrip: null,
    };
  }

  // ------------------------------------------------------------------ snapshots
  snapshot(): SimState {
    this.s.rngState = this.rng.state;
    return structuredClone(this.s);
  }

  restore(state: SimState) {
    this.s = structuredClone(state);
    this.rng.state = state.rngState;
  }

  // ------------------------------------------------------------------ theoretical price
  /** PricingPrediction (2.1): value = (sum of input amount x input value + labour x seed) / output.
   * Each pass moves a value by at most 1%; passes stop once every change is below 0.1%. */
  recipeValues(seed: number, old: number[] | null): number[] {
    const val = old ? [...old] : this.sc.goods.map(() => 1.0);
    for (let pass = 0; pass < K.THEO_PASSES; pass++) {
      let done = true;
      for (const g of this.recipeOrder) {
        const r = this.recipeOf[g]!;
        let nv = (psum(this.inputsOf[g].map(([i, q]) => val[i] * q)) + r.labour * seed) / r.out;
        if (Number.isNaN(nv) || nv <= 0) nv = K.THEO_FLOOR;
        const prev = val[g];
        const rel = (nv - prev) / prev;
        if (Math.abs(rel) > K.THEO_TOL) {
          done = false;
          if (Math.abs(rel) > K.THEO_MAX_STEP) nv = prev * (1 + Math.sign(rel) * K.THEO_MAX_STEP);
        }
        val[g] = nv;
      }
      if (done) break;
    }
    return val;
  }

  // ------------------------------------------------------------------ events
  emit(
    kind: EventKind,
    sig: 1 | 2 | 3,
    text: string,
    extra: { city?: number; good?: number; trader?: number; key?: string; receipt?: TripReceipt } = {},
  ) {
    const ev = this.s.events;
    const key = extra.key ?? "";
    if (key) {
      for (let i = ev.length - 1; i >= Math.max(0, ev.length - 12); i--) {
        const e = ev[i];
        if (e.key === key && this.s.t - e.t < 120) {
          e.count++;
          e.t = this.s.t;
          e.text = text;
          ev.splice(i, 1);
          ev.push(e);
          return;
        }
      }
    }
    const e: SimEvent = { id: this.s.nextEventId++, t: this.s.t, kind, sig, text, count: 1, key, ...extra };
    ev.push(e);
    if (ev.length > MAX_EVENTS) ev.splice(0, ev.length - MAX_EVENTS);
  }

  private gname(g: number) {
    return this.sc.goods[g].name.toLowerCase();
  }

  // ------------------------------------------------------------------ production (6.1)
  produce(dt: number) {
    for (const c of this.s.cities) {
      let free = c.residents;
      for (const b of c.buildings) {
        b.workers = b.enabled ? Math.min(K.WORKERS_PER_BUILDING, free) : 0;
        free -= b.workers;
      }
      c.employed = c.residents - free;
      c.buildings.forEach((b) => {
        const r = this.recipeOf[b.good]!;
        const out = c.storage[b.good];
        const prevState = b.state;
        if (!b.running && b.enabled && (this.quirks || b.workers > 0)) {
          if (this.inputsOf[b.good].every(([i, q]) => c.storage[i].amount >= q)) {
            for (const [i, q] of this.inputsOf[b.good]) {
              c.storage[i].amount -= q;
              c.storage[i].flowAcc -= q;
            }
            b.running = true;
            b.progress = 0.0;
          }
        }
        if (b.running && b.progress < 1.0) b.progress += (dt / r.seconds) * (b.workers / K.WORKERS_PER_BUILDING);
        if (b.running && b.progress >= 1.0 && out.amount + r.out <= out.max) {
          out.amount += r.out;
          out.flowAcc += r.out;
          b.running = false;
        }
        b.state = !b.enabled
          ? "off"
          : b.running && b.progress >= 1.0
            ? "full"
            : b.workers === 0
              ? "noworkers"
              : !b.running
                ? "inputs"
                : "running";
        if (b.state !== prevState && (b.state === "inputs" || b.state === "full") && prevState === "running") {
          const ci = this.s.cities.indexOf(c);
          const why =
            b.state === "full"
              ? `its ${this.gname(b.good)} storage is full`
              : `it is missing ${this.inputsOf[b.good].map(([i, q]) => `${q} ${this.gname(i)}`).join(" + ")}`;
          this.emit("blocked", 3, `${c.name}'s ${r.name.toLowerCase()} stopped: ${why}.`, {
            city: ci,
            good: b.good,
            key: `blk-${ci}-${b.good}-${b.state}`,
          });
        }
      });
    }
  }

  // ------------------------------------------------------------------ residents (6.2)
  residents(dt: number) {
    this.s.cities.forEach((c, ci) => {
      // consumption: each need draws rate x residents x dt; satisfaction = share of the draw met
      this.needGoods.forEach((g, ni) => {
        const need = this.needDefs[ni];
        c.consumeAcc[g] += need.rate * c.residents * dt;
        const n = Math.trunc(c.consumeAcc[g]);
        if (n) {
          const take = Math.min(n, c.storage[g].amount);
          c.storage[g].amount -= take;
          c.storage[g].flowAcc -= take;
          c.consumeAcc[g] -= n;
          c.satisfaction[ni] = take / n;
        }
        const st = c.storage[g];
        if (st.amount === 0 && !st.short && c.satisfaction[ni] < 1) {
          st.short = true;
          this.emit("shortage", 1, `${c.name} has run out of ${this.gname(g)}.`, { city: ci, good: g, key: `short-${ci}-${g}` });
        } else if (st.short && st.amount >= Math.max(3, st.max * st.desiredFill * 0.2)) {
          st.short = false;
          this.emit("restocked", 2, `${c.name} has ${this.gname(g)} again (${st.amount} in stock).`, { city: ci, good: g });
        }
      });
      // target happiness: base + per need + job share
      const parts: { label: string; value: number }[] = [{ label: "Base", value: K.BASE_HAPPINESS }];
      let target = K.BASE_HAPPINESS;
      this.needGoods.forEach((g, ni) => {
        const need = this.needDefs[ni];
        const s = c.satisfaction[ni];
        if (s > 0 && need.supply) {
          target += s * need.supply;
          parts.push({ label: `${this.sc.goods[g].name} supplied`, value: s * need.supply });
        } else if (need.under && s < 1) {
          target += (1 - s) * need.under;
          parts.push({ label: `${this.sc.goods[g].name} missing`, value: (1 - s) * need.under });
        }
      });
      if (c.residents) {
        const emp = c.employed / c.residents;
        target += emp * K.JOB_HAPPINESS + (1 - emp) * K.UNEMPLOYED_HAPPINESS;
        parts.push({ label: `Jobs (${pct(emp)} employed)`, value: emp * K.JOB_HAPPINESS + (1 - emp) * K.UNEMPLOYED_HAPPINESS });
      }
      c.happinessParts = parts;
      c.target = Math.max(0.0, Math.min(1.0, target));
      const gap = c.target - c.happiness;
      const step = dt * K.HAPPINESS_SPEED * Math.max(Math.abs(gap), 0.1);
      c.happiness = Math.abs(gap) <= step ? c.target : c.happiness + Math.sign(gap) * step;
      this.migrate(c, ci, dt);
      c.payTimer += dt;
      if (c.payTimer >= K.PAY_INTERVAL) {
        c.payTimer -= K.PAY_INTERVAL;
        const hf = Math.max(0.0, (c.happiness - K.CRITICAL_HAPPINESS) / (1 - K.CRITICAL_HAPPINESS));
        const pay = K.PAY_INTERVAL * c.residents * (K.BASE_PAY + hf * K.BONUS_PAY);
        c.cash += pay;
        c.lastPay = pay;
        c.minted += pay;
        this.s.ledger.minted += pay;
        if (this.quirks) c.incomeRate += pay;
        else c.tickIncome += pay;
      }
    });
  }

  /** Happier than the occupancy -> each empty slot rolls to fill; less happy -> each resident rolls
   * to leave. At most one move per tick. Both directions use MaxMoveInProbabilityPerSec. */
  migrate(c: CityState, ci: number, dt: number) {
    const m = c.migration;
    m.moved = 0;
    m.direction = "none";
    m.rate = 0;
    if (c.capacity <= 0) return;
    const occ = c.residents / c.capacity;
    const h = Math.max(0.0, Math.min(1.0, c.happiness / K.CRITICAL_HAPPINESS));
    m.occupancy = occ;
    m.h = h;
    if (h >= occ) {
      if (occ < 1) {
        m.direction = "in";
        m.rate = ((h - occ) / (1 - occ)) * K.MAX_MOVE_PROB;
        const stay = Math.pow(1 - ((h - occ) / (1 - occ)) * K.MAX_MOVE_PROB, dt);
        for (let i = 0; i < c.capacity - c.residents; i++) {
          if (this.rng.random() > stay) {
            c.residents += 1;
            m.moved = 1;
            break;
          }
        }
      }
    } else {
      const h2 = Math.max(0.0, Math.min(1.0, Math.max(c.target, c.happiness) / K.CRITICAL_HAPPINESS));
      m.h = h2;
      if (h2 < occ) {
        m.direction = "out";
        m.rate = ((occ - h2) / occ) * K.MAX_MOVE_PROB;
        const stay = Math.pow(1 - ((occ - h2) / occ) * K.MAX_MOVE_PROB, dt);
        for (let i = 0; i < c.residents; i++) {
          if (this.rng.random() > stay) {
            c.residents -= 1;
            m.moved = -1;
            break;
          }
        }
      }
    }
    if (m.moved > 0)
      this.emit("migration", 3, `People are moving into ${c.name} (now ${c.residents}/${c.capacity}).`, { city: ci, key: `mig-in-${ci}` });
    else if (m.moved < 0)
      this.emit("migration", 2, `People are leaving ${c.name}: happiness ${f2(c.happiness)} is too low for its occupancy (now ${c.residents}/${c.capacity}).`, {
        city: ci,
        key: `mig-out-${ci}`,
      });
  }

  /** Local value: what a good is worth to this city. Made here from inputs: input cost per unit of
   * output at local buy prices. Made here from labour only: 0.8 x theoretical (a sim choice). */
  localValues() {
    for (const c of this.s.cities) {
      const madeHere = new Set(c.buildings.map((b) => b.good));
      c.storage.forEach((st, g) => {
        let v = this.s.theo[g];
        if (madeHere.has(g)) {
          const inputs = this.inputsOf[g];
          if (inputs.length) {
            const parts: number[] = [];
            for (const [i, q] of inputs)
              for (let k = 0; k < q; k++) parts.push(c.storage[i].buy > 0 ? c.storage[i].buy : this.s.glob[i]);
            v = psum(parts) / this.recipeOf[g]!.out;
          } else v = v * 0.8;
        }
        st.localValue = Math.max(K.MIN_PRICE, v);
      });
    }
  }

  // ------------------------------------------------------------------ port pricing (3)
  pricePorts(dt: number) {
    const s = this.s;
    const cashTotal = psum(s.cities.map((c) => c.cash));
    s.cities.forEach((c, ci) => {
      if (c.newPortTimer > 0) c.newPortTimer -= dt;
      const newBonus = Math.max(0.0, c.newPortTimer / K.NEW_PORT_BONUS_T) * K.NEW_PORT_BONUS_W;
      const liquidityTime = c.cash / Math.max(c.spendRate, 1e-3);
      const liq = Math.max(0.0, Math.min(1.0, 1.0 - liquidityTime / K.CRIT_LIQ_TIME));
      const disparity = (c.spendRate - c.incomeRate) / Math.max(c.spendRate + c.incomeRate, 1e-3);
      c.liquidity = liq;
      c.liquidityTime = liquidityTime;
      c.disparity = disparity;
      if (liq > 0.6 && !c.broke) {
        c.broke = true;
        this.emit("broke", 1, `${c.name} is running short of cash: it will bid less and sell harder.`, { city: ci, key: `broke-${ci}` });
      } else if (liq < 0.3 && c.broke) c.broke = false;
      c.storage.forEach((st, g) => {
        const k = dt / K.STOCK_INTEGRATION;
        st.trend += (st.flowAcc / dt - st.trend) * Math.min(1.0, k * 10);
        st.flowAcc = 0;
        const mean = s.mean[g];
        const glob = s.glob[g];
        const theo = s.theo[g];
        const buyLo = (1 - K.MAX_DEV + K.BUY_SELL_SHIFT) * mean;
        let buyHi = Math.max((1 + K.MAX_DEV + K.BUY_SELL_SHIFT) * mean, theo);
        if (this.construction[g]) buyHi *= 10;
        const sellLo = (1 - K.MAX_DEV - K.BUY_SELL_SHIFT) * mean;
        const sellHi = (1 + K.MAX_DEV - K.BUY_SELL_SHIFT) * mean;
        if (st.buy < 0) {
          st.buy = (1 + K.START_DEV) * mean;
          st.sell = (1 - K.START_DEV) * mean;
        }
        const desired = Math.trunc(st.max * st.desiredFill);
        const missing = desired - st.amount;
        const lv = st.localValue;
        const absCap = this.quirks ? Infinity : cashTotal * 0.00033 * dt;
        let terms: Term[];
        let prio: number;
        let target: number;
        let before: number;
        let side: "buy" | "sell";
        let rel: number;
        if (missing > 0) {
          side = "buy";
          rel = missing / Math.max(desired, 1);
          st.integral = st.integral * (1 - dt / K.STOCK_INTEGRATION) + rel * dt;
          const b = st.buy;
          terms = [
            { key: "p", label: "Shortage now", value: K.P_W * rel, formula: `${K.P_W} × ${f2(rel)} missing` },
            { key: "d1", label: "Stock trend", value: -K.D1_W * st.trend, formula: `−${K.D1_W} × trend ${f2(st.trend)}/s` },
            { key: "i", label: "Shortage over time", value: K.I_W * st.integral, formula: `${K.I_W} × ∫ ${f2(st.integral)}` },
            {
              key: "l2g",
              label: "Price vs global",
              value: (-K.L2G_W * (b - glob)) / glob,
              formula: `−${K.L2G_W} × (${f2(b)} − ${f2(glob)}) / ${f2(glob)}`,
            },
            { key: "liq", label: "Low on cash", value: -K.REM_LIQ_W * liq, formula: `−${K.REM_LIQ_W} × liquidity ${f2(liq)}` },
            {
              key: "disp",
              label: "Spending > income",
              value: -K.INC_SPEND_W * Math.max(0.0, disparity),
              formula: `−${K.INC_SPEND_W} × max(0, ${f2(disparity)})`,
            },
            {
              key: "cheap",
              label: "Cheaper than making it",
              value: K.CHEAPER_BUY_W * Math.max(0.0, (lv - b) / lv) * (1 - liq),
              formula: `${K.CHEAPER_BUY_W} × max(0, (${f2(lv)} − ${f2(b)}) / ${f2(lv)}) × (1 − ${f2(liq)})`,
            },
            {
              key: "over",
              label: "Above local value",
              value: (K.OVERPRICED_BUY_F * Math.max(0.0, b - lv)) / Math.max(mean, 1e-3),
              formula: `${K.OVERPRICED_BUY_F} × max(0, ${f2(b)} − ${f2(lv)}) / ${f2(mean)}`,
            },
            { key: "new", label: "New port bonus", value: newBonus, formula: `${K.NEW_PORT_BONUS_W} × ${f2(Math.max(0, c.newPortTimer))}/${K.NEW_PORT_BONUS_T} s left` },
          ];
          if (st.subsidy) terms.push({ key: "sub", label: "Subsidy", value: K.SUBSIDY_W, formula: `+${K.SUBSIDY_W}` });
          const raw = psum(terms.map((t) => t.value));
          prio = Math.max(1e-4, Math.min(1.0, raw));
          target = buyLo + (buyHi - buyLo) * prio;
          before = st.buy;
          const r = this.slew(st, "buy", st.buy, target, dt, buyLo, buyHi, absCap);
          st.buy = r.price;
          if (this.quirks) st.sell = Math.max(st.sell, st.buy * 1.05);
          else st.sell = clamp(Math.max(st.sell, st.buy * 1.05), sellLo, sellHi);
          st.trace = this.trace(side, st, desired, rel, [buyLo, buyHi], [sellLo, sellHi], mean, glob, theo, terms, raw, prio, target, before, r, liq);
        } else {
          side = "sell";
          const surplus = -missing;
          rel = surplus / Math.max(st.max - desired, 1);
          st.integral = st.integral * (1 - dt / K.STOCK_INTEGRATION);
          const p = st.sell;
          terms = [
            { key: "p", label: "Surplus now", value: K.P_W * rel, formula: `${K.P_W} × ${f2(rel)} surplus` },
            { key: "d1", label: "Stock trend", value: K.D1_W * st.trend, formula: `${K.D1_W} × trend ${f2(st.trend)}/s` },
            {
              key: "l2g",
              label: "Price vs global",
              value: (K.L2G_W * (p - glob)) / glob,
              formula: `${K.L2G_W} × (${f2(p)} − ${f2(glob)}) / ${f2(glob)}`,
            },
            { key: "liq", label: "Needs cash", value: -K.REM_LIQ_W * liq * -1, formula: `${K.REM_LIQ_W} × liquidity ${f2(liq)}` },
            {
              key: "under",
              label: "Below its value",
              value: (K.SELL_UNDER_W * Math.max(0.0, lv - p)) / Math.max(p, 0.1),
              formula: `${K.SELL_UNDER_W} × max(0, ${f2(lv)} − ${f2(p)}) / ${f2(p)}`,
            },
            { key: "new", label: "New port bonus", value: newBonus, formula: `${K.NEW_PORT_BONUS_W} × ${f2(Math.max(0, c.newPortTimer))}/${K.NEW_PORT_BONUS_T} s left` },
          ];
          const raw = psum(terms.map((t) => t.value));
          prio = Math.max(0.0, Math.min(1.0, raw));
          target = sellHi - (sellHi - sellLo) * prio;
          before = st.sell;
          const r = this.slew(st, "sell", st.sell, target, dt, sellLo, sellHi, absCap);
          st.sell = r.price;
          if (this.quirks) st.buy = Math.min(st.buy, st.sell * 0.95);
          else st.buy = clamp(Math.min(st.buy, st.sell * 0.95), buyLo, buyHi);
          st.trace = this.trace(side, st, desired, rel, [buyLo, buyHi], [sellLo, sellHi], mean, glob, theo, terms, raw, prio, target, before, r, liq);
        }
        st.priority = prio;
        const now = side === "buy" ? st.buy : st.sell;
        if (st.announced <= 0) st.announced = now;
        else if (Math.abs(now / st.announced - 1) > 0.25) {
          const up = now > st.announced;
          const move = Math.abs(now / st.announced - 1);
          this.emit(
            "price",
            move > 0.5 ? 2 : 3,
            `${this.sc.goods[g].name} in ${c.name} ${up ? "up" : "down"} ${pct(move)} to ${f2(now)} (${side === "buy" ? "buying" : "selling"}, stock ${st.amount}/${desired}).`,
            { city: ci, good: g, key: `price-${ci}-${g}` },
          );
          st.announced = now;
        }
      });
    });
  }

  private trace(
    side: "buy" | "sell",
    st: PortGood,
    desired: number,
    rel: number,
    buyBand: [number, number],
    sellBand: [number, number],
    mean: number,
    global: number,
    theo: number,
    terms: Term[],
    raw: number,
    priority: number,
    target: number,
    before: number,
    r: { price: number; stepCap: number; urgency: number; step: number; smooth: number; clamped: boolean },
    liquidity: number,
  ) {
    return {
      side,
      amount: st.amount,
      desired,
      rel,
      buyBand,
      sellBand,
      mean,
      global,
      theo,
      localValue: st.localValue,
      terms,
      raw,
      priority,
      target,
      before,
      stepCap: r.stepCap,
      urgency: r.urgency,
      step: r.step,
      smooth: r.smooth,
      after: r.price,
      clamped: r.clamped,
      liquidity,
      subsidised: st.subsidy,
    };
  }

  /** Move the price toward the target: at most 1%/s (4%/s if subsidised) widened by an urgency
   * bonus, passed through a 6 s smoother, then clamped to the band. */
  private slew(st: PortGood, side: "buy" | "sell", price: number, target: number, dt: number, lo: number, hi: number, absCap: number) {
    target = Math.max(target, K.MIN_PRICE);
    const delta = target - price;
    const urgency = Math.min(K.MAX_URGENCY, 0.1 * Math.sqrt(Math.abs(delta / Math.max(price, 1e-3))));
    const rate = st.subsidy ? K.MAX_GOOD_REL_CHG_SUBSIDY : K.MAX_GOOD_REL_CHG;
    const stepCap = Math.min(price * rate * dt * (1 + urgency), absCap);
    const step = Math.max(-stepCap, Math.min(stepCap, delta));
    const useSell = !this.quirks && side === "sell";
    let sm = useSell ? st.smoothSell : st.smooth;
    sm += (step - sm) * Math.min(1.0, dt / K.SMOOTH_TIME);
    const unclamped = price + sm;
    const out = Math.max(lo, Math.min(hi, unclamped));
    const clamped = out !== unclamped;
    if (clamped && !this.quirks) sm = out - price; // no windup against the band edge
    if (useSell) st.smoothSell = sm;
    else st.smooth = sm;
    return { price: out, stepCap, urgency, step, smooth: sm, clamped };
  }

  // ------------------------------------------------------------------ global layer (2)
  updateGlobalPrices(dt: number) {
    const s = this.s;
    const G = this.sc.goods.length;
    const volume = Array.from({ length: G }, (_, g) => {
      let v = 0;
      for (const c of s.cities) v += c.storage[g].amount;
      if (!this.quirks) for (const t of s.traders) for (const cg of t.cargo) if (cg.good === g) v += cg.qty;
      return v;
    });
    let totalVolume = 0;
    for (const v of volume) totalVolume += v;
    const goodsValue = psum(volume.map((v, g) => v * s.glob[g]));
    const cash = psum(s.cities.map((c) => c.cash));
    const theoValue = psum(volume.map((v, g) => v * s.theo[g]));
    const err = cash - K.DESIRED_CASH_TO_GOODS * theoValue;
    const seedBefore = s.seedValue;
    let seedFactor = 1;
    if (err !== 0) {
      const same = err > 0 === s.seedDelta > 0;
      seedFactor = same ? 1.1 : -0.9;
      s.seedDelta *= seedFactor;
      s.seedValue = Math.max(0.01, s.seedValue + s.seedDelta * dt);
    }
    s.theo = this.recipeValues(s.seedValue, s.theo);
    const moneyDev = cash > 0 ? (cash - K.DESIRED_CASH_TO_GOODS * goodsValue) / cash : 0.0;
    s.moneyDev = moneyDev;
    const drift: DriftParts[] = [];
    const ordersOut: { volume: number; mean: number }[] = [];
    for (let g = 0; g < G; g++) {
      const amts: number[] = [];
      const prods: number[] = [];
      for (const c of s.cities) {
        const st = c.storage[g];
        const desired = Math.trunc(st.max * st.desiredFill);
        if (st.amount < desired) {
          amts.push(desired - st.amount);
          prods.push((desired - st.amount) * st.buy);
        }
      }
      let vol = 0;
      for (const a of amts) vol += a;
      if (vol > 0) s.mean[g] = psum(prods) / vol;
      ordersOut.push({ volume: vol, mean: s.mean[g] });
      let glob = s.glob[g];
      const before = glob;
      const meanPull = (s.mean[g] - glob) * K.MEAN_TO_GLOBAL_W * dt;
      glob += meanPull;
      const theoPull = (s.theo[g] - glob) * K.THEO_TO_GLOBAL_W * dt;
      glob += theoPull;
      let money = 0;
      let share = 0;
      if (totalVolume > 0) {
        share = Math.min(K.MIN_GOOD_VOLUME_W, volume[g] / totalVolume);
        money = share * glob * dt * K.REL_MONEY_W * moneyDev;
        glob += money;
      }
      s.glob[g] = Math.max(K.MIN_PRICE, glob);
      s.mean[g] = s.glob[g];
      drift.push({ meanPull, theoPull, money, share, before, after: s.glob[g] });
    }
    const prevFactor = s.global?.seedFactor ?? 1;
    if (prevFactor !== 1 && seedFactor !== 1 && Math.sign(prevFactor) !== Math.sign(seedFactor) && seedFactor < 0) {
      this.emit(
        "seed",
        3,
        err > 0
          ? `Cities hold more than ${K.DESIRED_CASH_TO_GOODS}× the value of all goods: the labour seed turns upward (now ${f2(s.seedValue)}).`
          : `Cities hold less than ${K.DESIRED_CASH_TO_GOODS}× the value of all goods: the labour seed turns downward (now ${f2(s.seedValue)}).`,
        { key: "seed" },
      );
    }
    s.global = { volume, totalVolume, goodsValue, theoValue, cash, moneyDev, seedErr: err, seedFactor, seedBefore, drift, orders: ordersOut };
  }

  // ------------------------------------------------------------------ city buyers (5)
  /** Pair the source's sell orders with the destination's buy orders (5.1). */
  transportOrders(src: number, dst: number): Order[] {
    const S = this.s.cities[src];
    const D = this.s.cities[dst];
    const orders: Order[] = [];
    for (let g = 0; g < this.sc.goods.length; g++) {
      const s = S.storage[g];
      const d = D.storage[g];
      const sDesired = Math.trunc(s.max * s.desiredFill);
      const dDesired = Math.trunc(d.max * d.desiredFill);
      const amount = this.quirks
        ? Math.min(s.amount - sDesired, dDesired - d.amount)
        : Math.min(s.amount - sDesired - s.reservedOut, dDesired - d.amount - d.reservedIn);
      if (amount > 0 && d.buy > s.sell) orders.push({ good: g, amount, sell: s.sell, buy: d.buy });
    }
    return orders;
  }

  /** Greedy wagon fill (5.2): keep taking the order with the largest qty x profit per unit. */
  fillWagon(orders: Order[], capacity: number) {
    const load: Load[] = [];
    let profit = 0.0;
    let cost = 0.0;
    const left = [...orders];
    while (capacity > 0 && left.length) {
      let bi = 0;
      let bv = -Infinity;
      left.forEach((o, i) => {
        const v = Math.min(o.amount, capacity) * (o.buy - o.sell);
        if (v > bv) {
          bv = v;
          bi = i;
        }
      });
      const best = left[bi];
      const qty = Math.min(best.amount, capacity);
      load.push({ good: best.good, qty });
      profit += qty * (best.buy - best.sell);
      cost += qty * best.sell;
      capacity -= qty;
      left.splice(bi, 1);
    }
    return { load, profit, cost };
  }

  private evaluate(tr: TraderState, src: number, dst: number): Candidate {
    const { load, profit, cost } = this.fillWagon(this.transportOrders(src, dst), this.sc.options.wagonCapacity);
    const d = this.world.dist;
    const pathLen = d[tr.city][src] + d[src][dst];
    const time = pathLen / this.sc.options.wagonSpeed + K.PLAN_OVERHEAD;
    const transport = pathLen * this.sc.options.transportCost;
    const value = this.quirks ? (profit / time) * 60 : ((profit - transport) / time) * 60;
    return { src, dst, load, profit, cost, time, transport, value, verdict: "" };
  }

  /** Route choice (5.2) with noisy switching. A city buyer only fetches from other ports to home. */
  planRoute(tr: TraderState): Candidate | null {
    const r = this.rng.uniform(-1.0, 1.0);
    const noise = 1.0 + Math.sign(r) * K.MAX_PROFIT_DEV * r * r;
    const n = this.s.cities.length;
    const candidates: Candidate[] = [];
    let best: Candidate | null = null;
    let chosen = -1;
    let baseline: number;
    let bestValue: number;
    if (this.quirks) {
      baseline = tr.routeValue;
      bestValue = Math.max(K.MIN_PROFIT, tr.routeValue);
    } else {
      // baseline = the current route, valued now
      baseline = tr.route ? Math.max(0, this.evaluate(tr, tr.route.src, tr.route.dst).value) : 0;
      bestValue = -Infinity;
    }
    for (let src = 0; src < n; src++) {
      for (let dst = 0; dst < n; dst++) {
        if (src === dst) continue;
        if (dst !== tr.home || src === tr.home) continue;
        const c = this.evaluate(tr, src, dst);
        candidates.push(c);
        if (c.profit < K.MIN_PROFIT) {
          c.verdict = c.load.length ? "margin under 1 coin" : "nothing to fetch";
          continue;
        }
        if (!this.quirks && c.value <= 0) {
          c.verdict = "transport costs more than the margin";
          continue;
        }
        if (!(c.value > bestValue)) {
          c.verdict = best ? "worse than a route already found" : this.quirks ? "not better than the current route" : "worse";
          continue;
        }
        if (!(c.value > noise * baseline)) {
          c.verdict = `below the bar: ${f2(noise)} × current ${f2(baseline)}`;
          continue;
        }
        if (best) best.verdict = "beaten by a later route";
        best = c;
        bestValue = c.value;
        chosen = candidates.length - 1;
        c.verdict = "chosen";
      }
    }
    let outcome: string;
    if (best) outcome = `Chose ${this.s.cities[best.src].name} → ${this.s.cities[best.dst].name}.`;
    else if (tr.route) outcome = "Nothing cleared the bar: keeps its current route.";
    else outcome = "No route is worth it: waits at home.";
    tr.plan = { t: this.s.t, r, noise, baseline, candidates, chosen, outcome } satisfies PlanTrace;
    return best;
  }

  private reserve(tr: TraderState, src: number, dst: number, load: Load[], out: boolean) {
    for (const l of load) {
      if (out) this.s.cities[src].storage[l.good].reservedOut += l.qty;
      this.s.cities[dst].storage[l.good].reservedIn += l.qty;
    }
    tr.reserved = load.map((l) => ({ ...l }));
  }

  private release(tr: TraderState, out: boolean) {
    if (!tr.route || !tr.reserved.length) return;
    for (const l of tr.reserved) {
      if (out) {
        const so = this.s.cities[tr.route.src].storage[l.good];
        so.reservedOut = Math.max(0, so.reservedOut - l.qty);
      }
      const si = this.s.cities[tr.route.dst].storage[l.good];
      si.reservedIn = Math.max(0, si.reservedIn - l.qty);
    }
    tr.reserved = [];
  }

  /** Ask the home port for cash: the full gap, then half, then a quarter (5.3). */
  requestBudget(tr: TraderState, amount: number) {
    const owner = this.s.cities[tr.home];
    for (const part of [amount, amount * 0.5, amount * 0.25]) {
      if (part <= owner.cash) {
        owner.cash -= part;
        tr.budget += part;
        return part;
      }
    }
    return 0;
  }

  private returnCash(tr: TraderState) {
    const home = this.s.cities[tr.home];
    home.cash += tr.budget;
    const r = tr.budget;
    tr.budget = 0.0;
    return r;
  }

  private startLeg(tr: TraderState, from: number, to: number, eta: number) {
    tr.from = from;
    tr.to = to;
    tr.eta = eta;
    tr.legTime = eta;
  }

  runTraders(dt: number) {
    const s = this.s;
    for (const tr of s.traders) {
      if (tr.task === "idle") {
        tr.switchTimer -= dt;
        if (tr.switchTimer > 0) continue;
        tr.switchTimer = K.ROUTE_SWITCH_TIMEOUT / 10;
        if (!this.quirks) this.release(tr, true);
        const plan = this.planRoute(tr);
        if (this.quirks) {
          if (plan === null && tr.route === null) continue;
        } else if (plan === null) {
          // keep the current route only while it still pays
          const cur = tr.route ? this.evaluate(tr, tr.route.src, tr.route.dst) : null;
          if (!cur || cur.profit < K.MIN_PROFIT || cur.value <= 0) {
            tr.route = null;
            tr.routeValue = 0;
            continue;
          }
          tr.route = { src: cur.src, dst: cur.dst, load: cur.load };
          tr.routeValue = cur.value;
        }
        if (plan !== null) {
          tr.route = { src: plan.src, dst: plan.dst, load: plan.load };
          tr.routeValue = plan.value;
        }
        if (!this.quirks) this.reserve(tr, tr.route!.src, tr.route!.dst, tr.route!.load, true);
        tr.task = "to_source";
        this.startLeg(tr, tr.city, tr.route!.src, this.world.dist[tr.city][tr.route!.src] / this.sc.options.wagonSpeed + 2);
      } else if (tr.task === "to_source") {
        tr.eta -= dt;
        if (tr.eta > 0) continue;
        this.arriveAtSource(tr);
      } else if (tr.task === "to_dest") {
        tr.eta -= dt;
        if (tr.eta > 0) continue;
        if (this.quirks) this.deliverQuirk(tr);
        else this.deliverHome(tr);
      } else if (tr.task === "unloading") {
        tr.waitTimer -= dt;
        this.unload(tr, tr.waitTimer <= 0);
      }
    }
  }

  private arriveAtSource(tr: TraderState) {
    const s = this.s;
    const { src, dst } = tr.route!;
    const S = s.cities[src];
    if (!this.quirks) this.release(tr, true);
    const { load, cost } = this.fillWagon(this.transportOrders(src, dst), this.sc.options.wagonCapacity);
    let borrowed = 0;
    if (cost > tr.budget) borrowed = this.requestBudget(tr, cost - tr.budget);
    tr.city = src;
    const trip: TripReceipt = { t: s.t, src, dst, borrowed, bought: [], delivered: [], lost: [], returned: 0, margin: 0 };
    for (const l of load) {
      const st = S.storage[l.good];
      const qty = Math.min(l.qty, Math.trunc(tr.budget / Math.max(st.sell, 0.1)));
      if (qty <= 0) continue;
      const price = st.sell;
      const net = price / (1 + S.tax);
      st.amount -= qty;
      st.flowAcc -= qty;
      tr.budget -= price * qty;
      S.cash += net * qty;
      S.taxPaid += (price - net) * qty;
      this.payTax((price - net) * qty);
      if (this.quirks) S.incomeRate += net * qty;
      else {
        S.tickIncome += net * qty;
        s.cities[tr.home].tickSpend += price * qty;
      }
      tr.cargo.push({ good: l.good, qty, paid: price });
      trip.bought.push({ good: l.good, qty, price, toPort: net * qty, tax: (price - net) * qty });
    }
    const who = `${s.cities[tr.home].name}'s wagon`;
    if (!tr.cargo.length) {
      if (!this.quirks) trip.returned = this.returnCash(tr);
      tr.task = "idle";
      tr.route = null;
      tr.routeValue = 0;
      tr.lastTrip = trip;
      this.emit("empty", 2, `${who} reached ${S.name} but the surplus it came for was gone.`, {
        trader: tr.id,
        city: src,
        key: `empty-${tr.id}`,
      });
      return;
    }
    if (!this.quirks) this.reserve(tr, src, dst, tr.cargo.map((c) => ({ good: c.good, qty: c.qty })), false);
    tr.trip = trip;
    tr.task = "to_dest";
    this.startLeg(tr, src, dst, this.world.dist[src][dst] / this.sc.options.wagonSpeed + 2);
  }

  private payTax(amount: number) {
    this.s.treasury += amount;
    this.s.ledger.taxed += amount;
  }

  /** ltt_sim.py delivery: the destination pays price + tax per unit as if buying from a stranger;
   * whatever does not fit or cannot be paid for is thrown away. */
  private deliverQuirk(tr: TraderState) {
    const s = this.s;
    const dst = tr.route!.dst;
    const D = s.cities[dst];
    const trip = tr.trip!;
    let profit = 0.0;
    for (const cg of tr.cargo) {
      const st = D.storage[cg.good];
      const price = st.buy;
      const gross = price * (1 + D.tax);
      const qty = Math.min(cg.qty, st.max - st.amount, Math.trunc(D.cash / gross));
      st.amount += qty;
      st.flowAcc += qty;
      D.cash -= gross * qty;
      D.taxPaid += (gross - price) * qty;
      this.payTax((gross - price) * qty);
      D.spendRate += gross * qty;
      tr.budget += price * qty;
      profit += (price - cg.paid) * qty;
      trip.delivered.push({ good: cg.good, qty, price, tax: (gross - price) * qty });
      if (qty < cg.qty) trip.lost.push({ good: cg.good, qty: cg.qty - qty });
    }
    tr.profitAvg += (profit - tr.profitAvg) * 0.2;
    tr.cargo = [];
    tr.task = "idle";
    tr.city = dst;
    trip.margin = profit;
    trip.returned = this.returnCash(tr);
    this.finishTrip(tr, trip);
  }

  /** Fixed delivery: the wagon belongs to the receiving port, so handing over the goods is an
   * internal transfer. Only the import tax is a real payment. Goods that don't fit wait. */
  private deliverHome(tr: TraderState) {
    tr.city = tr.route!.dst;
    tr.waitTimer = UNLOAD_WAIT;
    this.unload(tr, false);
  }

  private unload(tr: TraderState, giveUp: boolean) {
    const s = this.s;
    const dst = tr.route!.dst;
    const D = s.cities[dst];
    const trip = tr.trip!;
    const left: typeof tr.cargo = [];
    for (const cg of tr.cargo) {
      const st = D.storage[cg.good];
      const qty = Math.min(cg.qty, st.max - st.amount);
      if (qty > 0) {
        const price = st.buy;
        const tax = Math.min(price * qty * D.tax, Math.max(0, D.cash));
        st.amount += qty;
        st.flowAcc += qty;
        st.reservedIn = Math.max(0, st.reservedIn - qty);
        D.cash -= tax;
        D.taxPaid += tax;
        D.tickSpend += tax;
        this.payTax(tax);
        trip.delivered.push({ good: cg.good, qty, price, tax });
        trip.margin += (price - cg.paid) * qty - tax;
      }
      if (cg.qty > qty) left.push({ ...cg, qty: cg.qty - qty });
    }
    tr.reserved = tr.reserved
      .map((r) => ({ good: r.good, qty: Math.min(r.qty, left.filter((c) => c.good === r.good).reduce((a, c) => a + c.qty, 0)) }))
      .filter((r) => r.qty > 0);
    tr.cargo = left;
    if (left.length && !giveUp) {
      tr.task = "unloading";
      return;
    }
    if (left.length) {
      for (const cg of left) {
        trip.lost.push({ good: cg.good, qty: cg.qty });
        const st = D.storage[cg.good];
        st.reservedIn = Math.max(0, st.reservedIn - cg.qty);
      }
      tr.reserved = [];
      tr.cargo = [];
    }
    tr.profitAvg += (trip.margin - tr.profitAvg) * 0.2;
    tr.task = "idle";
    trip.returned = this.returnCash(tr);
    this.finishTrip(tr, trip);
  }

  private finishTrip(tr: TraderState, trip: TripReceipt) {
    const s = this.s;
    tr.lastTrip = trip;
    tr.trip = null;
    const home = s.cities[tr.home];
    const items = trip.delivered.filter((d) => d.qty > 0).map((d) => `${d.qty} ${this.gname(d.good)}`);
    const paid = psum(trip.bought.map((b) => b.price * b.qty));
    const tax = psum(trip.bought.map((b) => b.tax)) + psum(trip.delivered.map((d) => d.tax));
    if (items.length)
      this.emit(
        "trip",
        2,
        `${home.name}'s wagon brought ${items.join(" + ")} from ${s.cities[trip.src].name}: paid ${f2(paid)} c, of which ${f2(tax)} c tax.`,
        { trader: tr.id, city: tr.home, good: trip.delivered[0]?.good, receipt: trip },
      );
    if (trip.lost.length)
      this.emit(
        "lost",
        1,
        `${home.name}'s wagon had to dump ${trip.lost.map((l) => `${l.qty} ${this.gname(l.good)}`).join(" + ")}: ${this.quirks ? "no room or no cash to pay for it" : "no storage room for a minute"}.`,
        { trader: tr.id, city: trip.dst, receipt: trip },
      );
  }

  // ------------------------------------------------------------------ loop
  step(dt = K.TICK) {
    const s = this.s;
    s.t += dt;
    this.produce(dt);
    this.residents(dt);
    this.localValues();
    this.pricePorts(dt);
    this.updateGlobalPrices(dt);
    this.runTraders(dt);
    for (const c of s.cities) {
      if (this.quirks) {
        c.incomeRate *= 1 - dt / K.FLOW_DECAY_TIME;
        c.spendRate *= 1 - dt / K.FLOW_DECAY_TIME;
      } else {
        // per-second moving averages over ~60 s
        const k = Math.min(1, dt / K.FLOW_DECAY_TIME);
        c.incomeRate += (c.tickIncome / dt - c.incomeRate) * k;
        c.spendRate += (c.tickSpend / dt - c.spendRate) * k;
        c.tickIncome = 0;
        c.tickSpend = 0;
      }
    }
    if (Math.round(s.t) % HISTORY_EVERY === 0) this.sample();
    s.rngState = this.rng.state;
  }

  private sample() {
    const s = this.s;
    const h: HistorySample = {
      t: s.t,
      glob: [...s.glob],
      seed: s.seedValue,
      moneyDev: s.moneyDev,
      cash: s.cities.map((c) => c.cash),
      pop: s.cities.map((c) => c.residents),
      happy: s.cities.map((c) => c.happiness),
      price: s.cities.map((c) => c.storage.map((st) => (st.trace?.side === "sell" ? st.sell : st.buy))),
      stock: s.cities.map((c) => c.storage.map((st) => st.amount)),
      minted: s.ledger.minted + s.ledger.gifts,
      taxed: s.ledger.taxed,
    };
    s.history.push(h);
    if (s.history.length > HISTORY_LEN) s.history.splice(0, s.history.length - HISTORY_LEN);
  }

  // ------------------------------------------------------------------ ledger
  /** Coins in circulation: city treasuries plus cash riding in wagons. */
  circulating(): number {
    return psum(this.s.cities.map((c) => c.cash)) + psum(this.s.traders.map((t) => t.budget));
  }

  /** What circulation should be from the ledger alone. Equal to circulating() up to rounding. */
  expectedCirculating(): number {
    const l = this.s.ledger;
    return l.start + l.minted + l.gifts - l.taxed;
  }

  // ------------------------------------------------------------------ player actions
  giftCash(ci: number, amount: number) {
    const c = this.s.cities[ci];
    c.cash += amount;
    this.s.ledger.gifts += amount;
    this.emit("player", 1, `You gave ${c.name} ${amount} coins. Watch the money supply term and the labour seed.`, { city: ci });
  }

  loseStock(ci: number, g: number, frac: number) {
    const st = this.s.cities[ci].storage[g];
    const lost = Math.floor(st.amount * frac);
    st.amount -= lost;
    st.flowAcc -= lost;
    this.emit("player", 1, `Fire! ${this.s.cities[ci].name} lost ${lost} ${this.gname(g)}.`, { city: ci, good: g });
  }

  setTax(ci: number, tax: number) {
    const c = this.s.cities[ci];
    c.tax = tax;
    this.emit("player", 1, `${c.name}'s tax is now ${pct(tax)}.`, { city: ci, key: `tax-${ci}` });
  }

  setSubsidy(ci: number, g: number, on: boolean) {
    const c = this.s.cities[ci];
    c.storage[g].subsidy = on;
    this.emit("player", 1, `${c.name} ${on ? "now subsidises" : "stopped subsidising"} ${this.gname(g)}.`, { city: ci, good: g });
  }

  toggleBuilding(ci: number, bi: number) {
    const c = this.s.cities[ci];
    const b = c.buildings[bi];
    b.enabled = !b.enabled;
    this.emit("player", 1, `${c.name}'s ${this.recipeOf[b.good]!.name.toLowerCase()} is ${b.enabled ? "back at work" : "shut down"}.`, {
      city: ci,
      good: b.good,
    });
  }

  addBuyer(ci: number) {
    this.s.traders.push(this.newTrader(this.s.nextTraderId++, ci));
    this.emit("player", 1, `${this.s.cities[ci].name} got an extra wagon.`, { city: ci });
  }

  removeBuyer(ci: number) {
    const idx = this.s.traders.findIndex((t) => t.home === ci && t.task === "idle");
    if (idx < 0) return false;
    const tr = this.s.traders[idx];
    this.release(tr, true);
    this.returnCash(tr);
    this.s.traders.splice(idx, 1);
    this.emit("player", 1, `${this.s.cities[ci].name} retired a wagon.`, { city: ci });
    return true;
  }
}
