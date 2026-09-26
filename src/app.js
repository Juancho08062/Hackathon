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
  tab: "overlaps", sort: "expected", shown: 60, askKey: false, opt: { maxShift: 6, who: "both" }, showMoves: false, openCheck: null,
  basemap: store.get("basemap", "plain"),
};
const STATUS = store.get("status", {});
const STATUSES = ["Open", "Contacted", "Coordinating", "Not pursuing"];

const fmtD = (p, which) => {
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
const isPast = p => p.in_service < TODAY;
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
  const key = [state.utilA, state.utilB, state.D, state.B, dataVersion].join("|");
  if (key !== bandKey) {
    bandKey = key;
    bandPairs = Engine.findOverlaps(PROJECTS, { utilA: state.utilA, utilB: state.utilB, maxKm: state.D * 1.05, bufferMonths: state.B, mode: "near" })
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
  const shown = VIEW.slice(0, state.shown), sel = state.sel, t = state.t, focus = sel || state.hover;
  const flagged = new Set(shown.flatMap(x => [x.p.id, x.q.id]));
  const moved = state.showMoves && optimize() ? new Set(optimize().moves.map(m => m.id)) : null;
  const raster = state.basemap !== "plain";
  const casing = state.basemap === "satellite" ? "rgba(255,255,255,.85)" : raster ? "rgba(20,24,28,.55)" : css("--panel");
  const phaseOp = { all: 1, building: 1, done: .45, planned: .15 };
  const projects = PROJECTS.filter(p => shownUtil(p.utility)).map(p => {
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
  const yards = solo() ? [] : CLUSTERS.map((c, i) => ({ id: "c" + i, at: c.yard.at, r: focus && focus.cluster === c ? 7 : 5, fill: focus && focus.cluster === c ? css("--seam") : "#FFFFFF" }));
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
function mapHover(hit, ev) {
  if (!hit || !ev) return hideTip();
  const p = PROJECTS.find(v => v.id === hit.id) || EXIST.find(v => v.id === hit.id);
  if (p) return showTip(ev, p);
  const x = VIEW.find(v => keyOf(v) === hit.id);
  if (x) return tip(ev, `<b>${esc(SEV[Math.min(x.tier, 4)])} · ${km(x.km)}</b><br>${esc(short(x.p))}<br>${esc(short(x.q))}<br>${pct(x.risk.chance)} chance of a shared window`);
  hideTip();
}
function tip(ev, html) { const t = $("#tip"); t.innerHTML = html; t.hidden = false; t.style.left = Math.min(ev.clientX + 12, innerWidth - 290) + "px"; t.style.top = (ev.clientY + 12) + "px"; }
function showTip(ev, p) {
  tip(ev, `<b>${esc(p.name)}</b><br>${esc(lbl(p.utility))}${p.existing ? " · existing" : ""}${p.kv ? " · " + p.kv + " kV " + (TYPE[p.type] || "") : ""}` +
    (p.existing ? "" : `<br>In service ${fmtD(p, "in_service")}${p.cost ? " · " + money(p.cost) : ""}${isPast(p) ? (p.likely_built ? "<br>Likely built" : "<br>In-service date has passed") : ""}${p.loc === "low" ? "<br>Approximate location" : ""}`));
}
function hideTip() { $("#tip").hidden = true; }
function legend() {
  const us = solo() ? [state.utilA] : [state.utilA, state.utilB];
  $("#legend").innerHTML = `<div class="lg-row">${us.map(u => `<span><i class="ln" style="background:${uColor(u)}"></i>${esc(lbl(u))}</span>`).join("")}<span><i class="ln" style="background:var(--ink3);opacity:.6"></i>Existing</span></div>
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
  document.querySelectorAll(".tabs button[data-tab]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === state.tab));
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

// ---------- panel: overlaps table ----------
function overlapsHead(P) {
  if (P.dataset.view === "overlaps" && $("#q")) return;
  P.dataset.view = "overlaps";
  P.innerHTML = `<div class="ph">
      <div class="ph-row"><div class="chips" id="chips" role="group" aria-label="Filter by distance"></div></div>
      <div class="ph-row"><label class="fl">Sort <select id="sort"><option value="expected">Expected savings</option><option value="chance">Chance of a shared window</option><option value="distance">Distance</option></select></label>
        <span class="grow"></span><input id="q" type="search" placeholder="Filter by project, substation, TEAMS id" aria-label="Filter overlaps"></div>
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
function renderOverlaps(P) {
  overlapsHead(P);
  if (solo()) return renderSoloRows();
  $("#chips").innerHTML = [`<button type="button" class="chip" data-t="all" aria-pressed="${state.tiers.size >= 5}">All ${RESULT.pairs.length}</button>`]
    .concat(TIERS.slice(0, 4).map((t, i) => `<button type="button" class="chip" data-t="${i}" aria-pressed="${state.tiers.has(i) && state.tiers.size < 5}"><i style="background:${tcol(i)}"></i>${SEV[i]} ${RESULT.pairs.filter(x => x.tier === i).length}</button>`)).join("");
  $("#chips").querySelectorAll(".chip").forEach(b => b.onclick = () => {
    const v = b.dataset.t;
    if (v === "all") state.tiers = new Set([0, 1, 2, 3, 4]);
    else if (state.tiers.size >= 5) state.tiers = new Set([+v]);
    else { if (state.tiers.has(+v)) state.tiers.delete(+v); else state.tiers.add(+v); if (!state.tiers.size) state.tiers = new Set([0, 1, 2, 3, 4]); }
    state.shown = 60; refresh();
  });
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
    const close = band.slice(0, 3).map(x => `${esc(short(x.p))} / ${esc(short(x.q))} at ${km(x.km)}`).join("; ");
    R.insertAdjacentHTML("beforeend", `<p class="band">${band.length} more pair${band.length === 1 ? "" : "s"} sit just outside the ${state.D} km screen &mdash; closest ${close}. Kept out of the ranking and the totals; shown because ${state.D} km is a chosen threshold, not a cliff.</p>`);
  }
}
function renderSoloRows() {
  $("#chips").innerHTML = `<span class="muted">${SOLO.length} ${esc(lbl(state.utilA))} projects</span>`;
  $("#clusters").hidden = true;
  $("#thead").innerHTML = `<span>#</span><span>Type</span><span>Project</span><span>In service</span><span class="r">Cost</span>`;
  const R = $("#rows");
  if (!SOLO.length) { R.innerHTML = `<div class="empty">No projects match the filter.</div>`; return; }
  R.innerHTML = SOLO.slice(0, 300).map((p, i) => `<button type="button" class="tr" data-i="${i}"><span class="muted">${i + 1}</span><span class="dist"><span>${p.kv} kV</span><small>${esc(TYPE[p.type] || p.type)}</small></span>
    <span class="pair"><span class="pp${isPast(p) ? " past" : ""}"><i class="a"></i>${esc(p.name)}</span></span><span class="ch"><span>${fmtD(p, "in_service")}</span></span><span class="r">${p.cost ? money(p.cost) : "–"}</span></button>`).join("");
  R.querySelectorAll(".tr").forEach(el => { const x = { p: SOLO[+el.dataset.i], solo: true }; el.onclick = () => select(x); });
}

// ---------- panel: pair detail ----------
function located(p) {
  if (!p.located) return p.loc === "low" ? "placed by hand, approximate" : "placed by hand from the plan's substation names";
  const M = { reference: "challenge reference", manual: "placed by hand", osm_substation: "OpenStreetMap substation", osm_plant: "OpenStreetMap plant", town: "town only", "not found": "not found" };
  return p.located.map(l => `${esc(l.name.replace(/\s*\(.*?\)/g, "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()))}: <span class="${l.confidence === "high" ? "" : "amber"}">${M[l.method] || l.method}</span>`).join(" · ");
}
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
  if (r.why === "built") return `<div class="callout amber"><b>Likely built</b><span>${esc(short(x.p.likely_built ? x.p : x.q))} was listed for ${fmtD(x.p.likely_built ? x.p : x.q, "in_service")} and is gone from DESC's newer plan, so there is nothing left to build together. Georgia's work still meets the finished line: share outage plans and as-built drawings.</span></div>`;
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
  const { who, shift } = state.wi, y = whatIf(x, who, shift), rec = Engine.recommendShift(x, who);
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
  P.querySelectorAll("[data-k]").forEach(el => el.onclick = () => { const x = RESULT.pairs.find(v => keyOf(v) === el.dataset.k); if (x) { state.tab = "overlaps"; select(x); } });
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
  P.querySelectorAll(".tr.opt").forEach(el => el.onclick = () => {
    const m = o.moves[+el.dataset.i], best = m.pairs.slice().sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];
    const x = best && RESULT.pairs.find(v => keyOf(v) === keyOf(best.x));
    if (x) { state.tab = "overlaps"; select(x); }
  });
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
const SYSTEM = `You are the assistant inside Seamline, a tool that compares two electric utilities' planned transmission construction (by default Dominion Energy South Carolina, "DESC", and Georgia's integrated transmission system, "GPC" / "Georgia ITS": Georgia Power, GTC and MEAG) and flags where the work overlaps.

How Seamline measures things:
- Distance is between the closest points of two projects. Tiers: touching (0 km), under 1.6 km (can share right-of-way, access roads, permits), under 8 km (laydown yards, deliveries), under 40 km (crews, cranes, contractors).
- "Same window on paper" means the planned construction periods overlap. "Chance" is the share of 2,000 schedule draws, from today on, in which both are in the field together, moving each date the way that utility's dates moved between its last two published plans. "Expected savings" weights the items that need a shared window by that chance. "Savings if dates hold" assumes every date holds. These are planning estimates, not quotes.
- Data: DESC's SCRTP 2024-2028 and 2026-2030 project lists, Georgia Power's 2025 IRP ten-year plan (Table 2 and each project's detail page) and SERTP 2026. Locations come from OpenStreetMap substation names, the challenge's reference table, or hand placement; each project records how.

Answer only from what the tools return. If the data doesn't cover something, say so. Name projects the way the tools do, give numbers with units, and cite the source page or TEAMS number when it helps. Keep answers short: a sentence or two, then a few bullets if needed. Answer in the language the user writes in. When the user asks where something is, or to see or show something, or when your answer is about one specific pair or project, call show_on_map for it. When they ask for a brief, a memo, a write-up or something to print or send, call open_brief (one pair) or open_schedule_brief (rescheduling) and pass a short narrative paragraph; the rest of the document is built from the plans, so put only the framing in narrative and never a figure you were not given.`;
const TOOLS = [
  { name: "get_overview", description: "The current comparison: which utilities, the filters in effect, how many pairs were checked and flagged, counts per distance tier, total expected savings and savings if dates hold, and the data sources and as-of date.", input_schema: { type: "object", properties: {} } },
  { name: "search_projects", description: "Find planned projects by words in their name, description, substation names, TEAMS number or source page. Returns up to `limit` matches with id, utility, kV, type, construction window, in-service date, cost and location confidence.", input_schema: { type: "object", properties: { query: { type: "string", description: "Words to match, e.g. 'McIntosh', 'Okatie', '20277', 'Augusta'" }, utility: { type: "string", description: "Optional utility code to limit to, e.g. DESC or GPC" }, limit: { type: "integer", description: "Max results, default 10" } }, required: ["query"] } },
  { name: "get_project", description: "Everything Seamline knows about one project: description, dates, cost, plan drift, how each end point was located, source, and the nearby projects of the other utility it overlaps with.", input_schema: { type: "object", properties: { id: { type: "string", description: "Project id from search_projects, e.g. DESC-12 or IRP-20277" } }, required: ["id"] } },
  { name: "list_overlaps", description: "Ranked flagged pairs of projects (one from each utility). Filter and sort them; each row has a key for get_overlap and show_on_map.", input_schema: { type: "object", properties: {
    sort: { type: "string", enum: ["expected", "chance", "distance"], description: "expected = expected savings (default), chance = chance of a shared window, distance = closest first" },
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
  { name: "why_not", description: "Why two specific projects are NOT flagged as an opportunity: too far apart, the same utility, a location that could not be established, or one of them already likely built. Most pairs do not overlap, so use this whenever the user asks about a pair that is missing from the list rather than guessing at the reason.", input_schema: { type: "object", properties: {
    project_id_a: { type: "string", description: "A project id, e.g. DESC-12" },
    project_id_b: { type: "string", description: "The other project id, e.g. IRP-20277" } }, required: ["project_id_a", "project_id_b"] } },
  { name: "open_brief", description: "Open the printable coordination brief for one pair: the memo a planner would take to the other utility, with both projects, the distance, the build windows, what can be shared with the arithmetic behind each figure, the best shared yard and the proposed next steps. Use it when the user asks for a brief, a memo, a write-up or something to send or print.", input_schema: { type: "object", properties: {
    key: { type: "string", description: "Pair key from list_overlaps, 'PROJECTID|PROJECTID'" },
    narrative: { type: "string", description: "One short paragraph, in the user's language, framing why this pair is worth coordinating. This is the only text in the brief you write; every figure in it is computed from the plans." } }, required: ["key"] } },
  { name: "open_schedule_brief", description: "Open the printable joint schedule proposal: the date moves that most raise expected savings, with each move and what it adds. Use it when the user asks for a brief or memo about rescheduling rather than about one pair.", input_schema: { type: "object", properties: {
    narrative: { type: "string", description: "One short paragraph, in the user's language, framing the proposal. The only text in the brief you write." },
    max_shift_months: { type: "integer", enum: [3, 6, 12], description: "Largest move allowed, default 6" } } } },
];
const projOut = p => ({ id: p.id, utility: p.utility, name: p.name, kv: p.kv, type: TYPE[p.type] || p.type, construction: `${p.start} to ${p.in_service}`, start_published: !!p.start_published,
  in_service: p.in_service, in_service_passed: isPast(p), likely_built: !!p.likely_built, cost_usd: p.cost || null, location_confidence: p.loc, source: p.page ? `${p.source} (${p.page})` : p.source });
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
    const ps = PROJECTS.filter(p => (!i.utility || p.utility.toLowerCase() === String(i.utility).toLowerCase()) && hit(`${p.id} ${p.name} ${p.desc || ""} ${p.page || ""} ${(p.located || []).map(l => l.name).join(" ")}`, i.query));
    return { matches: ps.length, projects: ps.slice(0, Math.min(25, i.limit || 10)).map(projOut) };
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
    xs = xs.slice().sort(by);
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
    const u = i.utility ? String(i.utility).toUpperCase() : null;
    const r = Engine.optimizeSchedule(RESULT.pairs, MODEL.slips, { today: TODAY, bufferMonths: state.B, maxShift: i.max_shift_months || 6, utilities: u ? [u] : null });
    return { expected_savings_before_usd: Math.round(r.before), after_usd: Math.round(r.after), moves: r.moves.map(m => {
      const best = m.pairs.slice().sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];
      return { project: m.project.name, id: m.id, utility: m.project.utility, months: m.months, in_service_from: m.from.in_service, in_service_to: m.to.in_service, adds_usd: Math.round(m.gain),
        strongest_effect: best ? `${(best.x.p === m.project ? best.x.q : best.x.p).name}: chance ${Math.round(best.before * 100)}% to ${Math.round(best.after * 100)}%` : null };
    }) };
  }
  if (name === "get_data_checks") return { as_of: TODAY, pipeline: MODEL.pipeline || null, checks: (MODEL.checks || []).map(c => ({ check: c.title, status: c.status, result: c.result, examples: (c.records || []).slice(0, 5) })) };
  if (name === "show_on_map") {
    if (i.key) { const x = findPair(i.key); if (!x) throw new Error(`No flagged pair ${i.key}.`); if (!VIEW.includes(x)) { state.tiers = new Set([0, 1, 2, 3, 4]); state.q = ""; state.past = true; state.horizon = 0; $("#pastOn").checked = true; refresh(); }
      const y = VIEW.find(v => keyOf(v) === keyOf(x)) || x; state.sel = y; state.wi = null; renderMap(); renderTimeline(); flyTo(y); return { shown: pairOut(y).project_a + " and " + pairOut(y).project_b }; }
    const p = PROJECTS.find(v => v.id === i.project_id);
    if (!p) throw new Error("Give a pair key or a project id.");
    SeamMap.fit(p.coords, { padKm: 6 });
    return { shown: p.name };
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
      explanation: `Their closest points are ${km.toFixed(1)} km apart, beyond the ${state.D} km screen, so sharing a crew or a staging yard is not plausible.`,
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
  if (name === "open_schedule_brief") {
    if (i.max_shift_months) state.opt.maxShift = i.max_shift_months;
    const o = optimize();
    if (!o || !o.moves.length) throw new Error("No date move of that size is worth the threshold, so there is no schedule brief to open.");
    openScheduleBrief(o, i.narrative);
    return { opened: "joint schedule proposal", moves: o.moves.length, adds_usd: Math.round(o.after - o.before) };
  }
  throw new Error("Unknown tool " + name);
}
const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
  .split(/\n{2,}/).map(par => /^\s*[-*] /m.test(par) ? "<ul>" + par.split("\n").filter(l => l.trim()).map(l => `<li>${l.replace(/^\s*[-*]\s+/, "")}</li>`).join("") + "</ul>" : `<p>${par.replace(/\n/g, "<br>")}</p>`).join("");
const apiKey = () => { try { return sessionStorage.getItem("seamline.key") || localStorage.getItem("seamline.key") || ""; } catch (err) { return CHAT.key || ""; } };
function saveKey(k, remember) {
  CHAT.key = k;
  try { sessionStorage.setItem("seamline.key", k); if (remember) localStorage.setItem("seamline.key", k); else localStorage.removeItem("seamline.key"); } catch (err) { /* storage blocked: key lives for this page only */ }
}
const SUGGEST = ["Which overlaps are most likely to happen, and what could they save?", "Explain the Jasper - Okatie and McIntosh - Purrysburg pair", "What changed between DESC's last two plans?", "Which three date moves would save the most?", "Show me what's planned near Augusta", "How reliable is the data?"];
// The panel leads with what it can do, not with a key field. The common questions are answered from the loaded plans
// with no model at all (agent-offline.js), so opening with "Anthropic API key" in bold reads as a paywall on a feature
// that is already working. The key is offered at the bottom, for the open-ended questions that do need it.
function renderAsk(P) {
  P.dataset.view = "ask";
  const has = !!apiKey();
  const keyForm = has
    ? `<span class="muted">Claude (${esc(SeamAgent.MODEL)}) · API key set</span><button type="button" class="link" id="kChange">Change key</button>`
    : state.askKey
      ? `<label for="kIn"><b>Anthropic API key</b></label><div class="ph-row"><input id="kIn" type="password" placeholder="sk-ant-…" autocomplete="off"><button type="button" class="btn sm primary" id="kSave">Use key</button></div>
        <label class="chk"><input type="checkbox" id="kRem"> Remember on this device</label>
        <span class="note">The assistant runs in your browser and sends your question, plus the Seamline data it looks up, to Anthropic's API with this key. The key is kept in this browser only (for this tab, unless you tick Remember) and never goes anywhere else.</span>`
      : `<button type="button" class="link" id="kShow">Connect an Anthropic key for open-ended questions</button>`;
  P.innerHTML = `<div class="ask">
    <div class="ask-log" id="askLog" role="log" aria-live="polite" aria-relevant="additions" aria-label="Assistant answers">${CHAT.log.length ? CHAT.log.map(m => `<div class="msg ${m.role}">${m.role === "user" ? esc(m.text) : m.role === "tool" ? esc(m.text) : md(m.text)}</div>`).join("")
      : `<div class="msg hint"><p>Ask about the projects, overlaps, plan changes or data quality. The common questions are answered right here from the loaded plans.</p><div class="sugs">${SUGGEST.map(s => `<button type="button" class="chip">${esc(s)}</button>`).join("")}</div></div>`}
      ${CHAT.busy ? `<div class="msg tool">Thinking…</div>` : ""}</div>
    <form class="ask-in" id="askForm"><textarea id="askQ" rows="2" placeholder="e.g. Which three date moves would save the most?" aria-label="Question"></textarea><button type="submit" class="btn primary"${CHAT.busy ? " disabled" : ""}>Ask</button></form>
    <div class="ask-key${has ? " set" : ""}">${keyForm}</div></div>`;
  const log = $("#askLog"); log.scrollTop = log.scrollHeight;
  if ($("#kShow")) $("#kShow").onclick = () => { state.askKey = true; renderAsk(P); $("#kIn").focus(); };
  if ($("#kSave")) $("#kSave").onclick = () => { const k = $("#kIn").value.trim(); if (k) { saveKey(k, $("#kRem").checked); state.askKey = false; renderAsk(P); $("#askQ").focus(); } };
  if ($("#kChange")) $("#kChange").onclick = () => { saveKey("", false); try { sessionStorage.removeItem("seamline.key"); localStorage.removeItem("seamline.key"); } catch (err) { /* nothing stored */ } state.askKey = true; renderAsk(P); };
  P.querySelectorAll(".sugs .chip").forEach(b => b.onclick = () => sendQuestion(b.textContent));
  $("#askForm").onsubmit = e => { e.preventDefault(); const q = $("#askQ").value.trim(); if (q) sendQuestion(q); };
  $("#askQ").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#askForm").requestSubmit(); } };
}
const TOOL_NOTE = { get_overview: "Reading the summary", search_projects: "Searching projects", get_project: "Reading a project", list_overlaps: "Ranking overlaps", get_overlap: "Reading a pair",
  get_plan_changes: "Comparing plan versions", optimize_schedule: "Running the schedule optimizer", get_data_checks: "Reading the data checks", show_on_map: "Showing it on the map",
  open_brief: "Writing the coordination brief", open_schedule_brief: "Writing the schedule proposal" };
// Answer a question without the model: the same tools, routed by pattern (agent-offline.js). Returns the answer text,
// or null when the pattern matcher is not confident — a half-understood question answered confidently is worse than
// saying the model is needed. reason, when given, is why the model was unavailable.
function answerOffline(q, reason) {
  const lang = SeamOffline.language(q), plan = SeamOffline.interpret(q);
  if (!plan) return null;
  CHAT.log.push({ role: "tool", text: TOOL_NOTE[plan.tool] || plan.tool });
  let text;
  try {
    text = SeamOffline.render(plan.tool, runTool(plan.tool, plan.input), lang);
  } catch (err) {
    text = String(err && err.message || err);
  }
  return `${text}\n\n${SeamOffline.note(lang, reason)}`;
}

async function sendQuestion(q) {
  if (CHAT.busy) return;
  CHAT.busy = true; CHAT.log.push({ role: "user", text: q });
  const P = $("#panel"), again = () => { if (state.tab === "ask") renderAsk(P); };
  const finish = text => { CHAT.log.push({ role: "assistant", text }); CHAT.busy = false; again(); if (state.tab !== "ask") renderTabs(); };
  again();

  // No key: answer by pattern if the question is one the tools cover, otherwise ask for the key and say what does work.
  if (!apiKey()) {
    const offline = answerOffline(q, null);
    const lang = SeamOffline.language(q);
    return finish(offline || `${SeamOffline.capabilities(lang)}\n\nFor anything else, add an Anthropic API key above.`);
  }

  CHAT.messages.push({ role: "user", content: q });
  try {
    const r = await SeamAgent.ask({ apiKey: apiKey(), system: SYSTEM, tools: TOOLS, messages: CHAT.messages, execute: async (n, input) => runTool(n, input),
      onTool: n => { CHAT.log.push({ role: "tool", text: TOOL_NOTE[n] || n }); again(); } });
    finish(r.text + (r.truncated ? "\n\n(The answer was cut short.)" : ""));
  } catch (err) {
    CHAT.messages.pop(); // drop the unanswered question so the conversation stays valid
    // The API is unreachable, the key was refused or the SDK would not load. Fall back to the pattern path rather than
    // leaving the question unanswered, and say which happened.
    finish(answerOffline(q, SeamAgent.explain(err)) || SeamAgent.explain(err));
  }
}

// ---------- coordination brief ----------
// narrative, when given, is the assistant's one-paragraph framing. It is the only generated prose in a brief:
// every figure, date, table and next step below is computed from the plans.
function openBrief(x0, narrative) {
  const y = whatIf(x0, state.wi.who, state.wi.shift), better = state.wi.shift && (y.ov > x0.ov || y.risk.expected > x0.risk.expected);
  const x = better ? y : x0, moved = better ? x[state.wi.who] : null, s = x.sav, T = TIERS[x.tier];
  const uA = lblLong(x.p.utility), uB = lblLong(x.q.utility), today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const when = x.ov > 0 ? `Their build windows overlap by about ${Math.round(x.ov)} months${moved ? `, if ${esc(moved.name)} moves ${moLabel(state.wi.shift)}` : ""}.`
    : `Their build windows are about ${Math.round(x.gap)} months apart.` + (() => { const r = Engine.recommendShift(x0, "q"); return r ? ` Moving ${esc(x0.q.name)} ${moLabel(r)} would give them a shared window.` : ""; })();
  const risk = x.risk.why === "built" ? "One of the projects is likely built already." : `Given how both utilities' dates have moved between plans, there is a ${pct(x.risk.chance)} chance both are in the field together from today on; expected savings ${money(x.risk.expected)}.`;
  const steps = [
    "Confirm both project locations and the closest-point distance with each utility's GIS team.",
    x.tier === 0 && "Agree one outage window and crossing-structure design for where the projects meet.",
    x.tier <= 1 && "Scope a shared right-of-way and access road, and file one joint permit package.",
    x.tier <= 2 && "Site one laydown yard between the projects for material deliveries.",
    "Compare contractor and crew plans; share mobilization where the windows overlap.",
    "Name one coordinator at each utility and set a monthly check-in until both are in service.",
  ].filter(Boolean);
  const row = (p, c) => `<tr><td><b>${esc(p.name)}</b><br><span>${esc(lblLong(p.utility))}</span></td><td>${p.kv} kV ${esc(TYPE[p.type] || "")}</td><td>${fmtD(p, "start")} to ${fmtD(p, "in_service")}${p === moved ? "<br><em>proposed</em>" : ""}</td><td>${c.est ? "est. " : ""}${money(c.v)}</td></tr>`;
  $("#briefDoc").innerHTML = `
    <header class="b-head"><div class="b-brand">SEAMLINE <span>Coordination brief</span></div><div class="b-date">${today}</div></header>
    <dl class="b-memo"><dt>To</dt><dd>${esc(uA)} transmission planning<br>${esc(uB)} transmission planning</dd>
      <dt>Re</dt><dd>Coordinating ${esc(x.p.name)} and ${esc(x.q.name)}</dd></dl>
    ${briefNote(narrative)}
    <p class="b-lede">These two planned projects come within <b>${km(x.km)}</b> of each other at their closest points (<b>${esc(T.label.toLowerCase())}</b>). ${esc(T.means)}. ${when} ${risk}</p>
    <div class="b-grid"><div>${briefMap(x)}</div>
      <div class="b-kpis"><div><b>${km(x.km)}</b><span>apart at the closest points</span></div><div><b>${x.risk.why === "built" ? "–" : pct(x.risk.chance)}</b><span>chance of a shared window</span></div><div><b>${money(x.risk.expected)}</b><span>expected savings (${s.total ? money(s.total) : "$0"} if dates hold)</span></div></div></div>
    <h4>The projects</h4>
    <table class="b-tab"><thead><tr><th>Project</th><th>Type</th><th>Build window</th><th>Cost</th></tr></thead><tbody>${row(x.p, s.ca)}${row(x.q, s.cb)}</tbody></table>
    ${s.items.length ? `<h4>What they can share, and what each saves</h4><table class="b-tab"><tbody>${s.items.map(i => `<tr><td><b>${esc(i.share)}</b> <span>${esc(i.how)}</span></td><td class="n">${money(i.v)}</td></tr>`).join("")}<tr class="tot"><td>Total if dates hold${Engine.customized() ? " (with edited unit costs)" : ""}</td><td class="n">${money(s.total)}</td></tr></tbody></table>` : ""}
    ${x.tier <= 3 ? (() => { const yd = pairYard(x), im = Engine.yardImpact(yd, 2); return `<p class="b-yard"><b>Shared yard.</b> The best spot for one staging yard is ${yd.near ? "next to " + esc(yd.near) : "open land"} at ${yd.at.map(v => v.toFixed(3)).join(", ")}, ${yardDist(yd)}${x.sameWindow ? `, saving about ${miles(im.netMi)} truck-miles and ${im.co2t.toFixed(1)} t of CO2` : ""}.</p>`; })() : ""}
    <h4>Proposed next steps</h4><ol>${steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
    <p class="b-foot">Prepared with Seamline from public plans (DESC's SCRTP project lists, Georgia Power's 2025 IRP ten-year plan and SERTP). Locations are matched from substation names to OpenStreetMap and checked by hand${x.p.loc === "low" || x.q.loc === "low" ? ", and at least one of these is approximate" : ""}; costs are planning-level estimates unless the plan lists one. Confirm with both utilities before acting.</p>`;
  showBrief();
}
function openScheduleBrief(o, narrative) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  $("#briefDoc").innerHTML = `<header class="b-head"><div class="b-brand">SEAMLINE <span>Joint schedule proposal</span></div><div class="b-date">${today}</div></header>
    <dl class="b-memo"><dt>To</dt><dd>${esc(lblLong(state.utilA))} transmission planning<br>${esc(lblLong(state.utilB))} transmission planning</dd><dt>Re</dt><dd>${o.moves.length} date moves that line up nearby construction</dd></dl>
    ${briefNote(narrative)}
    <p class="b-lede">Moving these ${o.moves.length} projects by at most ${state.opt.maxShift} months raises the expected savings from coordinating nearby work from <b>${money(o.before)}</b> to <b>${money(o.after)}</b>. Each move is on a project that has not started. Chances are worked out from how each utility's dates moved between its last two plans.</p>
    <table class="b-tab"><thead><tr><th>Project</th><th>Move</th><th>In service</th><th>Adds</th></tr></thead><tbody>${o.moves.map(m => `<tr><td><b>${esc(m.project.name)}</b><br><span>${esc(lblLong(m.project.utility))}</span></td><td>${m.months > 0 ? "+" : "−"}${Math.abs(m.months)} months</td><td>${fmtD(m.from, "in_service")} → ${fmtD(m.to, "in_service")}</td><td class="n">${money(m.gain)}</td></tr>`).join("")}</tbody></table>
    <h4>Proposed next steps</h4><ol><li>Each utility checks whether its moves fit reliability need dates, outage seasons and budget cycles.</li><li>Agree the moves that fit at the next SERTP coordination meeting.</li><li>Re-run Seamline on the next published plans to track the result.</li></ol>
    <p class="b-foot">Prepared with Seamline. A planning aid: it assumes each date moves once more like past plan updates, and that the utilities move independently.</p>`;
  showBrief();
}
const briefNote = text => text ? `<p class="b-note"><span>Assistant summary</span>${esc(String(text).slice(0, 1200))}</p>` : "";
let returnFocus = null;
function lockApp(on) { document.body.classList.toggle("modal-open", on); }
function showBrief() { returnFocus = document.activeElement; $("#brief").hidden = false; lockApp(true); $("#briefClose").focus(); }
function briefMap(x) {
  const W = 300, H = 210, feat = p => Engine.isLine(p) ? { type: "MultiLineString", coordinates: Engine.partsOf(p).filter(c => c.length > 1).map(c => c.map(v => [v[1], v[0]])) } : { type: "Point", coordinates: [p.coords[0][1], p.coords[0][0]] };
  const box = { type: "FeatureCollection", features: [x.p, x.q].map(p => ({ type: "Feature", geometry: feat(p) })) };
  const pr = d3.geoMercator().fitExtent([[40, 40], [W - 40, H - 40]], box);
  if (pr.scale() > 60000) pr.scale(60000)
    .center([(x.ca[1] + x.cb[1]) / 2, (x.ca[0] + x.cb[0]) / 2])
    .translate([W / 2, H / 2]);
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
const quality3d = () => { const q = store.get("3dquality", "high"); return Scene3D.QUALITY[q] ? q : "high"; };
function open3d(x) {
  $("#m3dQ").value = quality3d();
  Scene3D.open(x, {
    title: `${short(x.p)} and ${short(x.q)}`,
    subtitle: `${TIERS[x.tier].label}: ${km(x.km)} at the closest points. ${TIERS[x.tier].means}.`,
    colorA: uColor(x.p.utility), colorB: uColor(x.q.utility), tierColor: tcol(Math.min(x.tier, 4)),
    nameA: `${lbl(x.p.utility)}: ${short(x.p)}`, nameB: `${lbl(x.q.utility)}: ${short(x.q)}`,
    distText: `${km(x.km)} apart · ${TIERS[x.tier].short}`, quality: quality3d(),
  });
  $("#m3d").classList.add("settled"); document.body.classList.add("m3d-open");
}
function close3d() { $("#m3d").classList.remove("settled"); document.body.classList.remove("m3d-open"); Scene3D.close(); }

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
    return `<p class="warn">Couldn't load ${esc(filename)}: ${esc(err.message)}. Check it has a project name, a utility, coordinates and an in-service date.</p>`;
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

// ---------- modals ----------
function openModal(id) { const m = $("#" + id); returnFocus = document.activeElement; m.hidden = false; lockApp(true); const f = m.querySelector("input,select,button"); if (f) f.focus(); if (id === "import") $("#openImport").setAttribute("aria-expanded", "true"); }
function closeModal(id) { $("#" + id).hidden = true; lockApp(false); if (returnFocus && returnFocus.focus) returnFocus.focus(); returnFocus = null; if (id === "import") $("#openImport").setAttribute("aria-expanded", "false"); }

// ---------- selection and refresh ----------
function select(x) {
  if (!x || !state.wi || state.wi.key !== (x.p && x.q ? keyOf(x) : "")) state.wi = null;
  const changed = x !== state.sel;
  state.sel = x;
  if (x && !x.moves) state.tab = "overlaps";
  renderMap(); renderPanel(); renderTimeline();
  if (changed && x) flyTo(x); else if (changed && !x) fitAll(700);
}
function refresh() {
  compute();
  if (state.sel && state.sel.cluster) { const ids = state.sel.cluster.projects.map(p => p.id).join(); state.sel = (c => c ? { cluster: c } : null)(CLUSTERS.find(c => c.projects.map(p => p.id).join() === ids)); }
  else if (state.sel) state.sel = state.sel.solo ? (SOLO.includes(state.sel.p) ? state.sel : null) : VIEW.find(x => x.p === state.sel.p && x.q === state.sel.q) || null;
  const near = RESULT.pairs, exp = VIEW.reduce((s, x) => s + x.risk.expected, 0), plan = VIEW.reduce((s, x) => s + x.sav.total, 0);
  $("#summary").innerHTML = solo() ? `${SOLO.length} projects` :
    `${RESULT.checked.toLocaleString()} pairs checked · <b>${near.length} overlap</b>${VIEW.length !== near.length ? ` · ${VIEW.length} shown` : ""} · expected savings <b>${money(exp)}</b> <span class="muted">(${money(plan)} if every date held)</span>`;
  renderMap(); renderPanel(); renderTimeline();
}
function rebuild() {
  state.sel = null; chanceCache.clear(); optCache.key = null; driftCache.key = null;
  renderPickers(); compute(); legend(); setupScrub(); refresh(); fitAll(0);
}
function setBasemap(b) {
  state.basemap = b; store.set("basemap", b);
  document.querySelectorAll("#basemaps button").forEach(o => o.setAttribute("aria-pressed", o.dataset.b === b));
  SeamMap.setBasemap(b); $("#tileNote").hidden = true; renderMap();
}
function theme() {
  SeamMap.setTheme({ water: css("--water"), land: css("--land"), county: css("--grid"), stateLine: css("--ink3"), river: css("--river"), place: css("--ink2") });
  legend(); renderMap(); renderTimeline(); renderPanel();
}

// ---------- wiring ----------
$("#utilA").onchange = e => { state.utilA = e.target.value; if (state.utilB === state.utilA) state.utilB = utilities().find(u => u !== state.utilA) || NONE; rebuild(); };
$("#utilB").onchange = e => { state.utilB = e.target.value; state.tab = "overlaps"; rebuild(); };
$("#dist").onchange = e => { state.D = +e.target.value; state.shown = 60; refresh(); };
$("#buf").onchange = e => { state.B = +e.target.value; chanceCache.clear(); refresh(); };
for (const m of ["near", "both", "time"]) $("#m-" + m).onclick = () => { state.mode = m; for (const k of ["near", "both", "time"]) $("#m-" + k).setAttribute("aria-pressed", k === m); refresh(); };
document.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { state.horizon = +b.dataset.h; document.querySelectorAll("[data-h]").forEach(o => o.setAttribute("aria-pressed", o === b)); refresh(); });
$("#pastOn").onchange = e => { state.past = e.target.checked; refresh(); };
for (const v of ["focus", "all"]) $("#v-" + v).onclick = () => { state.view = v; for (const k of ["focus", "all"]) $("#v-" + k).setAttribute("aria-pressed", k === v); fitAll(700); };
$("#basemaps").innerHTML = Object.entries(SeamMap.BASEMAPS).map(([k, b]) => `<button type="button" data-b="${k}" aria-pressed="${k === state.basemap}">${b.label}</button>`).join("");
document.querySelectorAll("#basemaps button").forEach(b => b.onclick = () => setBasemap(b.dataset.b));
$("#b3d").onclick = () => { if (!mapReady) return; const on = !SeamMap.get3D(); SeamMap.set3D(on); $("#b3d").setAttribute("aria-pressed", on); if (on && state.basemap === "plain") setBasemap("satellite"); };
document.querySelectorAll(".tabs button[data-tab]").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; if (state.sel && !state.sel.cluster) { state.sel = null; renderMap(); renderTimeline(); } renderPanel(); });
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
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = solo()
    ? ["utility,name,kv,type,start,in_service,cost,lat,lon"].concat(SOLO.map(p => [q(p.utility), q(p.name), p.kv, p.type, p.start, p.in_service, p.cost ?? "", p.coords[0][0], p.coords[0][1]].join(","))).join("\n")
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
SEAM = seamCoords();
renderPickers(); compute(); legend(); setupScrub(); refresh();
SeamMap.init($("#map"), BASE, {
  click: mapClick, hover: mapHover, recenter: () => fitAll(700),
  tilesFailed: name => { setBasemap("plain"); $("#tileNote").textContent = `${SeamMap.BASEMAPS[name].label} tiles couldn't load (they need an internet connection), so the map switched to Plain.`; $("#tileNote").hidden = false; },
}).then(() => {
  mapReady = true;
  SeamMap.setBasemap(state.basemap);
  theme();
  fitAll(0);
});
