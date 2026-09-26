// Seamline UI: map, ranked list, timeline and the importer panel. Logic lives in engine.js and ingest.js.
const { TIERS, fmtMoney: money, findOverlaps, monthIndex: mon } = Engine;
const BASE = window.SEAMLINE_DATA.basemap;
const ALL = window.SEAMLINE_DATA.projects;
const EXIST = ALL.filter(p => p.existing);
let PROJECTS = ALL.filter(p => !p.existing).map(p => Object.assign({ dataset: "built-in" }, p));
const DATASETS = [{ id: "built-in", name: "Built-in: DESC and Georgia", count: PROJECTS.length, builtin: true }];

const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LABEL = { DESC: "Dominion Energy SC", GPC: "Georgia (Georgia Power, GTC, MEAG)" };
const lbl = u => LABEL[u] || u;
const TYPE = { new_line: "new line", rebuild: "rebuild", substation: "substation", generation: "generation" };
// Raster basemaps. "plain" is the built-in vector map and works offline.
const BASEMAPS = {
  plain: { label: "Plain" },
  streets: { label: "Streets", url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, attr: "© OpenStreetMap contributors" },
  satellite: { label: "Satellite", url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, attr: "Imagery © Esri, Maxar, Earthstar Geographics" },
  terrain: { label: "Terrain", url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`, attr: "© Esri, HERE, Garmin, USGS" },
};
let tileErrors = 0;
const state = { basemap: "plain", utilA: "DESC", utilB: "GPC", D: 40, B: 0, mode: "near", view: "focus", sel: null, hover: null, tiers: new Set([0, 1, 2, 3, 4]), q: "", t: null, wi: null, exist: true };

const fmtD = (p, which) => {
  const d = new Date(p[which] + "T00:00:00Z");
  if (which === "in_service" && p.date_precision === "year") return String(d.getUTCFullYear());
  if (which === "in_service" && p.date_precision === "estimated") return "~" + d.getUTCFullYear() + " (est.)";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};
const km = d => d < 0.1 ? "0 km" : d < 10 ? d.toFixed(1) + " km" : Math.round(d) + " km";
const tcol = i => css(TIERS[i].tok);
const utilities = () => [...new Set(PROJECTS.map(p => p.utility))];
// "None" in the second picker shows one utility's projects on their own, with no pairs or ranking.
const NONE = "__none";
const solo = () => state.utilB === NONE;
const shownUtil = u => u === state.utilA || (!solo() && u === state.utilB);
const uColor = u => u === state.utilA ? css("--u0") : u === state.utilB ? css("--u1") : css("--ink3");

// ---------- compute ----------
let RESULT = { pairs: [], checked: 0 }, VIEW = [];
let SOLO = [];
function compute() {
  if (solo()) {
    const q = state.q.toLowerCase();
    RESULT = { pairs: [], checked: 0 }; VIEW = [];
    SOLO = PROJECTS.filter(p => p.utility === state.utilA && (!q || (p.name + " " + p.desc).toLowerCase().includes(q)))
      .sort((a, b) => mon(a.start) - mon(b.start) || a.name.localeCompare(b.name));
    return;
  }
  RESULT = findOverlaps(PROJECTS, { utilA: state.utilA, utilB: state.utilB, maxKm: state.D, bufferMonths: state.B, mode: state.mode });
  const q = state.q.toLowerCase();
  VIEW = RESULT.pairs.filter(x => state.tiers.has(Math.min(x.tier, 4)) &&
    (!q || (x.p.name + " " + x.q.name + " " + x.p.desc + " " + x.q.desc).toLowerCase().includes(q)));
}

// ---------- map ----------
let proj, zoomK = 1, zoomBehavior;
const MW = 900, MH = 640;
function fitFeature() {
  const pts = [];
  if (state.view === "focus" && RESULT.pairs.length) RESULT.pairs.slice(0, 40).forEach(x => { pts.push(x.ca, x.cb); });
  else PROJECTS.filter(p => shownUtil(p.utility)).forEach(p => pts.push(...p.coords));
  if (!pts.length) return { type: "Feature", geometry: { type: "MultiPoint", coordinates: [[-85, 30.5], [-79, 35]] } };
  const la = pts.map(p => p[0]), lo = pts.map(p => p[1]);
  const pad = Math.max(0.25, (Math.max(...la) - Math.min(...la)) * 0.15);
  return { type: "Feature", geometry: { type: "MultiPoint", coordinates: [[Math.min(...lo) - pad, Math.min(...la) - pad], [Math.max(...lo) + pad, Math.max(...la) + pad]] } };
}
function drawMap() {
  const svg = d3.select("#map").attr("viewBox", `0 0 ${MW} ${MH}`);
  proj = d3.geoMercator().fitExtent([[16, 16], [MW - 16, MH - 16]], fitFeature());
  const path = d3.geoPath(proj), pt = c => proj([c[1], c[0]]);
  svg.selectAll("*").remove();
  svg.append("rect").attr("width", MW).attr("height", MH).attr("fill", css("--water"));
  const raster = !!BASEMAPS[state.basemap].url, bright = state.basemap === "satellite";
  svg.append("g").attr("id", "tiles");
  const z = svg.append("g").attr("id", "zoomg"), g = z.append("g");
  if (!raster) {
    g.selectAll(".st").data(BASE.states).join("path").attr("d", d => path(d.g)).attr("fill", css("--land")).attr("stroke", css("--line")).attr("stroke-width", 1);
    g.selectAll(".co").data(BASE.counties).join("path").attr("d", d => path(d.g)).attr("fill", "none").attr("stroke", css("--grid")).attr("stroke-width", .6);
  }
  g.selectAll(".sb").data(BASE.states).join("path").attr("d", d => path(d.g)).attr("fill", "none")
    .attr("stroke", bright ? "rgba(255,255,255,.7)" : css("--ink3")).attr("stroke-width", raster ? 1.5 : 1.1);
  drawSeam(g, path, raster);
  const places = [["Augusta", 33.47, -81.97], ["Savannah", 32.08, -81.09], ["Atlanta", 33.75, -84.39], ["Columbia", 34.0, -81.03], ["Charleston", 32.78, -79.93], ["Macon", 32.84, -83.63], ["Thomson", 33.47, -82.50], ["Beaufort", 32.43, -80.67], ["Aiken", 33.60, -81.68]];
  const stl = BASE.states.map(s => { const c = d3.geoCentroid({ type: "Feature", geometry: s.g }); return [s.n.toUpperCase(), c[1], c[0], true]; });
  g.selectAll(".lb").data(stl.concat(places)).join("text").attr("x", d => proj([d[2], d[1]])[0]).attr("y", d => proj([d[2], d[1]])[1])
    .attr("text-anchor", "middle").attr("fill", d => d[3] ? css("--ink3") : css("--ink2")).attr("data-fs", d => d[3] ? 14 : 11)
    .attr("letter-spacing", d => d[3] ? ".2em" : 0).attr("font-family", d => d[3] ? css("--display") : null).text(d => d[0]);
  // existing infrastructure: built-in plants and lines, plus any backdrop layer imported (for example HIFLD)
  const eg = z.append("g").attr("id", "existing").style("display", state.exist ? null : "none").selectAll("g").data(EXIST.filter(e => e.backdrop || shownUtil(e.utility))).join("g").style("cursor", "help")
    .on("mousemove", (ev, d) => tip(ev, `<b>${esc(d.name)}</b><br>Existing ${esc(lbl(d.utility))} ${d.coords.length > 1 ? "line" : "asset"}${d.kv > 0 ? " · " + d.kv + " kV" : ""}${d.backdrop ? "<br>From " + esc(d.dsName) : ""}`)).on("mouseleave", hideTip);
  eg.filter(d => d.coords.length > 1).append("path").attr("d", d => d3.line()(d.coords.map(pt))).attr("fill", "none").attr("stroke", css("--ink3")).attr("stroke-width", 2.5).attr("stroke-opacity", .6);
  eg.filter(d => d.coords.length === 1).append("path").attr("class", "dia").attr("data-x", d => pt(d.coords[0])[0]).attr("data-y", d => pt(d.coords[0])[1])
    .attr("fill", css("--panel")).attr("stroke", d => uColor(d.utility)).attr("stroke-width", 1.5);
  z.append("g").attr("id", "links");
  z.append("g").attr("id", "projs");
  z.append("g").attr("id", "sparks");
  // existing-asset names sit above project lines, with a halo so a line never hides them
  z.append("g").attr("id", "toplabels").selectAll("text").data(EXIST.filter(e => !e.backdrop && shownUtil(e.utility) && e.coords.length === 1)).join("text").attr("class", "exl ex")
    .attr("data-x", d => pt(d.coords[0])[0]).attr("data-y", d => pt(d.coords[0])[1]).attr("data-fs", 10).attr("fill", css("--ink2"))
    .attr("stroke", raster ? "rgba(255,255,255,.8)" : css("--land")).attr("stroke-width", 3).attr("paint-order", "stroke").attr("stroke-linejoin", "round").style("pointer-events", "none").text(d => d.name.split(" (")[0]);
  z.selectAll("#toplabels text.ex").style("display", state.exist ? null : "none");
  // name the seam once, beside the river between Augusta and Savannah
  const sm = SEAM[Math.floor(SEAM.length * 0.72)];
  if (sm) z.select("#toplabels").append("text").attr("class", "exl").attr("data-x", sm.x + 4).attr("data-y", sm.y).attr("data-fs", 10).attr("font-weight", 600).attr("letter-spacing", ".16em")
    .attr("fill", css("--seam")).attr("stroke", raster ? "rgba(255,255,255,.85)" : css("--land")).attr("stroke-width", 3).attr("paint-order", "stroke").style("pointer-events", "none").text("THE SEAM · SAVANNAH RIVER");
  svg.append("g").attr("id", "scale").attr("transform", `translate(24,${MH - 30})`);
  zoomBehavior = d3.zoom().scaleExtent([1, 20]).on("zoom", ev => { zoomK = ev.transform.k; z.attr("transform", ev.transform); renderTiles(ev.transform); applyK(); });
  if (raster) z.selectAll("text").attr("fill", bright ? "#fff" : css("--ink")).attr("stroke", bright ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.8)").attr("stroke-width", 3).attr("paint-order", "stroke");
  tileErrors = 0; $("#tileNote").hidden = true;
  $("#attr").textContent = BASEMAPS[state.basemap].attr || "";
  renderTiles(d3.zoomIdentity);
  svg.call(zoomBehavior).on("dblclick.zoom", null);
  zoomK = 1;
}
// The Seam: the Georgia and South Carolina border (the Savannah River) drawn as stitched thread.
// Built from the vertices both states' outlines share, so it follows the river exactly.
let SEAM = [];
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
function drawSeam(g, path, raster) {
  SEAM = [];
  const cs = seamCoords(); if (!cs) return;
  const line = { type: "LineString", coordinates: cs };
  g.append("path").attr("d", path(line)).attr("fill", "none").attr("stroke", css("--seamglow")).attr("stroke-width", raster ? 9 : 7).attr("stroke-linecap", "round");
  const base = g.append("path").attr("id", "seampath").attr("d", path(line)).attr("fill", "none").attr("stroke", css("--seam")).attr("stroke-width", 1.4);
  const node = base.node(), L = node.getTotalLength();
  for (let l = 4; l < L; l += 8) {
    const a = node.getPointAtLength(Math.max(0, l - 0.5)), b = node.getPointAtLength(Math.min(L, l + 0.5)), d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    SEAM.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, tx: (b.x - a.x) / d, ty: (b.y - a.y) / d });
  }
  g.append("g").attr("id", "stitches").selectAll("line").data(SEAM).join("line").attr("stroke", css("--seam")).attr("stroke-width", 1.3).attr("stroke-linecap", "round");
}

// Web Mercator tiles aligned to the d3 projection: world spans 2πS px at scale S, offset by the projection translate.
function renderTiles(t) {
  const bm = BASEMAPS[state.basemap], layer = d3.select("#tiles");
  if (!bm.url) { layer.selectAll("image").remove(); return; }
  const S = proj.scale(), [tx, ty] = proj.translate();
  const W = 2 * Math.PI * S * t.k, left = t.x + t.k * (tx - Math.PI * S), top = t.y + t.k * (ty - Math.PI * S);
  const z = Math.max(0, Math.min(18, Math.round(Math.log2(W / 256)))), n = 2 ** z, ts = W / n;
  const tiles = [];
  for (let i = Math.max(0, Math.floor(-left / ts)); i <= Math.min(n - 1, Math.floor((MW - left) / ts)); i++)
    for (let j = Math.max(0, Math.floor(-top / ts)); j <= Math.min(n - 1, Math.floor((MH - top) / ts)); j++) tiles.push([z, i, j]);
  layer.selectAll("image").data(tiles, d => d.join("/"))
    .join(e => e.append("image").attr("href", d => bm.url(...d)).attr("preserveAspectRatio", "none")
      .on("error", () => { if (++tileErrors === 3) tilesFailed(); }))
    .attr("x", d => left + d[1] * ts).attr("y", d => top + d[2] * ts).attr("width", ts + .5).attr("height", ts + .5);
}

// Outside tiles can be blocked (offline, or a sandboxed preview): fall back to the plain map and say why.
function tilesFailed() {
  if (!BASEMAPS[state.basemap].url) return;
  const name = BASEMAPS[state.basemap].label;
  state.basemap = "plain"; $("#basemap").value = "plain";
  drawMap(); refresh();
  $("#tileNote").innerHTML = `${name} tiles couldn't load here, so the map switched back to Plain. They need an internet connection and don't load inside sandboxed previews; open <code>index.html</code> in a browser to use them.`;
  $("#tileNote").hidden = false;
}

// Keep markers and labels the same on-screen size while zooming.
function applyK() {
  const k = zoomK, z = d3.select("#zoomg");
  z.selectAll("text").attr("font-size", function () { return this.dataset.fs / k; }).attr("stroke-width", function () { return this.getAttribute("stroke") ? 3 / k : null; });
  z.selectAll("text.exl").attr("x", function () { return +this.dataset.x + 9 / k; }).attr("y", function () { return +this.dataset.y + 4 / k; });
  z.selectAll("path.dia").attr("d", function () { const x = +this.dataset.x, y = +this.dataset.y, s = 6 / k; return `M${x},${y - s}L${x + s},${y}L${x},${y + s}L${x - s},${y}Z`; });
  z.selectAll("circle").attr("r", function () { return this.dataset.r / k; });
  // cross-stitches: short slanted ticks across the seam, the same size at every zoom
  const sl = 3.4 / k;
  z.select("#stitches").selectAll("line").attr("x1", d => d.x - (d.ty + d.tx * 0.6) * sl).attr("y1", d => d.y + (d.tx - d.ty * 0.6) * sl)
    .attr("x2", d => d.x + (d.ty + d.tx * 0.6) * sl).attr("y2", d => d.y - (d.tx - d.ty * 0.6) * sl);
  const sc = d3.select("#scale"); sc.selectAll("*").remove();
  const c = proj.invert([MW / 2, MH / 2]), a = proj(c), b = proj([c[0] + state.D / (111.32 * Math.cos(c[1] * Math.PI / 180)), c[1]]);
  const w = (b[0] - a[0]) * k;
  sc.append("rect").attr("width", Math.min(w, MW - 60)).attr("height", 4).attr("fill", css("--hot"));
  sc.append("text").attr("y", -6).attr("font-size", 11).attr("fill", css("--ink2")).text(`${state.D} km${w > MW - 60 ? " (wider than view)" : ""}`);
}
// Where a project stands at month t: not started, under construction, or in service.
const phase = (p, t) => t == null ? "all" : t < mon(p.start) ? "planned" : t <= mon(p.in_service) ? "building" : "done";
const live = (x, t) => phase(x.p, t) === "building" && phase(x.q, t) === "building";
function renderMap() {
  const shown = VIEW.slice(0, 60), sel = state.sel, hov = state.hover, pt = c => proj([c[1], c[0]]), t = state.t;
  const flagged = new Set(shown.flatMap(x => [x.p.id, x.q.id]));
  const focus = sel || hov;
  d3.select("#links").selectAll("g").data(shown, d => d.p.id + "|" + d.q.id)
    .join(e => { const g = e.append("g"); g.append("line"); g.append("circle"); return g; })
    .call(g => g.select("line").attr("x1", d => pt(d.ca)[0]).attr("y1", d => pt(d.ca)[1]).attr("x2", d => pt(d.cb)[0]).attr("y2", d => pt(d.cb)[1])
      .attr("stroke", d => tcol(Math.min(d.tier, 4))).attr("stroke-width", d => focus === d ? 3.5 : 1.5).attr("stroke-dasharray", "4 3"))
    .call(g => g.select("circle").attr("cx", d => pt(d.ca)[0]).attr("cy", d => pt(d.ca)[1]).attr("data-r", d => d.tier <= 1 ? (focus === d ? 12 : 8) : 0)
      .attr("fill", "none").attr("stroke", d => tcol(Math.min(d.tier, 4))).attr("stroke-width", 2))
    .attr("opacity", d => focus ? (d === focus ? 1 : .12) : t != null ? (live(d, t) ? 1 : .08) : d.sameWindow ? .9 : .45)
    .style("cursor", "pointer").on("click", (ev, d) => select(d));
  const rows = PROJECTS.filter(p => shownUtil(p.utility))
    .map(p => ({ p, on: solo() || flagged.has(p.id), hi: focus && (focus.p === p || focus.q === p), ph: phase(p, t) }));
  const G = d3.select("#projs").selectAll("g.p").data(rows, d => d.p.id)
    .join(e => { const g = e.append("g").attr("class", "p"); g.append("path").attr("class", "casing"); g.append("path").attr("class", "line"); g.append("circle"); return g; });
  // Casing contrasts with the basemap: dark on light maps (streets, terrain), white on satellite.
  const raster = !!BASEMAPS[state.basemap].url, lightMap = state.basemap === "streets" || state.basemap === "terrain";
  const wide = d => (d.p.kv >= 500 ? 4 : d.p.kv >= 230 ? 3 : 2) + (d.hi ? 2 : 0) + (raster ? 1.5 : 0) + (d.ph === "building" ? 1.5 : 0);
  G.select("path.casing").attr("d", d => d.p.coords.length > 1 ? d3.line()(d.p.coords.map(pt)) : null)
    .attr("fill", "none").attr("stroke", lightMap ? "rgba(20,24,28,.85)" : raster ? "rgba(255,255,255,.9)" : css("--panel")).attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
    .attr("stroke-width", d => wide(d) + (raster ? 4 : 3));
  const phaseOp = { all: 1, building: 1, done: .5, planned: .14 };
  G.attr("opacity", d => focus ? (d.hi ? 1 : .22) : (d.on ? 1 : .3) * phaseOp[d.ph]).classed("building", d => d.ph === "building").style("cursor", "pointer")
    .on("mousemove", (ev, d) => showTip(ev, d.p)).on("mouseleave", hideTip)
    .on("click", (ev, d) => { if (solo()) return select({ p: d.p, solo: true }); const pr = VIEW.find(x => x.p === d.p || x.q === d.p); if (pr) select(pr); });
  G.select("path.line").attr("d", d => d.p.coords.length > 1 ? d3.line()(d.p.coords.map(pt)) : null)
    .attr("fill", "none").attr("stroke", d => uColor(d.p.utility)).attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
    .attr("stroke-width", wide)
    .attr("stroke-dasharray", d => d.p.loc === "low" ? "6 4" : null);
  G.select("circle").attr("cx", d => pt(d.p.coords[0])[0]).attr("cy", d => pt(d.p.coords[0])[1])
    .attr("data-r", d => d.p.coords.length > 1 ? 0 : (d.hi ? 7 : 4.5))
    .attr("fill", d => d.p.loc === "low" ? css("--panel") : uColor(d.p.utility)).attr("stroke", d => raster && d.p.loc !== "low" ? (lightMap ? "rgba(20,24,28,.9)" : "#fff") : uColor(d.p.utility)).attr("stroke-width", 2);
  // sparks: flagged pairs that are both under construction at the scrubbed month
  const sp = t == null ? [] : shown.filter(x => live(x, t));
  d3.select("#sparks").selectAll("circle").data(sp, d => d.p.id + "|" + d.q.id).join("circle").attr("class", "spark")
    .attr("cx", d => (pt(d.ca)[0] + pt(d.cb)[0]) / 2).attr("cy", d => (pt(d.ca)[1] + pt(d.cb)[1]) / 2).attr("data-r", 11)
    .attr("fill", d => tcol(Math.min(d.tier, 4))).attr("fill-opacity", .25).attr("stroke", d => tcol(Math.min(d.tier, 4))).attr("stroke-width", 2)
    .style("cursor", "pointer").on("click", (ev, d) => select(d));
  if (t != null) {
    const nb = rows.filter(r => r.ph === "building").length;
    $("#tlive").textContent = `${nb} project${nb === 1 ? "" : "s"} under construction` + (solo() ? "" : ` · ${sp.length} flagged pair${sp.length === 1 ? "" : "s"} building at once`);
  }
  applyK();
}

// ---------- time scrubber ----------
let playTimer = null;
const monthLabel = m => new Date(Date.UTC(Math.floor(m / 12), Math.floor(m % 12), 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
function setupScrub() {
  const ps = PROJECTS.filter(p => shownUtil(p.utility));
  if (!ps.length) return;
  const lo = Math.floor(Math.min(...ps.map(p => mon(p.start)))), hi = Math.ceil(Math.max(...ps.map(p => mon(p.in_service))));
  const r = $("#tslider"); r.min = lo; r.max = hi;
  if (state.t != null) state.t = Math.min(hi, Math.max(lo, state.t));
  r.value = state.t ?? lo;
  const y0 = Math.ceil(lo / 12), y1 = Math.floor(hi / 12);
  $("#tticks").innerHTML = Array.from({ length: y1 - y0 + 1 }, (_, i) => `<span style="left:${((y0 + i) * 12 - lo) / (hi - lo) * 100}%">${y0 + i}</span>`).join("");
  scrubUI();
}
function scrubUI() {
  const on = state.t != null;
  $("#tyear").textContent = on ? monthLabel(state.t) : "All years";
  $("#tlive").hidden = !on;
  $("#tall").hidden = !on;
  $("#scrub").classList.toggle("on", on);
  $("#play").textContent = playTimer ? "Pause" : "Play";
  $("#play").setAttribute("aria-pressed", !!playTimer);
}
function setT(t) { state.t = t; scrubUI(); renderMap(); moveCursor(); }
function stopPlay() { clearInterval(playTimer); playTimer = null; scrubUI(); }
function togglePlay() {
  if (playTimer) return stopPlay();
  const r = $("#tslider");
  if (state.t == null || state.t >= +r.max) { r.value = r.min; setT(+r.min); }
  playTimer = setInterval(() => {
    const n = state.t + 1;
    if (n > +r.max) return stopPlay();
    r.value = n; setT(n);
  }, 110);
  scrubUI();
}
function tip(ev, html) { const t = $("#tip"); t.innerHTML = html; t.hidden = false; t.style.left = Math.min(ev.clientX + 12, innerWidth - 290) + "px"; t.style.top = (ev.clientY + 12) + "px"; }
function showTip(ev, p) {
  tip(ev, `<b>${esc(p.name)}</b><br>${esc(lbl(p.utility))} · ${p.kv} kV ${TYPE[p.type] || ""}<br>In service ${fmtD(p, "in_service")}${p.cost ? " · " + money(p.cost) : ""}${p.loc === "low" ? "<br>Approximate location" : ""}${p.imported ? "<br>Imported" : ""}`);
}
function hideTip() { $("#tip").hidden = true; }

// ---------- summary ----------
function renderStats() {
  if (solo()) {
    const ps = PROJECTS.filter(p => p.utility === state.utilA), costs = ps.map(Engine.estCost);
    const lineKm = ps.filter(p => p.coords.length > 1).reduce((t, p) => t + Engine.lengthKm(p), 0);
    const years = ps.map(p => +p.in_service.slice(0, 4));
    $("#stats").innerHTML = [
      [`${ps.length}`, `planned projects for ${lbl(state.utilA)}`],
      [`${Math.round(lineKm).toLocaleString()} km`, `of new or rebuilt line`],
      [ps.length ? `${Math.min(...years)}–${Math.max(...years)}` : "–", `in-service years`],
      [ps.length ? "~" + money(costs.reduce((t, c) => t + c.v, 0)) : "–", `total cost, listed or estimated`],
    ].map(([b, t]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(t)}</span></div>`).join("");
    return;
  }
  const nA = PROJECTS.filter(p => p.utility === state.utilA).length, nB = PROJECTS.filter(p => p.utility === state.utilB).length;
  const near = RESULT.pairs.filter(x => x.near), both = near.filter(x => x.sameWindow);
  const pct = RESULT.checked ? 100 * near.length / RESULT.checked : 0;
  const total = VIEW.reduce((s, x) => s + x.sav.total, 0);
  $("#stats").innerHTML = [
    [`${nA} / ${nB}`, `planned projects compared`],
    [`${near.length}`, `of ${RESULT.checked.toLocaleString()} project pairs are within ${state.D} km (${pct.toFixed(1)}%)`],
    [`${both.length}`, `of those are built in the same window`],
    [total ? "~" + money(total) : "–", "rough savings if the listed pairs coordinate"],
  ].map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
}
function renderTiers() {
  $("#tiers").hidden = solo();
  if (solo()) return;
  $("#tiers").innerHTML = TIERS.slice(0, 4).map((t, i) => {
    const n = RESULT.pairs.filter(x => x.tier === i).length, nt = RESULT.pairs.filter(x => x.tier === i && x.sameWindow).length;
    const on = state.tiers.has(i);
    return `<button type="button" class="tier" aria-pressed="${on}" data-t="${i}" style="--c:var(${t.tok})"><b>${n}</b><span class="tb"><span class="tl">${t.label}</span><span class="tm">${t.means}</span><span class="tn">${nt} in the same build window</span></span></button>`;
  }).join("");
  $("#tiers").querySelectorAll(".tier").forEach(b => b.onclick = () => {
    const i = +b.dataset.t;
    if (state.tiers.has(i) && state.tiers.size > 2) state.tiers.delete(i); else state.tiers.add(i);
    refresh();
  });
}

// ---------- list and detail ----------
const pn = (p, cls) => `<span class="${cls}">${esc(p.name)}</span> <i>${fmtD(p, "in_service")}</i>`;
function renderSoloList() {
  $("#listTitle").textContent = "Projects";
  $("#cnt").textContent = `${SOLO.length} shown`;
  const L = $("#list");
  if (!SOLO.length) { L.innerHTML = `<div class="empty">No projects match the filter.</div>`; return; }
  L.innerHTML = SOLO.slice(0, 200).map((p, i) => `<div class="pair solo${state.sel && state.sel.p === p ? " sel" : ""}" tabindex="0" data-i="${i}" style="--c:${uColor(p.utility)}">
    <div class="rank">${i + 1}</div>
    <div class="pn"><div class="tierline"><span class="tchip">${esc(TYPE[p.type] || p.type)}</span><span class="kmv">${p.kv} kV</span>${p.cost ? `<span class="chip save">${money(p.cost)}</span>` : ""}</div>
      ${pn(p, "a")}</div></div>`).join("") + (SOLO.length > 200 ? `<div class="empty">Showing the first 200 of ${SOLO.length}.</div>` : "");
  L.querySelectorAll(".pair").forEach(el => {
    const x = { p: SOLO[+el.dataset.i], solo: true };
    el.onclick = () => select(x);
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(x); } };
    el.onmouseenter = () => { state.hover = x; renderMap(); };
    el.onmouseleave = () => { state.hover = null; renderMap(); };
  });
}
function renderList() {
  if (solo()) return renderSoloList();
  $("#listTitle").textContent = "Coordination opportunities";
  $("#cnt").textContent = `${VIEW.length} flagged`;
  const L = $("#list");
  if (!VIEW.length) { L.innerHTML = `<div class="empty">No pairs match. Most planned projects don't overlap, so try a wider threshold, a build-window buffer, or turn tiers back on.</div>`; return; }
  L.innerHTML = VIEW.slice(0, 60).map((x, i) => `<div class="pair${state.sel === x ? " sel" : ""}" tabindex="0" data-i="${i}" style="--c:${tcol(Math.min(x.tier, 4))}">
    <div class="rank">${i + 1}</div>
    <div class="pn"><div class="tierline"><span class="tchip">${TIERS[x.tier].short}</span><span class="kmv">${km(x.km)}</span>${x.sameWindow ? `<span class="chip time">${x.ov > 0 ? Math.round(x.ov) + " mo same window" : "within buffer"}</span>` : `<span class="chip">${Math.round(x.gap)} mo apart</span>`}${x.sav.total ? `<span class="chip save">~${money(x.sav.total)}</span>` : ""}</div>
      ${pn(x.p, "a")}<br>${pn(x.q, "b")}</div></div>`).join("") + (VIEW.length > 60 ? `<div class="empty">Showing the top 60 of ${VIEW.length}.</div>` : "");
  L.querySelectorAll(".pair").forEach(el => {
    const x = VIEW[+el.dataset.i];
    el.onclick = () => select(x);
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(x); } };
    el.onmouseenter = () => { state.hover = x; renderMap(); };
    el.onmouseleave = () => { state.hover = null; renderMap(); };
  });
}
function projBlock(p, cost) {
  return `<div class="proj" style="--c:${uColor(p.utility)}"><span class="t">${esc(p.name)}</span>
    <span class="m">${esc(lbl(p.utility))}${p.owner && p.owner !== p.utility ? " (" + esc(p.owner) + ")" : ""} · ${p.kv} kV ${TYPE[p.type] || ""}${p.miles ? " · " + (p.miles * 1.609).toFixed(1) + " km" : ""} · ${cost.est ? "est. " : ""}${money(cost.v)}${cost.note ? " (" + cost.note + ")" : ""}</span>
    <span class="m">${p.start_published ? "Published start" : "Est. start"} ${fmtD(p, "start")} → in service ${fmtD(p, "in_service")}</span>
    ${p.desc ? `<span>${esc(p.desc)}</span>` : ""}
    ${p.source ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">Source${p.page ? ", " + esc(String(p.page).startsWith("item") ? p.page : "p. " + p.page) : ""}</a>` : ""}</div>`;
}
function advice(x) {
  const out = [`<b>${TIERS[x.tier].label} (${km(x.km)} at the closest points).</b> ${TIERS[x.tier].means}.`];
  if (x.ov > 0) out.push(`Build windows overlap by about ${Math.round(x.ov)} months, so a joint crew and equipment plan can be set before mobilization.`);
  else if (x.sameWindow) out.push(`Build windows are ${Math.round(x.gap)} months apart, inside the buffer you set.`);
  else {
    const later = mon(x.p.start) > mon(x.q.start) ? x.p : x.q;
    out.push(`Build windows are about ${Math.round(x.gap)} months apart. Pulling ${esc(later.name)} forward by ${Math.ceil(x.gap)} months would put both in one window.`);
  }
  if (x.res.length) out.push(`Also shareable: ${x.res.map(esc).join(", ")}.`);
  if (x.p.loc === "low" || x.q.loc === "low") out.push("At least one location is approximate, so confirm the distance with the utilities.");
  return out;
}
function renderDetail() {
  const x = state.sel, el = $("#detail");
  if (!x) { el.innerHTML = ""; return; }
  if (x.solo) {
    el.innerHTML = `<div class="detail"><div class="dh"><h3>Project</h3><span class="row"><button type="button" class="btn" id="clr">Close</button></span></div>${projBlock(x.p, Engine.estCost(x.p))}
      <p class="note">Pick a second utility under Compare to find projects near this one.</p></div>`;
    $("#clr").onclick = () => select(null);
    return;
  }
  const s = x.sav;
  const imp = s.items.length
    ? `<table class="imp"><tbody>${s.items.map(i => `<tr><td>${esc(i.k)}<small>${esc(i.how)}</small></td><td>${money(i.v)}</td></tr>`).join("")}<tr class="tot"><td>Rough savings if coordinated</td><td>${money(s.total)}</td></tr></tbody></table>`
    : `<p class="note">No savings estimate yet: the build windows don't overlap, so crews and yards wouldn't be shared. Aligning the schedules would unlock the crew-sharing estimate.</p>`;
  const key = x.p.id + "|" + x.q.id;
  if (!state.wi || state.wi.key !== key) state.wi = { key, who: "q", shift: 0 };
  el.innerHTML = `<div class="detail"><div class="dh"><h3>Why this pair</h3><span class="row"><button type="button" class="btn primary" id="v3d">View in 3D</button><button type="button" class="btn" id="brf">Coordination brief</button><button type="button" class="btn" id="clr" aria-label="Close details">Close</button></span></div>${projBlock(x.p, s.ca)}${projBlock(x.q, s.cb)}
    <div class="advice" style="--c:${tcol(Math.min(x.tier, 4))}"><ul>${advice(x).map(a => `<li>${a}</li>`).join("")}</ul></div>
    <div id="sharesBox"></div>
    <div class="whatif"><div class="dh"><h3>What if a schedule moved?</h3><span class="seg" role="group" aria-label="Project to move">
      <button type="button" data-w="q" aria-pressed="${state.wi.who === "q"}">Move ${esc(short(x.q))}</button><button type="button" data-w="p" aria-pressed="${state.wi.who === "p"}">Move ${esc(short(x.p))}</button></span></div>
      <div class="wi-ctl"><input type="range" id="wiShift" min="-36" max="36" step="1" value="${state.wi.shift}" aria-label="Months to move the project"><output id="wiOut"></output></div>
      <svg id="wiChart" role="img" aria-label="Both build windows after the shift"></svg>
      <p class="wi-res" id="wiRes" aria-live="polite"></p>
      <div class="row"><button type="button" class="btn" id="wiRec"></button><button type="button" class="btn" id="wiReset">Reset to plan</button></div></div>
    <div><h3>Cost and impact estimate</h3><div id="impBox">${imp}</div></div></div>`;
  $("#clr").onclick = () => select(null);
  $("#v3d").onclick = () => open3d(x);
  $("#brf").onclick = () => openBrief(x);
  el.querySelectorAll(".whatif [data-w]").forEach(b => b.onclick = () => {
    state.wi.who = b.dataset.w; state.wi.shift = 0; $("#wiShift").value = 0;
    el.querySelectorAll(".whatif [data-w]").forEach(o => o.setAttribute("aria-pressed", o === b));
    updateWhatIf(x);
  });
  $("#wiShift").oninput = e => { state.wi.shift = +e.target.value; updateWhatIf(x); };
  $("#wiReset").onclick = () => { state.wi.shift = 0; $("#wiShift").value = 0; updateWhatIf(x); };
  updateWhatIf(x);
}

// ---------- what-if schedule shift ----------
const short = p => (lbl(p.utility).split(" (")[0].split(" ")[0]) + " project";
const shiftISO = (iso, m) => { const d = new Date(iso + "T00:00:00Z"), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m); d.setUTCDate(Math.min(day, 28)); return d.toISOString().slice(0, 10); };
// The pair recomputed with one project's whole build window moved by m months.
function whatIf(x, who, m) {
  if (!m) return x;
  const moved = Object.assign({}, x[who], { start: shiftISO(x[who].start, m), in_service: shiftISO(x[who].in_service, m) });
  const p = who === "p" ? moved : x.p, q = who === "q" ? moved : x.q, ov = Engine.windowOverlap(p, q);
  const y = Object.assign({}, x, { p, q, ov: Math.max(0, ov), gap: Math.max(0, -ov), sameWindow: -ov <= state.B });
  y.sav = Engine.savings(y);
  return y;
}
// Smallest move that gives the two builds a real shared window: 6 months, or all of the shorter build.
function recommendShift(x, who) {
  const dur = p => mon(p.in_service) - mon(p.start), need = Math.min(6, dur(x.p), dur(x.q));
  if (Engine.windowOverlap(x.p, x.q) >= need) return 0;
  for (let a = 1; a <= 60; a++) for (const m of [-a, a]) if (Engine.windowOverlap(whatIf(x, who, m).p, whatIf(x, who, m).q) >= need) return m;
  return null;
}
const moLabel = m => m === 0 ? "as planned" : `${Math.abs(m)} month${Math.abs(m) === 1 ? "" : "s"} ${m < 0 ? "earlier" : "later"}`;
function updateWhatIf(x) {
  const { who, shift } = state.wi, y = whatIf(x, who, shift), rec = recommendShift(x, who);
  $("#wiOut").textContent = moLabel(shift);
  // chart: both build windows, the moved one with a ghost of where it was
  const svg = d3.select("#wiChart"), W = 460, H = 74, LW = 70; svg.selectAll("*").remove();
  const all = [x.p, x.q, y.p, y.q], lo = Math.floor(d3.min(all, p => mon(p.start)) / 12) * 12, hi = Math.ceil(d3.max(all, p => mon(p.in_service)) / 12) * 12;
  const X = d3.scaleLinear().domain([lo, hi]).range([LW, W - 8]);
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  for (let m = lo; m <= hi; m += 12) {
    svg.append("line").attr("x1", X(m)).attr("x2", X(m)).attr("y1", 12).attr("y2", H).attr("stroke", css("--grid"));
    if (m < hi && (hi - lo) / 12 <= 12) svg.append("text").attr("x", X(m) + 3).attr("y", 9).attr("font-size", 9).attr("fill", css("--ink3")).attr("font-family", css("--mono")).text(m / 12);
  }
  const a = Math.max(mon(y.p.start), mon(y.q.start)), b = Math.min(mon(y.p.in_service), mon(y.q.in_service));
  if (b > a) svg.append("rect").attr("x", X(a)).attr("width", X(b) - X(a)).attr("y", 14).attr("height", H - 14).attr("fill", css("--time")).attr("fill-opacity", .16);
  [["p", 22], ["q", 50]].forEach(([k, yy]) => {
    const o = x[k], n = y[k], c = uColor(o.utility);
    svg.append("text").attr("x", LW - 8).attr("y", yy + 10).attr("text-anchor", "end").attr("font-size", 11).attr("fill", c).attr("font-weight", 600).text(short(o).split(" ")[0]);
    if (n !== o) svg.append("rect").attr("x", X(mon(o.start))).attr("width", Math.max(2, X(mon(o.in_service)) - X(mon(o.start)))).attr("y", yy).attr("height", 14).attr("rx", 3)
      .attr("fill", "none").attr("stroke", c).attr("stroke-dasharray", "3 3").attr("opacity", .6);
    svg.append("rect").attr("x", X(mon(n.start))).attr("width", Math.max(2, X(mon(n.in_service)) - X(mon(n.start)))).attr("y", yy).attr("height", 14).attr("rx", 3).attr("fill", c).attr("fill-opacity", .85);
  });
  $("#sharesBox").innerHTML = sharesHTML(y);
  const d = y.sav.total - x.sav.total;
  $("#wiRes").innerHTML = (y.ov > 0 ? `Build windows overlap <b>${Math.round(y.ov)} months</b>.` : `Build windows are <b>${Math.round(y.gap)} months apart</b>.`) +
    ` Rough savings <b>${(y.sav.total ? money(y.sav.total) : "$0")}</b>` + (shift ? (d ? ` (<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${money(Math.abs(d))}</span> vs. as planned).` : " (no change from as planned).") : ".");
  const recBtn = $("#wiRec");
  // The plan already shares a window when rec is 0; then Reset is the only way back, so no suggestion button.
  recBtn.hidden = rec == null || rec === 0 || rec === shift;
  if (rec) { recBtn.textContent = `Try ${moLabel(rec)}`; recBtn.onclick = () => { state.wi.shift = rec; $("#wiShift").value = rec; updateWhatIf(x); }; }
  $("#wiReset").hidden = !shift;
  const s = y.sav;
  $("#impBox").innerHTML = s.items.length
    ? `<table class="imp"><tbody>${s.items.map(i => `<tr><td>${esc(i.k)}<small>${esc(i.how)}</small></td><td>${money(i.v)}</td></tr>`).join("")}<tr class="tot"><td>Rough savings if coordinated${shift ? " (with the move)" : ""}</td><td>${money(s.total)}</td></tr></tbody></table>`
    : `<p class="note">No savings estimate yet: the build windows don't overlap, so crews and yards wouldn't be shared. Aligning the schedules would unlock the crew-sharing estimate.</p>`;
}

// What the pair can share, tier by tier, in the challenge's wording. Crew and yard sharing needs a shared build window.
function sharesHTML(x) {
  return `<div class="shares"><h3>What they can share</h3>${Engine.shareable(x).map(g => `<div class="sg${g.active ? "" : " off"}" style="--c:${tcol(g.tier)}">
    <span class="sl">${esc(g.label)}</span><span class="chips">${g.items.map(i => `<span class="chip">${esc(i)}</span>`).join("")}</span>
    ${g.active ? "" : `<em>only if both are built at the same time</em>`}</div>`).join("")}
    ${x.res.length ? `<p class="note">Also in common: ${x.res.map(esc).join(", ")}.</p>` : ""}</div>`;
}

// ---------- coordination brief ----------
// A one-page memo for one pair, addressed to both utilities' planners. Printable, or copy as plain text.
function openBrief(x0) {
  // Use the what-if move only when it improves on the plan (more shared months or more savings); otherwise brief the plan as published.
  const y = whatIf(x0, state.wi.who, state.wi.shift), better = state.wi.shift && (y.ov > x0.ov || y.sav.total > x0.sav.total);
  const x = better ? y : x0, moved = better ? x[state.wi.who] : null, s = x.sav, T = TIERS[x.tier];
  const uA = lbl(x.p.utility), uB = lbl(x.q.utility), today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const when = x.ov > 0 ? `Their build windows overlap by about ${Math.round(x.ov)} months${moved ? `, if ${esc(moved.name)} moves ${moLabel(state.wi.shift)}` : ""}.`
    : `Their build windows are about ${Math.round(x.gap)} months apart.` + (() => { const r = recommendShift(x0, "q"); return r ? ` Moving ${esc(x0.q.name)} ${moLabel(r)} would give them a shared window.` : ""; })();
  const steps = [
    "Confirm both project locations and the closest-point distance with each utility's GIS team.",
    x.tier === 0 && "Agree one outage window and crossing-structure design for where the projects meet.",
    x.tier <= 1 && "Scope a shared right-of-way and access road, and file one joint permit package.",
    x.tier <= 2 && "Site one laydown yard between the projects for material deliveries.",
    "Compare contractor and crew plans; share mobilization where the windows overlap.",
    "Name one coordinator at each utility and set a monthly check-in until both are in service.",
  ].filter(Boolean);
  const row = (p, c) => `<tr><td><b>${esc(p.name)}</b><br><span>${esc(lbl(p.utility))}</span></td><td>${p.kv} kV ${esc(TYPE[p.type] || "")}</td><td>${fmtD(p, "start")} to ${fmtD(p, "in_service")}${p === moved ? "<br><em>proposed</em>" : ""}</td><td>${c.est ? "est. " : ""}${money(c.v)}</td></tr>`;
  $("#briefDoc").innerHTML = `
    <header class="b-head"><div class="b-brand">SEAMLINE <span>Coordination brief</span></div><div class="b-date">${today}</div></header>
    <dl class="b-memo"><dt>To</dt><dd>${esc(uA)} transmission planning<br>${esc(uB)} transmission planning</dd>
      <dt>Re</dt><dd>Coordinating ${esc(x.p.name)} and ${esc(x.q.name)}</dd></dl>
    <p class="b-lede">These two planned projects come within <b>${km(x.km)}</b> of each other at their closest points (<b>${esc(T.label.toLowerCase())}</b>). ${esc(T.means)}. ${when} Coordinating them could save roughly <b>${(s.total ? money(s.total) : "$0")}</b>.</p>
    <div class="b-grid"><div>${briefMap(x)}</div>
      <div class="b-kpis"><div><b>${km(x.km)}</b><span>apart at the closest points</span></div><div><b>${x.ov > 0 ? Math.round(x.ov) + " mo" : Math.round(x.gap) + " mo gap"}</b><span>${x.ov > 0 ? "of shared build window" : "between build windows"}</span></div><div><b>${(s.total ? money(s.total) : "$0")}</b><span>rough savings</span></div></div></div>
    <h4>The projects</h4>
    <table class="b-tab"><thead><tr><th>Project</th><th>Type</th><th>Build window</th><th>Cost</th></tr></thead><tbody>${row(x.p, s.ca)}${row(x.q, s.cb)}</tbody></table>
    <h4>What they can share</h4>
    <ul>${Engine.shareable(x).map(g => `<li><b>${esc(g.label)}:</b> ${esc(g.items.join(", ").toLowerCase().replace(/^./, c => c.toUpperCase()))}${g.active ? "" : " (only if both are built at the same time)"}</li>`).join("")}
      ${x.res.length ? `<li><b>Also in common:</b> ${x.res.map(esc).join(", ")}</li>` : ""}</ul>
    ${s.items.length ? `<h4>Savings estimate</h4><table class="b-tab"><tbody>${s.items.map(i => `<tr><td>${esc(i.k)}<br><span>${esc(i.how)}</span></td><td class="n">${money(i.v)}</td></tr>`).join("")}<tr class="tot"><td>Total</td><td class="n">${money(s.total)}</td></tr></tbody></table>` : ""}
    <h4>Proposed next steps</h4><ol>${steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
    <p class="b-foot">Prepared with Seamline from public plans (SCRTP and SERTP). Locations are placed by hand from substation names${x.p.loc === "low" || x.q.loc === "low" ? ", and at least one of these is approximate" : ""}; costs are planning-level estimates unless the plan lists one. Confirm with both utilities before acting.</p>`;
  $("#brief").hidden = false;
  $("#briefClose").focus();
}
// Small locator map for the brief: GA and SC outlines, the seam, both projects and the closest-point link.
function briefMap(x) {
  const W = 300, H = 210, feat = p => p.coords.length > 1 ? { type: "LineString", coordinates: p.coords.map(c => [c[1], c[0]]) } : { type: "Point", coordinates: [p.coords[0][1], p.coords[0][0]] };
  const box = { type: "FeatureCollection", features: [x.p, x.q].map(p => ({ type: "Feature", geometry: feat(p) })) };
  const pr = d3.geoMercator().fitExtent([[40, 40], [W - 40, H - 40]], box);
  if (pr.scale() > 60000) pr.scale(60000).translate(pr.translate());
  const path = d3.geoPath(pr).pointRadius(5), P = c => pr([c[1], c[0]]);
  const st = BASE.states.filter(v => v.n === "Georgia" || v.n === "South Carolina").map(v => `<path d="${path(v.g)}" fill="#EEF1EF" stroke="#B9C3C1" stroke-width=".8"/>`).join("");
  const sc = seamCoords(), seam = sc ? `<path d="${path({ type: "LineString", coordinates: sc })}" fill="none" stroke="#9A6B2F" stroke-width="1.4" stroke-dasharray="4 3"/>` : "";
  const proj1 = (p, c) => p.coords.length > 1 ? `<path d="${path(feat(p))}" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>` : `<circle cx="${P(p.coords[0])[0]}" cy="${P(p.coords[0])[1]}" r="5.5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
  const [a, b] = [P(x.ca), P(x.cb)];
  return `<svg class="b-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Locator map"><rect width="${W}" height="${H}" fill="#DCE6EA"/>${st}${seam}${proj1(x.p, "#0E6F8C")}${proj1(x.q, "#B4560F")}
    <line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#B0183D" stroke-width="2" stroke-dasharray="3 2"/><circle cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" r="7" fill="none" stroke="#B0183D" stroke-width="1.5"/>
    <text x="10" y="${H - 10}" font-size="10" fill="#4A5B62">${esc(km(x.km))} at the closest points</text></svg>`;
}
function closeBrief() { $("#brief").hidden = true; }
function open3d(x) {
  Scene3D.open(x, {
    title: `${x.p.name} and ${x.q.name}`,
    subtitle: `${TIERS[x.tier].label}: ${km(x.km)} at the closest points. ${TIERS[x.tier].means}.${x.sav.total ? " Rough savings " + money(x.sav.total) + "." : ""}`,
    colorA: uColor(x.p.utility), colorB: uColor(x.q.utility), tierColor: tcol(Math.min(x.tier, 4)),
    nameA: `${lbl(x.p.utility).split(" (")[0]}: ${x.p.name.split(":")[0]}`, nameB: `${lbl(x.q.utility).split(" (")[0]}: ${x.q.name.split(":")[0]}`,
    distText: `${km(x.km)} apart · ${TIERS[x.tier].short}`,
  });
}

// ---------- timeline ----------
let TLX = null;
function moveCursor() {
  const svg = d3.select("#tl"); svg.select("#tcur").remove();
  if (state.t == null || !TLX) return;
  const X = TLX.x(Math.min(TLX.x.domain()[1], Math.max(TLX.x.domain()[0], state.t)));
  const c = svg.append("g").attr("id", "tcur").style("pointer-events", "none");
  c.append("line").attr("x1", X).attr("x2", X).attr("y1", TLX.top - 10).attr("y2", TLX.H).attr("stroke", css("--seam")).attr("stroke-width", 2);
  c.append("circle").attr("cx", X).attr("cy", TLX.top - 10).attr("r", 4).attr("fill", css("--seam"));
}
function renderTimeline() {
  const ids = new Set(solo() ? SOLO.slice(0, 60).map(p => p.id) : VIEW.slice(0, 60).flatMap(x => [x.p.id, x.q.id]));
  const rows = PROJECTS.filter(p => ids.has(p.id)).sort((a, b) => (a.utility === state.utilA ? 0 : 1) - (b.utility === state.utilA ? 0 : 1) || mon(a.start) - mon(b.start));
  const svg = d3.select("#tl"); svg.selectAll("*").remove();
  const W = 1340, LW = 300, RH = 16, top = 26, H = Math.max(80, top + rows.length * RH + 10);
  svg.attr("viewBox", `0 0 ${W} ${H}`).style("min-width", "820px");
  if (!rows.length) { TLX = null; svg.append("text").attr("x", 16).attr("y", 40).attr("fill", css("--ink2")).text("No flagged projects."); return; }
  const lo = Math.floor(d3.min(rows, p => mon(p.start)) / 12) * 12, hi = Math.ceil(d3.max(rows, p => mon(p.in_service)) / 12) * 12;
  const x = d3.scaleLinear().domain([lo, hi]).range([LW, W - 16]);
  TLX = { x, top, H };
  for (let m = lo; m <= hi; m += 12) {
    svg.append("line").attr("x1", x(m)).attr("x2", x(m)).attr("y1", top - 6).attr("y2", H).attr("stroke", css("--grid"));
    if (m < hi) svg.append("text").attr("x", x(m) + 4).attr("y", 14).attr("font-size", 11).attr("fill", css("--ink2")).attr("font-family", css("--mono")).text(m / 12);
  }
  const sel = state.sel;
  if (sel && sel.ov > 0) {
    const a = Math.max(mon(sel.p.start), mon(sel.q.start)), b = Math.min(mon(sel.p.in_service), mon(sel.q.in_service));
    svg.append("rect").attr("x", x(a)).attr("width", x(b) - x(a)).attr("y", top - 6).attr("height", H - top + 6).attr("fill", css("--hotsoft"));
  }
  const g = svg.selectAll("g.r").data(rows).join("g").attr("transform", (d, i) => `translate(0,${top + i * RH})`).style("cursor", "pointer")
    .attr("opacity", d => sel ? (sel.p === d || sel.q === d ? 1 : .3) : 1)
    .on("click", (ev, d) => { if (solo()) return select({ p: d, solo: true }); const pr = VIEW.find(x => x.p === d || x.q === d); if (pr) select(pr); })
    .on("mousemove", (ev, d) => showTip(ev, d)).on("mouseleave", hideTip);
  g.append("text").attr("x", LW - 8).attr("y", 11).attr("text-anchor", "end").attr("font-size", 11).attr("fill", d => uColor(d.utility))
    .text(d => d.name.length > 44 ? d.name.slice(0, 43) + "…" : d.name);
  g.append("rect").attr("x", d => x(mon(d.start))).attr("width", d => Math.max(3, x(mon(d.in_service)) - x(mon(d.start)))).attr("y", 3).attr("height", RH - 6).attr("rx", 2)
    .attr("fill", d => uColor(d.utility)).attr("fill-opacity", .35);
  g.append("rect").attr("x", d => x(mon(d.in_service)) - 3).attr("width", 3).attr("y", 2).attr("height", RH - 4).attr("fill", d => uColor(d.utility));
  moveCursor();
}

// ---------- utilities, legend, datasets ----------
function renderPickers() {
  const us = utilities();
  if (!us.includes(state.utilA)) state.utilA = us[0];
  if (!solo() && (!us.includes(state.utilB) || state.utilB === state.utilA)) state.utilB = us.find(u => u !== state.utilA) || NONE;
  const opts = (cur, skip) => us.filter(u => u !== skip).map(u => `<option value="${esc(u)}"${u === cur ? " selected" : ""}>${esc(lbl(u))} (${PROJECTS.filter(p => p.utility === u).length})</option>`).join("");
  $("#utilA").innerHTML = opts(state.utilA);
  $("#utilB").innerHTML = `<option value="${NONE}"${solo() ? " selected" : ""}>None (just show projects)</option>` + opts(state.utilB, state.utilA);
  // Distance and window controls only matter when comparing two utilities.
  document.querySelector(".controls").classList.toggle("off", solo());
  for (const el of document.querySelectorAll(".controls input, .controls button")) el.disabled = solo();
}
function legend() {
  $("#legend").innerHTML = (solo() ? [state.utilA] : [state.utilA, state.utilB]).map(u => `<span><i class="sw" style="background:${uColor(u)}"></i>${esc(lbl(u))}</span>`).join("") +
    `<span><i class="sw" style="background:${css("--ink3")};opacity:.6"></i>existing asset</span><span><i class="sw dash"></i>approximate location</span>`;
}
function renderDatasets() {
  $("#datasets").innerHTML = DATASETS.map(d => `<li><span><b>${esc(d.name)}</b> <span class="note">${d.count} ${d.backdrop ? "existing lines and facilities (background)" : "projects"}${d.utils ? " · " + esc(d.utils.join(", ")) : ""}</span></span>${d.builtin ? "" : `<button type="button" class="btn" data-rm="${esc(d.id)}">Remove</button>`}</li>`).join("");
  $("#datasets").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const id = b.dataset.rm;
    PROJECTS = PROJECTS.filter(p => p.dataset !== id);
    for (let i = EXIST.length - 1; i >= 0; i--) if (EXIST[i].dataset === id) EXIST.splice(i, 1);
    DATASETS.splice(DATASETS.findIndex(d => d.id === id), 1);
    renderDatasets(); rebuild();
  });
}

// ---------- import ----------
// Adds one parsed file. input is { text } | { rows } | { geojson } from Formats.read, or { error }.
function importParsed(input, filename) {
  const id = "ds-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  // Without a utility column or a typed name, fall back to the file name so the rows still load.
  const fromName = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const backdrop = $("#impExisting").checked;
  const defaults = { utility: $("#impUtil").value.trim() || fromName, source: $("#impSrc").value.trim(), in_service: $("#impIsd").value.trim() || (backdrop ? "2000" : ""), start: $("#impStart").value.trim(), batch: id, existing: backdrop };
  try {
    if (input.error) throw new Error(input.error);
    const res = input.rows ? Ingest.parseRows(input.rows, defaults)
      : input.geojson ? Ingest.parseGeoJSON(input.geojson, defaults)
      : Ingest.parsePlan(input.text, filename, defaults);
    if (!res.projects.length) throw new Error(res.errors[0] || "no rows found");
    res.projects.forEach(p => p.dataset = id);
    if (backdrop) {
      // existing lines and substations: drawn under the plans for context, never paired or ranked
      res.projects.forEach(p => { p.existing = p.backdrop = true; p.dsName = filename; EXIST.push(p); });
      DATASETS.push({ id, name: filename, count: res.projects.length, backdrop: true });
      state.exist = true; $("#exOn").checked = true;
      renderDatasets(); drawMap(); refresh();
      return `<p class="ok">Loaded ${res.projects.length} existing lines and facilities from ${esc(filename)} as a background layer.</p>`;
    }
    PROJECTS = PROJECTS.concat(res.projects);
    const utils = [...new Set(res.projects.map(p => p.utility))];
    DATASETS.push({ id, name: filename, count: res.projects.length, utils });
    // Compare the new utility against whichever current utility is nearest to its projects.
    state.utilB = utils[0];
    // Nearest pair wins; more flagged pairs breaks a tie (several utilities can touch the new plan).
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

// ---------- wiring ----------
function select(x) { if (!x || !state.wi || state.wi.key !== (x.p && x.q ? x.p.id + "|" + x.q.id : "")) state.wi = null; state.sel = x; renderMap(); renderList(); renderDetail(); renderTimeline(); }
function refresh() {
  $("#distv").textContent = `${state.D} km (${Math.round(state.D / 1.609)} mi)`;
  $("#bufv").textContent = `±${state.B} mo`;
  compute();
  if (state.sel) state.sel = state.sel.solo ? (SOLO.includes(state.sel.p) ? state.sel : null) : VIEW.find(x => x.p === state.sel.p && x.q === state.sel.q) || null;
  renderStats(); renderTiers(); renderMap(); renderList(); renderDetail(); renderTimeline();
}
function rebuild() { state.sel = null; renderPickers(); compute(); drawMap(); legend(); setupScrub(); refresh(); }

$("#utilA").onchange = e => { state.utilA = e.target.value; if (state.utilB === state.utilA) state.utilB = utilities().find(u => u !== state.utilA) || NONE; rebuild(); };
$("#utilB").onchange = e => { state.utilB = e.target.value; rebuild(); };
$("#dist").oninput = e => { state.D = +e.target.value; refresh(); };
$("#buf").oninput = e => { state.B = +e.target.value; refresh(); };
$("#q").oninput = e => { state.q = e.target.value; refresh(); };
for (const m of ["near", "both", "time"]) $("#m-" + m).onclick = () => {
  state.mode = m; for (const k of ["near", "both", "time"]) $("#m-" + k).setAttribute("aria-pressed", k === m); refresh();
};
for (const v of ["focus", "all"]) $("#v-" + v).onclick = () => {
  state.view = v; for (const k of ["focus", "all"]) $("#v-" + k).setAttribute("aria-pressed", k === v); drawMap(); refresh();
};
$("#basemap").innerHTML = Object.entries(BASEMAPS).map(([k, b]) => `<option value="${k}">${b.label}</option>`).join("");
$("#basemap").onchange = e => { state.basemap = e.target.value; try { localStorage.setItem("seamline.basemap", state.basemap); } catch (err) { /* storage blocked: keep the choice for this visit only */ } drawMap(); refresh(); };
try { const b = localStorage.getItem("seamline.basemap"); if (BASEMAPS[b]) { state.basemap = b; $("#basemap").value = b; } } catch (err) { /* storage blocked: use the default map */ }
$("#exOn").onchange = e => { state.exist = e.target.checked; d3.select("#existing").style("display", state.exist ? null : "none"); d3.selectAll("#toplabels text.ex").style("display", state.exist ? null : "none"); };
$("#play").onclick = togglePlay;
$("#tslider").oninput = e => { if (playTimer) stopPlay(); setT(+e.target.value); };
$("#tall").onclick = () => { stopPlay(); setT(null); };
$("#briefClose").onclick = closeBrief;
$("#briefPrint").onclick = () => print();
$("#briefCopy").onclick = () => navigator.clipboard.writeText($("#briefDoc").innerText).then(() => { $("#briefCopy").textContent = "Copied"; setTimeout(() => $("#briefCopy").textContent = "Copy text", 1500); }, () => getSelection().selectAllChildren($("#briefDoc")));
$("#brief").addEventListener("click", e => { if (e.target.id === "brief") closeBrief(); });
// 3D labels on or off, remembered between visits
const setLabels3d = on => {
  $("#m3dStage").classList.toggle("nolabels", !on);
  $("#m3dLabels").setAttribute("aria-pressed", on); $("#m3dLabels").textContent = on ? "Labels on" : "Labels off";
  try { localStorage.setItem("seamline.3dlabels", on ? "on" : "off"); } catch (err) { /* storage blocked: keep the choice for this visit only */ }
};
$("#m3dLabels").onclick = () => setLabels3d($("#m3dLabels").getAttribute("aria-pressed") !== "true");
try { if (localStorage.getItem("seamline.3dlabels") === "off") setLabels3d(false); } catch (err) { /* storage blocked: labels stay on */ }
$("#m3dClose").onclick = () => Scene3D.close();
$("#m3d").addEventListener("click", e => { if (e.target.id === "m3d") Scene3D.close(); });
addEventListener("keydown", e => { if (e.key !== "Escape") return; if (!$("#brief").hidden) closeBrief(); else if (!$("#m3d").hidden) Scene3D.close(); });
$("#zin").onclick = () => d3.select("#map").transition().duration(250).call(zoomBehavior.scaleBy, 1.6);
$("#zout").onclick = () => d3.select("#map").transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.6);
$("#zreset").onclick = () => d3.select("#map").transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity);
$("#openImport").onclick = () => { const s = $("#import"); s.hidden = !s.hidden; $("#openImport").setAttribute("aria-expanded", !s.hidden); if (!s.hidden) $("#impUtil").focus(); };
$("#tpl").textContent = Ingest.TEMPLATE;
$("#copyTpl").onclick = () => navigator.clipboard.writeText(Ingest.TEMPLATE).then(() => $("#impReport").innerHTML = `<p class="ok">Template copied.</p>`, () => { getSelection().selectAllChildren($("#tpl")); });
$("#pasteHelp").onclick = () => { $("#paste").hidden = $("#loadPaste").hidden = false; $("#paste").focus(); };
$("#loadPaste").onclick = () => { const t = $("#paste").value.trim(); if (t) $("#impReport").innerHTML = importParsed({ text: t }, "pasted rows.csv"); };
$("#file").accept = Formats.ACCEPT;
$("#file").onchange = e => { importFiles([...e.target.files]); e.target.value = ""; };
const drop = $("#drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => importFiles([...e.dataTransfer.files]));
$("#copy").onclick = () => {
  if (solo()) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["utility,name,kv,type,start,in_service,cost,lat,lon"].concat(SOLO.map(p => [q(p.utility), q(p.name), p.kv, p.type, p.start, p.in_service, p.cost ?? "", p.coords[0][0], p.coords[0][1]].join(","))).join("\n");
    navigator.clipboard.writeText(csv).then(() => $("#msg").textContent = `Copied ${SOLO.length} projects as CSV.`, () => $("#msg").textContent = "The browser blocked copying.");
    return;
  }
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const hdr = "rank,tier,distance_km,same_window,overlap_months,gap_months,utility_a,project_a,in_service_a,utility_b,project_b,in_service_b,est_savings_usd,shared_resources";
  const csv = [hdr].concat(VIEW.map((x, i) => [i + 1, q(TIERS[x.tier].label), x.km.toFixed(2), x.sameWindow, Math.round(x.ov), Math.round(x.gap), q(x.p.utility), q(x.p.name), x.p.in_service, q(x.q.utility), q(x.q.name), x.q.in_service, Math.round(x.sav.total), q(x.res.join("; "))].join(","))).join("\n");
  navigator.clipboard.writeText(csv).then(() => $("#msg").textContent = `Copied ${VIEW.length} pairs as CSV.`, () => $("#msg").textContent = "The browser blocked copying.");
};
const redraw = () => { drawMap(); legend(); refresh(); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
renderDatasets();
rebuild();
