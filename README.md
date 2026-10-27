# trade-simulation-learn

Notes and a minimal simulation of the trade/economy layer of *Let Them Trade*, worked out by reverse engineering the shipped game binary (UE 5.5).

- [`economy_model.md`](economy_model.md): how the economy works. Covers port pricing (a PID controller plus bias terms mapped into a price band), the global price layer and its labour-seeded theoretical prices, taxes, liquidity feedback, city buyers (the cities' own wagons, which carry the trade in the shipped game), the dormant guild life cycle (branches, leases, firing, bankruptcy), production, and residents (consumption, happiness, income, migration). Each claim is tagged by confidence: `[code]`, `[defaults]` or `[struct]`.
- [`ltt_sim.py`](ltt_sim.py): a self-contained Python simulation (no dependencies) with a fixed set of cities, trade ports and city buyers. The guild layer can be turned on with `--guilds`. There are no bandits, knights, tiles or research.

```
python ltt_sim.py --seconds 7200 --report-every 1200 --csv run.csv
```

The simulation is an original implementation of the described mechanics, not game code.

## Economy explorer (web app)

[`web/`](web) is a browser version built for learning how the economy works. It is mobile-first and also works on desktop:

- an animated map of seven specialised towns, with wagons driving the roads;
- every price, wagon decision, trip and coin explained. A *Simple / Detailed / Maths* switch sets how deep the explanations go, from plain sentences to the formulas with live numbers;
- a causal chain for any shortage: stock → priority → price → route score → wagons;
- a feed of what just happened, with receipts showing who paid whom;
- experiments using the game's own levers (tax, subsidies) and shocks (fire, cash gifts, closed workshops), with a before/after pin;
- eight guided chapters, each one predict → run → compare.

The engine (`web/src/engine`) is a TypeScript port of `ltt_sim.py` without the dormant guild layer.

- **Reference world:** reproduces the Python tick for tick, checked by `web/test/parity.test.ts` through `tools/parity.py`.
- **Realm world:** fixes the Python quirks a learner would trip over; [`docs/PLAN.md`](docs/PLAN.md) lists them.

```
cd web
npm install
npm run dev           # local dev server
npm test              # engine invariants + parity with ltt_sim.py (needs python3)
npm run build         # static site in web/dist
npm run build:single  # one self-contained HTML file in web/dist-single
npx tsx scripts/tune.ts realm 7200   # headless run with balance statistics
```

`.github/workflows/pages.yml` runs the tests and deploys `web/dist` to GitHub Pages on every push to `main`. Pages has to be enabled once in the repository settings, with "GitHub Actions" as the source.
