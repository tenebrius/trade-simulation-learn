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
}

export interface ScenarioOptions {
  /** Route value subtracts path length x this (economy_model 5.4). 0 = the Python behaviour. */
  transportCost: number;
  /** Fixes on top of ltt_sim.py; all off in the reference scenario so it matches Python exactly. */
  reserveOrders: boolean; //   wagons reserve the surplus/shortfall they plan to move (5.1)
  keepUnsold: boolean; //      unsold cargo is carried home instead of being thrown away
  /** Starting stock is drawn uniformly from this range. */
  startStock: [number, number];
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
