// App state outside the engine: the running loop, speed, selection and view settings. Components
// subscribe through useStore(); the panels re-render at most ~5 times a second while running.

import { useEffect, useReducer } from "preact/hooks";
import { Engine } from "../engine/engine";
import type { Scenario } from "../engine/scenario";
import { realm } from "../engine/scenarios/realm";
import { reference } from "../engine/scenarios/reference";
import type { SimState } from "../engine/types";

export const SCENARIOS: Scenario[] = [realm, reference];

export type Selection =
  | { kind: "city"; city: number }
  | { kind: "wagon"; id: number }
  | { kind: "price"; city: number; good: number }
  | null;

export type Tab = "feed" | "market" | "inspect" | "economy" | "learn";
export type Depth = 1 | 2 | 3;
export type SheetSize = "peek" | "half" | "full";

export interface Pinned {
  t: number;
  state: SimState;
}

const SPEEDS = [1, 4, 16] as const;
const MAX_TICKS_PER_FRAME = 24;
const PANEL_INTERVAL = 200; // ms between panel refreshes while running

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`ltt.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(`ltt.${key}`, JSON.stringify(v));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export class Store {
  engine: Engine;
  scenarioId: string;
  seed: number;
  running = false;
  speed: number = SPEEDS[0];
  depth: Depth = load<Depth>("depth", 1);
  real = false;
  selection: Selection = null;
  tab: Tab = "learn";
  sheet: SheetSize = "half";
  pinned: Pinned | null = null;
  onboarded = load<boolean>("onboarded", false);
  learnChapter: number | null = null;
  /** the course: the open lesson and card, and finished lessons (kept between visits) */
  lesson: { id: string; card: number } | null = load("lesson", null);
  done: string[] = load<string[]>("done", []);
  learnView: "home" | "glossary" = "home";
  /** the glossary entry shown in the definition sheet */
  termOpen: string | null = null;
  /** the good shown in the Market tab (null = the first need) */
  marketGood: number | null = null;
  /** sub-tick progress 0..1, for smooth wagon motion */
  frac = 0;
  version = 0;
  private listeners = new Set<() => void>();
  private lastPanel = 0;
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  frameHooks = new Set<(store: Store) => void>();
  private stopAt: number | null = null;
  private onStop: (() => void) | null = null;
  private speedBefore = 1;

  constructor() {
    const hash = parseHash();
    this.scenarioId = hash.scenario ?? load("scenario", "realm");
    this.seed = hash.seed ?? load("seed", 1);
    this.engine = new Engine(this.scenario(), this.seed);
    if (this.onboarded) this.tab = "feed";
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.running) this.setRunning(false);
    });
  }

  scenario(): Scenario {
    return SCENARIOS.find((s) => s.id === this.scenarioId) ?? realm;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Re-render subscribers now. */
  emit() {
    this.version++;
    this.lastPanel = performance.now();
    for (const fn of this.listeners) fn();
  }

  set<K extends keyof this>(key: K, value: this[K]) {
    this[key] = value;
    if (key === "depth") save("depth", value);
    if (key === "onboarded") save("onboarded", value);
    this.emit();
  }

  openTerm(id: string | null) {
    this.termOpen = id;
    this.emit();
  }

  openLesson(id: string | null, card = 0) {
    this.lesson = id ? { id, card } : null;
    this.learnChapter = null;
    save("lesson", this.lesson);
    this.emit();
  }

  finishLesson(id: string) {
    if (!this.done.includes(id)) this.done = [...this.done, id];
    save("done", this.done);
    this.emit();
  }

  select(sel: Selection, openTab = true) {
    this.selection = sel;
    if (sel && !this.onboarded) {
      this.onboarded = true;
      save("onboarded", true);
    }
    if (sel && openTab) {
      this.tab = "inspect";
      if (this.sheet === "peek") this.sheet = "half";
    }
    this.emit();
  }

  setRunning(on: boolean) {
    if (!on && this.stopAt !== null) {
      this.stopAt = null;
      this.onStop = null;
      this.speed = this.speedBefore;
    }
    this.running = on;
    if (on) {
      this.lastFrame = performance.now();
      this.acc = 0;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
    this.emit();
  }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed as (typeof SPEEDS)[number]);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length];
    this.emit();
  }

  get speeds() {
    return SPEEDS;
  }

  /** Advance whole ticks (Step button, Learn chapters). */
  advance(ticks: number) {
    for (let i = 0; i < ticks; i++) this.engine.step();
    this.frac = 0;
    this.emit();
    for (const h of this.frameHooks) h(this);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += dt * this.speed;
    let n = 0;
    while (this.acc >= 1 && n < MAX_TICKS_PER_FRAME) {
      this.engine.step();
      this.acc -= 1;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) this.acc = 0; // falling behind: drop time rather than spiral
    if (this.stopAt !== null && this.engine.s.t >= this.stopAt) {
      const cb = this.onStop;
      this.stopAt = null;
      this.onStop = null;
      this.speed = this.speedBefore;
      this.running = false;
      this.frac = 0;
      for (const h of this.frameHooks) h(this);
      cb?.();
      this.emit();
      return;
    }
    this.frac = this.acc;
    for (const h of this.frameHooks) h(this);
    if (now - this.lastPanel > PANEL_INTERVAL) this.emit();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Run for a number of simulated seconds at high speed, then pause and call back. */
  runFor(seconds: number, done: () => void, speed = 16) {
    this.speedBefore = this.stopAt === null ? this.speed : this.speedBefore;
    this.stopAt = this.engine.s.t + seconds;
    this.onStop = done;
    this.speed = speed;
    this.setRunning(true);
  }

  get runningUntil() {
    return this.stopAt;
  }

  cancelRun() {
    if (this.stopAt === null) return;
    this.stopAt = null;
    this.onStop = null;
    this.speed = this.speedBefore;
    this.setRunning(false);
  }

  reset(scenarioId = this.scenarioId, seed = this.seed) {
    this.scenarioId = scenarioId;
    this.seed = seed;
    save("scenario", scenarioId);
    save("seed", seed);
    this.engine = new Engine(this.scenario(), seed);
    this.selection = null;
    this.pinned = null;
    this.frac = 0;
    writeHash(scenarioId, seed);
    this.emit();
    for (const h of this.frameHooks) h(this);
  }

  pin() {
    this.pinned = { t: this.engine.s.t, state: this.engine.snapshot() };
    this.emit();
  }
}

function parseHash(): { scenario?: string; seed?: number } {
  // a plain "#realm-7" style hash: scenario id and seed
  const m = /^#([a-z]+)-(\d+)$/.exec(location.hash);
  return m ? { scenario: m[1], seed: Number(m[2]) } : {};
}

function writeHash(scenario: string, seed: number) {
  try {
    history.replaceState(null, "", `#${scenario}-${seed}`);
  } catch {
    /* sandboxed frames may refuse; the hash is only a convenience */
  }
}

export const store = new Store();

export function useStore(): Store {
  const [, force] = useReducer((x: number, _: void) => x + 1, 0);
  useEffect(() => {
    const off = store.subscribe(() => force());
    return () => {
      off();
    };
  }, []);
  return store;
}
