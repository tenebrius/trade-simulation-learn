// Turn the single-file build (dist-single/index.html) into a claude.ai artifact page: the host adds
// the doctype/html/head/body skeleton, so keep only title, metas, links, styles, the root and script.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist-single/index.html", "utf8");
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const parts = [
  ...pick(/<title>[\s\S]*?<\/title>/g),
  ...pick(/<meta name="(?:claude:viewport-fit-sides|description)"[^>]*>/g),
  ...pick(/<link\s+rel="(?:preconnect|stylesheet)"[^>]*>/g),
  ...pick(/<style[^>]*>[\s\S]*?<\/style>/g),
  '<div id="app"></div>',
  ...pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/g),
];
if (parts.filter((p) => p.startsWith("<script")).length !== 1) throw new Error("expected exactly one inlined script");
writeFileSync("dist-single/artifact.html", parts.join("\n"));
console.log(`dist-single/artifact.html: ${(parts.join("\n").length / 1024).toFixed(0)} KB`);
