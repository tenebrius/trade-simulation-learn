// A scenario is the static world: goods, recipes, needs, cities and roads. The engine reads
// nothing else, so a new world needs no engine change.

export interface GoodDef {
  id: string;
  name: string;
  icon: string; //  short glyph for the map and lists
  color: string;
}

export interface RecipeDef {
  inputs: Record<string, number>;
  out: number; //       units per cycle
  seconds: number; //   seconds per cycle at full staffing
  labour: number; //    inhabitant units per cycle (the base input of the theoretical price)
  name: string; //      building name, e.g. "Bakery"
}

export interface NeedDef {
  kind?: "food" | "luxury" | "construction";
  rate: number; //      units per resident per second
  supply: number; //    happiness bonus x satisfaction (luxuries)
  under: number; //     happiness penalty x shortfall (necessities)
}

export interface CityDef {
  name: string;
  pos: [number, number];
  residents: number;
  capacity: number;
  buildings: string[]; // output good of each building
  blurb?: string;
  cash?: number;
  buyers?: number; //   city buyers (wagons); default NumCityBuyers = 2
  stock?: Record<string, number>; // overrides the random start for these goods
}

export interface ScenarioOptions {
  /** true = reproduce ltt_sim.py exactly, quirks included (see docs/PLAN.md). false = fixed engine. */
  quirks: boolean;
  /** Route score subtracts path length x this (economy_model 5.4). */
  transportCost: number;
  /** Starting stock is drawn uniformly from this range unless a city sets its own. */
  startStock: [number, number];
  /** Construction goods: their max buy price is multiplied by 10 (economy_model 3.2). */
  construction: string[];
  tax: number;
  /** Wagon speed (map units per second) and capacity. Python: 1 and 10. */
  wagonSpeed: number;
  wagonCapacity: number;
}

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  goods: GoodDef[];
  recipes: Record<string, RecipeDef>;
  needs: Record<string, NeedDef>;
  cities: CityDef[];
  /** Road segments between city indices; empty = straight lines between every pair. */
  roads: { a: number; b: number; via?: [number, number][] }[];
  options: ScenarioOptions;
}
