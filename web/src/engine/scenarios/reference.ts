import type { Scenario } from "../scenario";

/** The exact world of ltt_sim.py. Used for the parity test against Python and selectable in the
 * app as "Reference". Fixes and extras are switched off so behaviour matches line for line. */
export const reference: Scenario = {
  id: "reference",
  name: "Reference (ltt_sim.py)",
  blurb: "The 4-city world of the Python reference simulation, with no fixes. Matches it tick for tick.",
  goods: [
    { id: "grain", name: "Grain", icon: "🌾", color: "#c9a227" },
    { id: "wood", name: "Wood", icon: "🪵", color: "#8b5a2b" },
    { id: "fish", name: "Fish", icon: "🐟", color: "#3a86c8" },
    { id: "flour", name: "Flour", icon: "🥣", color: "#d8cfc0" },
    { id: "bread", name: "Bread", icon: "🍞", color: "#d08a3c" },
    { id: "tools", name: "Tools", icon: "🔨", color: "#7a7f87" },
  ],
  recipes: {
    grain: { inputs: {}, out: 2, seconds: 10, labour: 1, name: "Farm" },
    wood: { inputs: {}, out: 2, seconds: 10, labour: 1, name: "Woodcutter" },
    fish: { inputs: {}, out: 1, seconds: 8, labour: 1, name: "Fishery" },
    flour: { inputs: { grain: 2 }, out: 2, seconds: 10, labour: 1, name: "Mill" },
    bread: { inputs: { flour: 2 }, out: 3, seconds: 12, labour: 1, name: "Bakery" },
    tools: { inputs: { wood: 3 }, out: 1, seconds: 15, labour: 2, name: "Toolmaker" },
  },
  needs: {
    bread: { rate: 0.0025, supply: 0.0, under: -0.35 },
    fish: { rate: 0.0015, supply: 0.0, under: -0.2 },
    tools: { rate: 0.0004, supply: 0.15, under: 0.0 },
  },
  cities: [
    { name: "Ashford", pos: [0, 0], residents: 30, capacity: 60, buildings: ["grain", "grain", "flour", "bread"] },
    { name: "Brindle", pos: [40, 10], residents: 30, capacity: 50, buildings: ["wood", "wood", "tools", "fish"] },
    { name: "Corran", pos: [15, 45], residents: 30, capacity: 45, buildings: ["fish", "fish", "grain", "flour"] },
    { name: "Dunmere", pos: [55, 50], residents: 25, capacity: 55, buildings: ["wood", "bread", "tools"] },
  ],
  roads: [],
  options: { transportCost: 0, reserveOrders: false, keepUnsold: false, startStock: [10, 40] },
};
