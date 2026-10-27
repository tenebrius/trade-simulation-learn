// The Reference scenario must reproduce ltt_sim.py. tools/parity.py runs the Python with the same
// RNG; this test steps the engine alongside and reports the first tick where any value differs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine";
import { reference } from "../src/engine/scenarios/reference";

const ROOT = resolve(__dirname, "../..");
const TICKS = 1200;

function python(): string | null {
  for (const p of ["python3", "python"]) {
    try {
      execFileSync(p, ["--version"]);
      return p;
    } catch {
      /* try the next */
    }
  }
  return null;
}

const py = python();

describe.skipIf(!py || !existsSync(resolve(ROOT, "ltt_sim.py")))("parity with ltt_sim.py", () => {
  it(`matches Python for ${TICKS} ticks`, () => {
    for (const seed of [7, 11]) {
      const out = execFileSync(py!, [resolve(ROOT, "tools/parity.py"), "--seconds", String(TICKS), "--seed", String(seed)], {
        maxBuffer: 1 << 28,
      }).toString();
      const ref = JSON.parse(out);
      const eng = new Engine(reference, seed);
      const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      let firstDiff = -1;
      let what = "";
      for (let i = 0; i < ref.states.length && firstDiff < 0; i++) {
        if (i > 0) eng.step();
        const p = ref.states[i];
        const s = eng.s;
        const checks: [string, number, number][] = [
          ["seed", s.seedValue, p.seed],
          ...s.glob.map((v, g): [string, number, number] => [`glob ${g}`, v, p.glob[g]]),
        ];
        s.cities.forEach((c, ci) => {
          const pc = p.cities[ci];
          checks.push([`cash ${ci}`, c.cash, pc.cash], [`res ${ci}`, c.residents, pc.residents], [`happy ${ci}`, c.happiness, pc.happiness]);
          c.storage.forEach((st, g) => {
            checks.push([`amount ${ci}/${g}`, st.amount, pc.amount[g]], [`buy ${ci}/${g}`, st.buy, pc.buy[g]], [`sell ${ci}/${g}`, st.sell, pc.sell[g]]);
          });
        });
        s.traders.forEach((t, ti) => checks.push([`budget ${ti}`, t.budget, p.traders[ti].budget]));
        for (const [name, a, b] of checks)
          if (!close(a, b)) {
            firstDiff = i;
            what = `${name}: engine ${a} vs python ${b}`;
            break;
          }
        if (firstDiff < 0)
          s.traders.forEach((t, ti) => {
            if (firstDiff < 0 && t.task !== p.traders[ti].task) {
              firstDiff = i;
              what = `trader ${ti} task ${t.task} vs ${p.traders[ti].task}`;
            }
          });
      }
      expect(firstDiff, `seed ${seed}: first divergence at tick ${firstDiff}: ${what}`).toBe(-1);
    }
  }, 120_000);
});
