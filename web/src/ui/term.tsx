// Tappable words. <Term id="band">band</Term> underlines a word; tapping it opens a short definition
// at the bottom of the screen. <Rich text="..."/> turns [[band]] or [[band|price range]] markers in
// course text into Terms, so lessons can link words without writing markup by hand.

import type { ComponentChildren } from "preact";
import { GLOSSARY } from "./learn/glossary";
import { store, useStore } from "./store";

export function Term({ id, children }: { id: string; children?: ComponentChildren }) {
  const def = GLOSSARY[id];
  if (!def) return <>{children}</>;
  return (
    <button
      type="button"
      class="term"
      aria-haspopup="dialog"
      onClick={(ev) => {
        ev.stopPropagation();
        store.openTerm(id);
      }}
    >
      {children ?? def.word.toLowerCase()}
    </button>
  );
}

const MARK = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;

/** Course text with [[id]] / [[id|shown words]] links and **bold**. */
export function Rich({ text }: { text: string }) {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index! > last) out.push(...bold(text.slice(last, m.index), out.length));
    out.push(
      <Term key={`t${out.length}`} id={m[1]}>
        {m[2] ?? GLOSSARY[m[1]]?.word.toLowerCase() ?? m[1]}
      </Term>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...bold(text.slice(last), out.length));
  return <>{out}</>;
}

function bold(s: string, k: number): ComponentChildren[] {
  return s.split(/\*\*([^*]+)\*\*/g).map((part, i) => (i % 2 ? <b key={`b${k}-${i}`}>{part}</b> : part));
}

/** The definition sheet, shown above everything while a term is open. */
export function TermSheet() {
  const s = useStore();
  const id = s.termOpen;
  if (!id) return null;
  const def = GLOSSARY[id];
  if (!def) return null;
  return (
    <div class="term-backdrop" onClick={() => s.openTerm(null)}>
      <div class="term-sheet" role="dialog" aria-modal="true" aria-labelledby="term-title" onClick={(ev) => ev.stopPropagation()}>
        <div class="term-head">
          <h2 id="term-title">{def.word}</h2>
          <button type="button" class="icon-btn small" aria-label="Close" onClick={() => s.openTerm(null)}>
            ✕
          </button>
        </div>
        <p>{def.short}</p>
        {def.example && (
          <p class="term-example">
            <b>Example:</b> {def.example}
          </p>
        )}
        {def.related && def.related.length > 0 && (
          <div class="term-related">
            <span class="small muted">See also</span>
            {def.related
              .filter((r) => GLOSSARY[r])
              .map((r) => (
                <button key={r} type="button" class="chip" onClick={() => s.openTerm(r)}>
                  {GLOSSARY[r].word}
                </button>
              ))}
          </div>
        )}
        <button
          type="button"
          class="link"
          onClick={() => {
            s.termOpen = null;
            s.tab = "learn";
            s.learnView = "glossary";
            s.emit();
          }}
        >
          All words →
        </button>
      </div>
    </div>
  );
}
