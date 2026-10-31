// The course. Each lesson teaches one idea in a few short cards, points at the live simulation
// with "Show me", and ends with one question. Words in [[double brackets]] link to the glossary.
// Lessons build on each other: nothing is used before the lesson that explains it.

import type { Store } from "../store";

export interface Check {
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export interface Card {
  title: string;
  body: string[];
  show?: { label: string; run: (s: Store) => void };
  check?: Check;
}

export interface Lesson {
  id: string;
  title: string;
  idea: string; // the one-sentence takeaway
  cards: Card[];
}

export interface Unit {
  title: string;
  blurb: string;
  lessons: Lesson[];
}

const city = (s: Store, name: string) => Math.max(0, s.engine.s.cities.findIndex((c) => c.name === name));
const good = (s: Store, id: string) => s.engine.gi[id];

/** Start lessons in a settled world: past the first 400 s, when every port still gets a start-up
 * bonus that would hide the reasons the lessons talk about. Keep the map in view. */
const SETTLED = 420;
function warm(s: Store) {
  if (s.engine.s.t < SETTLED) s.advance(SETTLED - s.engine.s.t);
  if (s.sheet === "full") s.sheet = "half";
}

function showPrice(s: Store, town: string, g: string, depth?: 1 | 2 | 3) {
  warm(s);
  if (depth && s.depth < depth) s.depth = depth;
  s.select({ kind: "price", city: city(s, town), good: good(s, g) });
}

function showMarket(s: Store, g: string) {
  warm(s);
  s.marketGood = good(s, g);
  s.tab = "market";
  s.emit();
}

export const UNITS: Unit[] = [
  {
    title: "The world",
    blurb: "What is on the map, who makes what, and who lives there.",
    lessons: [
      {
        id: "map",
        title: "What you're looking at",
        idea: "Seven towns, each with one warehouse-and-market, trading by wagon.",
        cards: [
          {
            title: "Towns",
            body: [
              "Each circle on the map is a [[town]]. Every town makes a few [[good|goods]] and needs others. Nobody makes everything, so towns have to trade.",
              "Kingsbridge in the middle is the capital. It is the biggest town and grows no food at all.",
            ],
            show: { label: "Show me Kingsbridge", run: (s) => (warm(s), s.select({ kind: "city", city: city(s, "Kingsbridge") })) },
          },
          {
            title: "The port",
            body: [
              "A town keeps all its goods in one place, its [[port]]. Think of it as the town's warehouse and shop counter in one.",
              "Each good has room for 100 units. The bar next to a good shows its [[stock]]: how many are there now.",
            ],
            show: { label: "Show me Kingsbridge's port", run: (s) => (warm(s), s.select({ kind: "city", city: city(s, "Kingsbridge") })) },
          },
          {
            title: "Wagons",
            body: [
              "The small coloured blocks are [[wagon|wagons]]. Each town owns a few, in the town's colour.",
              "A wagon drives to another town, buys something its home town is missing, and brings it back. That is the only way goods move between towns.",
            ],
            show: { label: "Run 30 seconds and watch them", run: (s) => (warm(s), s.runFor(30, () => {}, 4)) },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Where does a town keep its goods?",
              options: ["In each workshop", "In its port", "In its wagons"],
              answer: 1,
              why: "Everything a town has sits in its port. Workshops take from it and put back into it; wagons bring goods to it.",
            },
          },
        ],
      },
      {
        id: "making",
        title: "Making things",
        idea: "Workshops turn goods into other goods, and those steps link into chains across towns.",
        cards: [
          {
            title: "Workshops and recipes",
            body: [
              "A [[workshop]] turns some goods into others by a fixed [[recipe]]. A mill turns 2 grain into 2 flour; a bakery turns 2 flour into 3 bread.",
              "Farms, fisheries, woodcutters, clay pits and sheep farms need only workers: they make raw goods from nothing but work.",
            ],
            show: { label: "Show me Millbrook's workshops", run: (s) => (warm(s), s.select({ kind: "city", city: city(s, "Millbrook") })) },
          },
          {
            title: "Workers and stopping",
            body: [
              "Each workshop needs up to 8 workers, taken from the town's residents. Half the workers means half the speed.",
              "A workshop stops when its ingredients run out, or when the port has no room for what it makes. The town page says which.",
            ],
          },
          {
            title: "Supply chains",
            body: [
              "Recipes link up into a [[supply-chain]]: Goldfield grows grain, Millbrook mills it into flour and bakes the flour into bread, and every town eats the bread.",
              "A gap anywhere stops everything after it.",
            ],
            show: { label: "Show me Goldfield", run: (s) => (warm(s), s.select({ kind: "city", city: city(s, "Goldfield") })) },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Millbrook's mills run out of grain. What stops next?",
              options: ["Goldfield's farms", "Millbrook's bakeries", "Nothing"],
              answer: 1,
              why: "No grain means no flour, and the bakeries need flour. The farms keep going; they only need workers.",
            },
          },
        ],
      },
      {
        id: "people",
        title: "People",
        idea: "Residents work, eat and pay; happy towns grow and unhappy towns shrink.",
        cards: [
          {
            title: "Residents and needs",
            body: [
              "[[resident|Residents]] work in the workshops and eat from the port. Their [[needs]]: bread and fish (food), cloth (a [[luxury]]), and bricks for building.",
            ],
          },
          {
            title: "Happiness",
            body: [
              "[[happiness|Happiness]] runs from 0 to 1. Fed, employed people with cloth are happy; running out of bread is the biggest blow.",
              "It changes slowly: a shortage shows up in happiness a minute or two later.",
            ],
            show: { label: "Show me Kingsbridge's happiness", run: (s) => (warm(s), s.select({ kind: "city", city: city(s, "Kingsbridge") })) },
          },
          {
            title: "Moving in and out",
            body: [
              "Happy towns attract people until every house is full; unhappy towns lose them. That is [[migration]]. Any town at happiness 0.5 or more fills up.",
              "More people means more workers, more eating, and more coins for the town.",
            ],
          },
          {
            title: "Residents pay",
            body: [
              "Every 10 seconds each resident hands the town a few coins, more when happy. This [[pay]] is the only way new coins come into existence.",
            ],
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "A town's bread runs out and stays out. What happens?",
              options: ["Happiness falls and people start leaving", "Its prices fall", "Nothing, people don't need bread"],
              answer: 0,
              why: "Missing bread costs a lot of happiness. Once happiness drops below what the full houses need, people move away.",
            },
          },
        ],
      },
    ],
  },
  {
    title: "Prices",
    blurb: "How a town decides what to pay and what to ask. This is the heart of the simulation.",
    lessons: [
      {
        id: "target",
        title: "Half full is the goal",
        idea: "Below half full a port buys; above it, it sells.",
        cards: [
          {
            title: "The target",
            body: [
              "Every port wants each good's storeroom half full: 50 of 100. That amount is its [[target]].",
              "The thin black tick on every stock bar marks it.",
            ],
            show: { label: "Show me Kingsbridge's port", run: (s) => (warm(s), s.select({ kind: "city", city: city(s, "Kingsbridge") })) },
          },
          {
            title: "Shortage and surplus",
            body: [
              "Below the target the port has a [[shortage]] and **buys**. Above it the port has a [[surplus]] and **sells**.",
              "A very big surplus that nobody comes to buy is called a [[glut]]: Oakhollow's wood is one.",
            ],
          },
          {
            title: "Blue buys, amber sells",
            body: [
              "For each good a port is either buying or selling, never both. Everywhere in the app, blue means buying and amber means selling.",
              "The Market tab shows one good across all seven towns.",
            ],
            show: { label: "Show me bread in every town", run: (s) => showMarket(s, "bread") },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "A port holds 80 wood. Is it buying or selling wood?",
              options: ["Buying", "Selling", "Neither"],
              answer: 1,
              why: "80 is above the target of 50, so it has a surplus of 30 and sells.",
            },
          },
        ],
      },
      {
        id: "eagerness",
        title: "How eager is the port?",
        idea: "A port first works out how badly it wants a good, then turns that into a price.",
        cards: [
          {
            title: "Eagerness first",
            body: [
              "A port doesn't pick a price out of the air. It first works out its eagerness, called [[priority]]: a number from 0 (not bothered) to 1 (desperate).",
            ],
          },
          {
            title: "Where eagerness comes from",
            body: [
              "It adds up several [[term|reasons]]. The big ones when buying:",
              "**How empty the store is**: emptier means more eager. **How long it has been short**: a shortage that drags on keeps adding eagerness. **Its cash cushion**: a town running low on coins holds back ([[liquidity]]). **Other towns' prices**: if it already pays more than the [[realm-price]], it holds back.",
              "Selling works the same way in reverse: a fuller store makes it more eager to sell.",
              "In its first few minutes every port also gets a [[new-port|new-port bonus]] to get trade going. The lessons start after it has faded.",
            ],
          },
          {
            title: "See the reasons",
            body: [
              "The price page draws each reason as a bar: green pushes eagerness up, red pulls it down. Their sum, kept between 0 and 1, is the eagerness.",
            ],
            show: { label: "Show me bread in Kingsbridge", run: (s) => showPrice(s, "Kingsbridge", "bread") },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Which makes a port MORE eager to buy bread?",
              options: ["Its bread store has been empty for minutes", "A wagon full of bread just arrived", "It is running out of coins"],
              answer: 0,
              why: "A long shortage keeps adding eagerness. Fresh bread arriving and low cash both hold it back.",
            },
          },
        ],
      },
      {
        id: "band",
        title: "The price range (band)",
        idea: "Eagerness picks a spot inside a fixed range around the realm-wide price, so prices can't run away.",
        cards: [
          {
            title: "The realm-wide price",
            body: [
              "Each good has a [[realm-price]]: roughly what it goes for across all towns. It changes slowly, over minutes. Lesson 12 explains how.",
            ],
          },
          {
            title: "The band",
            body: [
              "A port's price must stay inside a [[band]] around the realm-wide price. When buying it may offer between **0.7×** and **1.5×** the realm-wide price. When selling it may ask between **0.5×** and **1.3×**.",
              "So buyers can always offer a bit more than sellers ask. That gap is what pays for the wagons.",
            ],
          },
          {
            title: "Eagerness picks the spot",
            body: [
              "Buying: eagerness 0 aims at the cheap end of the band, 1 at the top. Selling is reversed: the more eager to sell, the cheaper it asks.",
              "However empty or full a store gets, its price stays inside the band.",
            ],
            show: { label: "Show me the band for bread in Kingsbridge", run: (s) => showPrice(s, "Kingsbridge", "bread", 2) },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "The realm-wide price of bread is 10. What is the most any port will offer for bread?",
              options: ["10", "15", "As much as it takes"],
              answer: 1,
              why: "The top of the buy band is 1.5 × 10 = 15. A desperate port offers 15 and no more.",
            },
          },
        ],
      },
      {
        id: "slow",
        title: "Prices move slowly",
        idea: "A price creeps toward its target about 1% a second, so nothing jumps.",
        cards: [
          {
            title: "Creeping, not jumping",
            body: [
              "Eagerness gives a target price, but the actual price moves toward it by at most about 1% a second, smoothed over a few seconds.",
              "A bigger gap moves a little faster, up to 1.5% a second.",
            ],
          },
          {
            title: "Watch it",
            body: ["Kingsbridge's bread price is on screen. Run a minute and watch its history chart climb or ease."],
            show: { label: "Run 60 seconds", run: (s) => (showPrice(s, "Kingsbridge", "bread"), s.runFor(60, () => {}, 8)) },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "A price is 10 and its target jumps to 20. Roughly where is it one second later?",
              options: ["About 10.1", "15", "20"],
              answer: 0,
              why: "It moves at most about 1% a second, so 10 becomes about 10.1, and it takes over a minute to get near 20.",
            },
          },
        ],
      },
    ],
  },
  {
    title: "Trade",
    blurb: "How wagons decide where to go, and where the coins end up.",
    lessons: [
      {
        id: "fetch",
        title: "Wagons fetch, they don't deliver",
        idea: "A town's wagons only bring goods home; a town exports only when others come to buy.",
        cards: [
          {
            title: "Only fetching",
            body: [
              "Each [[wagon]] works for its home town. It drives out, buys what home is short of, and brings it home.",
              "It never carries its own town's goods away to sell. A town sells only when other towns' wagons come to it.",
            ],
          },
          {
            title: "When a trip is possible",
            body: [
              "A trip needs a town that is **selling** a good and a home town that is **buying** it, and the home's offer must be higher than the seller's asking price.",
              "That difference per unit is the [[margin]].",
            ],
            show: { label: "Show me bread in every town", run: (s) => showMarket(s, "bread") },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Millbrook has lots of bread. How does it get to Kingsbridge?",
              options: ["Millbrook's wagons deliver it", "Kingsbridge's wagons fetch it", "It doesn't"],
              answer: 1,
              why: "Wagons only fetch for home. Kingsbridge's wagons drive to Millbrook and buy it.",
            },
          },
        ],
      },
      {
        id: "route",
        title: "Choosing a trip",
        idea: "Wagons pick the trip that earns the most margin per minute after the cost of the road.",
        cards: [
          {
            title: "Loading up",
            body: [
              "A wagon at home looks at each other town: what could it buy there that home wants, and at what margin? It fills its 12 slots with the best-paying goods first, so loads are often mixed.",
            ],
          },
          {
            title: "The route score",
            body: [
              "From the margin it takes off [[haulage]], the cost of the road, then divides by how long the trip takes. That gives a [[route-score]]: margin per minute.",
              "So a short trip with a small margin can beat a long trip with a big one.",
            ],
          },
          {
            title: "A little randomness",
            body: [
              "Each time it plans, the wagon draws a [[noise|random bar]] that it must clear before switching routes. That stops every wagon piling onto the same best route.",
              "Wagons also [[reservation|reserve]] what they plan to buy, so two don't race for the same goods.",
            ],
            show: {
              label: "Show me a Kingsbridge wagon's choices",
              run: (s) => {
                warm(s);
                const w = s.engine.s.traders.find((t) => t.home === city(s, "Kingsbridge") && t.plan) ?? s.engine.s.traders[0];
                s.select({ kind: "wagon", id: w.id });
              },
            },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Route A: margin 40, trip 2 minutes. Route B: margin 20, trip 40 seconds. Which scores higher?",
              options: ["A", "B", "The same"],
              answer: 1,
              why: "A earns 20 a minute; B earns 30 a minute. The wagon takes B.",
            },
          },
        ],
      },
      {
        id: "money-flow",
        title: "Who pays whom",
        idea: "Home pays the seller and the crown; the margin is a score, not a profit.",
        cards: [
          {
            title: "A trip's money",
            body: [
              "The wagon takes a [[loan]] from home for the purchase, pays the seller's asking price, brings the goods home, and hands back every coin it has left.",
            ],
          },
          {
            title: "Tax",
            body: [
              "On every trade the [[crown]] takes [[tax]], 10%, at both ends. Coins paid as tax leave the towns for good.",
            ],
          },
          {
            title: "Margin isn't profit",
            body: [
              "The wagon belongs to its town, so nobody pockets the margin. Home just pays the seller plus tax. The margin only decided which trip was worth making.",
              "Every finished trip in the Feed has a receipt: tap one.",
            ],
            show: { label: "Show me the Feed", run: (s) => (warm(s), s.set("tab", "feed")) },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Where does the 10% tax go?",
              options: ["To the selling town", "To the crown: out of the economy", "Back to the wagon"],
              answer: 1,
              why: "Tax goes to the crown, and those coins never come back to any town.",
            },
          },
        ],
      },
    ],
  },
  {
    title: "Money and the big picture",
    blurb: "Where coins come from, what anchors prices, and why everything slowly gets dearer.",
    lessons: [
      {
        id: "income",
        title: "Where a town's money comes from",
        idea: "Two incomes (residents' pay and sales), one expense (imports), one drain (tax).",
        cards: [
          {
            title: "In and out",
            body: [
              "A town earns from residents' [[pay]] (brand-new coins) and from selling to other towns' wagons (coins moving between towns). It spends only on what its own wagons buy, plus tax.",
            ],
            show: { label: "Show me the coin ledger", run: (s) => (warm(s), s.set("tab", "economy")) },
          },
          {
            title: "Rich towns and poor towns",
            body: [
              "Towns that sell dear goods (bread, cloth) gather coins; towns that sell cheap raw goods (wood, clay) lean on their residents' pay.",
              "A town low on coins has a thin [[liquidity|cash cushion]]: it offers less and sells harder until it recovers.",
            ],
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Which is the only way NEW coins appear?",
              options: ["Selling goods", "Residents' pay", "Tax"],
              answer: 1,
              why: "Sales only move coins from one town to another, and tax removes coins. Residents' pay creates them.",
            },
          },
        ],
      },
      {
        id: "realm",
        title: "The realm-wide price",
        idea: "One slow price per good anchors every port.",
        cards: [
          {
            title: "How it moves",
            body: [
              "Every second each good's [[realm-price]] moves a little toward what ports are offering for it (1% of the gap) and toward its [[cost-to-make]] (0.2% of the gap).",
            ],
          },
          {
            title: "An anchor",
            body: [
              "Because it moves so slowly, it works like an anchor: local prices swing around it within their bands, while it shifts over minutes.",
            ],
            show: { label: "Show me realm-wide prices", run: (s) => (warm(s), s.set("depth", Math.max(s.depth, 2) as 2 | 3), s.set("tab", "economy")) },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "One town's bread store burns down. What happens to the realm-wide price of bread?",
              options: ["It jumps at once", "It drifts up slowly as that town offers more", "Nothing at all"],
              answer: 1,
              why: "The town offers more, which nudges the average offer up, and the realm-wide price follows at 1% of the gap a second.",
            },
          },
        ],
      },
      {
        id: "labour",
        title: "Labour is the measure of value",
        idea: "Costs are counted in work, one number prices that work, and it rises as coins pile up.",
        cards: [
          {
            title: "Counting in work",
            body: [
              "Every good's [[cost-to-make]] is counted in work: bread costs the work of farming, milling and baking.",
              "One number, the [[labour-seed]], says what one unit of work is worth in coins.",
            ],
          },
          {
            title: "Why prices creep up",
            body: [
              "The labour seed rises when towns hold lots of coins compared with what their goods are worth. Residents keep adding coins and only tax removes them, so the seed and every price drift upward: [[inflation]].",
            ],
            show: { label: "Show me the labour seed", run: (s) => (warm(s), s.set("tab", "economy")) },
          },
          {
            title: "Seeing through it",
            body: [
              "To compare prices without inflation, switch on [[real-prices]] in the Market tab: every price divided by the labour seed. What's left is real scarcity.",
            ],
            show: { label: "Show me real prices", run: (s) => (showMarket(s, "bread"), s.set("real", true)) },
          },
          {
            title: "Check",
            body: [],
            check: {
              q: "Why do all prices slowly rise even when nothing is scarce?",
              options: ["Wagons get slower", "Residents keep creating coins, so labour is worth more", "Tax keeps rising"],
              answer: 1,
              why: "More coins → higher labour seed → higher cost to make for every good → realm-wide prices follow.",
            },
          },
        ],
      },
    ],
  },
];

export const LESSONS: Lesson[] = UNITS.flatMap((u) => u.lessons);

export function lessonNumber(id: string) {
  return LESSONS.findIndex((l) => l.id === id) + 1;
}
