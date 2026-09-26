// Seamline UI: map (map.js), the results panel (overlaps, plan changes, optimize, data checks), the build-window
// timeline, the importer and the dialogs. Logic lives in engine.js and ingest.js.
const { TIERS, fmtMoney: money, findOverlaps, monthIndex: mon } = Engine;
const BASE = window.SEAMLINE_DATA.basemap;
const ALL = window.SEAMLINE_DATA.projects;
const MODEL = window.SEAMLINE_DATA.model || { slips: {}, checks: [] };
const TODAY = MODEL.as_of || new Date().toISOString().slice(0, 10);
const EXIST = ALL.filter(p => p.existing);
let PROJECTS = ALL.filter(p => !p.existing).map(p => Object.assign({ dataset: "built-in" }, p));
const DATASETS = [{ id: "built-in", name: "Built-in: DESC and Georgia", count: PROJECTS.length, builtin: true }];

const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LABEL = { DESC: "Dominion Energy SC", GPC: "Georgia ITS" };
const LONG = { DESC: "Dominion Energy South Carolina", GPC: "Georgia (Georgia Power, GTC, MEAG)" };
const lbl = u => LABEL[u] || u;
const lblLong = u => LONG[u] || u;
const TYPE = { new_line: "new line", rebuild: "rebuild", substation: "substation", generation: "generation" };
const SEV = ["Touching", "< 1.6 km", "< 8 km", "< 40 km", "> 40 km"];
const NONE = "__none";
const store = {
  get: (k, d) => { try { const v = localStorage.getItem("seamline." + k); return v == null ? d : JSON.parse(v); } catch (err) { return d; } },
  set: (k, v) => { try { localStorage.setItem("seamline." + k, JSON.stringify(v)); } catch (err) { /* storage blocked: keep it for this visit */ } },
};
const state = {
  utilA: "DESC", utilB: "GPC", D: 40, B: 0, mode: "near", view: "focus", horizon: 0, past: true,
  sel: null, hover: null, tiers: new Set([0, 1, 2, 3, 4]), q: "", t: null, wi: null, exist: true,
  tab: "overlaps", sort: "expected", shown: 60, askKey: false, keyNote: null,
  lastView: "overlaps",
  askLang: store.get("askLang", (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en"),
  opt: { maxShift: 6, who: "both" }, showMoves: false, openCheck: null,
  grid: true,
  basemap: ["plain", "relief", "satellite", "topo"].includes(store.get("basemap", "plain")) ? store.get("basemap", "plain") : "plain",
};
const STATUS = store.get("status", {});
const STATUSES = ["Open", "Contacted", "Coordinating", "Not pursuing"];

const fmtD = (p, which) => {
  if (p.undated) return "No date";
  const d = new Date(p[which] + "T00:00:00Z");
  if (which === "in_service" && p.date_precision === "year") return String(d.getUTCFullYear());
  if (which === "in_service" && p.date_precision === "estimated") return "~" + d.getUTCFullYear() + " (est.)";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};
const monthLabel = m => new Date(Date.UTC(Math.floor(m / 12), Math.floor(m % 12), 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const km = d => d < 0.1 ? "0 km" : d < 10 ? d.toFixed(1) + " km" : Math.round(d) + " km";
// A distance in miles and kilometers, for labels on the map ("1.2 mi · 1.9 km").
const miKm = d => { const f = v => v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString(); return `${f(d / 1.609344)} mi · ${f(d)} km`; };
const pct = v => Math.round(v * 100) + "%";
const tcol = i => css(TIERS[i].tok);
const utilities = () => [...new Set(PROJECTS.map(p => p.utility))];
const solo = () => state.utilB === NONE;
const shownUtil = u => u === state.utilA || (!solo() && u === state.utilB);
const uColor = u => u === state.utilA ? css("--u0") : u === state.utilB ? css("--u1") : css("--ink3");
const keyOf = x => x.p.id + "|" + x.q.id;
const isPast = p => !p.undated && p.in_service < TODAY;
const miles = v => Math.round(v).toLocaleString();
// Shorter names for tight rows: drop sponsor prefixes, the "(USA)" style owner tags, and the work after a colon.
const short = p => p.name.replace(/^(SAV|GTC|MEAG|CC)\s*[:-]\s*/i, "").replace(/\s*\((USA|SAV|APC|FPL)\)/g, "").split(":")[0].trim();

// ---------- compute ----------
let RESULT = { pairs: [], checked: 0 }, VIEW = [], CLUSTERS = [], SOLO = [], dataVersion = 0, asmVersion = 0;
const chanceCache = new Map();
function risk(x) {
  const k = `${keyOf(x)}|${state.B}|${dataVersion}|${x.p.start}|${x.q.start}`;
  let c = chanceCache.get(k);
  if (!c) { c = Engine.overlapChance(x, MODEL.slips, { bufferMonths: state.B, today: TODAY }); chanceCache.set(k, c); }
  const e = Engine.expectedSavings(x, c.p);
  return { chance: c.p, why: c.why, expected: e.expected, fixed: e.fixed, windowed: e.windowed };
}
function inHorizon(p) {
  if (!state.horizon) return true;
  const now = mon(TODAY);
  return mon(p.start) <= now + state.horizon && mon(p.in_service) >= now;
}
function compute() {
  const q = state.q.toLowerCase();
  if (solo()) {
    RESULT = { pairs: [], checked: 0 }; VIEW = []; CLUSTERS = [];
    SOLO = PROJECTS.filter(p => p.utility === state.utilA && (!q || (p.name + " " + p.desc).toLowerCase().includes(q)) && (state.past || !isPast(p)) && inHorizon(p))
      .sort((a, b) => mon(a.start) - mon(b.start) || a.name.localeCompare(b.name));
    return;
  }
  const res = Engine.cachedOverlaps(PROJECTS, { utilA: state.utilA, utilB: state.utilB, maxKm: state.D, bufferMonths: state.B, mode: state.mode }, dataVersion + "/" + asmVersion);
  if (res !== RESULT) {
    RESULT = res;
    RESULT.pairs.forEach(x => { x.risk = risk(x); });
    // one yard serves sites within a day's drive, so clusters always use 40 km whatever the distance filter says
    CLUSTERS = Engine.clusters(RESULT.pairs, EXIST.filter(e => !e.backdrop), 40);
    // The map opens on the closest distance band that has any pairs, so it starts uncluttered; each band chip
    // pressed after that adds its routes.
    if (!state.tiersSet && RESULT.pairs.length) {
      const k = [0, 1, 2, 3].find(i => RESULT.pairs.some(x => x.tier === i));
      state.tiers = new Set(k == null ? [0, 1, 2, 3, 4] : [k]); state.tiersSet = true;
    }
  }
  VIEW = RESULT.pairs.filter(x => state.tiers.has(Math.min(x.tier, 4)) &&
    (state.past || (!isPast(x.p) && !isPast(x.q))) && inHorizon(x.p) && inHorizon(x.q) &&
    (!q || (x.p.name + " " + x.q.name + " " + x.p.desc + " " + x.q.desc + " " + x.p.page + " " + x.q.page).toLowerCase().includes(q)));
  const by = {
    expected: (a, b) => b.risk.expected - a.risk.expected || a.tier - b.tier || a.km - b.km,
    chance: (a, b) => b.risk.chance - a.risk.chance || b.risk.expected - a.risk.expected,
    distance: (a, b) => a.tier - b.tier || b.sameWindow - a.sameWindow || a.km - b.km,
  }[state.sort];
  VIEW.sort(by);
}
const pairYard = x => x.yard || (x.yard = Engine.yardFor([x.p, x.q], EXIST.filter(e => !e.backdrop), 40));
const clusterOf = x => CLUSTERS.find(c => c.projects.includes(x.p) && c.projects.includes(x.q));
const inSel = (sel, p) => !!sel && (sel.cluster ? sel.cluster.projects.includes(p) : sel.moves ? sel.moves.some(m => m.id === p.id) : sel.p === p || sel.q === p);

// ---------- optimizer (cached per inputs) ----------
let optCache = { key: null, r: null };
// Pairs that just missed the distance screen, within 5% of it. They stay out of every ranking, tier count and savings
// total on purpose: the point is only to show that 40 km is a chosen threshold rather than a cliff, since a pair at
// 40.3 km is not materially different from one at 39.8 km. Cached on its own key, because Engine.cachedOverlaps holds
// a single result and searching wider would evict the comparison the whole page is built on.
let bandKey = null, bandPairs = [];
function borderline() {
  if (solo()) return [];
  const key = [state.utilA, state.utilB, state.D, state.B, state.mode, dataVersion, asmVersion].join("|");
  if (key !== bandKey) {
    bandKey = key;
    bandPairs = Engine.findOverlaps(PROJECTS, { utilA: state.utilA, utilB: state.utilB, maxKm: state.D * 1.05, bufferMonths: state.B, mode: state.mode })
      .pairs.filter(x => x.km > state.D).sort((a, b) => a.km - b.km);
  }
  return bandPairs;
}

function optimize() {
  if (solo()) return null;
  const who = state.opt.who === "both" ? null : [state.opt.who === "a" ? state.utilA : state.utilB];
  const key = [state.utilA, state.utilB, state.D, state.B, state.mode, dataVersion, asmVersion, state.opt.maxShift, state.opt.who].join("|");
  if (optCache.key !== key) optCache = { key, r: Engine.optimizeSchedule(RESULT.pairs, MODEL.slips, { today: TODAY, bufferMonths: state.B, maxShift: state.opt.maxShift, utilities: who }) };
  return optCache.r;
}
let driftCache = { key: null, r: null };
function drift() {
  const key = [state.utilA, state.utilB, state.D, state.B, state.mode, dataVersion].join("|");
  if (driftCache.key !== key) driftCache = { key, r: Engine.driftChanges(RESULT.pairs, state.B) };
  return driftCache.r;
}

// ---------- map ----------
let mapReady = false, SEAM = null;
function seamCoords() {
  const st = n => BASE.states.find(x => x.n === n), ga = st("Georgia"), sc = st("South Carolina");
  if (!ga || !sc) return null;
  const rings = g => g.type === "MultiPolygon" ? g.coordinates.flat() : g.coordinates;
  const inSC = new Set(rings(sc.g).flat().map(c => c.join()));
  let best = [];
  for (const ring of rings(ga.g)) {
    let run = [];
    for (const c of ring.concat(ring)) { if (inSC.has(c.join())) { run.push(c); if (run.length > best.length && run.length <= ring.length) best = run.slice(); } else run = []; }
  }
  return best.length > 3 ? best : null;
}
const phase = (p, t) => t == null ? "all" : t < mon(p.start) ? "planned" : t <= mon(p.in_service) ? "building" : "done";
const live = (x, t) => phase(x.p, t) === "building" && phase(x.q, t) === "building";
function renderMap() {
  if (!mapReady) return;
  // With a distance band chosen, the Overlaps map draws only the routes in the chosen bands (all of their pairs, not
  // just the page of the list), and leaves every other planned route off.
  const banded = !solo() && state.view === "focus" && state.tiers.size < 5;
  const shown = banded ? VIEW : VIEW.slice(0, state.shown), sel = state.sel, t = state.t, focus = sel || state.hover;
  const flagged = new Set(shown.flatMap(x => [x.p.id, x.q.id]));
  const moved = state.showMoves && optimize() ? new Set(optimize().moves.map(m => m.id)) : null;
  const raster = state.basemap === "satellite" || state.basemap === "topo";
  const casing = state.basemap === "satellite" ? "rgba(255,255,255,.85)" : raster ? "rgba(20,24,28,.55)" : css("--panel");
  const phaseOp = { all: 1, building: 1, done: .45, planned: .15 };
  const projects = PROJECTS.filter(p => shownUtil(p.utility) && (!banded || flagged.has(p.id) || inSel(focus, p))).map(p => {
    const hi = inSel(focus, p) || (moved && moved.has(p.id));
    let op = (solo() || flagged.has(p.id) ? 1 : .28) * phaseOp[phase(p, t)];
    // A passed date is encoded by the dash pattern below, not by fading the line out of sight: at .45 of an
    // already-dimmed line it fell under the 3:1 a meaningful graphic needs.
    if (isPast(p)) op = Math.max(op * .45, .55);
    if (focus || moved) op = hi ? 1 : Math.min(op, .18);
    return { id: p.id, parts: Engine.partsOf(p), kv: p.kv, color: uColor(p.utility), casing, opacity: op, dash: p.loc === "low" || isPast(p),
      width: (p.kv >= 500 ? 3.4 : p.kv >= 230 ? 2.6 : p.kv >= 115 ? 1.9 : 1.4) + (hi ? 2 : 0) + (phase(p, t) === "building" ? 1.2 : 0), r: hi ? 7 : 4.5 };
  });
  const pairOp = d => focus ? (d === focus || (focus.cluster && focus.cluster.pairs.includes(d)) ? 1 : .1) : t != null ? (live(d, t) ? 1 : .08) : .75;
  const links = solo() ? [] : shown.filter(d => d.km >= 0.1).map(d => ({ id: keyOf(d), a: d.ca, b: d.cb, color: tcol(Math.min(d.tier, 4)), width: focus === d ? 3 : 1.4, opacity: pairOp(d),
    label: miKm(d.km) + " apart", focus: focus === d }));
  const rings = solo() ? [] : shown.filter(d => d.tier <= 2 || d === focus).map(d => ({ id: keyOf(d), at: [(d.ca[0] + d.cb[0]) / 2, (d.ca[1] + d.cb[1]) / 2],
    color: tcol(Math.min(d.tier, 4)), r: d === focus ? 13 : d.tier <= 1 ? 9 : 6, w: d.tier === 0 ? 2.6 : 1.8, opacity: pairOp(d) }));
  const sparks = t == null ? [] : shown.filter(x => live(x, t)).map(x => ({ id: keyOf(x), at: [(x.ca[0] + x.cb[0]) / 2, (x.ca[1] + x.cb[1]) / 2], color: tcol(Math.min(x.tier, 4)) }));
  let yardRing = null, spokes = [];
  const yards = solo() ? [] : CLUSTERS.map((c, i) => ({ id: "c" + i, at: c.yard.at, r: focus && focus.cluster === c ? 7 : 5, fill: focus && focus.cluster === c ? css("--seam") : css("--panel") }));
  const fx = focus && !focus.solo && !focus.moves ? (focus.cluster ? focus.cluster.yard : focus.tier <= 3 ? pairYard(focus) : null) : null;
  if (fx) {
    yardRing = { at: fx.at, km: 40 };
    spokes = fx.spokes.map(s => [fx.at, s]);
    if (!focus.cluster) yards.push({ id: "pairyard", at: fx.at, r: 6, fill: css("--seam") });
  }
  SeamMap.update({ projects, existing: state.exist ? EXIST.filter(e => e.backdrop || shownUtil(e.utility)).map(e => ({ id: e.id, parts: Engine.partsOf(e) })) : [],
    links, rings, sparks, yards, yardRing, spokes, seam: SEAM, showExisting: state.exist });
  if (t != null) {
    const nb = PROJECTS.filter(p => shownUtil(p.utility) && phase(p, t) === "building").length;
    $("#tlsub").textContent = `${nb} under construction` + (solo() ? "" : ` · ${sparks.length} listed pair${sparks.length === 1 ? "" : "s"} building at once`);
  }
}
function mapPoints() {
  const pts = [];
  if (state.view === "focus" && VIEW.length) VIEW.slice(0, 40).forEach(x => { pts.push(x.ca, x.cb); });
  else PROJECTS.filter(p => shownUtil(p.utility)).forEach(p => pts.push(...p.coords));
  return pts;
}
function fitAll(duration) { SeamMap.fit(mapPoints(), { padKm: 8, duration }); }
function flyTo(x) {
  if (x.solo) return SeamMap.fit(x.p.coords, { padKm: 6 });
  if (x.moves) return SeamMap.fit(x.moves.flatMap(m => m.project.coords), { padKm: 10 });
  const pts = x.cluster ? [x.cluster.yard.at, ...x.cluster.yard.spokes] : [x.ca, x.cb, ...x.p.coords, ...x.q.coords];
  SeamMap.fit(pts, { padKm: x.cluster ? 6 : Math.max(3, x.km * 0.4), padding: 60 });
}
function mapClick(hit) {
  if (!hit) return;
  if (["links", "rings", "sparks"].includes(hit.layer)) { const x = VIEW.find(v => keyOf(v) === hit.id); if (x) select(x); return; }
  if (hit.layer === "yards" && hit.id && hit.id[0] === "c") return select({ cluster: CLUSTERS[+hit.id.slice(1)] });
  const p = PROJECTS.find(v => v.id === hit.id);
  if (!p) return;
  if (solo()) return select({ p, solo: true });
  const x = VIEW.find(v => v.p === p || v.q === p);
  if (x) select(x);
}
// Double-click or double-tap a route: bring the side panel back if it was hidden and open that route's pair, with
// its distance, costs, what-if, brief and 3D.
function mapOpen(hit) {
  if (!hit) return;
  const wasMin = panelMin();
  if (wasMin) setPanel(false);
  // the first click already started framing the pair on the wider map; frame it again for the narrower one
  if (wasMin) setTimeout(() => { if (state.sel) flyTo(state.sel); }, 0);
  if (["links", "rings", "sparks"].includes(hit.layer)) { const x = VIEW.find(v => keyOf(v) === hit.id) || RESULT.pairs.find(v => keyOf(v) === hit.id); if (x) select(x); return; }
  if (hit.layer === "yards" && hit.id && hit.id[0] === "c") return select({ cluster: CLUSTERS[+hit.id.slice(1)] });
  const p = PROJECTS.find(v => v.id === hit.id);
  if (!p) return;
  if (solo()) return select({ p, solo: true });
  const x = pairFor(p);
  if (x) select(x); else { state.tab = "overlaps"; renderPanel(); SeamMap.fit(p.coords, { padKm: 6 }); }
}
function mapHover(hit, ev) {
  if (!hit || !ev) return hideTip();
  if (hit.layer === "grid") return tip(ev, `<b>Existing ${hit.kv} kV line</b>${hit.op ? "<br>" + esc(hit.op) : ""}<br><span style="opacity:.7">OpenStreetMap</span>`);
  const p = PROJECTS.find(v => v.id === hit.id) || EXIST.find(v => v.id === hit.id);
  if (p) return showTip(ev, p);
  const x = VIEW.find(v => keyOf(v) === hit.id);
  if (x) return tip(ev, `<b>${esc(SEV[Math.min(x.tier, 4)])} · ${km(x.km)}</b><br>${esc(short(x.p))}<br>${esc(short(x.q))}<br>${pct(x.risk.chance)} chance of a shared window`);
  hideTip();
}
function tip(ev, html) {
  const t = $("#tip"); t.innerHTML = html; t.hidden = false;
  t.style.left = Math.min(ev.clientX + 12, innerWidth - 290) + "px";
  t.style.top = Math.min(ev.clientY + 12, innerHeight - t.offsetHeight - 8) + "px"; // flips above the pointer near the bottom
}
function showTip(ev, p) {
  tip(ev, `<b>${esc(p.name)}</b><br>${esc(lbl(p.utility))}${p.existing ? " · existing" : ""}${p.kv ? " · " + p.kv + " kV " + (TYPE[p.type] || "") : ""}` +
    (p.existing ? "" : `<br>In service ${fmtD(p, "in_service")}${p.cost ? " · " + money(p.cost) : ""}${isPast(p) ? (p.likely_built ? "<br>Likely built" : "<br>In-service date has passed") : ""}${p.loc === "low" ? "<br>Approximate location" : ""}`));
}
function hideTip() { $("#tip").hidden = true; }
function legend() {
  const us = solo() ? [state.utilA] : [state.utilA, state.utilB];
  $("#legend").innerHTML = `<div class="lg-row">${us.map(u => `<span><i class="ln" style="background:${uColor(u)}"></i>${esc(lbl(u))}</span>`).join("")}<span><i class="ln" style="background:var(--ink3);opacity:.6"></i>Existing</span></div>
    ${state.grid ? `<div class="lg-row muted"><span>Existing grid</span><span><i class="ln" style="background:#8E9AA6"></i>115</span><span><i class="ln" style="background:#8E7CB8"></i>161</span><span><i class="ln" style="background:#A05BA8"></i>230</span><span><i class="ln" style="background:#0097A7"></i>500 kV</span></div>` : ""}
    <div class="lg-row muted"><span>Width = kV</span><span><i class="ln dash"></i>approx. location</span><span><i class="ln fade"></i>date passed</span></div>` +
    (solo() ? "" : `<div class="lg-row muted">${[0, 1, 2, 3].map(i => `<span><i class="rg t${i}" style="border-color:${tcol(i)};border-width:${i ? 1.8 : 2.6}px"></i>${SEV[i]}</span>`).join("")}<span><i class="sq"></i>shared yard</span></div>`);
}

// ---------- time scrubber ----------
let playTimer = null;
function setupScrub() {
  const ps = PROJECTS.filter(p => shownUtil(p.utility));
  if (!ps.length) return;
  const lo = Math.floor(Math.min(...ps.map(p => mon(p.start)))), hi = Math.ceil(Math.max(...ps.map(p => mon(p.in_service))));
  const r = $("#tslider"); r.min = lo; r.max = hi;
  if (state.t != null) state.t = Math.min(hi, Math.max(lo, state.t));
  r.value = state.t ?? mon(TODAY);
  scrubUI();
}
function scrubUI() {
  const on = state.t != null;
  $("#tyear").textContent = on ? monthLabel(state.t) : "All years";
  $("#tall").hidden = !on;
  $("#play").textContent = playTimer ? "Pause" : "Play";
  $("#play").setAttribute("aria-pressed", !!playTimer);
  if (!on) $("#tlsub").textContent = solo() ? "listed projects" : "top pairs in the list · bars show construction, green where both are in the field";
}
function setT(t) { state.t = t; scrubUI(); renderMap(); renderTimeline(); }
function stopPlay() { clearInterval(playTimer); playTimer = null; scrubUI(); }
function togglePlay() {
  if (playTimer) return stopPlay();
  const r = $("#tslider");
  if (state.t == null || state.t >= +r.max) { r.value = r.min; setT(+r.min); }
  // Slower under reduced motion rather than disabled: the scrubber is the control, not decoration, so it still has
  // to advance — just without a 120 ms strobe.
  const step = matchMedia("(prefers-reduced-motion: reduce)").matches ? 600 : 120;
  playTimer = setInterval(() => { const n = state.t + 1; if (n > +r.max) return stopPlay(); r.value = n; setT(n); }, step);
  scrubUI();
}

// ---------- timeline ----------
function renderTimeline() {
  const svg = d3.select("#tl"); svg.selectAll("*").remove();
  const box = $(".tlbody"), W = Math.max(600, box.clientWidth || 800), LW = Math.min(300, W * 0.3), RH = 26, top = 22;
  const rows = solo() ? SOLO.slice(0, 40).map(p => ({ label: short(p), bars: [p] }))
    : (state.sel && state.sel.p && state.sel.q && !VIEW.slice(0, 12).includes(state.sel) ? [state.sel] : []).concat(VIEW.slice(0, 12)).map(x => ({ x, label: `${short(x.p)} × ${short(x.q)}`, bars: [x.p, x.q] }));
  const H = Math.max(80, top + rows.length * RH + 6);
  svg.attr("width", W).attr("height", H).attr("viewBox", `0 0 ${W} ${H}`);
  if (!rows.length) { svg.append("text").attr("x", 12).attr("y", 40).attr("fill", css("--ink2")).attr("font-size", 12).text(solo() ? "No projects match." : "No pairs match the filters."); return; }
  const all = rows.flatMap(r => r.bars);
  const lo = Math.floor(Math.min(d3.min(all, p => mon(p.start)), mon(TODAY)) / 12) * 12, hi = Math.ceil(d3.max(all, p => mon(p.in_service)) / 12) * 12;
  const X = d3.scaleLinear().domain([lo, hi]).range([LW, W - 12]);
  for (let m = lo; m <= hi; m += 12) {
    svg.append("line").attr("x1", X(m)).attr("x2", X(m)).attr("y1", top - 6).attr("y2", H).attr("stroke", css("--grid"));
    if (m < hi) svg.append("text").attr("x", X(m) + 3).attr("y", 13).attr("font-size", 11).attr("fill", css("--ink3")).text(m / 12);
  }
  const nowX = X(mon(TODAY));
  svg.append("line").attr("x1", nowX).attr("x2", nowX).attr("y1", top - 8).attr("y2", H).attr("stroke", css("--ink")).attr("stroke-dasharray", "2 2");
  svg.append("text").attr("x", nowX + 3).attr("y", top - 1).attr("font-size", 10).attr("fill", css("--ink")).text("today");
  const g = svg.selectAll("g.r").data(rows).join("g").attr("class", "r").attr("transform", (d, i) => `translate(0,${top + i * RH})`).style("cursor", "pointer")
    .on("click", (ev, d) => select(d.x || { p: d.bars[0], solo: true }));
  g.append("rect").attr("x", 0).attr("width", W).attr("height", RH).attr("fill", d => d.x && d.x === state.sel ? css("--hotsoft") : "transparent");
  g.append("text").attr("x", 10).attr("y", RH / 2 + 4).attr("font-size", 12).attr("fill", css("--ink")).attr("font-weight", d => d.x && d.x === state.sel ? 600 : 400)
    .text(d => { const n = Math.floor((LW - 20) / 6.4); return d.label.length > n ? d.label.slice(0, n - 1) + "…" : d.label; });
  g.each(function (d) {
    const G = d3.select(this), n = d.bars.length;
    d.bars.forEach((p, i) => {
      const y = n === 1 ? 9 : 5 + i * 9;
      G.append("rect").attr("x", X(mon(p.start))).attr("width", Math.max(3, X(mon(p.in_service)) - X(mon(p.start)))).attr("y", y).attr("height", 6)
        .attr("fill", uColor(p.utility)).attr("fill-opacity", isPast(p) ? .55 : .9);
    });
    if (n === 2) {
      const a = Math.max(mon(d.bars[0].start), mon(d.bars[1].start)), b = Math.min(mon(d.bars[0].in_service), mon(d.bars[1].in_service));
      if (b > a) G.append("rect").attr("x", X(a)).attr("width", X(b) - X(a)).attr("y", 22).attr("height", 3).attr("fill", css("--time"));
    }
  });
  if (state.t != null) {
    const x = X(Math.min(hi, Math.max(lo, state.t)));
    svg.append("line").attr("x1", x).attr("x2", x).attr("y1", top - 8).attr("y2", H).attr("stroke", css("--seam")).attr("stroke-width", 2);
  }
}

// ---------- panel: tabs ----------
function renderTabs() {
  document.querySelectorAll(".rail [role=tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  $("#tab-ask").classList.toggle("nudge", !store.get("askSeen", false));
  $("#n-overlaps").textContent = solo() ? SOLO.length : VIEW.length;
  const both = !solo();
  $("#tab-changes").hidden = $("#tab-optimize").hidden = !both;
  if (both) {
    const d = drift(), o = optimize();
    $("#n-changes").innerHTML = `<span class="up">+${d.opened.length}</span> <span class="down">−${d.closed.length}</span>`;
    $("#n-optimize").innerHTML = o && o.moves.length ? `<span class="up">+${money(o.after - o.before)}</span>` : "";
  }
  const review = (MODEL.checks || []).filter(c => c.status === "warn").length;
  $("#n-checks").innerHTML = review ? `<span class="warn">${review} to review</span>` : "";
  $("#b-checks").hidden = !review; $("#b-checks").textContent = review;
}
// Switch the panel's view, as the rail's tabs do.
// Ask toggles; every other rail item switches. Leaving Ask returns to the view that was open before it, which is what
// a panel you opened over your work should do.
function toggleTab(t) {
  if (panelMin()) { setPanel(false); if (t === "ask") store.set("askSeen", true); else state.lastView = t; return goTab(t); } // a rail item reopens a hidden panel
  if (t === "ask" && state.tab === "ask") return goTab(state.lastView || "overlaps");
  if (t === "ask") store.set("askSeen", true);
  else state.lastView = t;
  goTab(t);
}

function goTab(t) { const keep = t === "overlaps" && state.tab === "ask"; state.tab = t; if (state.sel && !state.sel.cluster && !keep) { state.sel = null; renderMap(); renderTimeline(); } renderPanel(); writeHash(); }
// Four headline numbers at the top of the Overlaps view; the last two open the Plan and Checks views.
function renderKpis() {
  const el = $("#kpis");
  if (!el) return;
  const exp = VIEW.reduce((t, x) => t + x.risk.expected, 0), plan = VIEW.reduce((t, x) => t + x.sav.total, 0), o = optimize();
  const review = (MODEL.checks || []).filter(c => c.status === "warn").length;
  const gain = o && o.moves.length ? o.after - o.before : 0;
  const part = VIEW.length !== RESULT.pairs.length;
  el.innerHTML = `<div class="kpi"><b>${VIEW.length}</b><span>${part ? "overlaps shown" : "overlaps"}</span><small>${part ? `of ${RESULT.pairs.length} flagged · ${RESULT.checked.toLocaleString()} checked` : `of ${RESULT.checked.toLocaleString()} pairs checked`}</small></div>
    <div class="kpi"><b>${money(exp)}</b><span>expected savings</span><small>${money(plan)} if every date held</small></div>
    <button type="button" class="kpi" data-kt="optimize"><b style="color:var(--time)">${gain ? "+" + money(gain) : "–"}</b><span>joint schedule</span><small>${o && o.moves.length ? o.moves.length + " suggested date move" + (o.moves.length === 1 ? "" : "s") : "no move helps"}</small></button>
    <button type="button" class="kpi" data-kt="checks"><b style="color:var(--amber)">${review}</b><span>to check</span><small>data checks to review</small></button>`;
  el.querySelectorAll("[data-kt]").forEach(b => b.onclick = () => goTab(b.dataset.kt));
}
function renderPanel() {
  renderTabs();
  const P = $("#panel");
  if (state.sel && state.tab === "overlaps") return renderDetail(P);
  if (state.tab === "changes" && !solo()) return renderChanges(P);
  if (state.tab === "optimize" && !solo()) return renderOptimize(P);
  if (state.tab === "checks") return renderChecks(P);
  if (state.tab === "ask") return renderAsk(P);
  renderOverlaps(P);
}

const activate = (el, fn) => { el.setAttribute("role", "button"); el.onclick = fn; el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }; };
// ---------- panel: overlaps table ----------
function overlapsHead(P) {
  // rebuilt when switching between comparing two utilities and listing one, since only the former has headline numbers
  const view = solo() ? "overlaps-solo" : "overlaps";
  if (P.dataset.view === view && $("#q")) return;
  P.dataset.view = view;
  P.innerHTML = `<div class="ph">${solo() ? "" : `<div class="kpis" id="kpis"></div>`}
      <div class="ph-row"><label class="fl">Sort <select id="sort"><option value="expected">Expected savings</option><option value="chance">Chance of a shared window</option><option value="distance">Distance</option></select></label>
        <span class="grow"></span><input id="q" type="search" placeholder="Search projects or TEAMS id" aria-label="Filter overlaps"></div>
    </div>
    <div class="yards" id="clusters"></div>
    <div class="thead" id="thead"></div>
    <div class="rows" id="rows"></div>`;
  $("#sort").value = state.sort;
  $("#q").value = state.q;
  $("#sort").onchange = e => { state.sort = e.target.value; refresh(); };
  let qTimer = null;
  $("#q").oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; state.shown = 60; refresh(); }, 150); };
}
// The distance chips live in the bar over the map, so they stay in reach with the side panel hidden.
function renderChips() {
  const el = $("#chips");
  if (solo()) { el.innerHTML = `<span class="muted">${SOLO.length} ${esc(lbl(state.utilA))} projects</span>`; return; }
  el.innerHTML = [`<button type="button" class="chip" data-t="all" aria-pressed="${state.tiers.size >= 5}">All ${RESULT.pairs.length}</button>`]
    .concat(TIERS.slice(0, 4).map((t, i) => `<button type="button" class="chip" data-t="${i}" aria-pressed="${state.tiers.has(i) && state.tiers.size < 5}"><i style="background:${tcol(i)}"></i>${SEV[i]} ${RESULT.pairs.filter(x => x.tier === i).length}</button>`)).join("");
  el.querySelectorAll(".chip").forEach(b => b.onclick = () => {
    const v = b.dataset.t;
    if (v === "all") state.tiers = new Set([0, 1, 2, 3, 4]);
    else if (state.tiers.size >= 5) state.tiers = new Set([+v]);
    else { if (state.tiers.has(+v)) state.tiers.delete(+v); else state.tiers.add(+v); if (!state.tiers.size) state.tiers = new Set([0, 1, 2, 3, 4]); }
    state.shown = 60; refresh();
  });
}
// The side panel can be hidden, leaving the rail, the filter bar and the map; the choice is remembered.
const panelMin = () => $(".work").classList.contains("min");
function setPanel(min, quiet) {
  $(".work").classList.toggle("min", !!min);
  const t = $("#panelTog"); t.setAttribute("aria-expanded", !min); t.title = min ? "Show the side panel" : "Hide the side panel";
  // resize the map now (the grid change is already laid out), so anything framed right after uses the new width
  if (!quiet) { store.set("panelMin", !!min); SeamMap.resize(); requestAnimationFrame(renderTimeline); }
}
function renderOverlaps(P) {
  overlapsHead(P);
  if (solo()) return renderSoloRows();
  renderKpis();
  const C = $("#clusters");
  C.hidden = !CLUSTERS.length;
  C.innerHTML = CLUSTERS.length ? `<span class="muted">Shared yards</span>` + CLUSTERS.map((c, i) => `<button type="button" class="chip" data-i="${i}" title="One staging yard for ${c.projects.length} projects built at the same time">${c.projects.length} projects · ${c.yard.near ? esc(c.yard.near.replace(/^(SAV|GTC|MEAG|CC)\s*[:-]\s*/i, "").split(/ (?:\d|-|\()/)[0]) : "open land"} · ${miles(c.impact.netMi)} truck-mi</button>`).join("") : "";
  C.querySelectorAll("[data-i]").forEach(b => b.onclick = () => select({ cluster: CLUSTERS[+b.dataset.i] }));
  $("#thead").innerHTML = `<span>#</span><span>Distance</span><span>Project pair</span><span title="Chance both are in the field together from today, given how each utility's dates moved between its last two plans">Same window</span><span class="r">Expected</span>`;
  const R = $("#rows");
  if (!VIEW.length) { R.innerHTML = `<div class="empty">No pairs match. Most planned projects don't overlap, so try a wider distance, a window buffer, or clear the filters.</div>`; return; }
  const bar = c => `<span class="bar"><span style="width:${Math.round(c * 100)}%;background:${c >= .5 ? "var(--time)" : c >= .25 ? "var(--amber)" : "var(--ink3)"}"></span></span>`;
  const paper = x => x.ov > 0 ? `on paper ${Math.round(x.ov)} mo shared` : x.sameWindow ? "on paper within buffer" : `on paper ${Math.round(x.gap)} mo apart`;
  const side = (p, cls) => `<span class="pp${isPast(p) ? " past" : ""}"><i class="${cls}"></i>${esc(short(p))}${p.likely_built ? ` <em>likely built</em>` : isPast(p) ? ` <em>date passed</em>` : ""}</span>`;
  R.innerHTML = VIEW.slice(0, state.shown).map((x, i) => {
    const st = STATUS[keyOf(x)];
    const label = `${SEV[Math.min(x.tier, 4)]}, ${km(x.km)}, ${short(x.p)} and ${short(x.q)}, ${x.risk.why === "built" ? "likely built" : pct(x.risk.chance) + " chance of a shared window"}, expected ${x.risk.expected ? money(x.risk.expected) : "no saving"}`;
    return `<div class="tr${state.hover === x ? " hov" : ""}" tabindex="0" role="button" aria-label="${esc(label)}" data-i="${i}">
      <span class="muted">${i + 1}</span>
      <span class="dist"><b class="sev s${Math.min(x.tier, 4)}">${SEV[Math.min(x.tier, 4)]}</b><span>${km(x.km)}</span></span>
      <span class="pair">${side(x.p, "a")}${side(x.q, "b")}${st && st !== "Open" ? `<span class="status">${esc(st)}</span>` : ""}</span>
      <span class="ch">${x.risk.why === "built" ? `<span class="muted">built</span>` : `<span class="chv">${bar(x.risk.chance)}<b>${pct(x.risk.chance)}</b></span>`}<small>${paper(x)}</small></span>
      <span class="r"><b>${x.risk.expected ? money(x.risk.expected) : "–"}</b><small>${x.sav.total ? "plan " + money(x.sav.total) : ""}</small></span></div>`;
  }).join("") + (VIEW.length > state.shown ? `<button type="button" class="more" id="more">Show ${Math.min(60, VIEW.length - state.shown)} more of ${VIEW.length - state.shown}</button>` : "");
  R.querySelectorAll(".tr").forEach(el => {
    const x = VIEW[+el.dataset.i];
    el.onclick = () => select(x);
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(x); } };
    el.onmouseenter = () => { state.hover = x; renderMap(); };
    el.onmouseleave = () => { state.hover = null; renderMap(); };
  });
  if ($("#more")) $("#more").onclick = () => { state.shown += 60; renderMap(); renderOverlaps(P); };
  const band = borderline();
  if (band.length) {
    const close = band.slice(0, 3).map(x => `${esc(short(x.p))} / ${esc(short(x.q))} at ${x.km.toFixed(1)} km`).join("; ");
    R.insertAdjacentHTML("beforeend", `<p class="band">${band.length} more pair${band.length === 1 ? "" : "s"} sit just outside the ${state.D} km screen &mdash; closest ${close}. Kept out of the ranking and the totals; shown because ${state.D} km is a chosen threshold, not a cliff.</p>`);
  }
}
function renderSoloRows() {
  $("#clusters").hidden = true;
  $("#thead").innerHTML = `<span>#</span><span>Type</span><span>Project</span><span>In service</span><span class="r">Cost</span>`;
  const R = $("#rows");
  if (!SOLO.length) { R.innerHTML = `<div class="empty">No projects match the filter.</div>`; return; }
  R.innerHTML = SOLO.slice(0, 300).map((p, i) => `<div class="tr" tabindex="0" data-i="${i}"><span class="muted">${i + 1}</span><span class="dist"><span>${p.kv} kV</span><small>${esc(TYPE[p.type] || p.type)}</small></span>
    <span class="pair"><span class="pp${isPast(p) ? " past" : ""}"><i class="a"></i>${esc(p.name)}</span></span><span class="ch"><span>${fmtD(p, "in_service")}</span></span><span class="r">${p.cost ? money(p.cost) : "–"}</span></div>`).join("");
  R.querySelectorAll(".tr").forEach(el => { const x = { p: SOLO[+el.dataset.i], solo: true }; activate(el, () => select(x)); });
}

// ---------- panel: pair detail ----------
function located(p) {
  if (!p.located) return p.loc === "low" ? "placed by hand, approximate" : "placed by hand from the plan's substation names";
  const M = { reference: "challenge reference", manual: "placed by hand", osm_substation: "OpenStreetMap substation", osm_plant: "OpenStreetMap plant", town: "town only", "not found": "not found" };
  return p.located.map(l => `${esc(l.name.replace(/\s*\(.*?\)/g, "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()))}: <span class="${l.confidence === "high" ? "" : "amber"}">${M[l.method] || l.method}</span>`).join(" · ");
}
// A plain name for where a project comes from, for the brief's footer.
const srcName = p => {
  const s = p.source || "";
  if (!s) return `${lbl(p.utility)}'s plan`;
  if (s.startsWith("Challenge package")) return s.replace("Challenge package: ", "");
  if (/scrtp/i.test(s)) return "SCRTP 2026-2030 project list";
  if (/southeasternrtp/i.test(s)) return "SERTP expansion plan";
  try { return /^https?:/i.test(s) ? `${lbl(p.utility)}'s plan (${new URL(s).hostname})` : s; } catch (err) { return s; }
};
function sourceLink(p) {
  if (!p.source) return "–";
  const txt = p.source.startsWith("Challenge package") ? p.source.replace("Challenge package: ", "") : p.source.includes("scrtp") ? "SCRTP 2026–2030" : p.source.includes("southeasternrtp") ? "SERTP" : "Source";
  return p.source.startsWith("http") ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(txt)}${p.page ? ", " + esc(p.page) : ""}</a>` : `${esc(txt)}${p.page ? ", " + esc(p.page) : ""}`;
}
function windowText(p) {
  return `${fmtD(p, "start")} → ${fmtD(p, "in_service")} <span class="muted">${p.start_published ? "" : "est."}</span>${p.likely_built ? ` <span class="amber">· likely built</span>` : isPast(p) ? ` <span class="amber">· date passed</span>` : ""}`;
}
function driftText(p) {
  if (!p.drift || !p.drift.months) return p.drift ? "date unchanged since the previous plan" : "–";
  const m = p.drift.months;
  return `${Math.abs(m)} months ${m > 0 ? "later" : "earlier"} than the previous plan`;
}
function chanceBox(x) {
  const r = x.risk;
  if (r.why === "built") { const b = x.p.likely_built ? x.p : x.q, o = b === x.p ? x.q : x.p;
    return `<div class="callout amber"><b>Likely built</b><span>${esc(short(b))} was listed for ${fmtD(b, "in_service")} and is gone from ${esc(lbl(b.utility))}'s newer plan, so there is nothing left to build together. ${esc(lbl(o.utility))}'s work still meets the finished line: share outage plans and as-built drawings.</span></div>`; }
  const ahead = mon(x.p.in_service) > mon(TODAY) && mon(x.q.in_service) > mon(TODAY);
  const head = x.sameWindow && r.chance < .5 ? (ahead ? "In one window on paper, but plans usually move" : "In one window on paper, but mostly in the past")
    : !x.sameWindow && r.chance >= .5 ? "Apart on paper, but likely to meet" : x.sameWindow ? "In one window, and likely to stay there" : "Apart on paper, and likely to stay apart";
  const cls = r.chance >= .5 ? "green" : r.chance >= .25 ? "amber" : "grey";
  return `<div class="callout ${cls}"><div class="big"><b>${pct(r.chance)}</b><small>chance</small></div><div><b>${head}</b>
    <span>Share of 2,000 schedule draws in which both are in the field together from ${fmtD({ d: TODAY }, "d")} on, moving each date like ${esc(lbl(x.p.utility))} and ${esc(lbl(x.q.utility))} dates moved between their last two plans. Expected savings <b>${money(r.expected)}</b>${x.sav.total ? `; ${money(x.sav.total)} if every date held` : ""}.</span></div></div>`;
}
function renderDetail(P) {
  P.dataset.view = "detail";
  const x = state.sel;
  if (x.cluster) return renderCluster(x.cluster, P);
  if (x.solo) {
    const p = x.p, c = Engine.estCost(p);
    P.innerHTML = `<div class="dbar"><button type="button" class="btn sm" id="back">← Projects</button></div><div class="detail">
      <h2>${esc(p.name)}</h2><table class="cmp"><tbody>
      <tr><th>Work</th><td>${p.kv} kV ${esc(TYPE[p.type] || "")}${p.desc ? " · " + esc(p.desc) : ""}</td></tr>
      <tr><th>Window</th><td>${windowText(p)}</td></tr><tr><th>Cost</th><td>${c.est ? "est. " : ""}${money(c.v)}</td></tr>
      <tr><th>Located</th><td>${located(p)}</td></tr><tr><th>Source</th><td>${sourceLink(p)}</td></tr></tbody></table>
      <p class="note">Pick a second utility at the top to find projects near this one.</p></div>`;
    $("#back").onclick = () => select(null);
    return;
  }
  const s = x.sav, key = keyOf(x), idx = VIEW.indexOf(x), ref = REFS[key];
  if (!state.wi || state.wi.key !== key) state.wi = { key, who: "q", shift: 0 };
  const T = TIERS[Math.min(x.tier, 4)];
  P.innerHTML = `<div class="dbar"><button type="button" class="btn sm" id="back">← Overlaps</button><span class="muted">${idx >= 0 ? `#${idx + 1} of ${VIEW.length}` : ""}</span><span class="grow"></span>
      <button type="button" class="btn sm" id="v3d">3D illustration</button><button type="button" class="btn sm primary" id="brf">Coordination brief</button></div>
    <div class="detail">
      <div class="tags"><b class="sev s${Math.min(x.tier, 4)}">${SEV[Math.min(x.tier, 4)]}${T.short.toLowerCase() !== SEV[Math.min(x.tier, 4)].toLowerCase() ? " · " + esc(T.short.toLowerCase()) : ""}</b>${x.ov > 0 ? `<b class="tag green">${Math.round(x.ov)} mo same window</b>` : ""}${ref ? `<span class="muted">Matches challenge reference ${esc(ref)}</span>` : ""}</div>
      <h2>${esc(short(x.p))} and ${esc(short(x.q))}</h2>
      <dl class="facts"><div><dt>Closest points</dt><dd>${km(x.km)}</dd></div><div><dt>Build windows</dt><dd>${x.ov > 0 ? Math.round(x.ov) + " mo shared" : Math.round(x.gap) + " mo apart"}</dd></div>
        <div><dt>Chance</dt><dd>${x.risk.why === "built" ? "–" : pct(x.risk.chance)}</dd></div><div><dt>Expected</dt><dd>${money(x.risk.expected)}</dd></div></dl>
      ${chanceBox(x)}
      <table class="cmp"><thead><tr><th></th><th><i class="a"></i>${esc(lbl(x.p.utility))}</th><th><i class="b"></i>${esc(lbl(x.q.utility))}</th></tr></thead><tbody>
        <tr><th>Project</th><td>${esc(x.p.name)}</td><td>${esc(x.q.name)}</td></tr>
        <tr><th>Work</th><td>${x.p.kv} kV ${esc(TYPE[x.p.type] || "")}${x.p.desc ? `<small>${esc(x.p.desc)}</small>` : ""}</td><td>${x.q.kv} kV ${esc(TYPE[x.q.type] || "")}${x.q.desc ? `<small>${esc(x.q.desc)}</small>` : ""}</td></tr>
        <tr><th>Window</th><td>${windowText(x.p)}</td><td>${windowText(x.q)}</td></tr>
        <tr><th>Plan drift</th><td>${driftText(x.p)}</td><td>${driftText(x.q)}</td></tr>
        <tr><th>Cost</th><td>${s.ca.est ? "est. " : ""}${money(s.ca.v)}</td><td>${s.cb.est ? "est. " : ""}${money(s.cb.v)}</td></tr>
        <tr><th>Located</th><td>${located(x.p)}</td><td>${located(x.q)}</td></tr>
        <tr><th>Source</th><td>${sourceLink(x.p)}</td><td>${sourceLink(x.q)}</td></tr></tbody></table>
      <div id="sharesBox"></div>
      ${pairYardHTML(x)}
      <div class="whatif"><div class="dh"><h3>Schedule what-if</h3><span class="seg sm" role="group" aria-label="Project to move">
        <button type="button" data-w="q" aria-pressed="${state.wi.who === "q"}">Move ${esc(lbl(x.q.utility))}</button><button type="button" data-w="p" aria-pressed="${state.wi.who === "p"}">Move ${esc(lbl(x.p.utility))}</button></span></div>
        <div class="wi-ctl"><input type="range" id="wiShift" min="-36" max="36" step="1" value="${state.wi.shift}" aria-label="Months to move the project"><output id="wiOut"></output></div>
        <svg id="wiChart" role="img" aria-label="Both build windows after the shift"></svg>
        <p class="wi-res" id="wiRes" aria-live="polite"></p>
        <div class="row"><button type="button" class="btn sm" id="wiRec"></button><button type="button" class="btn sm" id="wiReset">Reset to plan</button></div></div>
      <div class="statusrow"><label for="st">Status</label><select id="st">${STATUSES.map(v => `<option${(STATUS[key] || "Open") === v ? " selected" : ""}>${v}</option>`).join("")}</select><span class="muted">saved on this device</span></div>
    </div>`;
  $("#back").onclick = () => select(null);
  $("#v3d").onclick = () => open3d(x);
  $("#brf").onclick = () => openBrief(x);
  $("#st").onchange = e => { if (e.target.value === "Open") delete STATUS[key]; else STATUS[key] = e.target.value; store.set("status", STATUS); };
  if ($("#toCl")) $("#toCl").onclick = () => select({ cluster: clusterOf(x) });
  P.querySelectorAll(".whatif [data-w]").forEach(b => b.onclick = () => {
    state.wi.who = b.dataset.w; state.wi.shift = 0; $("#wiShift").value = 0;
    P.querySelectorAll(".whatif [data-w]").forEach(o => o.setAttribute("aria-pressed", o === b));
    updateWhatIf(x);
  });
  $("#wiShift").oninput = e => { state.wi.shift = +e.target.value; updateWhatIf(x); };
  $("#wiReset").onclick = () => { state.wi.shift = 0; $("#wiShift").value = 0; updateWhatIf(x); };
  updateWhatIf(x);
  P.scrollTop = 0;
}
// The challenge's reference overlaps (data/official/reference_overlaps.csv), by project pair.
const REFS = { "DESCP-31|IRP-20793": "OVL_1", "DESC-12|IRP-20277": "OVL_2", "DESC-12|IRP-20065": "OVL_3", "DESCP-14|IRP-20793": "OVL_4", "DESCP-10|IRP-20277": "OVL_5", "DESCP-10|IRP-20065": "OVL_6" };

function yardPlace(yd) {
  const ll = yd.at.map(v => v.toFixed(3)).join(", ");
  return `${yd.near ? `next to <b>${esc(yd.near)}</b>` : "on open land"} (<a href="https://www.google.com/maps?q=${yd.at[0].toFixed(5)},${yd.at[1].toFixed(5)}" target="_blank" rel="noopener">${ll}</a>)`;
}
const yardDist = yd => yd.dists.every(d => d < 0.1) ? "right at both sites" : yd.dists.map(km).join(" and ") + " from the two sites";
function pairYardHTML(x) {
  if (x.tier > 3) return "";
  const yd = pairYard(x), im = Engine.yardImpact(yd, 2), c = clusterOf(x);
  return `<div class="box"><h3>Shared yard</h3><p>Best spot for one staging yard: ${yardPlace(yd)}, ${yardDist(yd)}.
    ${x.sameWindow ? `It would save about <b>${miles(im.netMi)} truck-miles</b>, ${miles(im.hours)} driver-hours and ${im.co2t.toFixed(1)} t of CO2.` : "It only helps while both are being built."}</p>
    ${c ? `<button type="button" class="btn sm" id="toCl">Part of a ${c.projects.length}-project group: one yard for all</button>` : ""}</div>`;
}
function sharesHTML(x) {
  const by = Object.fromEntries(x.sav.items.map(i => [i.share, i]));
  const all = Engine.savings(Object.assign({}, x, { sameWindow: true })).items, byAll = Object.fromEntries(all.map(i => [i.share, i]));
  const rows = Engine.shareable(x).flatMap(g => g.items.map(n => ({ n, g, i: by[n] || byAll[n] })));
  return `<div class="box"><div class="dh"><h3>What they can share</h3><button type="button" class="link" id="editCosts">Edit unit costs</button></div>
    <table class="items"><tbody>${rows.map(r => `<tr class="${r.g.active ? "" : "off"}"><td>${esc(r.i ? r.i.k : r.n)}<small>${r.i ? esc(r.i.how) : ""}${r.g.active ? "" : " · only while both are being built"}</small></td><td class="r">${r.i ? money(r.i.v) : "–"}</td></tr>`).join("")}
    <tr class="tot"><td>Each utility saves if dates hold</td><td class="r">${x.sav.total ? money(x.sav.total) : "$0"}</td></tr></tbody></table>
    ${x.res.length ? `<p class="note">Also in common: ${x.res.map(esc).join(", ")}.</p>` : ""}</div>`;
}
function renderCluster(c, P) {
  const im = c.impact;
  P.innerHTML = `<div class="dbar"><button type="button" class="btn sm" id="back">← Overlaps</button></div><div class="detail">
    <h2>One yard for ${c.projects.length} projects</h2>
    <p>These projects are built during overlapping windows and chain together through nearby pairs. The best single staging yard is ${yardPlace(c.yard)}, which puts every work site within ${km(c.yard.max)}, inside a crew's 40 km daily drive.</p>
    <dl class="facts"><div><dt>Truck-miles saved</dt><dd>${miles(im.netMi)}</dd></div><div><dt>Driver time</dt><dd>${miles(im.hours)} h</dd></div><div><dt>CO2 avoided</dt><dd>${im.co2t.toFixed(1)} t</dd></div><div><dt>Yards not built</dt><dd>${im.yardsAvoided} · ${money(im.dollars)}</dd></div></dl>
    <table class="items"><tbody>${c.projects.map((p, i) => `<tr><td><i class="${p.utility === state.utilA ? "a" : "b"}"></i>${esc(p.name)}<small>${esc(lbl(p.utility))} · ${fmtD(p, "start")} to ${fmtD(p, "in_service")}</small></td><td class="r">${km(c.yard.dists[i])}</td></tr>`).join("")}</tbody></table>
    ${yardMath(c.yard, im)}
    <p class="note">The yard is the point with the least total distance to every site (a geometric median), moved to an existing substation or plant when one is almost as good, since those already have road access. Distances are straight lines times the road factor.</p></div>`;
  $("#back").onclick = () => select(null);
}
function yardMath(yd, im) {
  const A = Engine.ASSUME;
  return `<table class="items"><tbody>
    <tr><td>Heavy loads that share trips<small>${A.loads} loads × ${im.n - 1} extra project${im.n === 2 ? "" : "s"} × 2 × ${A.haulKm} km from the depot</small></td><td class="r">${miles(im.haulMi)} mi</td></tr>
    <tr><td>Added yard-to-site driving<small>${A.shuttles} round trips per project × ${A.circuity} × each site's distance from the yard</small></td><td class="r">−${miles(im.shuttleMi)} mi</td></tr>
    <tr class="tot"><td>Net truck-miles saved</td><td class="r">${miles(im.netMi)} mi</td></tr>
    <tr><td>CO2 avoided<small>${A.mpg} mpg × ${A.co2Gal} kg CO2 per gallon of diesel (EPA)</small></td><td class="r">${im.co2t.toFixed(1)} t</td></tr></tbody></table>`;
}

// ---------- what-if ----------
const shiftISO = Engine.shiftISO;
function whatIf(x, who, m) {
  if (!m) return x;
  const moved = Object.assign({}, x[who], { start: shiftISO(x[who].start, m), in_service: shiftISO(x[who].in_service, m) });
  const p = who === "p" ? moved : x.p, q = who === "q" ? moved : x.q, ov = Engine.windowOverlap(p, q);
  const y = Object.assign({}, x, { p, q, ov: Math.max(0, ov), gap: Math.max(0, -ov), sameWindow: -ov <= state.B });
  y.sav = Engine.savings(y);
  const c = Engine.overlapChance(y, MODEL.slips, { bufferMonths: state.B, today: TODAY });
  const e = Engine.expectedSavings(y, c.p);
  y.risk = { chance: c.p, why: c.why, expected: e.expected };
  return y;
}
const moLabel = m => m === 0 ? "as planned" : `${Math.abs(m)} month${Math.abs(m) === 1 ? "" : "s"} ${m < 0 ? "earlier" : "later"}`;
function updateWhatIf(x) {
  const { who, shift } = state.wi, y = whatIf(x, who, shift), rec = Engine.recommendShift(x, who, TODAY);
  $("#wiOut").textContent = moLabel(shift);
  const svg = d3.select("#wiChart"), W = 480, H = 64, LW = 96; svg.selectAll("*").remove();
  const all = [x.p, x.q, y.p, y.q], lo = Math.floor(d3.min(all, p => mon(p.start)) / 12) * 12, hi = Math.ceil(d3.max(all, p => mon(p.in_service)) / 12) * 12;
  const X = d3.scaleLinear().domain([lo, hi]).range([LW, W - 8]);
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  for (let m = lo; m <= hi; m += 12) {
    svg.append("line").attr("x1", X(m)).attr("x2", X(m)).attr("y1", 12).attr("y2", H).attr("stroke", css("--grid"));
    if (m < hi && (hi - lo) / 12 <= 12) svg.append("text").attr("x", X(m) + 3).attr("y", 9).attr("font-size", 9).attr("fill", css("--ink3")).text(m / 12);
  }
  const a = Math.max(mon(y.p.start), mon(y.q.start)), b = Math.min(mon(y.p.in_service), mon(y.q.in_service));
  if (b > a) svg.append("rect").attr("x", X(a)).attr("width", X(b) - X(a)).attr("y", 14).attr("height", H - 14).attr("fill", css("--time")).attr("fill-opacity", .14);
  const nowX = X(Math.min(hi, Math.max(lo, mon(TODAY))));
  svg.append("line").attr("x1", nowX).attr("x2", nowX).attr("y1", 12).attr("y2", H).attr("stroke", css("--ink")).attr("stroke-dasharray", "2 2");
  [["p", 20], ["q", 42]].forEach(([k, yy]) => {
    const o = x[k], n = y[k], c = uColor(o.utility);
    svg.append("text").attr("x", LW - 8).attr("y", yy + 10).attr("text-anchor", "end").attr("font-size", 11).attr("fill", c).attr("font-weight", 600).text(lbl(o.utility).split(" ")[0]);
    if (n !== o) svg.append("rect").attr("x", X(mon(o.start))).attr("width", Math.max(2, X(mon(o.in_service)) - X(mon(o.start)))).attr("y", yy).attr("height", 12).attr("rx", 2)
      .attr("fill", "none").attr("stroke", c).attr("stroke-dasharray", "3 3").attr("opacity", .6);
    svg.append("rect").attr("x", X(mon(n.start))).attr("width", Math.max(2, X(mon(n.in_service)) - X(mon(n.start)))).attr("y", yy).attr("height", 12).attr("rx", 2).attr("fill", c).attr("fill-opacity", .85);
  });
  $("#sharesBox").innerHTML = sharesHTML(y);
  $("#editCosts").onclick = () => openModal("assume");
  const d = y.risk.expected - x.risk.expected;
  $("#wiRes").innerHTML = (y.ov > 0 ? `Windows overlap <b>${Math.round(y.ov)} months</b> on paper.` : `Windows are <b>${Math.round(y.gap)} months apart</b> on paper.`) +
    ` Chance of a shared window <b>${pct(y.risk.chance)}</b>, expected savings <b>${money(y.risk.expected)}</b>` +
    (shift ? (Math.abs(d) >= 500 ? ` (<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${money(Math.abs(d))}</span> vs. as planned).` : " (no change from as planned).") : ".");
  const recBtn = $("#wiRec");
  recBtn.hidden = rec == null || rec === 0 || rec === shift;
  if (rec) { recBtn.textContent = `Try ${moLabel(rec)}`; recBtn.onclick = () => { state.wi.shift = rec; $("#wiShift").value = rec; updateWhatIf(x); }; }
  $("#wiReset").hidden = !shift;
}

// ---------- panel: plan changes ----------
function histogram(months, color) {
  const bins = [-36, -24, -12, 0, 12, 24, 36, 48], W = 240, H = 84, bw = 22;
  const binOf = v => v <= -30 ? 0 : v <= -18 ? 1 : v < 0 ? 2 : v === 0 ? 3 : v < 18 ? 4 : v < 30 ? 5 : v < 42 ? 6 : 7;
  const n = bins.map(() => 0); months.forEach(v => n[binOf(v)]++);
  const max = Math.max(...n), x0 = 12;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="How far dates moved">${n.map((c, i) => c ? `<rect x="${x0 + i * (bw + 4)}" y="${62 - 52 * c / max}" width="${bw}" height="${52 * c / max}" fill="${color}"><title>${c}</title></rect><text x="${x0 + i * (bw + 4) + bw / 2}" y="${58 - 52 * c / max}" font-size="9" text-anchor="middle" fill="var(--ink2)">${c}</text>` : "").join("")}
    <line x1="0" x2="${W}" y1="62" y2="62" stroke="var(--line)"/>${["−36", "−24", "−12", "0", "+12", "+24", "+36", "48+"].map((t, i) => `<text x="${x0 + i * (bw + 4) + bw / 2}" y="76" font-size="9" text-anchor="middle" fill="var(--ink3)">${t}</text>`).join("")}</svg>`;
}
function renderChanges(P) {
  P.dataset.view = "changes";
  const d = drift(), S = MODEL.slips || {};
  const why = x => {
    const r = [];
    for (const p of [x.p, x.q]) if (p.drift && p.drift.months) r.push(`${lbl(p.utility)} moved ${short(p)} ${Math.abs(p.drift.months)} months ${p.drift.months > 0 ? "later" : "earlier"}`);
    return r.join("; ") + (REFS[keyOf(x)] ? ` · challenge reference ${REFS[keyOf(x)]}` : "");
  };
  const list = xs => xs.map((x, i) => `<button type="button" class="tr lite" data-k="${esc(keyOf(x))}"><span class="muted">${km(x.km)}</span><span class="pair"><span class="pp"><i class="a"></i>${esc(short(x.p))}</span><span class="pp"><i class="b"></i>${esc(short(x.q))}</span><small>${esc(why(x))}</small></span></button>`).join("") || `<div class="empty">None.</div>`;
  const u = k => S[k] ? `<div class="hist"><span><b>${esc(lbl(k))}</b> · ${S[k].n} projects with a history</span>${histogram(S[k].months, k === state.utilA ? "var(--u0)" : "var(--u1)")}<small>${S[k].slipped} later, ${S[k].advanced} earlier, ${S[k].n - S[k].slipped - S[k].advanced} unchanged · months moved between the last two plans</small><small class="muted">${esc(S[k].source)}</small></div>` : "";
  P.innerHTML = `<div class="detail"><h2>How dates moved between the last two plans</h2><div class="hists">${u(state.utilA)}${u(state.utilB)}</div>
    <p class="note">Seamline replays each pair with the dates the previous plan listed. These are the shared build windows the latest updates opened and closed.</p></div>
    <h3 class="sub">Shared windows opened <span class="up">${d.opened.length}</span></h3><div class="rows">${list(d.opened)}</div>
    <h3 class="sub">Closed <span class="down">${d.closed.length}</span></h3><div class="rows">${list(d.closed)}</div>`;
  P.querySelectorAll("[data-k]").forEach(el => activate(el, () => { const x = RESULT.pairs.find(v => keyOf(v) === el.dataset.k); if (x) { state.tab = "overlaps"; select(x); } }));
}

// ---------- panel: optimize ----------
function renderOptimize(P) {
  P.dataset.view = "optimize";
  const o = optimize();
  const gain = o.after - o.before, up = new Set(o.moves.flatMap(m => m.pairs.filter(a => a.after > a.before).map(a => keyOf(a.x)))).size;
  P.innerHTML = `<div class="detail"><h2>${o.moves.length ? `${o.moves.length} date move${o.moves.length === 1 ? "" : "s"} raise expected savings from ${money(o.before)} to ${money(o.after)}` : "No move of this size adds at least $25K"}</h2>
    <p>${o.moves.length ? `Each move is at most ${state.opt.maxShift} months, on a project that has not started, never starting before today. ${up} pairs become more likely to share a crew window (+${money(gain)}).` : "Try allowing larger moves."} Chances use how each utility's dates moved between its last two plans.</p>
    <div class="ph-row"><label class="fl">Largest move <select id="oMax"><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option></select></label>
      <label class="fl">Move <select id="oWho"><option value="both">Both utilities</option><option value="a">${esc(lbl(state.utilA))} only</option><option value="b">${esc(lbl(state.utilB))} only</option></select></label>
      <span class="grow"></span><button type="button" class="btn sm" id="oMap" aria-pressed="${state.showMoves}">Show on map</button><button type="button" class="btn sm primary" id="oBrief"${o.moves.length ? "" : " disabled"}>Joint brief</button></div></div>
    <div class="thead opt"><span>#</span><span>Move</span><span>Shift</span><span class="r">Adds</span></div>
    <div class="rows">${o.moves.map((m, i) => {
      const best = m.pairs.slice().sort((a, b) => (b.after - b.before) - (a.after - a.before))[0], other = best ? (best.x.p === m.project ? best.x.q : best.x.p) : null;
      return `<button type="button" class="tr opt" data-i="${i}"><span class="muted">${i + 1}</span><span class="pair"><span class="pp"><i class="${m.project.utility === state.utilA ? "a" : "b"}"></i>${esc(short(m.project))}</span>
        <small>In service ${fmtD(m.from, "in_service")} → ${fmtD(m.to, "in_service")}</small>${other ? `<small>Best effect · ${esc(short(other))}: ${pct(best.before)} → ${pct(best.after)}</small>` : ""}</span>
        <span class="${m.months > 0 ? "amber" : "blue"}"><b>${m.months > 0 ? "+" : "−"}${Math.abs(m.months)} mo</b></span><span class="r up"><b>+${money(m.gain)}</b></span></button>`;
    }).join("")}</div>
    <p class="note pad">Planning aid: assumes each date moves once more, like past plan updates, and that the utilities move independently.</p>`;
  $("#oMax").value = state.opt.maxShift; $("#oWho").value = state.opt.who;
  $("#oMax").onchange = e => { state.opt.maxShift = +e.target.value; renderPanel(); renderMap(); };
  $("#oWho").onchange = e => { state.opt.who = e.target.value; renderPanel(); renderMap(); };
  $("#oMap").onclick = () => { state.showMoves = !state.showMoves; if (state.showMoves && o.moves.length) flyTo({ moves: o.moves }); renderPanel(); renderMap(); };
  $("#oBrief").onclick = () => openScheduleBrief(o);
  P.querySelectorAll(".tr.opt").forEach(el => activate(el, () => {
    const m = o.moves[+el.dataset.i], best = m.pairs.slice().sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];
    const x = best && RESULT.pairs.find(v => keyOf(v) === keyOf(best.x));
    if (x) { state.tab = "overlaps"; select(x); }
  }));
}

// ---------- panel: data checks ----------
function renderChecks(P) {
  P.dataset.view = "checks";
  const C = MODEL.checks || [], n = s => C.filter(c => c.status === s).length;
  const LBL = { pass: "Passed", fixed: "Fixed", warn: "Review" };
  const rec = r => Object.entries(r).filter(([k]) => k !== "endpoints").map(([k, v]) => `<b>${esc(k)}</b> ${esc(typeof v === "object" ? JSON.stringify(v) : v)}`).join(" · ");
  P.innerHTML = `<div class="detail"><h2>Pipeline run ${new Date(TODAY + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</h2>
    <p>${(k => k ? `${k.pdfs} PDFs → ${k.official} official records (${k.official_placed} placed) + the newer SCRTP and SERTP lists → ${k.on_map} projects on the map → ` : "")(MODEL.pipeline)}${RESULT.pairs.length} overlaps. These checks run on every rebuild of the data (<code>scripts/build_projects.py</code>); a test confirms all 6 of the challenge's reference overlaps are flagged.</p>
    <div class="ph-row"><span><b class="green">${n("pass")}</b> passed</span><span><b class="blue">${n("fixed")}</b> caught and fixed</span><span><b class="amber">${n("warn")}</b> to review</span><span class="grow"></span><button type="button" class="btn sm" id="dl">Download report (JSON)</button></div></div>
    <div class="rows">${C.map((c, i) => `<div class="check"><button type="button" class="tr lite" data-i="${i}" aria-expanded="${state.openCheck === i}"><b class="st ${c.status}">${LBL[c.status] || c.status}</b><span class="pair"><b>${esc(c.title)}</b><small>${esc(c.result)}</small></span></button>
      ${state.openCheck === i ? `<ul class="recs">${(c.records || []).slice(0, 40).map(r => `<li>${rec(r)}</li>`).join("") || "<li>No records.</li>"}${(c.records || []).length > 40 ? `<li class="muted">and ${c.records.length - 40} more in the report</li>` : ""}</ul>` : ""}</div>`).join("")}</div>`;
  P.querySelectorAll(".check [data-i]").forEach(b => b.onclick = () => { const i = +b.dataset.i; state.openCheck = state.openCheck === i ? null : i; renderChecks(P); });
  $("#dl").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(MODEL, null, 1)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "seamline-validation.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}


// ---------- panel: assistant ----------
// Claude answers questions using tools that read the same data the page shows (agent.js runs the loop).
const CHAT = { messages: [], log: [], busy: false };
const SYSTEM = `You are Geo, the assistant inside Seamline. If asked your name, you are Geo. a tool that compares two electric utilities' planned transmission construction (by default Dominion Energy South Carolina, "DESC", and Georgia's integrated transmission system, "GPC" / "Georgia ITS": Georgia Power, GTC and MEAG) and flags where the work overlaps.

How Seamline measures things:
- Distance is between the closest points of two projects. Tiers: touching (0 km), under 1.6 km (can share right-of-way, access roads, permits), under 8 km (laydown yards, deliveries), under 40 km (crews, cranes, contractors).
- "Same window on paper" means the planned construction periods overlap. "Chance" is the share of 2,000 schedule draws, from today on, in which both are in the field together, moving each date the way that utility's dates moved between its last two published plans. "Expected savings" weights the items that need a shared window by that chance. "Savings if dates hold" assumes every date holds. These are planning estimates, not quotes.
- Data: DESC's SCRTP 2024-2028 and 2026-2030 project lists, Georgia Power's 2025 IRP ten-year plan (Table 2 and each project's detail page) and SERTP 2026. Locations come from OpenStreetMap substation names, the challenge's reference table, or hand placement; each project records how.

The section below the prompt tells you what is loaded — counts, filters, totals and the five strongest pairs — so a question about those needs no tool call. For anything more specific than that summary, call a tool: it is the data, and the summary is only a summary. Answer only from what the tools and that summary give you. If the data doesn't cover something, say so. Name projects the way the tools do, give numbers with units, and cite the source page or TEAMS number when it helps. Keep answers short: a sentence or two, then a few bullets if needed. Answer in the language the user writes in. When the user asks where something is, or to see or show something, or when your answer is about one specific pair or project, call show_on_map for it — but always name the project or pair in your reply as well, with its id and its figures. Moving the map is not an answer on its own. For questions about extremes — the biggest, longest, highest-voltage, earliest or latest project — use search_projects with sort, and say which measure you ranked by. To compare two named projects, call compare_projects rather than reading each one: it is the only tool that gives you the distance between them and whether they are a flagged pair. When an answer is a list or a summary someone might want to keep, end by offering the printable version — open_report for a list of projects or the comparison as a whole, open_brief for one pair, open_schedule_brief for the date moves — and say it can be saved as PDF from the document's own button. Offer it in one short sentence; do not open a document unless the user asks for one. When they ask for a brief, a memo, a write-up or something to print or send, call open_brief (one pair) or open_schedule_brief (rescheduling) and pass a short narrative paragraph; the rest of the document is built from the plans, so put only the framing in narrative and never a figure you were not given.`;
const TOOLS = [
  { name: "get_overview", description: "The current comparison: which utilities, the filters in effect, how many pairs were checked and flagged, counts per distance tier, total expected savings and savings if dates hold, and the data sources and as-of date.", input_schema: { type: "object", properties: {} } },
  { name: "search_projects", description: "Find and rank planned projects. Match words in their name, description, substation names, TEAMS number or source page, and/or sort them to answer questions about extremes — the biggest, longest, highest-voltage, earliest or latest project. Leave query out to rank the whole list. Note that 'biggest' is ambiguous here: only Dominion publishes costs, Georgia's filing redacts every one, so sort by cost only when the user means money and say so; kv or length_km are the measures that cover both utilities.", input_schema: { type: "object", properties: {
    query: { type: "string", description: "Words to match, e.g. 'McIntosh', 'Okatie', '20277', 'Augusta'. Omit to rank everything." },
    utility: { type: "string", description: "Optional utility code to limit to, e.g. DESC or GPC" },
    sort: { type: "string", enum: ["cost", "kv", "length_km", "in_service", "name"], description: "How to order the results. cost covers Dominion only; kv and length_km cover both utilities." },
    order: { type: "string", enum: ["desc", "asc"], description: "desc = largest or latest first (default), asc = smallest or earliest first" },
    limit: { type: "integer", description: "Max results, default 10" } } } },
  { name: "get_project", description: "Everything Seamline knows about one project: description, dates, cost, plan drift, how each end point was located, source, and the nearby projects of the other utility it overlaps with.", input_schema: { type: "object", properties: { id: { type: "string", description: "Project id from search_projects, e.g. DESC-12 or IRP-20277" } }, required: ["id"] } },
  { name: "list_overlaps", description: "Ranked flagged pairs of projects (one from each utility). Filter and sort them; each row has a key for get_overlap and show_on_map.", input_schema: { type: "object", properties: {
    sort: { type: "string", enum: ["expected", "chance", "distance"], description: "expected = expected savings (default), chance = chance of a shared window, distance = closest first" },
    order: { type: "string", enum: ["desc", "asc"], description: "desc (default) puts the strongest first: most savings, best chance, closest. asc reverses it, which is the only way to reach the bottom of the ranking — the least valuable pairs, or the farthest apart — since only `limit` rows come back." },
    max_distance_km: { type: "number", description: "Only pairs at most this far apart" },
    min_chance: { type: "number", description: "Only pairs with at least this chance (0 to 1)" },
    same_window_on_paper: { type: "boolean", description: "true: only pairs whose planned windows overlap; false: only pairs that don't" },
    project_query: { type: "string", description: "Only pairs where either project's name matches these words" },
    include_past: { type: "boolean", description: "Include projects whose in-service date has passed (default true)" },
    limit: { type: "integer", description: "Max rows, default 10, at most 25" } } } },
  { name: "get_overlap", description: "Full detail of one pair: distance, tier, both build windows, chance and expected savings, each shareable item with its saving and the math, the best shared yard, plan drift, locations, sources, and whether it is one of the challenge's reference overlaps.", input_schema: { type: "object", properties: { key: { type: "string", description: "Pair key from list_overlaps, 'PROJECTID|PROJECTID'" } }, required: ["key"] } },
  { name: "get_plan_changes", description: "How each utility's planned dates moved between its last two published plans (counts later, earlier, unchanged), and which shared build windows the latest plan updates opened or closed, with the reason.", input_schema: { type: "object", properties: {} } },
  { name: "optimize_schedule", description: "The few date moves (projects not yet started, never before today) that most raise total expected savings, with each move's gain and its strongest effect.", input_schema: { type: "object", properties: { max_shift_months: { type: "integer", enum: [3, 6, 12], description: "Largest move allowed, default 6" }, utility: { type: "string", description: "Optional: only move this utility's projects (DESC or GPC)" } } } },
  { name: "get_data_checks", description: "The data pipeline's validation report: each check, its result and status (passed, fixed, review), with a few example records.", input_schema: { type: "object", properties: {} } },
  { name: "show_on_map", description: "Select a pair or a project in Seamline so the map flies to it and the side panel shows its details.", input_schema: { type: "object", properties: { key: { type: "string", description: "Pair key 'PROJECTID|PROJECTID'" }, project_id: { type: "string", description: "A project id, when no pair is meant" } } } },
  { name: "compare_projects", description: "Put two or more projects side by side, with the relationship between them worked out: how far apart their closest points are, which distance tier that falls in, whether their build windows overlap, and whether Seamline flagged them as a coordination pair. Use this for any question of the form 'compare A and B' — reading each project separately does not give you the distance or the pair status between them.", input_schema: { type: "object", properties: {
    project_ids: { type: "array", items: { type: "string" }, description: "Two to five project ids, e.g. ['DESC-11', 'IRP-20277']" } }, required: ["project_ids"] } },
  { name: "why_not", description: "Why two specific projects are NOT flagged as an opportunity: too far apart, the same utility, a location that could not be established, or one of them already likely built. Most pairs do not overlap, so use this whenever the user asks about a pair that is missing from the list rather than guessing at the reason.", input_schema: { type: "object", properties: {
    project_id_a: { type: "string", description: "A project id, e.g. DESC-12" },
    project_id_b: { type: "string", description: "The other project id, e.g. IRP-20277" } }, required: ["project_id_a", "project_id_b"] } },
  { name: "open_brief", description: "Open the printable coordination brief for one pair: the memo a planner would take to the other utility, with both projects, the distance, the build windows, what can be shared with the arithmetic behind each figure, the best shared yard and the proposed next steps. Use it when the user asks for a brief, a memo, a write-up or something to send or print.", input_schema: { type: "object", properties: {
    key: { type: "string", description: "Pair key from list_overlaps, 'PROJECTID|PROJECTID'" },
    narrative: { type: "string", description: "One short paragraph, in the user's language, framing why this pair is worth coordinating. This is the only text in the brief you write; every figure in it is computed from the plans." } }, required: ["key"] } },
  { name: "open_report", description: "Open a printable report over the whole comparison rather than one pair: the totals, the projects ranked by whichever measure the user asked for, the strongest coordination opportunities, and what the data does and does not cover. The reader can save it as PDF from the document. Use it when someone asks for a report, a list they can keep, or something to send that is not about a single pair.", input_schema: { type: "object", properties: {
    sort: { type: "string", enum: ["cost", "kv", "length_km", "in_service", "name"], description: "How to rank the project table. Default cost, which only Dominion publishes — prefer kv or length_km when the question covers both utilities." },
    order: { type: "string", enum: ["desc", "asc"] },
    utility: { type: "string", description: "Optional: restrict the project table to one utility code, e.g. DESC" },
    limit: { type: "integer", description: "Rows in the project table, default 20, at most 40" },
    narrative: { type: "string", description: "One short paragraph, in the user's language, framing what the report shows. The only text in it you write." } } } },
  { name: "open_schedule_brief", description: "Open the printable joint schedule proposal: the date moves that most raise expected savings, with each move and what it adds. Use it when the user asks for a brief or memo about rescheduling rather than about one pair.", input_schema: { type: "object", properties: {
    narrative: { type: "string", description: "One short paragraph, in the user's language, framing the proposal. The only text in the brief you write." },
    max_shift_months: { type: "integer", enum: [3, 6, 12], description: "Largest move allowed, default 6" } } } },
];
// The shape of the loaded data, handed to the model with the system prompt. Without it every turn starts blind: the
// model has to spend a tool call discovering how many projects there are, which utilities they belong to and what the
// comparison found, before it can answer anything. With it, a one-line question gets a one-turn answer, and the model
// knows what it is allowed to claim — that Georgia publishes no costs, and how many pairs were rejected.
function dataDigest() {
  const tiers = TIERS.slice(0, 4).map((t, k) => `${t.label}: ${RESULT.pairs.filter(x => x.tier === k).length}`).join(", ");
  const priced = PROJECTS.filter(p => p.cost);
  const dates = PROJECTS.map(p => p.in_service).filter(Boolean).sort();
  const top = RESULT.pairs.slice(0, 5).map(x =>
    `  ${keyOf(x)} — ${x.km.toFixed(1)} km, ${TIERS[Math.min(x.tier, 4)].label}, ${x.sameWindow ? "same window on paper" : `${Math.round(x.gap)} mo apart`}, expected ${Engine.fmtMoney(x.risk.expected)}`).join("\n");
  const lines = [
    `As of ${TODAY}. Comparing ${utilities().map(u => `${lblLong(u)} (${u}, ${PROJECTS.filter(p => p.utility === u).length} projects)`).join(" against ")}.`,
    `In-service dates run ${dates[0]} to ${dates[dates.length - 1]}. ${priced.length} of ${PROJECTS.length} projects publish a cost; the rest are redacted in their filing, so no figure may be attributed to them.`,
    `Filters in effect: within ${state.D} km, window buffer ±${state.B} months, match rule "${state.mode}".`,
    `${RESULT.checked.toLocaleString("en-US")} pairs checked, ${RESULT.pairs.length} flagged. By tier: ${tiers}. ${RESULT.pairs.filter(x => x.sameWindow).length} share a build window on paper.`,
    `Total expected savings ${Engine.fmtMoney(RESULT.pairs.reduce((a, x) => a + x.risk.expected, 0))}, or ${Engine.fmtMoney(RESULT.pairs.reduce((a, x) => a + x.sav.total, 0))} if every date holds.`,
    `${borderline().length} further pairs fall just outside the ${state.D} km screen and are deliberately excluded from every ranking and total.`,
    "",
    "The five strongest pairs right now, so you can answer without a tool call when the question is about them:",
    top,
  ];
  return lines.join("\n");
}

const projOut = p => ({ id: p.id, utility: p.utility, name: p.name, kv: p.kv, type: TYPE[p.type] || p.type, construction: `${p.start} to ${p.in_service}`, start_published: !!p.start_published,
  in_service: p.in_service, in_service_passed: isPast(p), likely_built: !!p.likely_built,
  cost_usd: p.cost || null, cost_note: p.cost ? undefined : "not published in this utility's filing",
  length_km: +Engine.lengthKm(p).toFixed(1) || null, location_confidence: p.loc, source: p.page ? `${p.source} (${p.page})` : p.source });
const pairOut = x => ({ key: keyOf(x), distance_km: +x.km.toFixed(2), tier: TIERS[Math.min(x.tier, 4)].label, project_a: `${x.p.name} (${x.p.utility}, in service ${x.p.in_service})`, project_b: `${x.q.name} (${x.q.utility}, in service ${x.q.in_service})`,
  windows_on_paper: x.ov > 0 ? `${Math.round(x.ov)} months shared` : `${Math.round(x.gap)} months apart`, chance_of_shared_window: x.risk.why === "built" ? "none, one side is likely built" : +x.risk.chance.toFixed(2),
  expected_savings_usd: Math.round(x.risk.expected), savings_if_dates_hold_usd: Math.round(x.sav.total), challenge_reference: REFS[keyOf(x)] || null });
const findPair = key => { const k = String(key || "").trim(), [a, b] = k.split("|"); return RESULT.pairs.find(x => keyOf(x) === k || (x.p.id === b && x.q.id === a)); };
function runTool(name, i) {
  const words = q => String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text, q) => { const w = words(q); return w.every(t => text.toLowerCase().includes(t)); };
  if (name === "get_overview") {
    const tiers = {}; TIERS.slice(0, 4).forEach((t, k) => { tiers[t.label] = RESULT.pairs.filter(x => x.tier === k).length; });
    return { utilities: solo() ? [lblLong(state.utilA)] : [lblLong(state.utilA), lblLong(state.utilB)], projects: Object.fromEntries(utilities().map(u => [u, PROJECTS.filter(p => p.utility === u).length])),
      filters: { distance_km: state.D, window_buffer_months: state.B, match: state.mode, build_period_months_from_today: state.horizon || "all", include_dates_passed: state.past },
      pairs_checked: RESULT.checked, pairs_flagged: RESULT.pairs.length, pairs_shown_with_filters: VIEW.length, by_tier: tiers, just_outside: borderline().length,
      same_window_on_paper: RESULT.pairs.filter(x => x.sameWindow).length, expected_savings_usd: Math.round(RESULT.pairs.reduce((a, x) => a + x.risk.expected, 0)),
      savings_if_dates_hold_usd: Math.round(RESULT.pairs.reduce((a, x) => a + x.sav.total, 0)), as_of: TODAY, sources: $("#asof").textContent };
  }
  if (name === "search_projects") {
    const ps = PROJECTS.filter(p => (!i.utility || p.utility.toLowerCase() === String(i.utility).toLowerCase()) &&
      (!i.query || hit(`${p.id} ${p.name} ${p.desc || ""} ${p.page || ""} ${(p.located || []).map(l => l.name).join(" ")}`, i.query)));
    const key = { cost: p => p.cost || 0, kv: p => p.kv || 0, length_km: p => Engine.lengthKm(p), in_service: p => mon(p.in_service), name: p => p.name };
    const sorted = i.sort && key[i.sort]
      ? ps.slice().sort((a, b) => { const x = key[i.sort](a), y = key[i.sort](b); const c = typeof x === "string" ? x.localeCompare(y) : x - y; return i.order === "asc" ? c : -c; })
      : ps;
    const out = { matches: ps.length, projects: sorted.slice(0, Math.min(25, i.limit || 10)).map(projOut) };
    // If the ranking is by money, say which side of the comparison has no figures at all, so the answer cannot present
    // a Dominion project as the largest of both utilities.
    if (i.sort === "cost") out.note = `Ranked by published cost. ${PROJECTS.filter(p => !p.cost).length} of ${PROJECTS.length} projects publish no cost and are ordered last; every Georgia project is among them.`;
    return out;
  }
  if (name === "get_project") {
    const p = PROJECTS.find(v => v.id === i.id);
    if (!p) throw new Error(`No project with id ${i.id}. Use search_projects to find its id.`);
    const pairs = RESULT.pairs.filter(x => x.p === p || x.q === p).sort((a, b) => b.risk.expected - a.risk.expected);
    return Object.assign(projOut(p), { description: p.desc || null, plan_drift: p.drift || null, also_listed_as: p.official || null, located: p.located || `placed by hand (${p.loc})`,
      overlaps: pairs.length, top_overlaps: pairs.slice(0, 8).map(pairOut) });
  }
  if (name === "list_overlaps") {
    let xs = RESULT.pairs.filter(x => (i.max_distance_km == null || x.km <= i.max_distance_km) && (i.min_chance == null || x.risk.chance >= i.min_chance) &&
      (i.same_window_on_paper == null || x.sameWindow === i.same_window_on_paper) && (i.include_past !== false || (!isPast(x.p) && !isPast(x.q))) &&
      (!i.project_query || hit(`${x.p.name} ${x.q.name} ${x.p.id} ${x.q.id}`, i.project_query)));
    const by = { expected: (a, b) => b.risk.expected - a.risk.expected, chance: (a, b) => b.risk.chance - a.risk.chance, distance: (a, b) => a.km - b.km }[i.sort || "expected"] || ((a, b) => b.risk.expected - a.risk.expected);
    xs = xs.slice().sort(i.order === "asc" ? (a, b) => -by(a, b) : by);
    return { matching_pairs: xs.length, rows: xs.slice(0, Math.min(25, i.limit || 10)).map(pairOut) };
  }
  if (name === "get_overlap") {
    const x = findPair(i.key);
    if (!x) throw new Error(`No flagged pair ${i.key}. Use list_overlaps to get keys.`);
    const all = Engine.savings(Object.assign({}, x, { sameWindow: true })).items, needs = new Set(Engine.SHARES.filter(g => g.window).flatMap(g => g.items));
    const yd = x.tier <= 3 ? pairYard(x) : null;
    return Object.assign(pairOut(x), { project_a: projOut(x.p), project_b: projOut(x.q), plan_drift: { a: x.p.drift || null, b: x.q.drift || null },
      located: { a: x.p.located || x.p.loc, b: x.q.located || x.q.loc },
      shareable_items: all.map(it => ({ item: it.k, saving_usd: Math.round(it.v), math: it.how, needs_shared_window: needs.has(it.share) })),
      shared_yard: yd ? { near: yd.near || "open land", at: yd.at.map(v => +v.toFixed(4)), km_to_sites: yd.dists.map(d => +d.toFixed(1)) } : null, also_in_common: x.res });
  }
  if (name === "get_plan_changes") {
    const d = drift(), S = MODEL.slips || {};
    const row = x => ({ key: keyOf(x), distance_km: +x.km.toFixed(1), pair: `${x.p.name} × ${x.q.name}`, moved: [x.p, x.q].filter(p => p.drift && p.drift.months).map(p => `${p.utility} moved ${p.name} ${Math.abs(p.drift.months)} months ${p.drift.months > 0 ? "later" : "earlier"}`), challenge_reference: REFS[keyOf(x)] || null });
    return { how_dates_moved: Object.fromEntries(Object.entries(S).map(([u, v]) => [u, { projects_with_history: v.n, later: v.slipped, earlier: v.advanced, unchanged: v.n - v.slipped - v.advanced, median_months: v.median, source: v.source }])),
      windows_opened: d.opened.map(row), windows_closed: d.closed.map(row) };
  }
  if (name === "optimize_schedule") {
    const u = i.utility ? utilities().find(v => v.toLowerCase() === String(i.utility).toLowerCase() || lbl(v).toLowerCase() === String(i.utility).toLowerCase()) || String(i.utility) : null;
    const r = Engine.optimizeSchedule(RESULT.pairs, MODEL.slips, { today: TODAY, bufferMonths: state.B, maxShift: i.max_shift_months || 6, utilities: u ? [u] : null });
    return { expected_savings_before_usd: Math.round(r.before), after_usd: Math.round(r.after), moves: r.moves.map(m => {
      const best = m.pairs.slice().sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];
      return { project: m.project.name, id: m.id, utility: m.project.utility, months: m.months, in_service_from: m.from.in_service, in_service_to: m.to.in_service, adds_usd: Math.round(m.gain),
        strongest_effect: best ? `${(best.x.p === m.project ? best.x.q : best.x.p).name}: chance ${Math.round(best.before * 100)}% to ${Math.round(best.after * 100)}%` : null };
    }) };
  }
  if (name === "get_data_checks") return { as_of: TODAY, pipeline: MODEL.pipeline || null, checks: (MODEL.checks || []).map(c => ({ check: c.title, status: c.status, result: c.result, examples: (c.records || []).slice(0, 5) })) };
  if (name === "show_on_map") {
    // The chat stays open; the pair is selected (its details wait on the Overlaps tab) and the map flies to it.
    // If filters hide it, they are cleared, and the controls show that.
    const clearFilters = () => { state.tiers = new Set([0, 1, 2, 3, 4]); state.q = ""; state.past = true; state.horizon = 0; syncControls(); if ($("#q")) $("#q").value = ""; refresh(); };
    const show = y => { state.hover = null; state.wi = null; state.sel = y; renderMap(); renderTimeline(); flyTo(y); writeHash(); };
    if (i.key) {
      const x = findPair(i.key); if (!x) throw new Error(`No flagged pair ${i.key}.`);
      if (!VIEW.includes(x)) clearFilters();
      const y = VIEW.find(v => keyOf(v) === keyOf(x)) || x; show(y);
      return { shown: pairOut(y).project_a + " and " + pairOut(y).project_b, note: "Selected; its details are on the Overlaps tab." };
    }
    const p = PROJECTS.find(v => v.id === i.project_id);
    if (!p) throw new Error("Give a pair key or a project id.");
    const y = solo() ? { p, solo: true } : pairFor(p);
    if (y) { if (!y.solo && !VIEW.includes(y)) clearFilters(); show(y.solo ? y : (VIEW.find(v => v === y) || y)); } else SeamMap.fit(p.coords, { padKm: 6 });
    return { shown: p.name };
  }
  if (name === "compare_projects") {
    const ids = (Array.isArray(i.project_ids) ? i.project_ids : []).map(v => String(v || "").toUpperCase()).slice(0, 5);
    if (ids.length < 2) throw new Error("Give at least two project ids.");
    const ps = ids.map(id => {
      const p = PROJECTS.find(v => v.id === id);
      if (!p) throw new Error(`No project with id ${id}. Use search_projects to find its id.`);
      return p;
    });
    // Every unordered pair among them, since "compare A and B" is really a question about the relationship.
    const between = [];
    for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
      const p = ps[a], q = ps[b], km = Engine.closest(p, q)[0], ov = Engine.windowOverlap(p, q);
      const flagged = RESULT.pairs.find(x => (x.p === p && x.q === q) || (x.p === q && x.q === p));
      between.push({
        projects: `${p.id} and ${q.id}`,
        same_utility: p.utility === q.utility,
        distance_km: +km.toFixed(2),
        tier: km <= state.D ? TIERS[Math.min(Engine.tierOf(km), 4)].label : `beyond the ${state.D} km screen`,
        windows: ov > 0 ? `${Math.round(ov)} months shared` : `${Math.round(-ov)} months apart`,
        flagged_pair: flagged ? keyOf(flagged) : null,
        expected_savings_usd: flagged ? Math.round(flagged.risk.expected) : null,
        why_not_flagged: flagged ? null : runTool("why_not", { project_id_a: p.id, project_id_b: q.id }).explanation,
      });
    }
    return { projects: ps.map(p => Object.assign(projOut(p), { description: p.desc || null, plan_drift: p.drift || null })), between };
  }
  if (name === "why_not") {
    const p = PROJECTS.find(v => v.id === String(i.project_id_a).toUpperCase()), q = PROJECTS.find(v => v.id === String(i.project_id_b).toUpperCase());
    if (!p || !q) { const missing = !p ? i.project_id_a : i.project_id_b; throw new Error(`No project with id ${missing}. Use search_projects to find its id.`); }
    const base = { project_id_a: p.id, project_id_b: q.id, pair: `${p.name} × ${q.name}` };
    const flagged = RESULT.pairs.find(x => (x.p === p && x.q === q) || (x.p === q && x.q === p));
    if (flagged) return Object.assign(base, { rejected: false, reason: "flagged", key: keyOf(flagged), distance_km: +flagged.km.toFixed(2),
      explanation: `This pair IS flagged, as ${keyOf(flagged)}, at ${flagged.km.toFixed(1)} km.` });
    if (p.utility === q.utility) return Object.assign(base, { rejected: true, reason: "same_utility",
      explanation: `Both projects belong to ${lblLong(p.utility)}. Seamline compares work across two different utilities.` });
    if (!(p.coords || []).length || !(q.coords || []).length) return Object.assign(base, { rejected: true, reason: "unlocated",
      explanation: `${(p.coords || []).length ? q.id : p.id} has no location, so no distance can be measured.` });
    const km = Engine.closest(p, q)[0];
    if (km > state.D) return Object.assign(base, { rejected: true, reason: "too_far", distance_km: +km.toFixed(2),
      explanation: km <= state.D * 1.05 ? `Their closest points are ${km.toFixed(1)} km apart, just beyond the ${state.D} km screen. That is a chosen threshold, so widening the distance filter would include them.`
        : `Their closest points are ${km.toFixed(1)} km apart, beyond the ${state.D} km screen, so sharing a crew or a staging yard is not plausible.`,
      just_outside: km <= state.D * 1.05 });
    return Object.assign(base, { rejected: true, reason: "filtered", distance_km: +km.toFixed(2),
      explanation: `They are ${km.toFixed(1)} km apart, inside the screen, but the current match mode (${state.mode}) or the build-window filter excludes them.` });
  }
  if (name === "open_brief") {
    const x = findPair(i.key);
    if (!x) throw new Error(`No flagged pair ${i.key}. Use list_overlaps to get keys.`);
    openBrief(x, i.narrative);
    return { opened: "coordination brief", pair: pairOut(x).project_a + " and " + pairOut(x).project_b };
  }
  if (name === "open_report") {
    openReport({ sort: i.sort, order: i.order, utility: i.utility ? String(i.utility).toUpperCase() : null, limit: i.limit }, i.narrative);
    return { opened: "project report", ranked_by: i.sort || "cost", projects: PROJECTS.length, flagged_pairs: RESULT.pairs.length };
  }
  if (name === "open_schedule_brief") {
    if (i.max_shift_months) state.opt.maxShift = i.max_shift_months;
    const o = optimize();
    if (!o || !o.moves.length) throw new Error("No date move of that size is worth the threshold, so there is no schedule brief to open.");
    openScheduleBrief(o, i.narrative);
    return { opened: "joint schedule proposal", moves: o.moves.length, adds_usd: Math.round(o.after - o.before) };
  }
  throw new Error("Unknown tool " + name);
}
// Minimal markdown for the assistant's answers: headings, ordered and unordered lists with one level of nesting,
// pipe tables, bold, italic and inline code. Text is escaped before any of it, so a model that emits HTML gets it shown
// rather than run. Deliberately small — this renders answers, not documents.
const md = text => {
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s([])\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/(^|\s)_([^_\n]+)_(?=$|[\s.,;:)])/g, "$1<i>$2</i>");
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  let para = [], table = null;
  // A stack of open list types, so a nested list is emitted inside its parent item rather than beside it, and an item
  // is only closed once whatever it contains has been closed.
  const stack = [];
  let liOpen = false;

  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const closeItem = () => { if (liOpen) { out.push("</li>"); liOpen = false; } };
  const flushList = () => {
    while (stack.length) { closeItem(); out.push(`</${stack.pop()}>`); liOpen = stack.length > 0; }
    liOpen = false;
  };
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    out.push(`<table class="mt"><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
      body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") + "</tbody></table>");
    table = null;
  };
  const flushAll = () => { flushPara(); flushList(); flushTable(); };
  const cells = line => line.replace(/^\||\|$/g, "").split("|").map(c => c.trim());

  for (const line of lines) {
    if (!line.trim()) { flushAll(); continue; }

    // A pipe table: the row after the header is all dashes, which is what tells one apart from a line with a pipe in it.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList();
      const row = cells(line.trim());
      if (table && row.every(c => /^:?-{2,}:?$/.test(c))) continue;   // the separator row carries no data
      table = table || [];
      table.push(row);
      continue;
    }
    flushTable();

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flushPara(); flushList(); out.push(`<h4>${inline(heading[2])}</h4>`); continue; }

    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const want = /\d/.test(item[2]) ? "ol" : "ul";
      const level = Math.min(1, Math.floor(item[1].length / 2)) + 1;  // one level of nesting is enough here
      while (stack.length > level) { closeItem(); out.push(`</${stack.pop()}>`); liOpen = stack.length > 0; }
      if (stack.length === level) closeItem();                        // a sibling: close the item before the next one
      while (stack.length < level) { out.push(`<${want}>`); stack.push(want); }
      out.push(`<li>${inline(item[3])}`);
      liOpen = true;
      continue;
    }

    // An indented line under a list item belongs to that item, not to a new paragraph.
    if (stack.length && /^\s{2,}\S/.test(line)) { out.push(`<div class="li-note">${inline(line.trim())}</div>`); continue; }

    flushList();
    para.push(line.trim());
  }
  flushAll();
  return out.join("");
};
const apiKey = () => { try { return sessionStorage.getItem("seamline.key") || localStorage.getItem("seamline.key") || ""; } catch (err) { return CHAT.key || ""; } };
function saveKey(k, remember) {
  CHAT.key = k;
  try { sessionStorage.setItem("seamline.key", k); if (remember) localStorage.setItem("seamline.key", k); else localStorage.removeItem("seamline.key"); } catch (err) { /* storage blocked: key lives for this page only */ }
}
const SUGGEST_BY_LANG = {
  en: ["Which overlaps are most likely to happen, and what could they save?", "Explain the Jasper - Okatie and McIntosh - Purrysburg pair", "What changed between DESC's last two plans?", "Which three date moves would save the most?", "Show me what's planned near Augusta", "Which is the biggest project?", "How reliable is the data?"],
  es: ["¿Qué solapes son más probables y cuánto podrían ahorrar?", "Explícame el par de Jasper - Okatie con McIntosh - Purrysburg", "¿Qué cambió entre los dos últimos planes de DESC?", "¿Qué tres movimientos de fecha ahorrarían más?", "¿Qué hay planeado cerca de Augusta?", "¿Cuál es el proyecto más grande?", "¿Qué tan confiable es el dato?"],
};
// The flags set the panel's language. The browser's own preference is only the first guess; after that the choice sticks.
const askLang = () => state.askLang;
const SUGGEST = () => SUGGEST_BY_LANG[askLang()] || SUGGEST_BY_LANG.en;
// The panel leads with what it can do, not with a key field. The common questions are answered from the loaded plans
// with no model at all (agent-offline.js), so opening with "Anthropic API key" in bold reads as a paywall on a feature
// that is already working. The key is offered at the bottom, for the open-ended questions that do need it.
function renderAsk(P) {
  P.dataset.view = "ask";
  const has = !!apiKey();
  const keyForm = has
    ? `<span class="muted">Claude (${esc(SeamAgent.MODEL)}) · API key set</span><button type="button" class="link" id="kChange">Change key</button>`
    : state.askKey
      ? `<label for="kIn"><b>Anthropic API key</b></label><form class="ph-row" id="kForm"><input id="kIn" type="password" placeholder="sk-ant-…" autocomplete="off" spellcheck="false"><button type="submit" class="btn sm primary" id="kSave">Use key</button></form>
        <label class="chk"><input type="checkbox" id="kRem"> Remember on this device</label>
        <span class="note${state.keyNote ? " warn" : ""}" id="kNote">${esc(state.keyNote || "")}</span>
        <span class="note">Geo runs in your browser and sends your question, plus the Seamline data it looks up, to Anthropic's API with this key. The key is kept in this browser only (for this tab, unless you tick Remember) and never goes anywhere else.</span>`
      : `<button type="button" class="link" id="kShow">Connect an Anthropic key for open-ended questions</button>`;
  const C = ASK_COPY[askLang()] || ASK_COPY.en;
  P.innerHTML = `<div class="ask">
    <div class="ask-bar">
      <span class="muted">${esc(C.bar)}</span><span class="grow"></span>
      ${Object.entries(ASK_COPY).map(([code, c]) => `<button type="button" class="flag${code === askLang() ? " on" : ""}" data-lang="${code}" aria-pressed="${code === askLang()}" aria-label="${esc(c.label)}" title="${esc(c.label)}"><span aria-hidden="true">${c.flag}</span>${c.code}</button>`).join("")}
    </div>
    <div class="ask-log" id="askLog" role="log" aria-live="polite" aria-relevant="additions" aria-label="Geo's answers">${CHAT.log.length ? CHAT.log.map(m => `<div class="msg ${m.role}">${m.role === "user" ? esc(m.text) : m.role === "tool" ? esc(m.text) : md(m.text)}</div>`).join("")
      : askWelcome()}
      ${CHAT.busy ? `<div class="msg tool">Thinking<span class="dots"><i></i><i></i><i></i></span></div>` : ""}</div>
    <div class="sugs" id="sugs" role="group" aria-label="Suggested questions">${SUGGEST().map(s => `<button type="button" class="chip">${esc(s)}</button>`).join("")}</div>
    <form class="ask-in" id="askForm"><textarea id="askQ" rows="2" placeholder="${esc(C.placeholder)}" aria-label="Question"></textarea><button type="submit" class="btn primary"${CHAT.busy ? " disabled" : ""}>Ask</button></form>
    <div class="ask-key${has ? " set" : ""}">${keyForm}</div></div>`;
  const log = $("#askLog"); log.scrollTop = CHAT.log.length ? log.scrollHeight : 0; // the greeting reads from the top
  cycleHint();
  if ($("#kShow")) $("#kShow").onclick = () => { state.askKey = true; renderAsk(P); $("#kIn").focus(); };
  // The key is checked against the API before it is accepted, so "Use key" answers the question the user is actually
  // asking: is this key good? The panel is mutated in place rather than re-rendered while the check runs, so the typed
  // value survives it.
  if ($("#kForm")) $("#kForm").onsubmit = async e => {
    e.preventDefault();
    const input = $("#kIn"), btn = $("#kSave"), note = () => $("#kNote");
    const k = input.value.trim();
    const say = (text, cls) => { const n = note(); if (n) { n.textContent = text; n.className = `note ${cls}`; } };
    if (!k) return say("Paste a key first.", "warn");
    // Not a hard gate — key formats change — but a pasted URL or a truncated string is better caught here than as an
    // authentication error a moment later.
    if (!/^sk-[\w-]{20,}$/.test(k)) return say("That does not look like an Anthropic API key. They start with sk- and are much longer.", "warn");

    input.disabled = btn.disabled = true;
    btn.textContent = "Checking…";
    say("Asking the API whether this key works…", "");
    const r = await SeamAgent.verify(k);
    input.disabled = btn.disabled = false;
    btn.textContent = "Use key";

    if (r.ok) {
      saveKey(k, $("#kRem").checked);
      state.askKey = false; state.keyNote = null;
      CHAT.log.push({ role: "tool", text: `Key accepted. Open-ended questions now go to ${r.model}.` });
      renderAsk(P); $("#askQ").focus();
      return;
    }
    if (r.transient) {
      // The key could not be judged, only the connection. Keep it, and say exactly that.
      saveKey(k, $("#kRem").checked);
      state.askKey = false;
      state.keyNote = null;
      CHAT.log.push({ role: "tool", text: `Key saved but not verified — ${r.reason} It will be used as soon as the API is reachable.` });
      renderAsk(P); $("#askQ").focus();
      return;
    }
    say(r.reason, "warn");
  };
  if ($("#kChange")) $("#kChange").onclick = () => { saveKey("", false); try { sessionStorage.removeItem("seamline.key"); localStorage.removeItem("seamline.key"); } catch (err) { /* nothing stored */ } state.askKey = true; state.keyNote = null; CHAT.log.push({ role: "tool", text: "API key removed. The common questions are still answered from the plans." }); renderAsk(P); };
  P.querySelectorAll(".flag").forEach(b => b.onclick = () => {
    if (b.dataset.lang === state.askLang) return;
    state.askLang = b.dataset.lang; store.set("askLang", state.askLang);
    hintAt = 0;
    renderAsk(P);
  });
  P.querySelectorAll(".sugs .chip").forEach(b => b.onclick = () => { if (!CHAT.busy) sendQuestion(b.textContent); });
  $("#askForm").onsubmit = e => { e.preventDefault(); const q = $("#askQ").value.trim(); if (q) sendQuestion(q); };
  $("#askQ").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#askForm").requestSubmit(); } };
}
// What the assistant can do, with the numbers of the plans currently loaded. Written out in full because none of it is
// discoverable otherwise: a reader would not guess that it opens the printable briefs, or that it will explain the
// pairs it rejected.
const ASK_COPY = {
  en: {
    flag: "🇺🇸", code: "EN", label: "Answer in English",
    hero: "Hey, I'm Geo",
    bar: "Geo · answers from the plans on this page",
    sub: "Ask me which overlaps matter, what the two utilities could share, or why a pair is not on the list.",
    scopePair: (n, who, pairs) => `I answer from the data on this page — ${n} planned projects across ${who}, with ${pairs} pair${pairs === 1 ? "" : "s"} flagged as close enough to coordinate on. Every figure comes from the same tables the map shows; I read them, I never estimate.`,
    scopeSolo: (n, who) => `I answer from the data on this page — ${n} planned projects from ${who}. Every figure comes from the same tables the map shows; I read them, I never estimate.`,
    head: "What I can do for you",
    items: [
      ["Find the overlaps that matter.", "The closest pairs, the ones most likely to actually happen, anything within a distance you name, or only pairs that share a build window."],
      ["Explain any pair.", "How far apart at their closest points, both build windows, everything the two utilities could share with the arithmetic behind each figure, and where one staging yard would serve both."],
      ["Tell you why a pair is <em>not</em> on the list.", "Too far, same utility, or a location that could not be established. Most planned projects do not overlap, and I will say which reason applies."],
      ["Rank the projects themselves.", "The biggest by cost, the longest, the highest voltage, the first or last to be built — and which measure I ranked by."],
      ["Show what changed.", "How each utility's dates moved between its last two published plans, and which shared build windows that opened or closed."],
      ["Propose a schedule.", "The few date moves that most raise the expected savings, and what each one adds."],
      ["Write the report.", "I can open the printable coordination brief for a pair, or the joint schedule proposal, ready to print or send — with a paragraph framing why it matters."],
      ["Check the data.", "What the pipeline validated, what it caught and fixed, and what still needs a human."],
      ["Put it on the map.", "When an answer is about one pair or project, the map flies to it."],
    ],
    foot: "Everything above works with no API key. Connect one for open-ended questions.",
    placeholder: "e.g. Which three date moves would save the most?",
  },
  es: {
    flag: "🇪🇸", code: "ES", label: "Responder en español",
    hero: "Hola, soy Geo",
    bar: "Geo · responde con los planes de esta página",
    sub: "Preguntame qué solapes importan, qué podrían compartir las dos utilities, o por qué un par no está en la lista.",
    scopePair: (n, who, pairs) => `Respondo con los datos de esta página — ${n} proyectos planeados entre ${who}, con ${pairs} ${pairs === 1 ? "par marcado" : "pares marcados"} como lo bastante cerca para coordinarse. Cada cifra sale de las mismas tablas que dibuja el mapa; las leo, no las estimo.`,
    scopeSolo: (n, who) => `Respondo con los datos de esta página — ${n} proyectos planeados de ${who}. Cada cifra sale de las mismas tablas que dibuja el mapa; las leo, no las estimo.`,
    head: "Qué puedo hacer por vos",
    items: [
      ["Encontrar los solapes que importan.", "Los pares más cercanos, los más probables, los que estén a menos de la distancia que digas, o solo los que comparten ventana de obra."],
      ["Explicar cualquier par.", "A qué distancia están en sus puntos más cercanos, las dos ventanas de obra, todo lo que las dos utilities podrían compartir con la aritmética de cada cifra, y dónde un solo patio serviría a ambas."],
      ["Decirte por qué un par <em>no</em> está en la lista.", "Muy lejos, misma utility, o una ubicación que no se pudo establecer. La mayoría de los proyectos planeados no se solapan, y te digo cuál es el motivo."],
      ["Rankear los proyectos.", "El más grande por costo, el más largo, el de mayor voltaje, el primero o el último en construirse — y con qué medida los ordené."],
      ["Mostrar qué cambió.", "Cómo se movieron las fechas de cada utility entre sus dos últimos planes publicados, y qué ventanas compartidas abrió o cerró eso."],
      ["Proponer un cronograma.", "Los pocos movimientos de fecha que más suben el ahorro esperado, y cuánto agrega cada uno."],
      ["Escribir el informe.", "Puedo abrir el brief de coordinación imprimible de un par, o la propuesta conjunta de cronograma, listos para imprimir o enviar — con un párrafo que encuadra por qué importa."],
      ["Revisar el dato.", "Qué validó el pipeline, qué atrapó y corrigió, y qué todavía necesita un humano."],
      ["Ponerlo en el mapa.", "Cuando la respuesta es sobre un par o un proyecto, el mapa vuela ahí."],
    ],
    foot: "Todo lo de arriba funciona sin API key. Conectá una para preguntas abiertas.",
    placeholder: "ej. ¿Qué tres movimientos de fecha ahorrarían más?",
  },
};

// What the assistant can do, with the numbers of the plans currently loaded. Written out in full because none of it is
// discoverable otherwise: a reader would not guess that it opens the printable briefs, or that it will explain the
// pairs it rejected.
function askWelcome() {
  const C = ASK_COPY[askLang()] || ASK_COPY.en;
  const n = PROJECTS.length, pairs = RESULT.pairs.length;
  const who = solo() ? esc(lblLong(state.utilA)) : `${esc(lblLong(state.utilA))} ${askLang() === "es" ? "y" : "and"} ${esc(lblLong(state.utilB))}`;
  return `<div class="msg hint welcome">
    <p class="ask-hero">${SPARK}${esc(C.hero)}</p>
    <p class="ask-sub">${esc(C.sub)}</p>
    <p>${solo() ? C.scopeSolo(n, who) : C.scopePair(n, who, pairs)}</p>
    <p class="wl-head">${esc(C.head)}</p>
    <ul class="wl">${C.items.map(([b, rest]) => `<li><b>${b}</b> ${esc(rest)}</li>`).join("")}</ul>
    <p class="wl-foot">${esc(C.foot)}</p>
    <p class="ask-hint" id="askHint" aria-hidden="true"></p></div>`;
}

// The assistant's mark. Shared by the tab and the panel so the two read as the same thing.
const SPARK = `<svg class="spark geo-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.8h11a2.6 2.6 0 0 1 2.6 2.6v7.1a2.6 2.6 0 0 1-2.6 2.6h-6.3l-4.7 3.9v-3.9h0a2.6 2.6 0 0 1-2.6-2.6V6.4a2.6 2.6 0 0 1 2.6-2.6z"/><circle cx="8.6" cy="10" r="1.25"/><circle cx="12" cy="10" r="1.25"/><circle cx="15.4" cy="10" r="1.25"/></svg>`;
const TOOL_NOTE = { get_overview: "Reading the summary", search_projects: "Searching projects", get_project: "Reading a project", list_overlaps: "Ranking overlaps", get_overlap: "Reading a pair",
  get_plan_changes: "Comparing plan versions", optimize_schedule: "Running the schedule optimizer", get_data_checks: "Reading the data checks", show_on_map: "Showing it on the map",
  open_brief: "Writing the coordination brief", open_schedule_brief: "Writing the schedule proposal",
  open_report: "Writing the project report", compare_projects: "Comparing projects", why_not: "Checking why a pair was rejected" };
// Answer a question without the model: the same tools, routed by pattern (agent-offline.js). Returns the answer text,
// or null when the pattern matcher is not confident — a half-understood question answered confidently is worse than
// saying the model is needed. reason, when given, is why the model was unavailable.
function answerOffline(q, reason) {
  const lang = askLang(), plan = SeamOffline.interpret(q);
  if (!plan) return null;
  CHAT.log.push({ role: "tool", text: TOOL_NOTE[plan.tool] || plan.tool });
  let text;
  try {
    text = SeamOffline.render(plan.tool, runTool(plan.tool, plan.input), lang, plan.input);
  } catch (err) {
    text = String(err && err.message || err);
  }
  return `${text}\n\n${SeamOffline.note(lang, reason)}`;
}

async function sendQuestion(q) {
  if (CHAT.busy) return;
  const mark = CHAT.messages.length; // where this turn starts, so a failed turn can be undone whole
  CHAT.busy = true; CHAT.log.push({ role: "user", text: q });
  const P = $("#panel"), again = () => { if (state.tab === "ask") renderAsk(P); };
  const finish = text => { CHAT.log.push({ role: "assistant", text }); CHAT.busy = false; again(); if (state.tab !== "ask") renderTabs(); };
  again();

  // No key: answer by pattern if the question is one the tools cover, otherwise ask for the key and say what does work.
  if (!apiKey()) {
    const offline = answerOffline(q, null);
    const lang = askLang();
    return finish(offline || `${SeamOffline.capabilities(lang)}\n\nFor anything else, add an Anthropic API key above.`);
  }

  CHAT.messages.push({ role: "user", content: q });
  try {
    const answerIn = askLang() === "es" ? "Answer in Spanish." : "Answer in English.";
    // The digest goes after the prompt and before the conversation, so the stable part of the request stays stable and
    // only changes when the data or the filters do.
    const system = `${SYSTEM}\n\n## What is loaded right now\n\n${dataDigest()}\n\n${answerIn}`;
    const r = await SeamAgent.ask({ apiKey: apiKey(), system, tools: TOOLS, messages: CHAT.messages, execute: async (n, input) => runTool(n, input),
      onTool: n => { CHAT.log.push({ role: "tool", text: TOOL_NOTE[n] || n }); again(); } });
    finish(r.text + (r.truncated ? "\n\n(The answer was cut short.)" : ""));
  } catch (err) {
    // drop the whole turn (question, tool calls and results) so the history never ends on an unanswered tool call
    CHAT.messages.length = mark;
    // The API is unreachable, the key was refused or the SDK would not load. Fall back to the pattern path rather than
    // leaving the question unanswered, and say which happened.
    const why = `Your API key is set, but the request failed. ${SeamAgent.explain(err)}`;
    finish(answerOffline(q, why) || why);
  }
}

// ---------- coordination brief ----------
// narrative, when given, is the assistant's one-paragraph framing. It is the only generated prose in a brief:
// every figure, date, table and next step below is computed from the plans.
// One example question at a time, changing every few seconds while the field is untouched. It is the only motion in
// the app that also teaches something: it shows the grammar the input accepts instead of describing it. It stops the
// moment the user engages with the field, and under reduced motion it shows a single example and never changes it.
let hintTimer = null, hintAt = 0;
function cycleHint() {
  clearInterval(hintTimer); hintTimer = null;
  const el = $("#askHint"), q = $("#askQ");
  if (!el) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paint = () => { const list = SUGGEST(); el.innerHTML = `${askLang() === "es" ? "Probá" : "Try"}: <b>${esc(list[hintAt % list.length])}</b>`; };
  paint();
  if (reduced) return;
  hintTimer = setInterval(() => {
    if (!$("#askHint") || CHAT.busy || (q && (q.value.trim() || document.activeElement === q))) return;
    hintAt++; paint();
  }, 3800);
  if (q) q.addEventListener("focus", () => { clearInterval(hintTimer); hintTimer = null; el.textContent = ""; }, { once: true });
}

function openBrief(x0, narrative) {
  // the what-if applies only when it was set on this pair; the assistant can open a brief for a pair nobody selected
  const wi = state.wi && state.wi.key === keyOf(x0) ? state.wi : { who: "q", shift: 0 };
  const y = whatIf(x0, wi.who, wi.shift), better = wi.shift && (y.ov > x0.ov || y.risk.expected > x0.risk.expected);
  const x = better ? y : x0, moved = better ? x[wi.who] : null, s = x.sav;
  const D = doc(), uA = lblLong(x.p.utility), uB = lblLong(x.q.utility), today = docDate();
  const when = x.ov > 0 ? D.windowsShare(Math.round(x.ov), moved ? esc(moved.name) : null, moved ? moLabel(wi.shift) : null)
    : D.windowsApart(Math.round(x.gap)) + (() => { const r = Engine.recommendShift(x0, "q", TODAY); return r ? D.windowsFix(esc(x0.q.name), moLabel(r)) : ""; })();
  const risk = x.risk.why === "built" ? D.riskBuilt : D.risk(pct(x.risk.chance), money(x.risk.expected));
  const steps = [D.steps[0], x.tier === 0 && D.steps[1], x.tier <= 1 && D.steps[2], x.tier <= 2 && D.steps[3], D.steps[4], D.steps[5]].filter(Boolean);
  const row = (p, c) => `<tr><td><b>${esc(p.name)}</b><br><span>${esc(lblLong(p.utility))}</span></td><td>${p.kv} kV ${esc(TYPE[p.type] || "")}</td><td>${fmtD(p, "start")} ${esc(D.to2)} ${fmtD(p, "in_service")}${p === moved ? `<br><em>${esc(D.proposed)}</em>` : ""}</td><td>${c.est ? esc(D.est) : ""}${money(c.v)}</td></tr>`;
  $("#briefDoc").innerHTML = `
    <header class="b-head"><div class="b-brand">SEAMLINE <span>${esc(D.brandBrief)}</span></div><div class="b-date">${today}</div></header>
    <dl class="b-memo"><dt>${esc(D.to)}</dt><dd>${esc(uA)} ${esc(D.planning)}<br>${esc(uB)} ${esc(D.planning)}</dd>
      <dt>${esc(D.re)}</dt><dd>${esc(D.reCoord(x.p.name, x.q.name))}</dd></dl>
    ${briefNote(narrative)}
    <p class="b-lede">${D.ledePair(km(x.km), esc(D.tiers[x.tier]), esc(D.means[x.tier]))} ${when} ${risk}</p>
    <div class="b-grid"><div>${briefMap(x)}</div>
      <div class="b-kpis"><div><b>${km(x.km)}</b><span>${esc(D.kpiApart)}</span></div><div><b>${x.risk.why === "built" ? "–" : pct(x.risk.chance)}</b><span>${esc(D.kpiChance)}</span></div><div><b>${money(x.risk.expected)}</b><span>${esc(D.kpiExpected(s.total ? money(s.total) : "$0"))}</span></div></div></div>
    <h4>${esc(D.hProjects)}</h4>
    <table class="b-tab"><thead><tr><th>${esc(D.thProject)}</th><th>${esc(D.thType)}</th><th>${esc(D.thWindow)}</th><th>${esc(D.thCost)}</th></tr></thead><tbody>${row(x.p, s.ca)}${row(x.q, s.cb)}</tbody></table>
    ${s.items.length ? `<h4>${esc(D.hShare)}</h4><table class="b-tab"><tbody>${s.items.map(i => `<tr><td><b>${esc(i.share)}</b> <span>${esc(i.how)}</span></td><td class="n">${money(i.v)}</td></tr>`).join("")}<tr class="tot"><td>${esc(D.totalHold)}${Engine.customized() ? esc(D.edited) : ""}</td><td class="n">${money(s.total)}</td></tr></tbody></table>` : ""}
    ${x.tier <= 3 ? (() => { const yd = pairYard(x), im = Engine.yardImpact(yd, 2); return `<p class="b-yard"><b>Shared yard.</b> The best spot for one staging yard is ${yd.near ? "next to " + esc(yd.near) : "open land"} at ${yd.at.map(v => v.toFixed(3)).join(", ")}, ${yardDist(yd)}${x.sameWindow ? `, saving about ${miles(im.netMi)} truck-miles and ${im.co2t.toFixed(1)} t of CO2` : ""}.</p>`; })() : ""}
    <h4>${esc(D.hSteps)}</h4><ol>${steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
    <p class="b-foot">${esc(D.footBrief([...new Set([x.p, x.q].map(srcName))].join("; ")))}${x.p.loc === "low" || x.q.loc === "low" ? esc(D.footApprox) : ""}${esc(D.footBriefEnd)}</p>`;
  showBrief();
}
// The printable documents in both languages. They follow the panel's flag, because a report is read by whoever asked
// for it. Tier labels and unit-cost wording come from the engine in English, so the ones that reach a document are
// translated here rather than in the engine, which has no notion of a reader.
const DOC = {
  en: {
    locale: "en-US",
    brandBrief: "Coordination brief", brandSchedule: "Joint schedule proposal", brandReport: "Project report",
    to: "To", re: "Re", planning: "transmission planning",
    reCoord: (a, b) => `Coordinating ${a} and ${b}`,
    reMoves: n => `${n} date moves that line up nearby construction`,
    reReport: (n, util, by) => `${n} planned projects${util ? ` (${util} only)` : ""}, ranked by ${by}`,
    tiers: ["touching or crossing", "under 1.6 km", "under 8 km", "under 40 km", "over 40 km"],
    means: ["Outage timing and crossing structures have to be coordinated", "They can share right-of-way, access roads and permits",
      "They can share laydown yards and deliveries", "They can share crews, cranes and contractors", "They are beyond one staging yard's daily drive"],
    ledePair: (d, tier, means) => `These two planned projects come within <b>${d}</b> of each other at their closest points (<b>${tier}</b>). ${means}.`,
    windowsShare: (m, who, by) => `Their build windows overlap by about ${m} months${who ? `, if ${who} moves ${by}` : ""}.`,
    windowsApart: m => `Their build windows are about ${m} months apart.`,
    windowsFix: (who, by) => ` Moving ${who} ${by} would give them a shared window.`,
    riskBuilt: "One of the projects is likely built already.",
    risk: (p, m) => `Given how both utilities' dates have moved between plans, there is a ${p} chance both are in the field together from today on; expected savings ${m}.`,
    kpiApart: "apart at the closest points", kpiChance: "chance of a shared window",
    kpiExpected: hold => `expected savings (${hold} if dates hold)`,
    hProjects: "The projects", thProject: "Project", thType: "Type", thWindow: "Build window", thCost: "Cost",
    to2: "to", est: "est. ", proposed: "proposed",
    hShare: "What they can share, and what each saves",
    totalHold: "Total if dates hold", edited: " (with edited unit costs)",
    yardLead: "Shared yard.", yardBest: "The best spot for one staging yard is", atCoords: "at", yardNear: n => `next to ${n}`, yardOpen: "open land",
    yardSaves: (mi, co2) => `, saving about ${mi} truck-miles and ${co2} t of CO2`,
    hSteps: "Proposed next steps",
    steps: [
      "Confirm both project locations and the closest-point distance with each utility's GIS team.",
      "Agree one outage window and crossing-structure design for where the projects meet.",
      "Scope a shared right-of-way and access road, and file one joint permit package.",
      "Site one laydown yard between the projects for material deliveries.",
      "Compare contractor and crew plans; share mobilization where the windows overlap.",
      "Name one coordinator at each utility and set a monthly check-in until both are in service.",
    ],
    footBrief: srcs => `Prepared with Seamline from public plans (${srcs}). Locations are matched from substation names to OpenStreetMap and checked by hand`,
    footApprox: ", and at least one of these is approximate",
    footBriefEnd: "; costs are planning-level estimates unless the plan lists one. Confirm with both utilities before acting.",
    ledeSchedule: (n, mo, before, after) => `Moving these ${n} projects by at most ${mo} months raises the expected savings from coordinating nearby work from <b>${before}</b> to <b>${after}</b>. Each move is on a project that has not started. Chances are worked out from how each utility's dates moved between its last two plans.`,
    thMove: "Move", thInService: "In service", thAdds: "Adds", months: "months",
    stepsSchedule: ["Each utility checks whether its moves fit reliability need dates, outage seasons and budget cycles.",
      "Agree the moves that fit at the next SERTP coordination meeting.", "Re-run Seamline on the next published plans to track the result."],
    footSchedule: "Prepared with Seamline. A planning aid: it assumes each date moves once more like past plan updates, and that the utilities move independently.",
    measures: { cost: "published cost", kv: "voltage", length_km: "length", in_service: "in-service date", name: "name" },
    ledeReport: (n, checked, screen, flagged, expected, hold, priced) =>
      `${n} planned projects are loaded${checked ? `, and ${checked} cross-utility pairs were checked against a ${screen} km screen` : ""}. ${flagged ? `<b>${flagged}</b> pairs are close enough to coordinate on, worth <b>${expected}</b> in expected savings (${hold} if every date holds).` : ""} Only ${priced} of the ${n} projects publish a cost; the rest are redacted in their own filing, so no figure is attributed to them here.`,
    kpiChecked: "pairs checked", kpiFlagged: "flagged", kpiSavings: "expected savings", kpiOutside: "just outside the screen",
    hRanked: by => `Projects by ${by}`, thLength: "Length", notPublished: "not published",
    hTop: "Strongest coordination opportunities", thPair: "Pair", thApart: "Apart", thWindows: "Windows", thExpected: "Expected",
    shared: m => `${m} mo shared`, apart: m => `${m} mo apart`,
    hCovers: "What this covers",
    coverPlaced: (ok, n, bad) => `${ok} of ${n} projects could be placed on a map${bad ? `; ${bad} could not and are excluded from every distance` : ""}.`,
    coverBand: (n, from, to) => `${n} further pairs fall between ${from} km and ${to} km. They are deliberately outside the ranking and the totals; ${from} km is a chosen threshold, not a cliff.`,
    coverFilters: (d, b, mode) => `Filters in effect: within ${d} km, window buffer ±${b} months, match rule "${mode}".`,
    footReport: "Prepared with Seamline from public plans (DESC's SCRTP project lists, Georgia Power's 2025 IRP ten-year plan and SERTP). Locations are matched from substation names to OpenStreetMap and checked by hand; costs are reproduced from the filings that publish them and never estimated for the ones that do not. Confirm with both utilities before acting.",
  },
  es: {
    locale: "es-ES",
    brandBrief: "Informe de coordinación", brandSchedule: "Propuesta conjunta de cronograma", brandReport: "Informe de proyectos",
    to: "Para", re: "Asunto", planning: "planeación de transmisión",
    reCoord: (a, b) => `Coordinar ${a} y ${b}`,
    reMoves: n => `${n} movimientos de fecha que alinean obra cercana`,
    reReport: (n, util, by) => `${n} proyectos planeados${util ? ` (solo ${util})` : ""}, ordenados por ${by}`,
    tiers: ["se tocan o se cruzan", "a menos de 1,6 km", "a menos de 8 km", "a menos de 40 km", "a más de 40 km"],
    means: ["Hay que coordinar las ventanas de corte y las estructuras de cruce", "Pueden compartir servidumbre, vías de acceso y permisos",
      "Pueden compartir patios de acopio y entregas", "Pueden compartir cuadrillas, grúas y contratistas", "Están más lejos de lo que un patio cubre en un día"],
    ledePair: (d, tier, means) => `Estos dos proyectos planeados quedan a <b>${d}</b> uno del otro en sus puntos más cercanos (<b>${tier}</b>). ${means}.`,
    windowsShare: (m, who, by) => `Sus ventanas de obra se solapan unos ${m} meses${who ? `, si ${who} se mueve ${by}` : ""}.`,
    windowsApart: m => `Sus ventanas de obra están separadas unos ${m} meses.`,
    windowsFix: (who, by) => ` Mover ${who} ${by} les daría una ventana compartida.`,
    riskBuilt: "Uno de los dos proyectos probablemente ya está construido.",
    risk: (p, m) => `Según cómo se movieron las fechas de las dos utilities entre planes, hay ${p} de probabilidad de que ambos estén en obra al mismo tiempo de hoy en adelante; ahorro esperado ${m}.`,
    kpiApart: "de separación en los puntos más cercanos", kpiChance: "probabilidad de ventana compartida",
    kpiExpected: hold => `ahorro esperado (${hold} si las fechas se mantienen)`,
    hProjects: "Los proyectos", thProject: "Proyecto", thType: "Tipo", thWindow: "Ventana de obra", thCost: "Costo",
    to2: "a", est: "est. ", proposed: "propuesto",
    hShare: "Qué pueden compartir, y cuánto ahorra cada cosa",
    totalHold: "Total si las fechas se mantienen", edited: " (con costos unitarios editados)",
    yardLead: "Patio compartido.", yardBest: "El mejor lugar para un solo patio de acopio es", atCoords: "en", yardNear: n => `junto a ${n}`, yardOpen: "campo abierto",
    yardSaves: (mi, co2) => `, ahorrando unas ${mi} millas-camión y ${co2} t de CO2`,
    hSteps: "Próximos pasos propuestos",
    steps: [
      "Confirmar las ubicaciones de ambos proyectos y la distancia entre puntos más cercanos con el equipo de GIS de cada utility.",
      "Acordar una sola ventana de corte y un diseño de estructuras de cruce donde los proyectos se encuentran.",
      "Dimensionar una servidumbre y una vía de acceso compartidas, y presentar un solo paquete de permisos.",
      "Ubicar un único patio de acopio entre los dos proyectos para las entregas de material.",
      "Comparar los planes de contratistas y cuadrillas; compartir la movilización donde las ventanas se solapan.",
      "Nombrar un coordinador en cada utility y fijar una reunión mensual hasta que ambos entren en servicio.",
    ],
    footBrief: srcs => `Preparado con Seamline desde planes públicos (${srcs}). Las ubicaciones se cruzan desde los nombres de subestación contra OpenStreetMap y se revisan a mano`,
    footApprox: ", y al menos una de estas es aproximada",
    footBriefEnd: "; los costos son estimaciones de nivel de planeación salvo que el plan publique uno. Confirmar con ambas utilities antes de actuar.",
    ledeSchedule: (n, mo, before, after) => `Mover estos ${n} proyectos a lo sumo ${mo} meses sube el ahorro esperado por coordinar obra cercana de <b>${before}</b> a <b>${after}</b>. Cada movimiento es sobre un proyecto que no ha arrancado. Las probabilidades salen de cómo se movieron las fechas de cada utility entre sus dos últimos planes.`,
    thMove: "Movimiento", thInService: "Entra en servicio", thAdds: "Agrega", months: "meses",
    stepsSchedule: ["Cada utility revisa si sus movimientos calzan con fechas de necesidad de confiabilidad, temporadas de corte y ciclos de presupuesto.",
      "Acordar los movimientos que calzan en la próxima reunión de coordinación de SERTP.", "Volver a correr Seamline sobre los próximos planes publicados para seguir el resultado."],
    footSchedule: "Preparado con Seamline. Es una ayuda de planeación: asume que cada fecha se mueve una vez más como en las actualizaciones de plan anteriores, y que las utilities se mueven de forma independiente.",
    measures: { cost: "costo publicado", kv: "voltaje", length_km: "longitud", in_service: "fecha de entrada en servicio", name: "nombre" },
    ledeReport: (n, checked, screen, flagged, expected, hold, priced) =>
      `Hay ${n} proyectos planeados cargados${checked ? `, y se revisaron ${checked} pares entre utilities contra un filtro de ${screen} km` : ""}. ${flagged ? `<b>${flagged}</b> pares están lo bastante cerca para coordinarse, por <b>${expected}</b> de ahorro esperado (${hold} si todas las fechas se mantienen).` : ""} Solo ${priced} de los ${n} proyectos publican un costo; el resto lo tienen tachado en su propio filing, así que acá no se les atribuye ninguna cifra.`,
    kpiChecked: "pares revisados", kpiFlagged: "marcados", kpiSavings: "ahorro esperado", kpiOutside: "justo afuera del filtro",
    hRanked: by => `Proyectos por ${by}`, thLength: "Longitud", notPublished: "no publicado",
    hTop: "Oportunidades de coordinación más fuertes", thPair: "Par", thApart: "Separación", thWindows: "Ventanas", thExpected: "Esperado",
    shared: m => `${m} meses compartidos`, apart: m => `${m} meses de diferencia`,
    hCovers: "Qué cubre esto",
    coverPlaced: (ok, n, bad) => `${ok} de ${n} proyectos se pudieron ubicar en el mapa${bad ? `; ${bad} no, y quedan excluidos de toda distancia` : ""}.`,
    coverBand: (n, from, to) => `Otros ${n} pares caen entre ${from} km y ${to} km. Quedan deliberadamente afuera del ranking y de los totales; ${from} km es un umbral elegido, no un acantilado.`,
    coverFilters: (d, b, mode) => `Filtros vigentes: a menos de ${d} km, margen de ventana ±${b} meses, regla de coincidencia "${mode}".`,
    footReport: "Preparado con Seamline desde planes públicos (las listas de proyectos SCRTP de DESC, el plan a diez años del IRP 2025 de Georgia Power y SERTP). Las ubicaciones se cruzan desde los nombres de subestación contra OpenStreetMap y se revisan a mano; los costos se reproducen de los filings que los publican y nunca se estiman para los que no. Confirmar con ambas utilities antes de actuar.",
  },
};
const doc = () => DOC[askLang()] || DOC.en;
const docDate = () => new Date().toLocaleDateString(doc().locale, { year: "numeric", month: "long", day: "numeric" });

function openReport(opts, narrative) {
  const o = Object.assign({ sort: "cost", order: "desc", limit: 20 }, opts || {});
  const D = doc(), today = docDate();
  const ranked = runTool("search_projects", { sort: o.sort, order: o.order, utility: o.utility, limit: Math.min(40, o.limit) });
  const top = RESULT.pairs.slice(0, 8);
  const priced = PROJECTS.filter(p => p.cost);
  const MEASURE = D.measures;
  const unlocated = PROJECTS.filter(p => !(p.coords || []).length).length;
  const totals = { expected: RESULT.pairs.reduce((a, x) => a + x.risk.expected, 0), hold: RESULT.pairs.reduce((a, x) => a + x.sav.total, 0) };

  $("#briefDoc").innerHTML = `
    <header class="b-head"><div class="b-brand">SEAMLINE <span>${esc(D.brandReport)}</span></div><div class="b-date">${today}</div></header>
    <dl class="b-memo"><dt>${esc(D.to)}</dt><dd>${esc(lblLong(state.utilA))} ${esc(D.planning)}${solo() ? "" : `<br>${esc(lblLong(state.utilB))} ${esc(D.planning)}`}</dd>
      <dt>${esc(D.re)}</dt><dd>${esc(D.reReport(PROJECTS.length, o.utility ? lblLong(o.utility) : null, MEASURE[o.sort] || o.sort))}</dd></dl>
    ${briefNote(narrative)}
    <p class="b-lede">${D.ledeReport(PROJECTS.length, solo() ? null : RESULT.checked.toLocaleString(D.locale), state.D, solo() ? null : RESULT.pairs.length, money(totals.expected), money(totals.hold), priced.length)}</p>
    ${solo() ? "" : `<div class="b-kpis b-row"><div><b>${RESULT.checked.toLocaleString(D.locale)}</b><span>${esc(D.kpiChecked)}</span></div><div><b>${RESULT.pairs.length}</b><span>${esc(D.kpiFlagged)}</span></div><div><b>${money(totals.expected)}</b><span>${esc(D.kpiSavings)}</span></div><div><b>${borderline().length}</b><span>${esc(D.kpiOutside)}</span></div></div>`}
    <h4>${esc(D.hRanked(MEASURE[o.sort] || o.sort))}</h4>
    <table class="b-tab"><thead><tr><th>#</th><th>${esc(D.thProject)}</th><th>${esc(D.thType)}</th><th>${esc(D.thInService)}</th><th>${esc(D.thLength)}</th><th>${esc(D.thCost)}</th></tr></thead><tbody>
      ${ranked.projects.map((p, i) => `<tr><td>${i + 1}</td><td><b>${esc(p.name)}</b><br><span>${esc(p.id)} · ${esc(lblLong(p.utility))}</span></td><td>${p.kv} kV ${esc(p.type || "")}</td><td>${esc(p.in_service)}</td><td class="n">${p.length_km ? p.length_km + " km" : "–"}</td><td class="n">${p.cost_usd ? money(p.cost_usd) : `<span>${esc(D.notPublished)}</span>`}</td></tr>`).join("")}
    </tbody></table>
    ${top.length ? `<h4>${esc(D.hTop)}</h4>
    <table class="b-tab"><thead><tr><th>${esc(D.thPair)}</th><th>${esc(D.thApart)}</th><th>${esc(D.thWindows)}</th><th>${esc(D.thExpected)}</th></tr></thead><tbody>
      ${top.map(x => `<tr><td><b>${esc(short(x.p))}</b> × <b>${esc(short(x.q))}</b><br><span>${esc(D.tiers[Math.min(x.tier, 4)])}</span></td><td class="n">${km(x.km)}</td><td>${x.ov > 0 ? esc(D.shared(Math.round(x.ov))) : esc(D.apart(Math.round(x.gap)))}</td><td class="n">${money(x.risk.expected)}</td></tr>`).join("")}
    </tbody></table>` : ""}
    <h4>${esc(D.hCovers)}</h4>
    <ul><li>${esc(D.coverPlaced(PROJECTS.length - unlocated, PROJECTS.length, unlocated))}</li>
      ${solo() ? "" : `<li>${esc(D.coverBand(borderline().length, state.D, Math.round(state.D * 1.05)))}</li>`}
      <li>${esc(D.coverFilters(state.D, state.B, state.mode))}</li></ul>
    <p class="b-foot">${esc(D.footReport)}</p>`;
  showBrief();
}

function openScheduleBrief(o, narrative) {
  const D = doc(), today = docDate();
  $("#briefDoc").innerHTML = `<header class="b-head"><div class="b-brand">SEAMLINE <span>${esc(D.brandSchedule)}</span></div><div class="b-date">${today}</div></header>
    <dl class="b-memo"><dt>${esc(D.to)}</dt><dd>${esc(lblLong(state.utilA))} ${esc(D.planning)}<br>${esc(lblLong(state.utilB))} ${esc(D.planning)}</dd><dt>${esc(D.re)}</dt><dd>${esc(D.reMoves(o.moves.length))}</dd></dl>
    ${briefNote(narrative)}
    <p class="b-lede">${D.ledeSchedule(o.moves.length, state.opt.maxShift, money(o.before), money(o.after))}</p>
    <table class="b-tab"><thead><tr><th>${esc(D.thProject)}</th><th>${esc(D.thMove)}</th><th>${esc(D.thInService)}</th><th>${esc(D.thAdds)}</th></tr></thead><tbody>${o.moves.map(m => `<tr><td><b>${esc(m.project.name)}</b><br><span>${esc(lblLong(m.project.utility))}</span></td><td>${m.months > 0 ? "+" : "−"}${Math.abs(m.months)} ${esc(D.months)}</td><td>${fmtD(m.from, "in_service")} → ${fmtD(m.to, "in_service")}</td><td class="n">${money(m.gain)}</td></tr>`).join("")}</tbody></table>
    <h4>${esc(D.hSteps)}</h4><ol>${D.stepsSchedule.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
    <p class="b-foot">${esc(D.footSchedule)}</p>`;
  showBrief();
}
const briefNote = text => text ? `<p class="b-note"><span>Summary by Geo</span>${esc(String(text).slice(0, 1200))}</p>` : "";
let returnFocus = null;
function lockApp(on) { document.body.classList.toggle("modal-open", on); }
function showBrief() { returnFocus = document.activeElement; $("#brief").hidden = false; lockApp(true); $("#briefClose").focus(); }
function briefMap(x) {
  const W = 300, H = 210, feat = p => Engine.isLine(p) ? { type: "MultiLineString", coordinates: Engine.partsOf(p).filter(c => c.length > 1).map(c => c.map(v => [v[1], v[0]])) } : { type: "Point", coordinates: [p.coords[0][1], p.coords[0][0]] };
  const box = { type: "FeatureCollection", features: [x.p, x.q].map(p => ({ type: "Feature", geometry: feat(p) })) };
  const pr = d3.geoMercator().fitExtent([[40, 40], [W - 40, H - 40]], box);
  // very close pairs would zoom in past street level; cap the zoom and keep the pair centered
  if (pr.scale() > 60000) { const [[x0, y0], [x1, y1]] = d3.geoBounds(box); pr.scale(60000).center([(x0 + x1) / 2, (y0 + y1) / 2]).translate([W / 2, H / 2]); }
  const path = d3.geoPath(pr).pointRadius(5), P = c => pr([c[1], c[0]]);
  const st = BASE.states.filter(v => v.n === "Georgia" || v.n === "South Carolina").map(v => `<path d="${path(v.g)}" fill="#F1F2EE" stroke="#B9C0C4" stroke-width=".8"/>`).join("");
  const seam = SEAM ? `<path d="${path({ type: "LineString", coordinates: SEAM })}" fill="none" stroke="#8FB6CC" stroke-width="2.5"/>` : "";
  const one = (p, c) => Engine.isLine(p) ? `<path d="${path(feat(p))}" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>` : `<circle cx="${P(p.coords[0])[0]}" cy="${P(p.coords[0])[1]}" r="5.5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
  const [a, b] = [P(x.ca), P(x.cb)];
  return `<svg class="b-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Locator map"><rect width="${W}" height="${H}" fill="#E4EBEF"/>${st}${seam}${one(x.p, "#1668A8")}${one(x.q, "#C4540E")}
    <line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#B42318" stroke-width="2" stroke-dasharray="3 2"/><circle cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" r="7" fill="none" stroke="#B42318" stroke-width="1.5"/>
    <text x="10" y="${H - 10}" font-size="10" fill="#57606A">${esc(km(x.km))} at the closest points</text></svg>`;
}
function closeBrief() { $("#brief").hidden = true; lockApp(false); if (returnFocus && returnFocus.focus) returnFocus.focus(); returnFocus = null; }

// ---------- 3D illustration (three.js) ----------
const quality3d = () => Scene3D.qualityKey(store.get("3dquality", "detailed"));
function open3d(x, extra) {
  $("#m3dQ").value = quality3d();
  Scene3D.open(x, Object.assign({
    title: `${short(x.p)} and ${short(x.q)}`,
    subtitle: `${TIERS[x.tier].label}: ${km(x.km)} at the closest points. ${TIERS[x.tier].means}.`,
    colorA: uColor(x.p.utility), colorB: uColor(x.q.utility), tierColor: tcol(Math.min(x.tier, 4)),
    nameA: `${lbl(x.p.utility)}: ${short(x.p)}`, nameB: `${lbl(x.q.utility)}: ${short(x.q)}`,
    distText: `${km(x.km)} apart · ${TIERS[x.tier].short}`, quality: quality3d(),
  }, extra || {}));
  $("#m3d").classList.add("settled"); document.body.classList.add("m3d-open");
}
function close3d() { $("#m3d").classList.remove("settled"); document.body.classList.remove("m3d-open"); Scene3D.close(); }

// ---------- drop-in walker ----------
// Drag the orange figure onto a project: the 3D illustration opens at that spot in walk mode, with the project's
// pair that is worth the most (or the selected pair, if it includes the project).
function pairFor(p) {
  if (state.sel && state.sel.p && state.sel.q && (state.sel.p === p || state.sel.q === p)) return state.sel;
  return (VIEW.concat(RESULT.pairs)).filter(x => x.p === p || x.q === p).sort((a, b) => b.risk.expected - a.risk.expected)[0] || null;
}
function setupPeg() {
  const peg = $("#peg");
  // The figure that follows the pointer appears only once a drag has actually started, carries none of the button's
  // own classes, and is always cleaned up, so the button never shows a second, faded figure over itself.
  let ghost = null, over = null, down = null;
  const clear = () => document.querySelectorAll(".peg.ghost").forEach(g => g.remove());
  const end = () => { clear(); ghost = null; down = null; peg.classList.remove("dragging"); hideTip(); };
  peg.addEventListener("pointerdown", e => {
    e.preventDefault(); end(); over = null; peg.setPointerCapture(e.pointerId); down = [e.clientX, e.clientY];
  });
  const move = e => {
    if (!down) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) return;
      peg.classList.add("dragging");
      ghost = document.createElement("div"); ghost.className = "peg ghost"; ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = peg.innerHTML; document.body.appendChild(ghost);
    }
    ghost.style.transform = `translate(${e.clientX - 14}px, ${e.clientY - 44}px)`;
    const hit = mapReady ? SeamMap.pick(e.clientX, e.clientY) : null;
    over = hit && hit.id ? { p: PROJECTS.find(v => v.id === hit.id), at: hit.at } : null;
    const x = over && over.p && pairFor(over.p);
    ghost.classList.toggle("ok", !!x);
    if (over && over.p) tip(e, x ? `<b>${esc(short(over.p))}</b><br>Drop to walk here in 3D` : `<b>${esc(short(over.p))}</b><br>${solo() ? "Pick a second utility at the top to compare" : "No overlap with " + esc(lbl(state.utilB)) + " for this project"}`);
    else if (hit) tip(e, "Drop onto a project line or substation"); else hideTip();
  };
  peg.addEventListener("pointermove", move);
  peg.addEventListener("pointerup", () => {
    const o = over; end(); over = null;
    if (!o || !o.p) return;
    const x = pairFor(o.p);
    if (!x) return;
    const ll = Engine.closest({ coords: [o.at] }, o.p)[2]; // the point on the project nearest the drop
    if (x !== state.sel) select(x);
    open3d(x, { walkAt: ll });
  });
  peg.addEventListener("pointercancel", end);
  peg.addEventListener("lostpointercapture", () => { if (ghost || down) end(); });
  peg.addEventListener("click", e => { if (e.detail === 0) tip({ clientX: peg.getBoundingClientRect().left, clientY: peg.getBoundingClientRect().top }, "Drag onto a project to walk around it in 3D"); });
}

// ---------- pickers, datasets, import ----------
function renderPickers() {
  const us = utilities();
  if (!us.includes(state.utilA)) state.utilA = us[0];
  if (!solo() && (!us.includes(state.utilB) || state.utilB === state.utilA)) state.utilB = us.find(u => u !== state.utilA) || NONE;
  const opts = (cur, skip) => us.filter(u => u !== skip).map(u => `<option value="${esc(u)}"${u === cur ? " selected" : ""}>${esc(lbl(u))} · ${PROJECTS.filter(p => p.utility === u).length}</option>`).join("");
  $("#utilA").innerHTML = opts(state.utilA);
  $("#utilB").innerHTML = `<option value="${NONE}"${solo() ? " selected" : ""}>None: just list projects</option>` + opts(state.utilB, state.utilA);
  $("#controls").classList.toggle("off", solo());
  const imported = DATASETS.filter(d => !d.builtin).length;
  $("#asof").textContent = `Plans: SCRTP 2024–28 & 2026–30 · GA IRP 2025 · SERTP 2026${imported ? ` · +${imported} imported` : ""} · as of ${new Date(TODAY + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  document.documentElement.style.setProperty("--ua", uColor(state.utilA));
  document.documentElement.style.setProperty("--ub", solo() ? "transparent" : uColor(state.utilB));
}
function renderDatasets() {
  $("#datasets").innerHTML = DATASETS.map(d => `<li><span><b>${esc(d.name)}</b> <span class="note">${d.count} ${d.backdrop ? "existing lines and facilities (background)" : "projects"}${d.utils ? " · " + esc(d.utils.join(", ")) : ""}</span></span>${d.builtin ? "" : `<button type="button" class="btn sm" data-rm="${esc(d.id)}">Remove</button>`}</li>`).join("");
  $("#datasets").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const id = b.dataset.rm;
    PROJECTS = PROJECTS.filter(p => p.dataset !== id);
    for (let i = EXIST.length - 1; i >= 0; i--) if (EXIST[i].dataset === id) EXIST.splice(i, 1);
    dataVersion++;
    DATASETS.splice(DATASETS.findIndex(d => d.id === id), 1);
    renderDatasets(); rebuild();
  });
}
function importParsed(input, filename) {
  const id = "ds-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const fromName = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const backdrop = $("#impExisting").checked;
  const defaults = { utility: $("#impUtil").value.trim() || fromName, source: $("#impSrc").value.trim(), in_service: $("#impIsd").value.trim() || (backdrop ? "2000" : ""), start: $("#impStart").value.trim(), batch: id, existing: backdrop };
  try {
    if (input.error) throw new Error(input.error);
    const res = input.rows ? Ingest.parseRows(input.rows, defaults) : input.geojson ? Ingest.parseGeoJSON(input.geojson, defaults) : Ingest.parsePlan(input.text, filename, defaults);
    if (!res.projects.length) throw new Error(res.errors[0] || "no rows found");
    res.projects.forEach(p => { p.dataset = id; });
    if (backdrop) {
      res.projects.forEach(p => { p.existing = p.backdrop = true; p.dsName = filename; EXIST.push(p); });
      dataVersion++;
      DATASETS.push({ id, name: filename, count: res.projects.length, backdrop: true });
      state.exist = true;
      renderDatasets(); refresh();
      return `<p class="ok">Loaded ${res.projects.length} existing lines and facilities from ${esc(filename)} as a background layer.</p>`;
    }
    PROJECTS = PROJECTS.concat(res.projects); dataVersion++;
    const utils = [...new Set(res.projects.map(p => p.utility))];
    DATASETS.push({ id, name: filename, count: res.projects.length, utils });
    state.utilB = utils[0];
    const score = u => { const ps = findOverlaps(PROJECTS, { utilA: u, utilB: state.utilB, maxKm: state.D, bufferMonths: state.B, mode: "near" }).pairs; return [ps.length ? Math.min(...ps.map(x => x.km)) : Infinity, -ps.length]; };
    const others = utilities().filter(u => u !== state.utilB).map(u => [u, score(u)]).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
    if (others.length && (others[0][1][0] < Infinity || state.utilA === state.utilB)) state.utilA = others[0][0];
    renderDatasets(); rebuild();
    return `<p class="ok">Loaded ${res.projects.length} of ${res.total} rows from ${esc(filename)} (${esc(utils.join(", "))}). Now comparing with ${esc(lbl(state.utilA))}.</p>` +
      (res.errors.length ? `<p class="warn">Skipped ${res.errors.length}: ${res.errors.slice(0, 4).map(esc).join("; ")}${res.errors.length > 4 ? "…" : ""}</p>` : "");
  } catch (err) {
    return `<p class="warn">Couldn't load ${esc(filename)}: ${esc(err.message)}. Check it has a project name, a utility and coordinates.</p>`;
  }
}
async function importFiles(files) {
  const report = $("#impReport");
  if (!files.length) return;
  report.innerHTML = `<p class="note">Reading ${files.length === 1 ? esc(files[0].name) : files.length + " files"}…</p>`;
  const parsed = await Formats.read(files);
  report.innerHTML = parsed.map(r => importParsed(r, r.name)).join("");
}

// ---------- unit costs ----------
function renderAssume() {
  let g0 = "";
  $("#asmBody").innerHTML = `<table class="asm"><thead><tr><th>Item</th><th>Value</th><th>What it covers</th></tr></thead><tbody>${Engine.ASSUMPTIONS.map(a => {
    const head = a.group !== g0 ? `<tr class="ag"><td colspan="3">${esc(a.group)}</td></tr>` : ""; g0 = a.group;
    const v = Engine.ASSUME[a.key], changed = v !== a.value;
    return `${head}<tr${changed ? ' class="chg"' : ""}><td><label for="as-${a.key}">${esc(a.label)}</label></td><td><input id="as-${a.key}" data-k="${a.key}" type="number" min="0" step="any" inputmode="decimal" value="${v}"><span class="u">${esc(a.unit)}</span></td><td>${esc(a.check)}${changed ? ` <em>default ${esc(String(a.value))}</em>` : ""}</td></tr>`;
  }).join("")}</tbody></table>`;
  $("#asmBody").querySelectorAll("input").forEach(inp => inp.onchange = () => {
    const vals = {};
    $("#asmBody").querySelectorAll("input").forEach(i => { const n = parseFloat(i.value); if (isFinite(n) && n >= 0) vals[i.dataset.k] = n; });
    saveAssume(vals);
  });
  $("#asmReset").hidden = !Engine.customized();
}
function saveAssume(vals) {
  Engine.setAssumptions(vals);
  store.set("assume", Engine.customized() ? vals : null);
  asmVersion++; optCache.key = null;
  renderAssume(); refresh();
}
{ const a = store.get("assume", null); if (a && typeof a === "object") Engine.setAssumptions(a); }


// ---------- shareable link ----------
// The URL hash carries what's on screen (utilities, filters, tab, selection, basemap, 3D and camera), so a link
// pasted into an email opens the same view. It is rewritten as the view changes, without adding history entries.
let pendingView = null, hashTimer = null;
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.toString()) return;
  const num = (k, ok) => { const v = +h.get(k); return h.has(k) && isFinite(v) && (!ok || ok(v)) ? v : null; };
  if (h.get("a")) state.utilA = h.get("a");
  if (h.get("b")) state.utilB = h.get("b");
  if (num("d", v => v >= 1 && v <= 200) != null) state.D = num("d");
  if (num("w", v => [0, 3, 6, 12].includes(v)) != null) state.B = num("w");
  if (["near", "both", "time"].includes(h.get("m"))) state.mode = h.get("m");
  if (num("h", v => [0, 12, 36].includes(v)) != null) state.horizon = num("h");
  if (h.get("past") === "0") state.past = false;
  if (h.get("grid") === "0") state.grid = false;
  if (["overlaps", "changes", "optimize", "checks", "ask"].includes(h.get("tab"))) state.tab = h.get("tab");
  if (state.utilB === NONE && (state.tab === "changes" || state.tab === "optimize")) state.tab = "overlaps"; // those need two utilities
  if (["plain", "relief", "satellite", "topo"].includes(h.get("map"))) state.basemap = h.get("map");
  const cam = (h.get("cam") || "").split(",").map(Number);
  pendingView = { sel: h.get("sel"), d3: h.get("3d") === "1", cam: cam.length === 5 && cam.every(isFinite) ? cam : null };
}
function syncControls() {
  $("#dist").value = String(state.D); if ($("#dist").value !== String(state.D)) { const o = document.createElement("option"); o.value = o.textContent = state.D; $("#dist").append(o); $("#dist").value = String(state.D); }
  $("#buf").value = String(state.B);
  const d2 = $("#dist2"); if (![...d2.options].some(o => o.value === String(state.D))) { const o = document.createElement("option"); o.value = String(state.D); o.textContent = state.D + " km"; d2.append(o); } d2.value = String(state.D);
  for (const k of ["near", "both", "time"]) $("#m-" + k).setAttribute("aria-pressed", k === state.mode);
  document.querySelectorAll("[data-h]").forEach(o => o.setAttribute("aria-pressed", +o.dataset.h === state.horizon));
  $("#pastOn").checked = state.past;
}
function applyPendingView() {
  const v = pendingView; pendingView = null;
  if (!v) return false;
  const m = SeamMap.raw();
  if (v.d3) { SeamMap.set3D(true); $("#b3d").setAttribute("aria-pressed", "true"); }
  if (v.sel) {
    const x = RESULT.pairs.find(y => keyOf(y) === v.sel), p = !x && PROJECTS.find(q => q.id === v.sel);
    if (x) { state.sel = VIEW.find(y => y === x) || x; if (state.tab !== "overlaps" && state.tab !== "ask") state.tab = "overlaps"; }
    else if (p && solo()) state.sel = { p, solo: true };
    renderMap(); renderPanel(); renderTimeline();
  }
  if (v.cam) { m.jumpTo({ center: [v.cam[0], v.cam[1]], zoom: v.cam[2], pitch: v.cam[3], bearing: v.cam[4] }); return true; }
  if (state.sel) { flyTo(state.sel); return true; }
  return false;
}
function writeHash() {
  if (!mapReady) return; // until the map is up, the link being opened is still being applied
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = new URLSearchParams();
    h.set("a", state.utilA); h.set("b", state.utilB);
    if (state.D !== 40) h.set("d", state.D);
    if (state.B) h.set("w", state.B);
    if (state.mode !== "near") h.set("m", state.mode);
    if (state.horizon) h.set("h", state.horizon);
    if (!state.past) h.set("past", "0");
    if (!state.grid) h.set("grid", "0");
    if (state.tab !== "overlaps") h.set("tab", state.tab);
    const x = state.sel;
    if (x && x.p && x.q) h.set("sel", keyOf(x)); else if (x && x.solo) h.set("sel", x.p.id);
    if (state.basemap !== "plain") h.set("map", state.basemap);
    {
      const m = SeamMap.raw(), c = m.getCenter();
      if (SeamMap.get3D()) h.set("3d", "1");
      h.set("cam", [c.lng.toFixed(4), c.lat.toFixed(4), m.getZoom().toFixed(2), Math.round(m.getPitch()), Math.round(m.getBearing())].join(","));
    }
    history.replaceState(null, "", "#" + h.toString().replace(/%7C/gi, "|").replace(/%2C/gi, ","));
  }, 250);
}

// ---------- modals ----------
function openModal(id) { const m = $("#" + id); returnFocus = document.activeElement; m.hidden = false; lockApp(true); const f = m.querySelector("input,select,button"); if (f) f.focus(); if (id === "import") $("#openImport").setAttribute("aria-expanded", "true"); }
function closeModal(id) { $("#" + id).hidden = true; lockApp(false); if (returnFocus && returnFocus.focus) returnFocus.focus(); returnFocus = null; if (id === "import") $("#openImport").setAttribute("aria-expanded", "false"); }

// ---------- selection and refresh ----------
function select(x) {
  state.hover = null;
  if (!x || !state.wi || state.wi.key !== (x.p && x.q ? keyOf(x) : "")) state.wi = null;
  const changed = x !== state.sel;
  state.sel = x;
  if (x && !x.moves) state.tab = "overlaps";
  renderMap(); renderPanel(); renderTimeline();
  if (changed && x) flyTo(x); else if (changed && !x) fitAll(700);
  writeHash();
}
function refresh() {
  state.hover = null;
  compute();
  if (state.sel && state.sel.cluster) { const ids = state.sel.cluster.projects.map(p => p.id).join(); state.sel = (c => c ? { cluster: c } : null)(CLUSTERS.find(c => c.projects.map(p => p.id).join() === ids)); }
  else if (state.sel) state.sel = state.sel.solo ? (SOLO.includes(state.sel.p) ? state.sel : null) : VIEW.find(x => x.p === state.sel.p && x.q === state.sel.q) || null;
  const near = RESULT.pairs, exp = VIEW.reduce((s, x) => s + x.risk.expected, 0), plan = VIEW.reduce((s, x) => s + x.sav.total, 0);
  renderChips();
  $("#summary").innerHTML = solo() ? `${SOLO.length} projects` :
    `${RESULT.checked.toLocaleString()} pairs checked · <b>${near.length} overlap</b>${VIEW.length !== near.length ? ` · ${VIEW.length} shown` : ""} · expected savings <b>${money(exp)}</b> <span class="muted">(${money(plan)} if every date held)</span>`;
  renderMap(); renderPanel(); renderTimeline();
  writeHash();
}
function rebuild() {
  state.sel = null; chanceCache.clear(); optCache.key = null; driftCache.key = null;
  renderPickers(); compute(); legend(); setupScrub(); refresh(); fitAll(0);
}
function setBasemap(b) {
  state.basemap = b; store.set("basemap", b);
  document.querySelectorAll("#basemaps button").forEach(o => o.setAttribute("aria-pressed", o.dataset.b === b));
  SeamMap.setBasemap(b); $("#tileNote").hidden = true; renderMap(); writeHash();
}
function theme() {
  SeamMap.setTheme({ water: css("--water"), land: css("--land"), county: css("--grid"), stateLine: css("--ink3"), river: css("--river"), place: css("--ink2") });
  legend(); renderMap(); renderTimeline(); renderPanel();
}

// ---------- wiring ----------
$("#utilA").onchange = e => { state.utilA = e.target.value; if (state.utilB === state.utilA) state.utilB = utilities().find(u => u !== state.utilA) || NONE; rebuild(); };
$("#utilB").onchange = e => { state.utilB = e.target.value; state.tab = "overlaps"; rebuild(); };
$("#dist").onchange = e => { state.D = +e.target.value; state.shown = 60; syncControls(); refresh(); };
$("#dist2").onchange = e => { state.D = +e.target.value; state.shown = 60; syncControls(); refresh(); };
$("#panelTog").onclick = () => setPanel(!panelMin());
setPanel(store.get("panelMin", false), true);
$("#buf").onchange = e => { state.B = +e.target.value; chanceCache.clear(); refresh(); };
for (const m of ["near", "both", "time"]) $("#m-" + m).onclick = () => { state.mode = m; for (const k of ["near", "both", "time"]) $("#m-" + k).setAttribute("aria-pressed", k === m); refresh(); };
document.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { state.horizon = +b.dataset.h; document.querySelectorAll("[data-h]").forEach(o => o.setAttribute("aria-pressed", o === b)); refresh(); });
$("#pastOn").onchange = e => { state.past = e.target.checked; refresh(); };
for (const v of ["focus", "all"]) $("#v-" + v).onclick = () => { state.view = v; for (const k of ["focus", "all"]) $("#v-" + k).setAttribute("aria-pressed", k === v); renderMap(); fitAll(700); };
$("#basemaps").innerHTML = Object.entries(SeamMap.BASEMAPS).map(([k, b]) => `<button type="button" data-b="${k}" aria-pressed="${k === state.basemap}">${b.label}</button>`).join("");
document.querySelectorAll("#basemaps button").forEach(b => b.onclick = () => setBasemap(b.dataset.b));
$("#b3d").onclick = () => { if (!mapReady) return; const on = !SeamMap.get3D(); SeamMap.set3D(on); $("#b3d").setAttribute("aria-pressed", on); if (on && state.basemap === "plain") setBasemap("relief"); writeHash(); };
$("#bgrid").onclick = () => { state.grid = !state.grid; $("#bgrid").setAttribute("aria-pressed", state.grid); SeamMap.setGrid(state.grid); legend(); writeHash(); };
$("#share").onclick = () => {
  clearTimeout(hashTimer); writeHash();
  setTimeout(() => navigator.clipboard.writeText(location.href).then(() => { $("#share").textContent = "Link copied"; setTimeout(() => { $("#share").textContent = "Share this view"; }, 1600); }, () => prompt("Copy this link", location.href)), 300);
};
document.querySelectorAll(".rail [role=tab]").forEach(b => b.onclick = () => toggleTab(b.dataset.tab));
// Windows: unfold the build-windows chart under the map (the Play bar is always there).
$("#railTl").onclick = () => {
  const on = !$(".left").classList.contains("tl-open");
  $(".left").classList.toggle("tl-open", on); $("#railTl").setAttribute("aria-pressed", on);
  renderTimeline(); SeamMap.resize();
};
// Filters popover and More menu: one open at a time, closed by a click elsewhere or Esc.
const pops = [["moreFilters", "controls"], ["moreBtn", "moreMenu"]];
const closePops = except => pops.forEach(([b, p]) => { if (b !== except) { $("#" + p).hidden = true; $("#" + b).setAttribute("aria-expanded", "false"); } });
pops.forEach(([b, p]) => $("#" + b).addEventListener("click", e => { e.stopPropagation(); closePops(b); const open = $("#" + p).hidden; if (open && p === "controls") { const r = $("#" + b).getBoundingClientRect(); $("#controls").style.right = Math.max(12, innerWidth - r.right) + "px"; $("#controls").style.top = r.bottom + 6 + "px"; } $("#" + p).hidden = !open; $("#" + b).setAttribute("aria-expanded", open); }));
document.addEventListener("click", e => { if (!e.target.closest("#controls, #moreMenu")) closePops(); });
$("#moreMenu").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; closePops(); if (b.dataset.go) $("#" + b.dataset.go).click(); });
$("#play").onclick = togglePlay;
$("#tslider").oninput = e => { if (playTimer) stopPlay(); setT(+e.target.value); };
$("#tall").onclick = () => { stopPlay(); setT(null); };
$("#briefClose").onclick = closeBrief;
$("#briefPrint").onclick = () => print();
$("#briefCopy").onclick = () => navigator.clipboard.writeText($("#briefDoc").innerText).then(() => { $("#briefCopy").textContent = "Copied"; setTimeout(() => { $("#briefCopy").textContent = "Copy text"; }, 1500); }, () => getSelection().selectAllChildren($("#briefDoc")));
$("#brief").addEventListener("click", e => { if (e.target.id === "brief") closeBrief(); });
const setLabels3d = on => {
  $("#m3dStage").classList.toggle("nolabels", !on);
  $("#m3dLabels").setAttribute("aria-pressed", on); $("#m3dLabels").textContent = on ? "Labels on" : "Labels off";
  store.set("3dlabels", on ? "on" : "off");
};
$("#m3dLabels").onclick = () => setLabels3d($("#m3dLabels").getAttribute("aria-pressed") !== "true");
if (store.get("3dlabels", "on") === "off") setLabels3d(false);
$("#m3dQ").onchange = e => { store.set("3dquality", e.target.value); Scene3D.reopen(e.target.value); };
$("#m3dClose").onclick = close3d;
$("#m3d").addEventListener("click", e => { if (e.target.id === "m3d") close3d(); });
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => closeModal(b.dataset.close));
document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) closeModal(m.id); }));
addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#controls").hidden || !$("#moreMenu").hidden) return closePops();
  if (!$("#m3d").hidden && Scene3D.isWalking && Scene3D.isWalking()) return Scene3D.stopWalking();
  if (!$("#brief").hidden) closeBrief();
  else if (!$("#m3d").hidden) close3d();
  else if (!$("#import").hidden) closeModal("import");
  else if (!$("#assume").hidden) closeModal("assume");
  else if (state.sel) select(null);
});
$("#openImport").onclick = () => openModal("import");
$("#openAssume").onclick = () => openModal("assume");
$("#asmReset").onclick = () => saveAssume({});
$("#tpl").textContent = Ingest.TEMPLATE;
$("#copyTpl").onclick = () => navigator.clipboard.writeText(Ingest.TEMPLATE).then(() => { $("#impReport").innerHTML = `<p class="ok">Template copied.</p>`; }, () => { getSelection().selectAllChildren($("#tpl")); });
$("#pasteHelp").onclick = () => { $("#paste").hidden = $("#loadPaste").hidden = false; $("#paste").focus(); };
$("#loadPaste").onclick = () => { const t = $("#paste").value.trim(); if (t) $("#impReport").innerHTML = importParsed({ text: t }, "pasted rows.csv"); };
$("#file").accept = Formats.ACCEPT;
$("#file").onchange = e => { importFiles([...e.target.files]); e.target.value = ""; };
const drop = $("#drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => importFiles([...e.dataTransfer.files]));
$("#copy").onclick = () => {
  // quoted, and text that a spreadsheet would run as a formula (=, +, -, @) is prefixed with an apostrophe
  const q = v => { let t = String(v ?? ""); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const csv = solo()
    ? ["utility,name,kv,type,start,in_service,cost,lat,lon"].concat(SOLO.map(p => [q(p.utility), q(p.name), p.kv, q(p.type), p.start, p.in_service, p.cost ?? "", p.coords[0][0], p.coords[0][1]].join(","))).join("\n")
    : ["rank,tier,distance_km,same_window_on_paper,overlap_months,gap_months,chance_of_shared_window,expected_savings_usd,savings_if_dates_hold_usd,utility_a,project_a,in_service_a,source_a,utility_b,project_b,in_service_b,source_b,status"]
      .concat(VIEW.map((x, i) => [i + 1, q(TIERS[x.tier].label), x.km.toFixed(2), x.sameWindow, Math.round(x.ov), Math.round(x.gap), x.risk.chance.toFixed(3), Math.round(x.risk.expected), Math.round(x.sav.total),
        q(x.p.utility), q(x.p.name), x.p.in_service, q(x.p.page || x.p.source), q(x.q.utility), q(x.q.name), x.q.in_service, q(x.q.page || x.q.source), q(STATUS[keyOf(x)] || "Open")].join(","))).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = solo() ? "seamline-projects.csv" : "seamline-overlaps.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", theme);
addEventListener("resize", () => renderTimeline());

renderAssume();
renderDatasets();
setupPeg();
SEAM = seamCoords();
readHash();
syncControls();
renderPickers(); compute(); legend(); setupScrub(); refresh();
SeamMap.init($("#map"), BASE, {
  click: mapClick, dblclick: mapOpen, hover: mapHover, recenter: () => fitAll(700),
  tilesFailed: name => { setBasemap("plain"); $("#tileNote").textContent = `${SeamMap.BASEMAPS[name].label} tiles couldn't load (they need an internet connection), so the map switched to Plain.`; $("#tileNote").hidden = false; },
}).then(() => {
  mapReady = true;
  // the walker sits on top of the corner controls, like Street View's figure, so it never covers the scale bars
  const peg = $("#peg"); peg.classList.add("maplibregl-ctrl", "in-ctrl");
  SeamMap.raw().addControl({ onAdd: () => peg, onRemove: () => {} }, "bottom-right");
  SeamMap.setBasemap(state.basemap);
  SeamMap.setGrid(state.grid); $("#bgrid").setAttribute("aria-pressed", state.grid);
  document.querySelectorAll("#basemaps button").forEach(o => o.setAttribute("aria-pressed", o.dataset.b === state.basemap));
  theme();
  if (!applyPendingView()) fitAll(0);
  SeamMap.raw().on("moveend", writeHash);
  writeHash();
});
