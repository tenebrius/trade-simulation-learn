// The Learn tab: a course of short lessons (one idea each), experiments, and a glossary.

import { useEffect, useState } from "preact/hooks";
import { GLOSSARY, glossaryIds } from "../learn/glossary";
import { type Lesson, LESSONS, UNITS, lessonNumber } from "../learn/curriculum";
import { LABS } from "../learn/labs";
import { Rich } from "../term";
import { store, useStore } from "../store";

const labId = (i: number) => `lab-${i}`;

export function Learn() {
  const s = useStore();
  if (s.learnView === "glossary") return <Glossary />;
  if (s.learnChapter !== null) return <LabView idx={s.learnChapter} />;
  const lesson = s.lesson && LESSONS.find((l) => l.id === s.lesson!.id);
  if (lesson) return <LessonView lesson={lesson} card={s.lesson!.card} />;
  return <Home />;
}

function startLesson(id: string) {
  store.setRunning(false);
  if (store.scenarioId !== "realm") store.reset("realm", store.seed);
  if (store.sheet === "full") store.sheet = "half"; // keep the map in view
  store.openLesson(id, 0);
}

// ---------------------------------------------------------------- home
function Home() {
  const s = useStore();
  const doneLessons = LESSONS.filter((l) => s.done.includes(l.id)).length;
  const next = LESSONS.find((l) => !s.done.includes(l.id));
  return (
    <div class="learn">
      <div class="course-head">
        <h2>Learn how this economy works</h2>
        <p class="small">
          {LESSONS.length} short lessons, one idea each, in an order where every lesson builds on the last. Each takes two or three minutes and ends with one
          question. Underlined words open a plain definition.
        </p>
        <div class="progress-row">
          <div class="progress-bar" role="img" aria-label={`${doneLessons} of ${LESSONS.length} lessons done`}>
            <span style={{ width: `${(100 * doneLessons) / LESSONS.length}%` }} />
          </div>
          <span class="small num">
            {doneLessons}/{LESSONS.length}
          </span>
        </div>
        <div class="btn-row">
          {next ? (
            <button type="button" class="btn" onClick={() => startLesson(next.id)}>
              {doneLessons === 0 ? "Start lesson 1" : `Continue: ${lessonNumber(next.id)}. ${next.title}`}
            </button>
          ) : (
            <span class="pill ok">Course finished: try the experiments</span>
          )}
          <button type="button" class="btn ghost" onClick={() => s.set("learnView", "glossary")}>
            Words ({glossaryIds.length})
          </button>
        </div>
      </div>

      {UNITS.map((u, ui) => (
        <section key={u.title} class="unit">
          <h3 class="unit-title">
            <span class="unit-n">Unit {ui + 1}</span> {u.title}
          </h3>
          <p class="small muted">{u.blurb}</p>
          <ul class="chapters">
            {u.lessons.map((l) => (
              <li key={l.id}>
                <button type="button" class="row-btn chapter" onClick={() => startLesson(l.id)}>
                  <span class={`ch-n num${s.done.includes(l.id) ? " done" : ""}`}>{s.done.includes(l.id) ? "✓" : lessonNumber(l.id)}</span>
                  <span class="ch-t">
                    <b>{l.title}</b>
                    <span class="small muted">{l.idea}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section class="unit">
        <h3 class="unit-title">
          <span class="unit-n">Unit {UNITS.length + 1}</span> Experiments
        </h3>
        <p class="small muted">Change something, predict what happens, run it and compare. Best after units 1–3.</p>
        <ul class="chapters">
          {LABS.map((lab, i) => (
            <li key={i}>
              <button
                type="button"
                class="row-btn chapter"
                onClick={() => {
                  s.lesson = null;
                  s.learnChapter = i;
                  s.emit();
                }}
              >
                <span class={`ch-n num${s.done.includes(labId(i)) ? " done" : ""}`}>{s.done.includes(labId(i)) ? "✓" : "⚗"}</span>
                <span class="ch-t">
                  <b>{lab.title}</b>
                  <span class="small muted">{lab.lesson}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- one lesson
function LessonView({ lesson, card }: { lesson: Lesson; card: number }) {
  const s = useStore();
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => setPick(null), [lesson.id, card]);
  const c = lesson.cards[Math.min(card, lesson.cards.length - 1)];
  const n = lessonNumber(lesson.id);
  const last = card >= lesson.cards.length - 1;
  const nextLesson = LESSONS[n]; // n is 1-based, so this is the following lesson
  const answered = !c.check || pick !== null;
  const go = (k: number) => s.openLesson(lesson.id, k);
  return (
    <div class="learn lesson">
      <div class="crumbs">
        <button type="button" class="link" onClick={() => s.openLesson(null)}>
          ← Course
        </button>
        <span class="muted small">
          Lesson {n} of {LESSONS.length}
        </span>
      </div>
      <h2 class="title">{lesson.title}</h2>
      <p class="idea">
        <span class="idea-label">The idea</span> {lesson.idea}
      </p>
      <div class="dots" role="tablist" aria-label="Steps">
        {lesson.cards.map((x, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === card}
            aria-label={`Step ${i + 1}: ${x.title}`}
            class={`dot-step${i === card ? " on" : ""}${i < card ? " past" : ""}`}
            onClick={() => go(i)}
          />
        ))}
      </div>
      <article class="card">
        <h3>{c.title}</h3>
        {c.body.map((p, i) => (
          <p key={i}>
            <Rich text={p} />
          </p>
        ))}
        {c.show && (
          <button type="button" class="btn ghost show" onClick={() => c.show!.run(store)}>
            ◎ {c.show.label}
          </button>
        )}
        {c.check && (
          <div class="quiz">
            <p>
              <b>{c.check.q}</b>
            </p>
            <div class="options" role="radiogroup" aria-label="Your answer">
              {c.check.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={pick === i}
                  disabled={pick !== null}
                  class={`option${pick !== null && i === c.check!.answer ? " right" : ""}${pick === i && i !== c.check!.answer ? " wrong" : ""}`}
                  onClick={() => setPick(i)}
                >
                  {o}
                </button>
              ))}
            </div>
            {pick !== null && (
              <div class={`reveal ${pick === c.check.answer ? "right" : "wrong"}`}>
                <p>
                  <b>{pick === c.check.answer ? "Right." : "Not quite."}</b> <Rich text={c.check.why} />
                </p>
              </div>
            )}
          </div>
        )}
      </article>
      <div class="btn-row nav">
        <button type="button" class="btn ghost" disabled={card === 0} onClick={() => go(card - 1)}>
          Back
        </button>
        {!last && (
          <button type="button" class="btn" onClick={() => go(card + 1)}>
            Next
          </button>
        )}
        {last && answered && (
          <>
            <button
              type="button"
              class="btn"
              onClick={() => {
                s.finishLesson(lesson.id);
                if (nextLesson) startLesson(nextLesson.id);
                else s.openLesson(null);
              }}
            >
              {nextLesson ? `Next lesson: ${nextLesson.title}` : "Finish the course"}
            </button>
            <button
              type="button"
              class="btn ghost"
              onClick={() => {
                s.finishLesson(lesson.id);
                s.openLesson(null);
              }}
            >
              Back to the course
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- experiments
type Phase = "intro" | "predict" | "running" | "reveal";

function LabView({ idx }: { idx: number }) {
  const s = useStore();
  const [phase, setPhase] = useState<Phase>("intro");
  const [pick, setPick] = useState<number | null>(null);
  const [memo, setMemo] = useState<Record<string, number>>({});
  useEffect(() => {
    setPhase("intro");
    setPick(null);
  }, [idx]);
  const lab = LABS[idx];
  const back = () => {
    s.cancelRun();
    s.learnChapter = null;
    s.emit();
  };
  return (
    <div class="learn">
      <div class="crumbs">
        <button type="button" class="link" onClick={back}>
          ← Course
        </button>
        <span class="muted small">
          Experiment {idx + 1} of {LABS.length}
        </span>
      </div>
      <h2 class="title">{lab.title}</h2>
      {lab.intro.map((p, i) => (
        <p key={i}>
          <Rich text={p} />
        </p>
      ))}
      {phase === "intro" && (
        <button
          type="button"
          class="btn"
          onClick={() => {
            store.setRunning(false);
            if (lab.world !== store.scenarioId) store.reset(lab.world, store.seed);
            if (store.engine.s.t < 30) store.advance(30 - store.engine.s.t); // let ports price first
            setMemo(lab.setup(store));
            setPhase("predict");
          }}
        >
          Set it up
        </button>
      )}
      {phase !== "intro" && (
        <div class="predict">
          <p>
            <b>Predict:</b> {lab.question}
          </p>
          <div class="options" role="radiogroup" aria-label="Your prediction">
            {lab.options.map((o, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={pick === i}
                disabled={phase !== "predict"}
                class={`option${pick === i ? " on" : ""}${phase === "reveal" && i === lab.answer ? " right" : ""}${phase === "reveal" && pick === i && i !== lab.answer ? " wrong" : ""}`}
                onClick={() => setPick(i)}
              >
                {o}
              </button>
            ))}
          </div>
          {phase === "predict" && (
            <button
              type="button"
              class="btn"
              disabled={pick === null}
              onClick={() => {
                setPhase("running");
                store.runFor(lab.run, () => setPhase("reveal"), lab.run > 200 ? 40 : 16);
              }}
            >
              Run {lab.run >= 120 ? `${Math.round(lab.run / 60)} minutes` : `${lab.run} seconds`}
            </button>
          )}
          {phase === "running" && (
            <p class="running small">
              Running… {Math.max(0, Math.round((store.runningUntil ?? s.engine.s.t) - s.engine.s.t))} s of simulated time to go. Watch the map.
            </p>
          )}
          {phase === "reveal" && (
            <div class={`reveal ${pick === lab.answer ? "right" : "wrong"}`}>
              <p>
                <b>{pick === lab.answer ? "Right." : "Not quite."}</b> <Rich text={lab.explain} />
              </p>
              <p class="observed">
                <b>What happened:</b> {lab.result(s.engine, memo)}
              </p>
              <div class="btn-row">
                {idx + 1 < LABS.length && (
                  <button
                    type="button"
                    class="btn"
                    onClick={() => {
                      s.finishLesson(labId(idx));
                      s.learnChapter = idx + 1;
                      s.emit();
                    }}
                  >
                    Next experiment
                  </button>
                )}
                <button
                  type="button"
                  class="btn ghost"
                  onClick={() => {
                    s.finishLesson(labId(idx));
                    back();
                  }}
                >
                  Back to the course
                </button>
                {lab.world === "reference" && (
                  <button type="button" class="btn ghost" onClick={() => store.reset("realm", store.seed)}>
                    Back to the Realm
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- glossary
function Glossary() {
  const s = useStore();
  const [q, setQ] = useState("");
  const words = glossaryIds
    .map((id) => ({ id, ...GLOSSARY[id] }))
    .filter((d) => !q || `${d.word} ${d.short}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.word.localeCompare(b.word));
  return (
    <div class="learn">
      <div class="crumbs">
        <button type="button" class="link" onClick={() => s.set("learnView", "home")}>
          ← Course
        </button>
        <span class="muted small">{glossaryIds.length} words</span>
      </div>
      <h2 class="title">Words</h2>
      <label class="field">
        <span class="small muted">Find a word</span>
        <input id="glossary-search" type="search" value={q} placeholder="band, margin, labour…" onInput={(ev) => setQ((ev.target as HTMLInputElement).value)} />
      </label>
      <dl class="glossary">
        {words.map((d) => (
          <div key={d.id} class="gloss-item">
            <dt>{d.word}</dt>
            <dd>
              {d.short}
              {d.example && <span class="small muted"> Example: {d.example}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {words.length === 0 && <p class="muted">No word matches “{q}”.</p>}
    </div>
  );
}
