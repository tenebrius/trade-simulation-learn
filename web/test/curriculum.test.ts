import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LESSONS, UNITS } from "../src/ui/learn/curriculum";
import { GLOSSARY } from "../src/ui/learn/glossary";
import { LABS } from "../src/ui/learn/labs";

const LINK = /\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g;
const links = (s: string) => [...s.matchAll(LINK)].map((m) => m[1]);

describe("course", () => {
  it("links only to words the glossary defines", () => {
    const texts = [
      ...LESSONS.flatMap((l) => [l.idea, ...l.cards.flatMap((c) => [...c.body, c.check?.why ?? ""])]),
      ...LABS.flatMap((l) => [...l.intro, l.explain]),
    ];
    const missing = texts.flatMap(links).filter((id) => !GLOSSARY[id]);
    expect(missing).toEqual([]);
  });

  it("uses only glossary ids in the panels' <Term id=...>", () => {
    const dir = resolve(__dirname, "../src/ui/panels");
    const ids = readdirSync(dir).flatMap((f) => [...readFileSync(resolve(dir, f), "utf8").matchAll(/<Term id="([^"]+)"/g)].map((m) => m[1]));
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter((id) => !GLOSSARY[id])).toEqual([]);
  });

  it("has related words that exist", () => {
    const bad = Object.entries(GLOSSARY).flatMap(([id, d]) => (d.related ?? []).filter((r) => !GLOSSARY[r]).map((r) => `${id}→${r}`));
    expect(bad).toEqual([]);
  });

  it("has unique lesson ids, one question per lesson, and valid answers", () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      const checks = l.cards.filter((c) => c.check);
      expect(checks.length, l.id).toBe(1);
      const c = checks[0].check!;
      expect(c.answer).toBeGreaterThanOrEqual(0);
      expect(c.answer).toBeLessThan(c.options.length);
    }
    expect(UNITS.length).toBe(4);
  });

  it("introduces a glossary word before an earlier lesson relies on it in a question", () => {
    // every word linked in a lesson's question explanation was linked in that lesson or an earlier one
    const seen = new Set<string>();
    for (const l of LESSONS) {
      for (const c of l.cards) for (const b of c.body) links(b).forEach((id) => seen.add(id));
      const why = l.cards.find((c) => c.check)!.check!.why;
      expect(links(why).filter((id) => !seen.has(id)), l.id).toEqual([]);
    }
  });
});
