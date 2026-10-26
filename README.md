# trade-simulation-learn

Notes and a minimal simulation of the trade/economy layer of *Let Them Trade*, worked out by reverse engineering the shipped game binary (UE 5.5).

- [`economy_model.md`](economy_model.md): how the economy works. Covers port pricing (a PID controller plus bias terms mapped into a price band), the global price layer, taxes, liquidity feedback, and guild/trader/city parameters. Each claim is tagged by confidence: `[code]`, `[defaults]` or `[struct]`.
- [`ltt_sim.py`](ltt_sim.py): a self-contained Python simulation (no dependencies) with a fixed set of cities, trade ports, guilds and traders. There are no bandits, knights, tiles or research.

```
python ltt_sim.py --seconds 7200 --report-every 1200 --csv run.csv
```

The simulation is an original implementation of the described mechanics, not game code.
