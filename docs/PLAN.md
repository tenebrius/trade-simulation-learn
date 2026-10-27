# Plan: browser simulation that explains itself

Status: **v3 (final)**: draft v1 → self-review → v2 → independent review → v3 → final self-review (scope cuts at the end). Milestones 1–4 are implemented; see the README for how to run it.

## Goal

Turn the reverse-engineered *Let Them Trade* economy (`economy_model.md`, `ltt_sim.py`) into a browser simulation where a non-expert can **see and understand** what moves goods, prices and coins. It runs in the browser and is built mobile-first (portrait phone, 360–430 px wide), and it scales up to desktop.

The guild layer is dormant in the shipped game (section 5.5), so the web app leaves it out entirely. City buyers carry all the trade.

## Product pillars

1. **Animated map, full screen.** Cities on a road network; wagons drive along the roads with cargo icons. Each city shows a single "pressure" ring for its biggest shortage and a cash badge. Trades pop briefly; above 4×, pops are aggregated.
2. **Explain in layers.** A *Depth* switch controls how much is shown:
   - **Simple**: stock, price, wagons, a plain-language *why*.
   - **Detailed**: adds the top priority terms, route scores and the happiness parts.
   - **Maths**: adds full equations with live numbers, bands, the global layer and the labour seed.
   The *why* sentences come from the dominant terms ("Bread is getting dearer in Brindle: stock is 86% below target and the port has cash to spare").
3. **Causal chain.** For any shortage, a tappable *Why?* chain follows it through: shortage → priority up → buy price up → route score up → wagon dispatched → stock refills → price relaxes. Each link jumps to the live numbers.
4. **Event feed that can be read.** By default the feed shows significant events: shortages, migrations, broke ports, big price moves, blocked production, and trades summarised per wagon trip. Repeats are merged ("×3"). Filters by city or good; an "all" level for detail. Each item expands into a receipt.
5. **Experiment and compare.** Pause, single-step, speed up (1×, 4×, 16×). Game-real controls: per-city tax, per-good subsidy. Shocks: cash gift, stock loss, shutting a building, adding a wagon. **Snapshot / compare**: freeze a "before", run, and see the deltas.
6. **Learn by doing.** A 60-second guided first run (paused start, a highlighted shortage, "tap Brindle"). Then chapters, each a small scripted experiment: setup, then *predict*, then run, then an explanation of what happened.

## Architecture

- `web/`: Vite + TypeScript + Preact. Static build, no server. The only runtime dependency is Preact.
- `web/src/engine/`: pure TS, no DOM. Deterministic (mulberry32 RNG). Scenario-driven: cities, roads, goods, recipes, needs and options.
- `web/src/ui/`: Preact components.
  - The map is SVG with pinch/pan and a "fit" button. Wagons are moved by writing transforms straight to pooled DOM nodes in one `requestAnimationFrame` loop, interpolated between ticks, so Preact never renders at 60 fps.
  - Panels re-render at most ~5×/s.
  - The engine runs on the main thread with a cap on ticks per frame (measured; a Worker is overkill for this size). The sim pauses while the tab is hidden.
- Python stays the reference implementation and is not changed.

## Engine

### Scope
Port production, residents (consumption, happiness, migration, pay), local values, port pricing, global prices and the labour seed, and city buyers. No guilds.

### Quirks vs fixes, and parity
`ltt_sim.py` has behaviours that would confuse a learner. Each fix sits behind a `quirks` flag:

| Quirk in ltt_sim.py | Fix (Realm) |
|---|---|
| income/spend "rates" are 60 s sums, so liquidity time is ~60× too short and rich ports act broke | per-second moving averages |
| the switching baseline is the stale value the old route had when chosen | baseline re-valued now; a candidate must beat the best so far *and* noise × baseline (model 5.2), so a high draw makes a wagon stick to its route |
| several wagons chase the same surplus (19% of trips find nothing to load) | wagons reserve what they plan to move (model 5.1) |
| cash borrowed for an empty pickup stays in the wagon | returned to the home port |
| delivery home is paid like a purchase from a stranger; goods that don't fit or can't be paid for vanish | a home delivery is an internal transfer (only tax is a real payment); overflow waits in the wagon, and loss is a loud, rare event |
| buy and sell prices share one smoother; the inactive side is ratcheted outside its band | a smoother per side; the inactive side is held inside its band |
| a building with 0 workers still consumes inputs | it does not start a cycle |
| smoother windup at the band edge | the smoother is reset when clamped |
| volumes ignore cargo in transit | in-transit cargo counts (model 2) |
| no absolute price step cap | cap of C × 0.00033 × dt (model 2) |

- **Reference** scenario: quirks on. Same world as Python. Tested against a Python trace (`tools/parity.py` runs `ltt_sim.py` with the same RNG and CPython's compensated `sum()`, reproduced in TS). Matching is exact (≤ 1e-9) up to the first divergence; the test reports the tick where it diverges and requires at least 600 identical ticks.
- **Realm** scenario (default): quirks off. Each fix gets its own unit test.

### Money
- Residents mint coins (model 6.2). Taxes go to the **Crown treasury** and leave circulation. That gives the ledger an explicit source and sink: Δ(city cash + wagon cash) = pay − taxes. A test checks this every tick.
- Inflation is a real feature of the model. The UI shows it rather than hiding it:
  - an Economy card for minting vs taxes;
  - a **Real prices** toggle that divides by the labour seed ("hours of labour"), separating inflation from scarcity;
  - an experiment where the tax rate is raised to see the sink work.
- **Construction demand**: cities consume a construction good (bricks) for building, with the model's ×10 cap on its max buy price. This gives a third kind of demand besides food and luxury.

### Realm scenario
7 cities, 10 goods, a road network with one long mountain pass so distance and transport cost matter.

- Raw goods: grain, fish, wood, clay, wool.
- Intermediates: flour (grain), planks (wood).
- Finished goods: bread (flour), the necessity with a strong penalty; cloth (wool), the luxury with a supply bonus only; bricks (clay + planks), for construction.
- Each city specialises in one or two industries:
  - a farm town;
  - a fishing port;
  - a forest town;
  - a clay-pit town;
  - a sheep highland;
  - a mill and bakery hub;
  - a capital with large housing, no raw output and the most cash. The capital makes inbound flows visible.
- Asymmetric starting stock, so the first two minutes already show a shortage → price rise → wagon dispatch.

### Traces (cheap; recomputed each tick)
- port × good: side, stock vs desired, band, named priority terms, raw sum, clamped priority, target, step cap, urgency, smoothed delta, new price, and the *why* sentence.
- global: volumes, cash, goods value, money_dev, seed error/step/multiplier, and the per-good drift parts.
- wagon: last plan (noise draw and factor, baseline, candidates with load, score, time, transport cost and verdict) and last trip receipt.
- city: happiness target parts, migration rate and direction, last pay, and building states (running / waiting for inputs / output full / no workers).

### Events and history
- Ring buffer of 600 typed events, each with a significance level; repeats are merged.
- History sampled every 5 ticks for the last 2 simulated hours: global prices, city cash, population, happiness, port prices, labour seed, money_dev, minted and taxed coins.
- 1 tick = 1 simulated second; the clock reads in minutes and hours.

## UI

### Layout
- Phone:
  - The map is full-bleed.
  - A **bottom sheet** with three heights (peek / half / full) holds the panels.
  - A tab bar at the bottom of the sheet: **Feed · Market · Inspect · Economy · Learn**.
  - The play controls float bottom-right above the sheet, for one-handed use.
  - Safe-area insets are respected.
- Desktop (≥ 900 px): map on the left, panel on the right; the same components.
- Tap targets are ≥ 44 px; wagons have an enlarged invisible hit area; labels avoid collisions.

### Explainers
- **Price (city × good)**: stock bar with target; band strip; top-3 terms plus "other" (all terms at Maths depth); equations; *why*; history chart.
- **Wagon**: task, cargo and route on the map; the last plan as cards; the last trip's money receipt.
- **City**: residents and happiness parts, migration with its numbers, pay, buildings with block reasons, port cash and liquidity, and its shortages with a *Why?* chain.
- **Economy**: money supply vs goods value, labour seed controller, global prices (nominal / real), minting vs taxes, ledger.
- **Market**: a good × city grid of price and stock pressure.

### Charts
Small hand-rolled SVG line charts with text summaries, so they are readable without colour.

### Persistence
Scenario, seed and settings go in localStorage and the URL hash, so a setup can be shared.

### Visual design
Light and dark themes via CSS variables. Colour is never the only signal. Respects `prefers-reduced-motion`.

## Tests
- Parity with Python (Reference).
- Determinism (same seed → identical state).
- The money ledger closes every tick (Realm and Reference).
- Prices stay inside their bands; stock and cash never go negative.
- Unit tests per fix; recipe solver; a high noise draw makes a wagon stick to its route.
- Playwright screenshots at 390×844 and 1280×800.

## Delivery
- GitHub Pages workflow building `web/` (the user enables Pages).
- A single-file build published as a claude.ai artifact, so it can be opened on a phone right away.

## Milestones
1. Engine port, quirk flags, parity harness, tests.
2. Map, controls, bottom sheet, guided first run.
3. Explainers (Price, Wagon, City, Economy, Market), feed, charts, depth switch.
4. Learn chapters, experiments, snapshot / compare.
5. Polish (Playwright on phone and desktop, performance check), docs, publish.

## Final review: cuts and risks
- **Cut**: manual price override (no learning value over subsidies); a Web Worker; a 4th speed; a chart library.
- **Risk**: the Realm tuning. Mitigation: a headless tuning script (`web/scripts/tune.ts`) that prints stock fill, price spread, idle wagons and inflation over 2 simulated hours, so I can tune by numbers rather than by eye.
- **Risk**: explainer text drifting from the engine. Mitigation: the *why* sentences and receipts are built only from trace fields, never recomputed in the UI.
