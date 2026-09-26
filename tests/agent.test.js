// Run with: node tests/agent.test.js
// The assistant is the one part of Nexxo whose behaviour cannot be checked by reading it: the model decides which
// tool to call, and the loop has to handle every stop reason the API can return. These tests replay scripted responses
// through a fake client shaped like the SDK, so the whole loop runs with no network and no API key.
// The offline matcher (src/agent-offline.js) is tested here too, since it answers the same questions when the model
// cannot be reached.
const assert = require("assert");
const { SeamAgent } = require("../src/agent.js");
const O = require("../src/agent-offline.js");

let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
const at = (name, fn) => { promises.push(fn().then(() => { n++; console.log("ok -", name); })); };
const promises = [];

// ---------- fake SDK client ----------
const text = s => ({ type: "text", text: s });
const use = (name, input, id = "tu_1") => ({ type: "tool_use", name, input, id });
const reply = (content, stop_reason = "end_turn", extra = {}) => Object.assign({ content, stop_reason }, extra);

// Records every request and replays the scripted responses in order. Message arrays are copied on the way in: the loop
// appends to the same array after the call returns, so keeping a reference would record the end of the conversation
// instead of what this request actually sent.
function fakeClient(...scripted) {
  const requests = [];
  const create = async req => {
    requests.push(Object.assign({}, req, { messages: (req.messages || []).slice() }));
    if (!scripted.length) throw new Error("the fake client ran out of scripted responses");
    const next = scripted.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { requests, beta: { messages: { create } }, messages: { create } };
}
const run = (client, opts = {}) => SeamAgent.ask(Object.assign({
  client, apiKey: "", system: "sys", tools: [{ name: "get_overview" }], messages: [{ role: "user", content: "q" }],
  execute: async () => ({ ok: true }),
}, opts));

// ---------- the loop ----------
at("a tool call runs once and the answer comes back as text", async () => {
  const client = fakeClient(reply([use("get_overview", {})], "tool_use"), reply([text("Two pairs.")]));
  const calls = [];
  const r = await run(client, { execute: async (name, input) => { calls.push([name, input]); return { pairs: 2 }; } });
  assert.strictEqual(r.text, "Two pairs.");
  assert.deepStrictEqual(calls, [["get_overview", {}]]);
  assert.strictEqual(client.requests.length, 2);
});

at("the request carries the model, the tools, caching and refusal fallbacks", async () => {
  const client = fakeClient(reply([text("ok")]));
  await run(client);
  const req = client.requests[0];
  assert.strictEqual(req.model, SeamAgent.MODEL);
  assert.deepStrictEqual(req.cache_control, { type: "ephemeral" });
  assert.strictEqual(req.fallbacks, "default");
  assert.deepStrictEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.strictEqual(req.tools[0].name, "get_overview");
});

at("two tool calls in one turn come back in a single user message", async () => {
  // Splitting tool results across messages teaches the model to stop making parallel calls, so they must go together.
  const client = fakeClient(
    reply([use("get_overview", {}, "tu_1"), use("get_data_checks", {}, "tu_2")], "tool_use"),
    reply([text("both read")]),
  );
  await run(client);
  const followUp = client.requests[1].messages[client.requests[1].messages.length - 1];
  assert.strictEqual(followUp.role, "user");
  assert.deepStrictEqual(followUp.content.map(b => b.type), ["tool_result", "tool_result"]);
  assert.deepStrictEqual(followUp.content.map(b => b.tool_use_id), ["tu_1", "tu_2"]);
});

at("a tool that throws is reported to the model, not to the user", async () => {
  const client = fakeClient(reply([use("get_overlap", { key: "X|Y" })], "tool_use"), reply([text("recovered")]));
  const r = await run(client, { execute: async () => { throw new Error("No flagged pair X|Y."); } });
  const block = client.requests[1].messages[client.requests[1].messages.length - 1].content[0];
  assert.strictEqual(block.is_error, true);
  assert.match(block.content, /No flagged pair/);
  assert.strictEqual(r.text, "recovered");
});

at("a refusal stops the loop and says so", async () => {
  const client = fakeClient(reply([text("")], "refusal", { stop_details: { category: "cyber" } }), reply([text("unreached")]));
  const r = await run(client);
  assert.match(r.text, /can't help/);
  assert.strictEqual(client.requests.length, 1, "no further request after a refusal");
});

at("a paused turn is resumed without running tools again", async () => {
  const client = fakeClient(reply([text("partial")], "pause_turn"), reply([text("complete")]));
  let ran = 0;
  const r = await run(client, { execute: async () => { ran++; return {}; } });
  assert.strictEqual(r.text, "complete");
  assert.strictEqual(ran, 0);
  assert.strictEqual(client.requests.length, 2);
});

at("a truncated answer is flagged", async () => {
  const r = await run(fakeClient(reply([text("cut off")], "max_tokens")));
  assert.strictEqual(r.truncated, true);
});

at("an answer with no text still returns something", async () => {
  const r = await run(fakeClient(reply([], "end_turn")));
  assert.strictEqual(r.text, "(no answer)");
});

at("a loop that never finishes stops instead of running forever", async () => {
  const scripted = Array.from({ length: 40 }, () => reply([use("get_overview", {})], "tool_use"));
  const client = fakeClient(...scripted);
  const r = await run(client);
  assert.match(r.text, /more steps than expected/);
  assert(client.requests.length <= 12, `stopped after ${client.requests.length} requests`);
});

at("the conversation the loop builds stays valid", async () => {
  // Every assistant turn must be followed by the tool results it asked for, or the next request is rejected by the API.
  const client = fakeClient(reply([use("get_overview", {})], "tool_use"), reply([text("done")]));
  const messages = [{ role: "user", content: "q" }];
  await run(client, { messages });
  assert.deepStrictEqual(messages.map(m => m.role), ["user", "assistant", "user", "assistant"]);
});

at("an API failure propagates so the caller can fall back", async () => {
  // app.js catches this and answers from the offline matcher instead; swallowing it here would hide that path.
  const boom = new Error("connection refused");
  await assert.rejects(() => run(fakeClient(boom)), /connection refused/);
});

// ---------- key verification ----------
// verify() is what "Use key" calls before accepting a key. It asks the Models endpoint, which spends no tokens, and has
// to separate three outcomes: the key works, the key is refused, and the key could not be judged at all.
at("a key that can reach the model is accepted", async () => {
  const client = { models: { retrieve: async id => ({ id, display_name: "Claude Opus 5" }) } };
  const r = await SeamAgent.verify("sk-test", client);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.model, "Claude Opus 5");
});

at("the model asked about is the one the assistant uses", async () => {
  let asked = null;
  const client = { models: { retrieve: async id => { asked = id; return { id }; } } };
  await SeamAgent.verify("sk-test", client);
  assert.strictEqual(asked, SeamAgent.MODEL);
});

at("a failure that cannot be attributed to the key is reported as transient", async () => {
  // Without the SDK loaded there are no typed errors to match, so anything unrecognised must not be called a bad key:
  // saying "your key is invalid" when the network is down sends the user to rotate a key that was fine.
  const client = { models: { retrieve: async () => { throw new Error("network down"); } } };
  const r = await SeamAgent.verify("sk-test", client);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.transient, true);
  assert.match(r.reason, /network down/);
});

at("a client that cannot be built is transient too", async () => {
  const r = await SeamAgent.verify("");   // no injected client and no SDK: the import fails
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.transient, true);
});

t("error messages are readable without the SDK loaded", () => {
  assert.match(SeamAgent.explain(new TypeError("failed to fetch module")), /internet connection/);
  assert.strictEqual(SeamAgent.explain(new Error("plain")), "plain");
});

// ---------- offline matcher: routing ----------
const routes = [
  // the six questions the Ask panel suggests, all answerable with no model
  ["Which overlaps are most likely to happen, and what could they save?", "list_overlaps", { sort: "chance" }],
  ["Explain the Jasper - Okatie and McIntosh - Purrysburg pair", "list_overlaps", { project_query: "jasper okatie mcintosh purrysburg" }],
  ["What changed between DESC's last two plans?", "get_plan_changes", {}],
  ["Which three date moves would save the most?", "optimize_schedule", { show: 3 }],
  ["Show me what's planned near Augusta", "search_projects", { query: "Augusta" }],
  ["How reliable is the data?", "get_data_checks", {}],
  // and the shapes a reviewer actually types
  ["top 5 overlaps", "list_overlaps", { limit: 5 }],
  ["pairs within 8 km", "list_overlaps", { max_distance_km: 8 }],
  ["overlaps within 5 miles", "list_overlaps", { max_distance_km: 8.047 }],
  ["which pairs are in the same window?", "list_overlaps", { same_window_on_paper: true }],
  ["how many pairs were checked?", "get_overview", {}],
  ["DESC-11", "get_project", { id: "DESC-11" }],
  ["DESC-11|IRP-20277", "get_overlap", { key: "DESC-11|IRP-20277" }],
  // Spanish, routed the same way
  ["las 3 mejores oportunidades", "list_overlaps", { limit: 3 }],
  ["pares a menos de 8 km", "list_overlaps", { max_distance_km: 8 }],
  ["¿qué cambió entre los dos planes?", "get_plan_changes", {}],
  ["qué fechas mover para ahorrar más", "optimize_schedule", {}],
  ["qué hay planeado cerca de Augusta", "search_projects", { query: "Augusta" }],
  ["qué tan confiable es el dato", "get_data_checks", {}],
  ["cuántos pares se revisaron", "get_overview", {}],
  // what the Ask panel says works without a key: why-not, briefs, the map, and counts in either word order
  ["why is DESC-11 not paired with IRP-20277?", "why_not", { project_id_a: "DESC-11", project_id_b: "IRP-20277" }],
  ["¿por qué DESC-11 no está con IRP-20277?", "why_not", { project_id_a: "DESC-11", project_id_b: "IRP-20277" }],
  ["write the brief for DESC-12|IRP-20277", "open_brief", { key: "DESC-12|IRP-20277" }],
  ["escribe el informe del par DESC-12|IRP-20277", "open_brief", { key: "DESC-12|IRP-20277" }],
  ["open the schedule proposal", "open_schedule_brief", {}],
  ["abrí la propuesta de calendario", "open_schedule_brief", {}],
  ["show DESC-12 on the map", "show_on_map", { project_id: "DESC-12" }],
  ["muéstrame DESC-12|IRP-20277 en el mapa", "show_on_map", { key: "DESC-12|IRP-20277" }],
  ["in the 3 closest pairs", "list_overlaps", { limit: 3, sort: "distance" }],
  ["¿cuáles son los 3 pares más probables?", "list_overlaps", { limit: 3, sort: "chance" }],
  ["los tres pares más cercanos", "list_overlaps", { limit: 3 }],
  // a place ends where the question goes on, and one word is enough to name it
  ["Which overlaps near Augusta are most likely to happen?", "list_overlaps", { project_query: "augusta", sort: "chance" }],
  ["overlaps near Savannah", "list_overlaps", { project_query: "savannah" }],
  ["¿qué solapes cerca de Augusta son más probables?", "list_overlaps", { project_query: "augusta", sort: "chance" }],
];
t("the offline matcher routes every question it claims to cover", () => {
  for (const [q, tool, input] of routes) {
    const plan = O.interpret(q);
    assert(plan, `no plan for: ${q}`);
    assert.strictEqual(plan.tool, tool, q);
    for (const [k, v] of Object.entries(input)) assert.deepStrictEqual(plan.input[k], v, `${q} → ${k}`);
  }
});

t("the offline matcher hands off rather than guessing", () => {
  // A half-understood question answered confidently is worse than saying the model is needed.
  for (const q of ["what is the weather in Atlanta", "explain FERC Order 1920", "who runs the SERTP process", "hello", "2028"]) {
    assert.strictEqual(O.interpret(q), null, q);
  }
});

t("language is read off the question", () => {
  assert.strictEqual(O.language("top 5 overlaps"), "en");
  assert.strictEqual(O.language("¿dónde se solapan?"), "es");
  assert.strictEqual(O.language("cuantos proyectos hay sin ubicar"), "es");
  assert.strictEqual(O.language("which pairs share right-of-way?"), "en");
});

// ---------- offline matcher: rendering ----------
// Fixtures mirror what runTool returns in src/app.js; rendering is checked against those shapes, not against the DOM.
const PAIRS = {
  matching_pairs: 2,
  rows: [
    { key: "DESC-31|IRP-19523", distance_km: 0, tier: "Touching or crossing", project_a: "Hooks - Thurmond (DESC, in service 2026-12-31)", project_b: "SAV: CC (GPC, in service 2033-06-01)", windows_on_paper: "4 months shared", chance_of_shared_window: 0.42, expected_savings_usd: 1250000, savings_if_dates_hold_usd: 2100000, challenge_reference: "OVL_1" },
    { key: "DESC-11|IRP-20277", distance_km: 8.08, tier: "Under 40 km", project_a: "Jasper - Okatie (DESC, in service 2025-12-31)", project_b: "MCINTOSH - PURRYSBURG (GPC, in service 2026-06-01)", windows_on_paper: "3 months apart", chance_of_shared_window: "none, one side is likely built", expected_savings_usd: 0, savings_if_dates_hold_usd: 340000, challenge_reference: null },
  ],
};
const PROJECT = { id: "DESC-11", utility: "DESC", name: "Jasper - Okatie 230 kV #2", kv: 230, type: "New line", construction: "2024-06-01 to 2025-12-31", in_service: "2025-12-31", cost_usd: 11116933, location_confidence: "high", source: "scrtp.com (item 3)", description: "Construct a second circuit.", overlaps: 2, top_overlaps: PAIRS.rows };

t("a ranked list renders the same way every time, in either language", () => {
  const en = O.render("list_overlaps", PAIRS, "en");
  assert.strictEqual(en, O.render("list_overlaps", PAIRS, "en"));
  assert.match(en, /2 flagged pairs/);
  assert.match(en, /Touching or crossing/);
  assert.match(en, /reference table/);            // the challenge cross-check is surfaced
  assert.match(en, /42%/);                        // chance is shown as a percentage
  const es = O.render("list_overlaps", PAIRS, "es");
  assert.match(es, /2 pares marcados/);
  assert.match(es, /se tocan o se cruzan/);
});

t("an empty result says most pairs genuinely do not overlap", () => {
  assert.match(O.render("list_overlaps", { matching_pairs: 0, rows: [] }, "en"), /do not overlap/);
  assert.match(O.render("list_overlaps", { matching_pairs: 0, rows: [] }, "es"), /no se solapan/);
});

t("a published cost is shown and a redacted one is named as such", () => {
  assert.match(O.render("get_project", PROJECT, "en"), /cost \$11\.1M/);
  const redacted = Object.assign({}, PROJECT, { cost_usd: null });
  const out = O.render("get_project", redacted, "en");
  assert.match(out, /cost not published in the filing/);
  assert(!/\$/.test(out.split("\n")[0]), "no figure is attached to a project whose cost the filing withholds");
});

t("the overview surfaces how many pairs were rejected", () => {
  const out = O.render("get_overview", { pairs_checked: 10304, pairs_flagged: 169, by_tier: { "Touching or crossing": 2, "Under 40 km": 120 }, expected_savings_usd: 13700000, savings_if_dates_hold_usd: 16200000, projects: { DESC: 64, GPC: 161 }, as_of: "2026-09-26" }, "en");
  assert.match(out, /10,304 pairs checked, 169 flagged/);
  assert.match(out, /13\.7M/);
});

t("plan changes and schedule moves render", () => {
  const changes = O.render("get_plan_changes", { how_dates_moved: { DESC: { n: 40, later: 22, earlier: 6, unchanged: 12, median_months: 12, projects_with_history: 40, source: "SCRTP" } }, windows_opened: [], windows_closed: [] }, "en");
  assert.match(changes, /22 later, 6 earlier, 12 unchanged \(median 12 months/); // the field get_plan_changes returns
  assert.match(changes, /No shared window opened or closed/);
  const moves = O.render("optimize_schedule", { expected_savings_before_usd: 13700000, after_usd: 16200000, moves: [{ id: "IRP-20277", project: "MCINTOSH - PURRYSBURG", utility: "GPC", months: -6, in_service_from: "2026-06-01", in_service_to: "2025-12-01", adds_usd: 480000, strongest_effect: "Jasper - Okatie: chance 12% to 61%" }] }, "en");
  assert.match(moves, /13\.7M to \$16\.2M/);
  assert.match(moves, /-6 months/);
  assert.strictEqual(O.render("optimize_schedule", { moves: [] }, "en").includes("left as planned"), true);
  // "which three date moves": list the three that add the most, and say how many there are
  const many = { expected_savings_before_usd: 1e6, after_usd: 2e6, moves: [100, 400, 200, 300].map((a, k) => ({ id: "P-" + k, project: "P" + k, utility: "GPC", months: 3, in_service_from: "2027-01-01", in_service_to: "2027-04-01", adds_usd: a * 1000 })) };
  const top = O.render("optimize_schedule", many, "en", { show: 3 });
  assert.match(top, /The 3 that add the most, of 4 moves/);
  assert.deepStrictEqual(top.match(/P-\d/g), ["P-1", "P-3", "P-2"]);
  assert.match(O.render("optimize_schedule", many, "es", { show: 3 }), /Los 3 que más suman, de 4/);
  assert.strictEqual(O.render("optimize_schedule", many, "en").match(/P-\d/g).length, 4);
});

t("offline answers for why-not, briefs and the map, in both languages, and partial lists say so", () => {
  assert.match(O.render("why_not", { reason: "too_far", project_id_a: "A-1", project_id_b: "B-2", distance_km: 40.45, just_outside: true }, "en"), /40\.45 km apart, just beyond/);
  assert.match(O.render("why_not", { reason: "flagged", project_id_a: "A-1", project_id_b: "B-2", key: "A-1|B-2", distance_km: 3.3 }, "es"), /sí están marcados/);
  assert.match(O.render("open_brief", { pair: "X and Y" }, "en"), /coordination brief for X and Y/);
  assert.match(O.render("open_schedule_brief", { moves: 8, adds_usd: 2500000 }, "es"), /8 movimientos/);
  assert.match(O.render("show_on_map", { shown: "Jasper" }, "es"), /Mostrando Jasper/);
  assert.match(O.render("list_overlaps", { matching_pairs: 17, rows: [] }, "en") + O.render("list_overlaps", { matching_pairs: 17, rows: [{ key: "A|B", km: 1, tier: "x", project_a: "a", project_b: "b" }] }, "en"), /first 1 of 17/);
});

t("the offline note names why the model was skipped", () => {
  assert.match(O.note("en", "the API could not be reached"), /without the language model: the API could not be reached/);
  assert.match(O.note("es"), /sin el modelo de lenguaje/);
  assert(O.capabilities("es").length > 40 && O.capabilities("en").length > 40);
});

Promise.all(promises).then(() => console.log(`\n${n} tests passed`), err => { console.error(err); process.exit(1); });
