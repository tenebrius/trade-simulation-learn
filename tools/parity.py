"""Run ltt_sim.py with the mulberry32 RNG and dump a per-tick state trace as JSON.

The web engine's "reference" scenario is checked against this trace (web/test/parity.test.ts),
so a change to either side that alters behaviour shows up as a test failure.

    python tools/parity.py --seconds 600 --seed 7 > web/test/fixtures/parity_seed7.json
"""
import argparse
import json
import math
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import ltt_sim  # noqa: E402
from mulberry import Mulberry32  # noqa: E402

# Same generator as the web engine, and a plain sqrt distance so both sides round identically.
ltt_sim.random = types.SimpleNamespace(Random=Mulberry32)
ltt_sim.City.dist = lambda self, other: math.sqrt(
    (self.pos[0] - other.pos[0]) ** 2 + (self.pos[1] - other.pos[1]) ** 2)


def state(eco):
    return {
        "t": eco.t,
        "seed": eco.seed_value,
        "seedDelta": eco.seed_delta,
        "glob": [eco.glob[g] for g in ltt_sim.GOODS],
        "theo": [eco.theo[g] for g in ltt_sim.GOODS],
        "cities": [{
            "cash": c.cash,
            "residents": c.residents,
            "happiness": c.happiness,
            "amount": [c.storage[g].amount for g in ltt_sim.GOODS],
            "buy": [c.storage[g].buy_price for g in ltt_sim.GOODS],
            "sell": [c.storage[g].sell_price for g in ltt_sim.GOODS],
        } for c in eco.cities],
        "traders": [{"task": t.task, "city": t.city.name, "budget": t.budget} for t in eco.buyers],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=600)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--every", type=int, default=1)
    a = ap.parse_args()
    eco = ltt_sim.Economy(a.seed)
    out = {"seed": a.seed, "goods": ltt_sim.GOODS, "states": [state(eco)]}
    for s in range(a.seconds):
        eco.step()
        if (s + 1) % a.every == 0:
            out["states"].append(state(eco))
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
