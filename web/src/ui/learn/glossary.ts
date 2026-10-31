// Plain-language definitions for every term the app and the course use. Lessons and panels link
// here with [[id]] (see term.tsx), so a word is always one tap away from what it means.

export interface Def {
  word: string;
  short: string; //     one sentence, no other jargon
  example?: string; //  a concrete case from the Realm
  related?: string[];
}

export const GLOSSARY: Record<string, Def> = {
  town: {
    word: "Town",
    short: "A place where people live and work. Each makes a few goods and needs others, so towns must trade.",
    example: "Goldfield grows grain; Kingsbridge, the capital, grows nothing and buys everything.",
    related: ["port", "good"],
  },
  good: {
    word: "Good",
    short: "Anything that can be made, stored, carried and eaten or used: grain, bread, wood, cloth and so on.",
    related: ["recipe", "stock"],
  },
  port: {
    word: "Port",
    short: "A town's one warehouse and market counter. Every good the town has sits here, and all buying and selling happens here.",
    example: "Bread baked in Millbrook goes into Millbrook's port; wagons from other towns buy it there.",
    related: ["stock", "target"],
  },
  stock: {
    word: "Stock",
    short: "How many units of a good a port holds right now. Each good has room for 100.",
    related: ["target", "shortage", "surplus"],
  },
  target: {
    word: "Target",
    short: "How much of each good a port wants to keep: half its room, 50 of 100. Below it the port buys; above it, it sells.",
    related: ["shortage", "surplus"],
  },
  shortage: {
    word: "Shortage",
    short: "Having less of a good than the target. A port with a shortage is buying.",
    example: "Kingsbridge holds 6 bread but wants 50: a shortage of 44.",
    related: ["target", "surplus", "priority"],
  },
  surplus: {
    word: "Surplus",
    short: "Having more of a good than the target. A port with a surplus is selling.",
    example: "Oakhollow holds 90 wood and wants 50: a surplus of 40.",
    related: ["target", "shortage", "glut"],
  },
  glut: {
    word: "Glut",
    short: "A very large surplus: far more of a good than the town wants and more than others come to buy. The asking price sinks to the bottom of its range.",
    example: "Oakhollow cuts much more wood than the realm uses, so its storeroom sits full and its wood is cheap.",
    related: ["surplus", "band"],
  },
  workshop: {
    word: "Workshop",
    short: "A building that turns goods into other goods (or work into raw goods), following a recipe. It needs workers, up to 8.",
    related: ["recipe", "supply-chain"],
  },
  recipe: {
    word: "Recipe",
    short: "What a workshop uses and makes in one round of work.",
    example: "Bakery: 2 flour → 3 bread every 12 seconds.",
    related: ["workshop", "cost-to-make"],
  },
  "supply-chain": {
    word: "Supply chain",
    short: "Recipes linked one after another, often across towns. A gap anywhere stops everything after it.",
    example: "Grain (Goldfield) → flour (Millbrook mill) → bread (Millbrook bakery) → every town's tables.",
    related: ["recipe"],
  },
  resident: {
    word: "Resident",
    short: "A person living in a town. Residents work in workshops, eat from the port and pay coins to the town.",
    related: ["needs", "happiness", "pay"],
  },
  needs: {
    word: "Needs",
    short: "What residents use up every second. Food (bread, fish) is essential; cloth is a luxury that only adds happiness; bricks are for building.",
    related: ["happiness", "luxury"],
  },
  luxury: {
    word: "Luxury",
    short: "A need people enjoy but can live without: having it adds happiness, lacking it costs nothing.",
    example: "Cloth.",
    related: ["needs"],
  },
  happiness: {
    word: "Happiness",
    short: "How content a town's people are, from 0 to 1. It rises when needs are met and people have work, and falls when food runs out. It moves slowly, over a minute or two.",
    related: ["migration", "pay"],
  },
  occupancy: {
    word: "Occupancy",
    short: "How full the houses are: residents divided by housing.",
    related: ["migration"],
  },
  migration: {
    word: "Migration",
    short: "People moving in or out. A town gains people while its happiness is high enough for how full it is, and loses them when happiness falls below that.",
    example: "A town at happiness 0.5 or more fills every house.",
    related: ["happiness", "occupancy"],
  },
  pay: {
    word: "Residents' pay",
    short: "Coins every resident hands to their town every 10 seconds, more when happy. It is the only way new coins enter the economy.",
    related: ["tax", "inflation"],
  },
  "buy-price": {
    word: "Buy price (offer)",
    short: "What a port is willing to pay per unit for a good it is short of. Shown in blue.",
    related: ["sell-price", "priority", "band"],
  },
  "sell-price": {
    word: "Sell price (asking price)",
    short: "What a port asks per unit for a good it has too much of. Shown in amber.",
    related: ["buy-price", "priority", "band"],
  },
  priority: {
    word: "Eagerness (priority)",
    short: "How badly a port wants to buy or sell a good, from 0 (not bothered) to 1 (desperate). It decides where in the price range the port aims.",
    example: "An empty bread store that has stayed empty for minutes pushes eagerness to 1.",
    related: ["band", "shortage", "term"],
  },
  term: {
    word: "Reason (priority term)",
    short: "One of the things the port adds up to get its eagerness: the shortage itself, how long it has lasted, its cash, how its price compares with other towns, and so on.",
    related: ["priority"],
  },
  band: {
    word: "Band (price range)",
    short: "The lowest-to-highest price a port may quote for a good. It sits around the realm-wide price, so no town's price can stray far from what the good is generally worth.",
    example: "Realm-wide bread price 10: a port may offer 7 to 15 when buying, and ask 5 to 13 when selling.",
    related: ["realm-price", "priority"],
  },
  "realm-price": {
    word: "Realm-wide price",
    short: "Roughly what a good goes for across all towns. It changes slowly, over minutes, and every port's price range is built around it.",
    related: ["band", "cost-to-make"],
  },
  "cost-to-make": {
    word: "Cost to make",
    short: "What a good is worth counted in work: the labour to make it plus the cost of its inputs. The realm-wide price is slowly pulled toward it.",
    example: "Bread's cost = the work of farming the grain, milling it and baking it.",
    related: ["labour-seed", "realm-price"],
  },
  "labour-seed": {
    word: "Labour seed",
    short: "What one unit of work is worth in coins. Every cost to make is a multiple of it. It rises when towns hold lots of coins compared with the value of their goods.",
    related: ["cost-to-make", "inflation", "real-prices"],
  },
  inflation: {
    word: "Inflation",
    short: "All prices rising together over time. Here it happens because residents keep adding coins while only tax removes them.",
    related: ["labour-seed", "real-prices", "pay"],
  },
  "real-prices": {
    word: "Real prices",
    short: "Prices divided by the labour seed: what a good costs in work rather than coins. They remove inflation so you can see real scarcity.",
    related: ["inflation", "labour-seed"],
  },
  "money-supply": {
    word: "Money supply term",
    short: "A push on every realm-wide price: up when towns hold more than twice the value of all goods in coins, down when they hold less.",
    related: ["inflation", "realm-price"],
  },
  wagon: {
    word: "Wagon (city buyer)",
    short: "A cart owned by a town. It only fetches: it drives to another town, buys what home is short of, and brings it back.",
    related: ["route-score", "margin"],
  },
  margin: {
    word: "Margin",
    short: "How much more the home town offers for a good than the other town asks for it. A trip is only worth making when the margin covers the road.",
    example: "Millbrook asks 20 for bread, Kingsbridge offers 22: a margin of 2 per loaf.",
    related: ["haulage", "route-score"],
  },
  haulage: {
    word: "Haulage",
    short: "The cost of the road: a little per unit of distance driven. Long routes need bigger margins to be worth it.",
    related: ["margin", "route-score"],
  },
  "route-score": {
    word: "Route score",
    short: "How good a trip looks to a wagon: margin minus haulage, per minute of travel. The wagon picks the best score.",
    example: "Margin 24, haulage 2, 44-second trip: about 29 per minute.",
    related: ["margin", "haulage", "noise"],
  },
  noise: {
    word: "Random bar",
    short: "Each time a wagon plans it draws a random number that raises or lowers how much better a new route must be. It spreads wagons over routes instead of all chasing the best one.",
    related: ["route-score"],
  },
  reservation: {
    word: "Reservation",
    short: "Goods a wagon has claimed on its way to buy them, so another wagon doesn't race it for the same load.",
    related: ["wagon"],
  },
  loan: {
    word: "Loan",
    short: "Coins a wagon borrows from its home town to pay for what it buys. Every coin left over goes back home after the trip.",
    related: ["wagon", "tax"],
  },
  tax: {
    word: "Tax",
    short: "A cut of every trade (10%) paid to the crown. It is the only way coins leave the economy.",
    related: ["crown", "pay"],
  },
  crown: {
    word: "Crown",
    short: "Where tax goes. Coins paid to the crown are gone from the towns for good.",
    related: ["tax"],
  },
  liquidity: {
    word: "Cash cushion (liquidity)",
    short: "How long a town's coins would last at its current spending. Under 5 minutes, the port bids less and sells harder until it recovers.",
    related: ["priority"],
  },
  "local-value": {
    word: "Local value",
    short: "What a good is worth to this particular town, such as what its ingredients cost here. A port resists selling below it and paying far above it.",
    related: ["priority"],
  },
  subsidy: {
    word: "Subsidy",
    short: "A player setting that makes a port extra eager to buy a good and lets its price move faster.",
    related: ["priority"],
  },
  tick: {
    word: "Tick",
    short: "One step of the simulation: one simulated second. Everything is updated once per tick, in a fixed order.",
  },
  "new-port": {
    word: "New-port bonus",
    short: "Extra eagerness every port gets for its first 400 seconds, so trade starts quickly. It fades to nothing.",
    related: ["priority"],
  },
};

export const glossaryIds = Object.keys(GLOSSARY);
