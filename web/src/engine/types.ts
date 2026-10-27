// Plain, JSON-cloneable simulation state. Everything the UI shows is read from here; the UI never
// recomputes a formula, so the explanations cannot drift from what the engine actually did.

export type Side = "buy" | "sell";

export interface Term {
  key: string;
  label: string; //     short human label
  value: number; //     contribution to the raw priority sum
  formula: string; //   the term written out with live numbers
}

/** How a port arrived at this tick's price for one good (economy_model section 3). */
export interface PriceTrace {
  side: Side;
  amount: number;
  desired: number;
  rel: number; //           missing (buy) or surplus (sell) fraction
  buyBand: [number, number];
  sellBand: [number, number];
  mean: number;
  global: number;
  theo: number;
  localValue: number;
  terms: Term[];
  raw: number;
  priority: number;
  target: number;
  before: number;
  stepCap: number;
  urgency: number;
  step: number;
  smooth: number;
  after: number;
  clamped: boolean;
  liquidity: number; //     liquidity factor (0 = fine, 1 = broke)
  subsidised: boolean;
}

export interface PortGood {
  amount: number;
  max: number;
  desiredFill: number;
  buy: number;
  sell: number;
  trend: number;
  integral: number;
  smooth: number; //        shared smoother (quirks) / buy-side smoother
  smoothSell: number; //    sell-side smoother (fixed engine)
  priority: number;
  flowAcc: number;
  localValue: number;
  reservedOut: number; //   units wagons have committed to take away
  reservedIn: number; //    units wagons are bringing
  subsidy: boolean;
  trace: PriceTrace | null;
  announced: number; //     last price mentioned in the feed (for "big move" events)
  short: boolean; //        currently empty while needed
}

export type BuildingState = "running" | "inputs" | "full" | "noworkers" | "off";

export interface Building {
  good: number;
  progress: number;
  running: boolean;
  workers: number;
  state: BuildingState;
  enabled: boolean;
}

export interface HappinessPart {
  label: string;
  value: number;
}

export interface MigrationTrace {
  occupancy: number;
  h: number;
  direction: "in" | "out" | "none";
  rate: number; //          probability per slot per second
  moved: number; //         +1 / -1 / 0 this tick
}

export interface CityState {
  name: string;
  pos: [number, number];
  residents: number;
  capacity: number;
  buildings: Building[];
  cash: number;
  tax: number;
  taxPaid: number; //       total tax collected at this port
  storage: PortGood[];
  incomeRate: number;
  spendRate: number;
  tickIncome: number;
  tickSpend: number;
  newPortTimer: number;
  happiness: number;
  target: number;
  happinessParts: HappinessPart[];
  satisfaction: number[]; //  per need, in scenario need order
  consumeAcc: number[]; //    per good
  payTimer: number;
  lastPay: number;
  minted: number;
  employed: number;
  migration: MigrationTrace;
  liquidity: number;
  liquidityTime: number;
  disparity: number;
  broke: boolean;
}

export interface Load {
  good: number;
  qty: number;
}

export interface Candidate {
  src: number;
  dst: number;
  load: Load[];
  profit: number; //        sum of qty x (buy - sell)
  cost: number; //          purchase cost at the source
  time: number; //          seconds for the whole trip
  transport: number; //     path length x transport cost
  value: number; //         score per minute
  verdict: string;
}

export interface PlanTrace {
  t: number;
  r: number;
  noise: number;
  baseline: number;
  candidates: Candidate[];
  chosen: number; //        index into candidates, -1 = none
  outcome: string;
}

export interface TripReceipt {
  t: number;
  src: number;
  dst: number;
  borrowed: number;
  bought: { good: number; qty: number; price: number; toPort: number; tax: number }[];
  delivered: { good: number; qty: number; price: number; tax: number }[];
  lost: Load[];
  returned: number;
  margin: number;
}

export type Task = "idle" | "to_source" | "to_dest" | "unloading";

export interface Cargo {
  good: number;
  qty: number;
  paid: number;
}

export interface TraderState {
  id: number;
  home: number;
  city: number; //          where it is, or where the current leg started
  from: number; //          leg start (for animation)
  to: number; //            leg end
  task: Task;
  route: { src: number; dst: number; load: Load[] } | null;
  routeValue: number;
  cargo: Cargo[];
  budget: number;
  eta: number;
  legTime: number; //       eta at the start of this leg
  switchTimer: number;
  profitAvg: number;
  reserved: Load[]; //      what this wagon has reserved at the source / destination
  waitTimer: number;
  plan: PlanTrace | null;
  trip: TripReceipt | null;
  lastTrip: TripReceipt | null;
}

export interface DriftParts {
  meanPull: number;
  theoPull: number;
  money: number;
  share: number;
  before: number;
  after: number;
}

export interface GlobalTrace {
  volume: number[];
  totalVolume: number;
  goodsValue: number;
  theoValue: number;
  cash: number;
  moneyDev: number;
  seedErr: number;
  seedFactor: number; //  1.1 or -0.9 this tick
  seedBefore: number;
  drift: DriftParts[];
  orders: { volume: number; mean: number }[];
}

export type EventKind =
  | "trip"
  | "empty"
  | "shortage"
  | "restocked"
  | "price"
  | "migration"
  | "blocked"
  | "broke"
  | "lost"
  | "player"
  | "seed"
  | "info";

export interface SimEvent {
  id: number;
  t: number;
  kind: EventKind;
  sig: 1 | 2 | 3; //   1 = headline, 2 = notable, 3 = detail
  text: string;
  city?: number;
  good?: number;
  trader?: number;
  count: number;
  key: string;
  receipt?: TripReceipt;
}

export interface HistorySample {
  t: number;
  glob: number[];
  seed: number;
  moneyDev: number;
  cash: number[];
  pop: number[];
  happy: number[];
  price: number[][]; //  [city][good]: the active side's price
  stock: number[][];
  minted: number;
  taxed: number;
}

export interface Ledger {
  start: number; //       coins in circulation at t = 0
  minted: number; //      resident pay
  gifts: number; //       coins added by the player
  taxed: number; //       coins paid to the crown
}

export interface SimState {
  t: number;
  rngState: number;
  seedValue: number;
  seedDelta: number;
  theo: number[];
  mean: number[];
  glob: number[];
  moneyDev: number;
  cities: CityState[];
  traders: TraderState[];
  nextTraderId: number;
  global: GlobalTrace | null;
  ledger: Ledger;
  treasury: number;
  events: SimEvent[];
  nextEventId: number;
  history: HistorySample[];
}
