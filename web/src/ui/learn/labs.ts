// Experiments ("labs"): each sets the world up, asks for a prediction, runs, then compares.
// They come after the course lessons and assume the ideas those lessons teach.

import type { Engine } from "../../engine/engine";
import { coins, num, pct } from "../format";
import type { Store } from "../store";

export interface Lab {
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

export const LABS: Lab[] = [
  {
    title: "Fire in the granary",
    lesson: "Shocks travel down supply chains",
    world: "realm",
    intro: [
      "Grain from Goldfield becomes flour in Millbrook's mills, then bread in its bakeries, then dinner in every town: a [[supply-chain]].",
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
      "New coins only come from residents' pay. The economy compares the cash cities hold with twice the value of all goods, and pushes prices up when there's too much cash ([[money-supply]]).",
      "It does that twice: directly on each realm-wide price, and through the [[labour-seed]], the value of one unit of work that every cost-to-make is built from.",
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
      "Residents get happier when their needs are met and sadder when bread or fish runs out. Happier than the houses are full? People move in ([[migration]]). Less? They leave, and with them their pay and their work.",
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
      "A wagon's [[route-score]] is the [[margin]] it can earn minus [[haulage]], divided by the trip time. Highcairn's only road is the long Cairn Pass.",
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
