# Proposed improvements

Five changes to Seamline, written as requirements so they can be picked up
independently. Each one names the problem it solves, what "done" means, and the
files it touches.

Two of them close gaps that would show in a demo (R1, R3). Two are safety nets
for code that currently has none (R2, R4). One makes the tool's negative result
— the 98% of pairs it rejects — inspectable (R5).

Nothing here re-implements work that already exists. The inventory below is the
result of reading the repo first, and one of the ideas that motivated this
document was dropped after measurement disproved it (see R4).

## How the numbers here were produced

Every figure in this document came from running the repo's own engine over its
own data at its default filters (`state.D = 40`, `state.B = 0`,
`state.mode = "near"`, `src/app.js:27`), excluding existing infrastructure the
way the tests do (`!p.existing`):

```js
const E = require("./src/engine.js");
const P = require("./data/projects.json").filter(p => !p.existing);
const { pairs, checked } = E.findOverlaps(P, { utilA: "DESC", utilB: "GPC", maxKm: 40, bufferMonths: 0, mode: "near" });
```

Baseline:

| Measure | Value |
|---|---|
| Planned projects | 225 (DESC 64, GPC 161) |
| Projects with a published cost | 64 — all DESC; Georgia's filing redacts every cost |
| Pairs checked | 10,304 |
| Pairs flagged | 169 |
| Pairs between 40 and 41.5 km (just outside the screen) | 11 |
| Pairs within 2.5% of the 8 km tier boundary | 2 (both at 8.08 km) |
| Worst deviation of the flat projection from geodesic distance | 0.35 km |
| Pairs whose tier would change if measured geodesically | 0 |

## What already exists

Read this before starting anything, so nothing gets built twice.

| Capability | Where |
|---|---|
| Natural-language assistant, Claude `claude-opus-5` with server-side refusal fallbacks | `src/agent.js` |
| Nine tools + system prompt | `src/app.js:637` (prompt), `:645` (tools), `:669` (`runTool`) |
| Ask panel, key handling, six suggested questions | `src/app.js:742`–`:780` |
| Answers in the user's language | instructed in the system prompt |
| Map follows the answer | `show_on_map` tool |
| Printable coordination brief per pair | `openBrief`, `src/app.js:782`; print and copy at `:996` |
| Joint schedule brief | `openScheduleBrief`, `src/app.js:813` |
| Validation report, downloadable as JSON | `src/app.js:629` |
| Closest-point distance, four tiers, multi-part geometry | `src/engine.js` |
| Monte Carlo schedule risk, expected savings, plan drift, schedule optimizer, shared-yard finder, clusters | `src/engine.js` |
| Every overlap in the challenge's reference table is asserted to be flagged | `tests/engine.test.js:48` |

---

## R1 — Answer without the model when the model is unavailable

### Problem

The assistant is the only part of Seamline that stops working without an
internet connection, and it fails in four ways that are all likely at a
conference: no network, `import()` of the SDK from jsDelivr blocked, a rejected
key, or a rate limit.

With no key, the panel is inert by construction: the textarea and the submit
button carry `${has ? "" : " disabled"}` (`src/app.js:754`), and the six
suggestion chips only focus the key field (`:758`). With a key but a failing
request, `sendQuestion` drops the question and prints an error
(`src/app.js:774`):

```js
} catch (err) {
  CHAT.messages.pop();
  CHAT.log.push({ role: "assistant", text: SeamAgent.explain(err) });
}
```

The six questions in `SUGGEST` (`src/app.js:742`) are all answerable from the
existing tools without a model. Advertising them in the UI while they need a key
is the worst of both states.

### Requirement

Add `src/agent-offline.js` exposing a pattern matcher over the **existing**
tools, in the same IIFE style as the other modules:

- `SeamOffline.interpret(question)` → `{ tool, input }`, or `null` when the
  question carries no clear signal.
- `SeamOffline.render(tool, result, lang)` → plain text, English or Spanish,
  chosen from the question's own words.

Recognise at least:

| Question shape | Tool |
|---|---|
| "top 5", "las 3 mejores" | `list_overlaps` with `limit` |
| "within 8 km", "a menos de 5 millas" | `list_overlaps` with `max_distance_km` |
| "most likely", "más probables" | `list_overlaps` with `sort: "chance"` |
| "same window", "misma ventana" | `list_overlaps` with `same_window_on_paper` |
| "what changed between plans", "qué cambió" | `get_plan_changes` |
| "which date moves", "qué fechas mover" | `optimize_schedule` |
| "what's near Augusta", "qué hay cerca de Augusta" | `search_projects` |
| "how reliable is the data", "qué tan confiable" | `get_data_checks` |
| "how many pairs were checked", "cuántos pares" | `get_overview` |
| a bare project id (`DESC-11`, `IRP-20277`) | `get_project` |

Wire it into `src/app.js` at three points, leaving `agent.js`, `engine.js` and
`runTool` untouched:

1. `renderAsk` — stop disabling the input when there is no key; say in the note
   what can be asked without one.
2. `sendQuestion` — with no key, try `interpret` first; if it returns `null`,
   ask for the key and list what does work without it.
3. the `catch` — try `interpret` before printing `SeamAgent.explain(err)`.

Every answer produced this way must say so, and say why, in the answer itself.

### Acceptance

- With no key stored, each of the six `SUGGEST` chips returns a real answer
  drawn from `runTool`.
- With a key present but the SDK import or the API call failing, a recognised
  question still answers, labelled as answered without the model and carrying
  the reason.
- An unrecognised question returns `null` from `interpret` and hands off to the
  model rather than guessing. This is the rule that matters: a half-understood
  question answered confidently is worse than an honest hand-off.
- Spanish and English phrasings of the same question route to the same tool and
  render in the language asked.
- `agent.js` is unchanged.

### Files

New `src/agent-offline.js` (~150 lines). `src/app.js`: `renderAsk`,
`sendQuestion`, and the script tag in `src/index.html`.

### Out of scope

Chained tool calls. The matcher runs exactly one tool; anything needing two is
the model's job.

---

## R2 — Tests for the assistant loop

### Problem

`npm test` covers the engine and the importers well: tiers, multi-part geometry
that must never measure across a gap, day-first versus month-first date parsing,
every savings line checked against its own arithmetic, yard snapping, clusters, and
— importantly — that every overlap in the challenge's reference table is flagged
(`tests/engine.test.js:48`).

`src/agent.js` has no tests at all, and it is the only non-deterministic
component in the system: it decides which tool to call and handles `refusal`,
`pause_turn`, `max_tokens`, the tool-result round trip and the round cap.

### Requirement

Add `tests/agent.test.js`, running under Node with no network, using a fake
client shaped like the SDK (`{ beta: { messages: { create } } }`) that replays
scripted responses. Cover:

| Case | Assertion |
|---|---|
| `tool_use` then text | the tool runs once; the final text is returned |
| two `tool_use` blocks in one response | both `tool_result`s go back in a **single** `user` message |
| a tool that throws | `is_error: true` with the message, and the loop continues |
| `stop_reason: "refusal"` | returns the refusal message and stops calling tools |
| `stop_reason: "pause_turn"` | retries without executing tools |
| `stop_reason: "max_tokens"` | sets `truncated` |
| `MAX_ROUNDS` consecutive `tool_use` | stops with a message instead of looping |
| the request body | still carries `model`, `tools`, `cache_control` and `fallbacks: "default"` |

That last row is the point of the exercise. If a refactor drops
`fallbacks: "default"` or `cache_control`, the assistant keeps working — just
more expensively, and with no rescue when a request is declined. Nothing would
surface that today.

Add the `SeamOffline` cases from R1 to the same file: every pattern in both
languages, and an out-of-scope question returning `null`.

### Acceptance

- `npm test` passes with no network access and no API key present.
- Deleting `fallbacks: "default"` from `src/agent.js` makes a test fail.
- Every `stop_reason` the SDK can return is exercised.

### Files

New `tests/agent.test.js` (~250 lines). `package.json`: add it to the `test`
script. No production code changes.

---

## R3 — Let the assistant produce a brief

### Problem

The briefs are good and already built: `openBrief` (`src/app.js:782`) renders a
printable memo with both projects, their windows, the chance of a shared window,
expected savings, and six next steps that vary by tier;
`openScheduleBrief` (`:813`) does the same for the optimizer's moves; both print
and copy (`:996`).

The assistant cannot reach either of them. The nine tools are `get_overview`,
`search_projects`, `get_project`, `list_overlaps`, `get_overlap`,
`get_plan_changes`, `optimize_schedule`, `get_data_checks` and `show_on_map`.
So "write me the brief for the Thurmond pair" gets a description in the chat and
nothing else; the user still has to find the pair by hand and click the button.

### Requirement

Add two tools alongside `show_on_map`, which already establishes the pattern of
a tool that acts on the UI rather than returning data:

```js
{ name: "open_brief",
  description: "Open the printable coordination brief for one pair, ready to print or copy.",
  input_schema: { type: "object", properties: {
    key: { type: "string", description: "Pair key from list_overlaps, 'PROJECTID|PROJECTID'" },
    narrative: { type: "string", description: "One short paragraph framing why this pair matters, in the user's language" },
  }, required: ["key"] } },

{ name: "open_schedule_brief",
  description: "Open the joint schedule brief for the optimizer's recommended date moves.",
  input_schema: { type: "object", properties: {
    narrative: { type: "string" },
    max_shift_months: { type: "integer", enum: [3, 6, 12] },
  } } },
```

`narrative` is the only generated prose allowed anywhere in a brief. Every
figure, date, table and next step stays with `openBrief`, computed from the
engine. The model frames; it does not calculate.

Render `narrative` in its own block, visually distinct from the filed facts, so
a reader can tell which sentence a model wrote.

### Acceptance

- "Open the brief for the Thurmond pair and explain why it matters" opens the
  printable brief with a paragraph written for that case.
- The brief's numbers are byte-identical to the same brief opened from the
  button, with or without a narrative.
- A `narrative` containing markup is escaped, not rendered.
- With no `narrative`, the brief contains no generated text at all.
- `TOOL_NOTE` (`src/app.js:762`) gains a progress label for each new tool.

### Files

`src/app.js`: `TOOLS`, `runTool`, `TOOL_NOTE`, and the `narrative` block in
`openBrief` / `openScheduleBrief`. Roughly 40 lines.

---

## R4 — Pin the geometry against geodesic distance

### Problem

The projection uses one fixed latitude for the whole map (`src/engine.js:4`):

```js
const LAT0 = 33;
const KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 110.57;
```

The projects span latitude 30.3 to 35.2. At 35°, `cos` is 2.3% off its value at
33° — nearly 1 km of east-west error over a 40 km separation. Since the tier
boundaries are the product's central claim, this looked like a correctness bug.

**It was measured and it is not one.** Comparing every flagged pair's reported
distance against the geodesic distance between the same closest points:

```
worst deviation:  0.35 km   (DESC-48|IRP-20326, 33.75 km reported vs 33.41 km geodesic)
tier changes:     0
```

Nothing needs fixing. But that is true because of where these two states
happen to sit, not because anything guarantees it. Extend the footprint, change
`LAT0`, or touch `segDist`, and the degradation is silent: the numbers keep
coming out, just wrong.

### Requirement

Add a test to `tests/engine.test.js` that walks the flagged pairs, computes the
haversine distance between each pair's `ca` and `cb` (the closest points the
engine already returns), and asserts:

```js
assert.ok(maxDeviation < 0.5, "the flat projection stays within 0.5 km of geodesic distance");
assert.strictEqual(tierFlips, 0, "no pair changes tier when measured geodesically");
```

### Acceptance

- The test passes on the current data.
- Changing `LAT0` to 25 makes it fail.
- It states its own tolerance, so a future reader knows what was guaranteed and
  what was merely observed.

### Files

`tests/engine.test.js`, about ten lines. No production code changes.

---

## R5 — Make the rejected pairs inspectable

### Problem

10,304 pairs are checked and 169 are flagged. Rejecting 98% is correct — the
challenge brief warns that most of the dataset does not overlap — but the
rejection only exists as an aggregate in `get_overview` (`pairs_checked`,
`pairs_flagged`). Two consequences:

**A specific pair cannot be asked about.** There is no tool that answers "why
isn't the Jesup project paired with the Charleston one?" with "they are 180 km
apart". The model would have to look both projects up and reason about an
absence, which is exactly where a language model starts improvising.

**The 40 km threshold is an invisible cliff.** Eleven pairs sit between 40 and
41.5 km:

```
DESCP-10|IRP-19523 @ 40.45    DESC-14|GA-37     @ 40.52    DESC-20|IRP-20266 @ 40.30
DESC-12|IRP-17075  @ 41.18    DESC-11|IRP-19966 @ 41.48    DESC-12|IRP-20787 @ 41.18
```

And two pairs at 8.08 km missed the shared-yard tier by 80 m. None of them
appear in any view. A pair at 40.3 km is not materially different from one at
39.8 km; the difference is that 40 is a round number somebody chose.

### Requirement

**A `why_not(project_id_a, project_id_b)` tool** returning a reason code and an
explanation: `flagged` (with the pair key), `too_far` (with the measured
distance), `same_utility`, `unlocated` (when a coordinate could not be
established), `unknown_project`. `Engine.closest` already computes what this
needs.

**A borderline band.** `get_overview` gains `just_outside`: how many pairs fall
between the threshold and 5% beyond it, with the closest few listed. In the map,
a toggle draws them in dashed grey.

### Acceptance

- `why_not` on a flagged pair returns `flagged` and the pair key, not a
  rejection.
- `why_not` on a distant pair returns the measured distance.
- Borderline pairs never enter the ranking, the tier counts, or any savings
  total. They appear only in their own view, labelled as outside the filter.
- The borderline band moves with the distance filter rather than hard-coding
  40 km.

### Files

`src/app.js`: `TOOLS`, `runTool`, `get_overview`, and the map toggle.
`src/engine.js` needs no changes. Roughly 60 lines.

---

## Suggested order

**R1 and R2 together.** R1 closes the only functional gap; R2's fake client
covers both the existing loop and the new offline path, so writing them
together means the new code arrives tested.

**R3 next.** It is the most visible capability gain and touches the same region
of `app.js` as R1.

**R4 after that.** Ten lines, and it converts an accidental property into a
guarantee.

**R5 last.** It is the most interesting to a reader but touches the most UI
surface, so it should not block the others.

## Non-goals

- **No server.** Seamline is static and each viewer supplies their own key.
  Nothing here introduces a backend.
- **No new dependencies.** Everything above is plain JavaScript in the existing
  module style.
- **No widening of the assistant's scope beyond the data.** The system prompt's
  rule — answer only from what the tools return — stays. The way to answer more
  questions is more tools, not a longer leash.
- **No cost figures for Georgia Power.** All 161 GPC projects carry
  `cost: null` because the filing redacts them. Nothing may substitute a
  benchmark, an average or an estimate for a redacted figure.
