# trade-simulation-learn

Notes and a minimal simulation of the trade/economy layer of *Let Them Trade*, worked out by reverse engineering the shipped game binary (UE 5.5).

- [`economy_model.md`](economy_model.md): how the economy works. Covers port pricing (a PID controller plus bias terms mapped into a price band), the global price layer and its labour-seeded theoretical prices, taxes, liquidity feedback, city buyers (the cities' own wagons, which carry the trade in the shipped game), the dormant guild life cycle (branches, leases, firing, bankruptcy), production, and residents (consumption, happiness, income, migration). Each claim is tagged by confidence: `[code]`, `[defaults]` or `[struct]`.
- [`ltt_sim.py`](ltt_sim.py): a self-contained Python simulation (no dependencies) with a fixed set of cities, trade ports and city buyers. The guild layer can be turned on with `--guilds`. There are no bandits, knights, tiles or research.

```
python ltt_sim.py --seconds 7200 --report-every 1200 --csv run.csv
```

The simulation is an original implementation of the described mechanics, not game code.
