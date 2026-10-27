// Guided chapters. Each is a small experiment: set the world up, predict, run, compare.

import { useState } from "preact/hooks";
import type { Engine } from "../../engine/engine";
import { coins, num, pct } from "../format";
import { type Store, store, useStore } from "../store";

interface Chapter {
  title: string;
  lesson: string; //   one line under the title
  intro: string[];
  world: "realm" | "reference";
  setup: (s: Store) => Record<string, number>;
  question: string;
  options: string[];
  answer: number;
  run: number; //      simulated seconds
  explain: string;
  result: (e: Engine, memo: Record<string, number>) => string;
}

const city = (e: Engine, name: string) => e.s.cities.findIndex((c) => c.name === name);

function tripsInto(e: Engine, ci: number, since: number) {
  return e.s.events.filter((ev) => ev.kind === "trip" && ev.city === ci && ev.t > since).reduce((a, ev) => a + ev.count, 0);
}

const CHAPTERS: Chapter[] = [
  {
    title: "Every port wants to be half full",
    lesson: "Stock targets drive everything",
    world: "realm",
    intro: [
      "Each town has one port. All its goods pass through it, and for every good the port aims to keep its storage half full: 50 of 100.",
      "Below the target the port buys; above it, it sells. Kingsbridge, the capital, makes no food, so its bread store is nearly empty. The panel on the right (or below) now shows its bread price.",
    ],
    setup: (s) => {
      const e = s.engine;
      const k = city(e, "Kingsbridge");
      const g = e.gi.bread;
      s.select({ kind: "price", city: k, good: g }, false);
      return { k, g, buy: e.s.cities[k].storage[g].buy, t: e.s.t };
    },
    question: "Kingsbridge is short of bread. What will its port do to the price it offers for bread?",
    options: ["Raise it, step by step", "Lower it, to save money", "Leave it alone until bread arrives"],
    answer: 0,
    run: 40,
    explain:
      "The shortage adds to the port's priority, and a higher priority moves the offer up through its buy band, at most about 1% a second. A higher offer makes the trip to Kingsbridge worth more to wagons.",
    result: (e, m) => {
      const st = e.s.cities[m.k].storage[m.g];
      return `Offer went from ${coins(m.buy)} to ${coins(st.buy)} while stock went to ${st.amount}. Priority is ${num(st.priority)}.`;
    },
  },
  {
    title: "Priority, not price",
    lesson: "Why prices can't run away",
    world: "realm",
    intro: [
      "Ports never set a price directly. They compute a priority between 0 and 1 from a handful of reasons (the stock gap, its trend, cash, the gap to the realm-wide price) and map it into a band around the realm-wide price.",
      "Oakhollow cuts far more wood than anyone needs. Its storage is overflowing.",
    ],
    setup: (s) => {
      const e = s.engine;
      const o = city(e, "Oakhollow");
      const g = e.gi.wood;
      s.select({ kind: "price", city: o, good: g }, false);
      s.set("depth", Math.max(s.depth, 2) as 2 | 3);
      return { o, g, sell: e.s.cities[o].storage[g].sell };
    },
    question: "Oakhollow is drowning in wood. How low can its asking price go?",
    options: ["All the way to almost nothing", "Only to the bottom of its sell band, half the realm-wide price", "It can't lower it at all"],
    answer: 1,
    run: 60,
    explain:
      "A full warehouse pushes the selling priority up, which slides the asking price down the sell band, but the band ends at 0.5 × the realm-wide price. The realm-wide price itself only drifts slowly, so local gluts can't crash it.",
    result: (e, m) => {
      const t = e.s.cities[m.o].storage[m.g].trace!;
      return `Asking price ${coins(m.sell)} → ${coins(t.after)}; the floor of the band is ${coins(t.sellBand[0])} and the realm-wide price ${coins(t.global)}.`;
    },
  },
  {
    title: "Wagons pull goods home",
    lesson: "Demand-driven trade",
    world: "realm",
    intro: [
      "In Let Them Trade the trade is done by each town's own wagons, the city buyers. They only fetch: they never carry their home town's goods away. Exports happen when other towns' wagons come to buy.",
      "The game's code also has merchant guilds with branches and leases, but nothing in the shipped game ever founds one, so they are left out here.",
    ],
    setup: (s) => {
      const e = s.engine;
      const k = city(e, "Kingsbridge");
      const w = e.s.traders.find((t) => t.home === k)!;
      s.select({ kind: "wagon", id: w.id }, false);
      return { k, t: e.s.t };
    },
    question: "Who decides that bread travels from Millbrook to Kingsbridge?",
    options: ["Millbrook, which sends its surplus out", "Kingsbridge's own wagons, which go and fetch it", "A merchant guild looking for profit"],
    answer: 1,
    run: 90,
    explain:
      "Each wagon scores every port it could fetch from (margin minus haulage, per minute) and drives to the best one. It borrows the money from home and gives every coin back after the trip.",
    result: (e, m) => `${tripsInto(e, m.k, m.t)} wagon loads reached Kingsbridge in those 90 seconds. Open a trip in the Feed to see its receipt.`,
  },
  {
    title: "Fire in the granary",
    lesson: "Shocks travel down supply chains",
    world: "realm",
    intro: [
      "Grain from Goldfield becomes flour in Millbrook's mills, then bread in its bakeries, then dinner in every town.",
      "We'll burn 90% of Goldfield's grain and empty Millbrook's grain store.",
    ],
    setup: (s) => {
      const e = s.engine;
      const gf = city(e, "Goldfield");
      const mb = city(e, "Millbrook");
      e.loseStock(gf, e.gi.grain, 0.9);
      e.loseStock(mb, e.gi.grain, 1);
      s.select({ kind: "price", city: mb, good: e.gi.grain }, false);
      return { gf, mb, gsell: e.s.cities[gf].storage[e.gi.grain].sell, flour: e.s.cities[mb].storage[e.gi.flour].amount, bread: e.s.cities[mb].storage[e.gi.bread].amount };
    },
    question: "What happens in Millbrook over the next four minutes?",
    options: ["Nothing: bread is made from flour", "Its grain offer climbs and its flour and bread stocks sag", "Bread gets cheaper"],
    answer: 1,
    run: 240,
    explain:
      "Mills wait for grain, so flour stops; bakeries then run out of flour. Each empty store raises that port's priority and offer, which pulls wagons to whoever still has stock, and Goldfield's thin stock lets it ask more.",
    result: (e, m) => {
      const mb = e.s.cities[m.mb];
      return `Millbrook flour ${m.flour} → ${mb.storage[e.gi.flour].amount}, bread ${m.bread} → ${mb.storage[e.gi.bread].amount}; its grain offer is ${coins(mb.storage[e.gi.grain].buy)}. Goldfield's grain asking price went ${coins(m.gsell)} → ${coins(e.s.cities[m.gf].storage[e.gi.grain].sell)}.`;
    },
  },
  {
    title: "Printing money",
    lesson: "Inflation has two channels",
    world: "realm",
    intro: [
      "New coins only come from residents' pay. The economy compares the cash cities hold with twice the value of all goods, and pushes prices up when there's too much cash.",
      "It does that twice: directly on each realm-wide price, and through the labour seed, the value of one unit of work that every cost-to-make is built from.",
    ],
    setup: (s) => {
      const e = s.engine;
      const k = city(e, "Kingsbridge");
      e.giftCash(k, 30000);
      s.set("tab", "learn");
      const avg = e.s.glob.reduce((a, b) => a + b, 0) / e.s.glob.length;
      return { seed: e.s.seedValue, avg, dev: e.s.moneyDev };
    },
    question: "You hand Kingsbridge 30,000 coins. What happens to prices?",
    options: ["Only Kingsbridge's prices jump", "Prices everywhere drift up, slowly", "Nothing: the coins just sit there"],
    answer: 1,
    run: 300,
    explain:
      "The money term and the labour seed use the total cash of all cities, not one town's. So the gift lifts realm-wide prices everywhere, and every port prices around those, at the slow global rates rather than in a jump.",
    result: (e, m) => {
      const avg = e.s.glob.reduce((a, b) => a + b, 0) / e.s.glob.length;
      return `Labour seed ${num(m.seed)} → ${num(e.s.seedValue)}; average realm-wide price ${coins(m.avg)} → ${coins(avg)} (${pct(avg / m.avg - 1)}). Watch the Economy tab for the controller at work.`;
    },
  },
  {
    title: "Happy towns grow",
    lesson: "Supply feeds population",
    world: "realm",
    intro: [
      "Residents get happier when their needs are met and sadder when bread or fish runs out. Happier than the houses are full? People move in. Less? They leave, and with them their pay and their work.",
      "We'll shut both of Millbrook's bakeries. Kingsbridge still has one.",
    ],
    setup: (s) => {
      const e = s.engine;
      const mb = city(e, "Millbrook");
      e.s.cities[mb].buildings.forEach((b, i) => b.good === e.gi.bread && b.enabled && e.toggleBuilding(mb, i));
      s.select({ kind: "city", city: city(e, "Kingsbridge") }, false);
      return { pop: e.s.cities.reduce((a, c) => a + c.residents, 0), happy: e.s.cities.reduce((a, c) => a + c.happiness, 0) / e.s.cities.length };
    },
    question: "With most bakeries closed, what happens to the realm over the next 7 minutes?",
    options: ["Bread runs short, happiness falls and people start leaving", "Bread gets cheaper", "Nothing changes: people don't need bread"],
    answer: 0,
    run: 420,
    explain:
      "Missing bread costs up to 0.35 happiness. Happiness moves slowly (1% of the gap a second), so the exodus lags the shortage, which is exactly what makes these economies feel alive.",
    result: (e, m) => {
      const pop = e.s.cities.reduce((a, c) => a + c.residents, 0);
      const happy = e.s.cities.reduce((a, c) => a + c.happiness, 0) / e.s.cities.length;
      return `Population ${m.pop} → ${pop}, average happiness ${num(m.happy)} → ${num(happy)}. Reopen the bakeries from Millbrook's page to watch it recover.`;
    },
  },
  {
    title: "Distance costs",
    lesson: "Haulage decides which routes pay",
    world: "realm",
    intro: [
      "A wagon's score for a route is the margin it can earn minus haulage, divided by the trip time. Highcairn's only road is the long Cairn Pass.",
    ],
    setup: (s) => {
      const e = s.engine;
      const h = city(e, "Highcairn");
      s.select({ kind: "city", city: h }, false);
      return { h, k: city(e, "Kingsbridge"), t: e.s.t };
    },
    question: "Highcairn and Kingsbridge both need food. Whose wagons bring home more loads per wagon?",
    options: ["Highcairn's", "About the same", "Kingsbridge's"],
    answer: 2,
    run: 300,
    explain:
      "Every Highcairn trip crosses the pass, so the margin has to cover a long haul and the trip takes longer. Routes that just about pay for Kingsbridge often don't pay for Highcairn, so its food stocks swing harder.",
    result: (e, m) => {
      const per = (ci: number) => tripsInto(e, ci, m.t) / Math.max(1, e.s.traders.filter((t) => t.home === ci).length);
      return `Loads per wagon in 5 minutes: Highcairn ${num(per(m.h), 1)}, Kingsbridge ${num(per(m.k), 1)}.`;
    },
  },
  {
    title: "What the fixes fix",
    lesson: "The reference engine's quirks",
    world: "reference",
    intro: [
      "This loads the exact four-town world of ltt_sim.py, the Python reference, including its quirks. One quirk: a port's income and spending are kept as 60-second sums but read as per-second rates.",
      "So a port compares its cash with 60× its real spending, and rich ports think they're about to go broke.",
    ],
    setup: (s) => {
      s.reset("reference", s.seed);
      s.select({ kind: "city", city: 0 }, false);
      return {};
    },
    question: "After a few minutes, Ashford holds thousands of coins. Does its port act as if it's short of cash?",
    options: ["No, it's rich", "Yes: its buy prices get a 'low on cash' push"],
    answer: 1,
    run: 400,
    explain:
      "In the Realm the engine keeps true per-second rates, so a rich port's liquidity term is zero. The Reference world exists so the engine can be checked against Python tick for tick.",
    result: (e) =>
      `Liquidity push per town (0 = no cash worries): ${e.s.cities.map((c) => `${c.name} ${num(c.liquidity)} with ${coins(c.cash)} c`).join(", ")}.`,
  },
];

type Phase = "intro" | "predict" | "running" | "reveal";

export function Learn() {
  const s = useStore();
  const [idx, setIdx] = useState<number | null>(s.learnChapter);
  const [phase, setPhase] = useState<Phase>("intro");
  const [pick, setPick] = useState<number | null>(null);
  const [memo, setMemo] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Set<number>>(new Set());

  if (idx === null) {
    return (
      <div class="learn">
        {!s.onboarded && (
          <div class="welcome">
            <h2>A working economy, opened up</h2>
            <p>
              Seven towns trade by wagon. Every price, trip and coin follows the rules recovered from <i>Let Them Trade</i>, and every number can tell you why it is what
              it is.
            </p>
            <ol class="small">
              <li>Tap a town on the map to see what it makes, needs and pays.</li>
              <li>Press ▶ to start time. Wagons set off when a trip pays.</li>
              <li>Or start a chapter below: each is a two-minute experiment.</li>
            </ol>
          </div>
        )}
        <ul class="chapters">
          {CHAPTERS.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                class="row-btn chapter"
                onClick={() => {
                  setIdx(i);
                  s.learnChapter = i;
                  setPhase("intro");
                  setPick(null);
                }}
              >
                <span class="ch-n num">{i + 1}</span>
                <span class="ch-t">
                  <b>{c.title}</b>
                  <span class="small muted">{c.lesson}</span>
                </span>
                {done.has(i) && <span class="pill ok">done</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const ch = CHAPTERS[idx];
  const back = () => {
    s.cancelRun();
    setIdx(null);
    s.learnChapter = null;
    s.emit();
  };
  return (
    <div class="learn">
      <div class="crumbs">
        <button type="button" class="link" onClick={back}>
          ← All chapters
        </button>
        <span class="muted small">
          Chapter {idx + 1} of {CHAPTERS.length}
        </span>
      </div>
      <h2 class="title">{ch.title}</h2>
      {ch.intro.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {phase === "intro" && (
        <button
          type="button"
          class="btn"
          onClick={() => {
            store.setRunning(false);
            if (ch.world !== store.scenarioId) store.reset(ch.world, store.seed);
            if (store.engine.s.t < 30) store.advance(30 - store.engine.s.t); // let ports price first
            setMemo(ch.setup(store));
            setPhase("predict");
          }}
        >
          Set it up
        </button>
      )}
      {phase !== "intro" && s.selection && (
        <p class="small">
          <button type="button" class="link" onClick={() => s.set("tab", "inspect")}>
            Look at it in Inspect →
          </button>{" "}
          <span class="muted">(come back with the Learn tab)</span>
        </p>
      )}
      {(phase === "predict" || phase === "running" || phase === "reveal") && (
        <div class="predict">
          <p>
            <b>Predict:</b> {ch.question}
          </p>
          <div class="options" role="radiogroup" aria-label="Your prediction">
            {ch.options.map((o, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={pick === i}
                disabled={phase !== "predict"}
                class={`option${pick === i ? " on" : ""}${phase === "reveal" && i === ch.answer ? " right" : ""}${phase === "reveal" && pick === i && i !== ch.answer ? " wrong" : ""}`}
                onClick={() => setPick(i)}
              >
                {o}
              </button>
            ))}
          </div>
          {phase === "predict" && (
            <button
              type="button"
              class="btn"
              disabled={pick === null}
              onClick={() => {
                setPhase("running");
                store.runFor(ch.run, () => setPhase("reveal"), ch.run > 200 ? 40 : 16);
              }}
            >
              Run {ch.run >= 120 ? `${Math.round(ch.run / 60)} minutes` : `${ch.run} seconds`}
            </button>
          )}
          {phase === "running" && (
            <p class="running small">
              Running… {Math.max(0, Math.round((store.runningUntil ?? s.engine.s.t) - s.engine.s.t))} s of simulated time to go. Watch the map.
            </p>
          )}
          {phase === "reveal" && (
            <div class={`reveal ${pick === ch.answer ? "right" : "wrong"}`}>
              <p>
                <b>{pick === ch.answer ? "Right." : "Not quite."}</b> {ch.explain}
              </p>
              <p class="observed">
                <b>What happened:</b> {ch.result(s.engine, memo)}
              </p>
              <div class="btn-row">
                {idx + 1 < CHAPTERS.length && (
                  <button
                    type="button"
                    class="btn"
                    onClick={() => {
                      setDone(new Set([...done, idx]));
                      setIdx(idx + 1);
                      s.learnChapter = idx + 1;
                      setPhase("intro");
                      setPick(null);
                    }}
                  >
                    Next chapter
                  </button>
                )}
                <button
                  type="button"
                  class="btn ghost"
                  onClick={() => {
                    setDone(new Set([...done, idx]));
                    back();
                  }}
                >
                  Back to chapters
                </button>
                {ch.world === "reference" && (
                  <button type="button" class="btn ghost" onClick={() => store.reset("realm", store.seed)}>
                    Back to the Realm
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
