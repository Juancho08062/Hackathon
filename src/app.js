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
const state = { basemap: "plain", utilA: "DESC", utilB: "GPC", D: 40, B: 0, mode: "near", view: "focus", sel: null, hover: null, tiers: new Set([0, 1, 2, 3, 4]), q: "" };

const fmtD = (p, which) => {
  const d = new Date(p[which] + "T00:00:00Z");
  if (which === "in_service" && p.date_precision === "year") return String(d.getUTCFullYear());
  if (which === "in_service" && p.date_precision === "estimated") return "~" + d.getUTCFullYear() + " (est.)";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};
const km = d => d < 0.1 ? "0 km" : d < 10 ? d.toFixed(1) + " km" : Math.round(d) + " km";
const tcol = i => css(TIERS[i].tok);
const utilities = () => [...new Set(PROJECTS.map(p => p.utility))];
const uColor = u => u === state.utilA ? css("--u0") : u === state.utilB ? css("--u1") : css("--ink3");

// ---------- compute ----------
let RESULT = { pairs: [], checked: 0 }, VIEW = [];
function compute() {
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
  else PROJECTS.filter(p => p.utility === state.utilA || p.utility === state.utilB).forEach(p => pts.push(...p.coords));
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
  const places = [["Augusta", 33.47, -81.97], ["Savannah", 32.08, -81.09], ["Atlanta", 33.75, -84.39], ["Columbia", 34.0, -81.03], ["Charleston", 32.78, -79.93], ["Macon", 32.84, -83.63], ["Thomson", 33.47, -82.50], ["Beaufort", 32.43, -80.67], ["Aiken", 33.60, -81.68]];
  const stl = BASE.states.map(s => { const c = d3.geoCentroid({ type: "Feature", geometry: s.g }); return [s.n.toUpperCase(), c[1], c[0], true]; });
  g.selectAll(".lb").data(stl.concat(places)).join("text").attr("x", d => proj([d[2], d[1]])[0]).attr("y", d => proj([d[2], d[1]])[1])
    .attr("text-anchor", "middle").attr("fill", d => d[3] ? css("--ink3") : css("--ink2")).attr("data-fs", d => d[3] ? 14 : 11)
    .attr("letter-spacing", d => d[3] ? ".2em" : 0).attr("font-family", d => d[3] ? css("--display") : null).text(d => d[0]);
  const eg = z.append("g").selectAll("g").data(EXIST.filter(e => e.utility === state.utilA || e.utility === state.utilB)).join("g").style("cursor", "help")
    .on("mousemove", (ev, d) => tip(ev, `<b>${esc(d.name)}</b><br>Existing ${esc(lbl(d.utility))} asset`)).on("mouseleave", hideTip);
  eg.filter(d => d.coords.length > 1).append("path").attr("d", d => d3.line()(d.coords.map(pt))).attr("fill", "none").attr("stroke", css("--ink3")).attr("stroke-width", 2.5).attr("stroke-opacity", .6);
  eg.filter(d => d.coords.length === 1).append("path").attr("class", "dia").attr("data-x", d => pt(d.coords[0])[0]).attr("data-y", d => pt(d.coords[0])[1])
    .attr("fill", css("--panel")).attr("stroke", d => uColor(d.utility)).attr("stroke-width", 1.5);
  eg.filter(d => d.coords.length === 1).append("text").attr("class", "exl").attr("data-x", d => pt(d.coords[0])[0]).attr("data-y", d => pt(d.coords[0])[1])
    .attr("data-fs", 10).attr("fill", css("--ink2")).text(d => d.name.split(" (")[0]);
  z.append("g").attr("id", "links");
  z.append("g").attr("id", "projs");
  svg.append("g").attr("id", "scale").attr("transform", `translate(24,${MH - 30})`);
  zoomBehavior = d3.zoom().scaleExtent([1, 20]).on("zoom", ev => { zoomK = ev.transform.k; z.attr("transform", ev.transform); renderTiles(ev.transform); applyK(); });
  if (raster) z.selectAll("text").attr("fill", bright ? "#fff" : css("--ink")).attr("stroke", bright ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.8)").attr("stroke-width", 3).attr("paint-order", "stroke");
  tileErrors = 0; $("#tileNote").hidden = true;
  $("#attr").textContent = BASEMAPS[state.basemap].attr || "";
  renderTiles(d3.zoomIdentity);
  svg.call(zoomBehavior).on("dblclick.zoom", null);
  zoomK = 1;
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
  const sc = d3.select("#scale"); sc.selectAll("*").remove();
  const c = proj.invert([MW / 2, MH / 2]), a = proj(c), b = proj([c[0] + state.D / (111.32 * Math.cos(c[1] * Math.PI / 180)), c[1]]);
  const w = (b[0] - a[0]) * k;
  sc.append("rect").attr("width", Math.min(w, MW - 60)).attr("height", 4).attr("fill", css("--hot"));
  sc.append("text").attr("y", -6).attr("font-size", 11).attr("fill", css("--ink2")).text(`${state.D} km${w > MW - 60 ? " (wider than view)" : ""}`);
}
function renderMap() {
  const shown = VIEW.slice(0, 60), sel = state.sel, hov = state.hover, pt = c => proj([c[1], c[0]]);
  const flagged = new Set(shown.flatMap(x => [x.p.id, x.q.id]));
  const focus = sel || hov;
  d3.select("#links").selectAll("g").data(shown, d => d.p.id + "|" + d.q.id)
    .join(e => { const g = e.append("g"); g.append("line"); g.append("circle"); return g; })
    .call(g => g.select("line").attr("x1", d => pt(d.ca)[0]).attr("y1", d => pt(d.ca)[1]).attr("x2", d => pt(d.cb)[0]).attr("y2", d => pt(d.cb)[1])
      .attr("stroke", d => tcol(Math.min(d.tier, 4))).attr("stroke-width", d => focus === d ? 3.5 : 1.5).attr("stroke-dasharray", "4 3"))
    .call(g => g.select("circle").attr("cx", d => pt(d.ca)[0]).attr("cy", d => pt(d.ca)[1]).attr("data-r", d => d.tier <= 1 ? (focus === d ? 12 : 8) : 0)
      .attr("fill", "none").attr("stroke", d => tcol(Math.min(d.tier, 4))).attr("stroke-width", 2))
    .attr("opacity", d => focus ? (d === focus ? 1 : .12) : d.sameWindow ? .9 : .45)
    .style("cursor", "pointer").on("click", (ev, d) => select(d));
  const rows = PROJECTS.filter(p => p.utility === state.utilA || p.utility === state.utilB)
    .map(p => ({ p, on: flagged.has(p.id), hi: focus && (focus.p === p || focus.q === p) }));
  const G = d3.select("#projs").selectAll("g.p").data(rows, d => d.p.id)
    .join(e => { const g = e.append("g").attr("class", "p"); g.append("path").attr("class", "casing"); g.append("path").attr("class", "line"); g.append("circle"); return g; });
  // Casing contrasts with the basemap: dark on light maps (streets, terrain), white on satellite.
  const raster = !!BASEMAPS[state.basemap].url, lightMap = state.basemap === "streets" || state.basemap === "terrain";
  const wide = d => (d.p.kv >= 500 ? 4 : d.p.kv >= 230 ? 3 : 2) + (d.hi ? 2 : 0) + (raster ? 1.5 : 0);
  G.select("path.casing").attr("d", d => d.p.coords.length > 1 ? d3.line()(d.p.coords.map(pt)) : null)
    .attr("fill", "none").attr("stroke", lightMap ? "rgba(20,24,28,.85)" : raster ? "rgba(255,255,255,.9)" : css("--panel")).attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
    .attr("stroke-width", d => wide(d) + (raster ? 4 : 3));
  G.attr("opacity", d => focus ? (d.hi ? 1 : .22) : d.on ? 1 : .3).style("cursor", "pointer")
    .on("mousemove", (ev, d) => showTip(ev, d.p)).on("mouseleave", hideTip)
    .on("click", (ev, d) => { const pr = VIEW.find(x => x.p === d.p || x.q === d.p); if (pr) select(pr); });
  G.select("path.line").attr("d", d => d.p.coords.length > 1 ? d3.line()(d.p.coords.map(pt)) : null)
    .attr("fill", "none").attr("stroke", d => uColor(d.p.utility)).attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
    .attr("stroke-width", wide)
    .attr("stroke-dasharray", d => d.p.loc === "low" ? "6 4" : null);
  G.select("circle").attr("cx", d => pt(d.p.coords[0])[0]).attr("cy", d => pt(d.p.coords[0])[1])
    .attr("data-r", d => d.p.coords.length > 1 ? 0 : (d.hi ? 7 : 4.5))
    .attr("fill", d => d.p.loc === "low" ? css("--panel") : uColor(d.p.utility)).attr("stroke", d => raster && d.p.loc !== "low" ? (lightMap ? "rgba(20,24,28,.9)" : "#fff") : uColor(d.p.utility)).attr("stroke-width", 2);
  applyK();
}
function tip(ev, html) { const t = $("#tip"); t.innerHTML = html; t.hidden = false; t.style.left = Math.min(ev.clientX + 12, innerWidth - 290) + "px"; t.style.top = (ev.clientY + 12) + "px"; }
function showTip(ev, p) {
  tip(ev, `<b>${esc(p.name)}</b><br>${esc(lbl(p.utility))} · ${p.kv} kV ${TYPE[p.type] || ""}<br>In service ${fmtD(p, "in_service")}${p.cost ? " · " + money(p.cost) : ""}${p.loc === "low" ? "<br>Approximate location" : ""}${p.imported ? "<br>Imported" : ""}`);
}
function hideTip() { $("#tip").hidden = true; }

// ---------- summary ----------
function renderStats() {
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
function renderList() {
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
  const s = x.sav;
  const imp = s.items.length
    ? `<table class="imp"><tbody>${s.items.map(i => `<tr><td>${esc(i.k)}<small>${esc(i.how)}</small></td><td>${money(i.v)}</td></tr>`).join("")}<tr class="tot"><td>Rough savings if coordinated</td><td>${money(s.total)}</td></tr></tbody></table>`
    : `<p class="note">No savings estimate yet: the build windows don't overlap, so crews and yards wouldn't be shared. Aligning the schedules would unlock the crew-sharing estimate.</p>`;
  el.innerHTML = `<div class="detail"><div class="dh"><h3>Why this pair</h3><button type="button" class="btn" id="clr">Close</button></div>${projBlock(x.p, s.ca)}${projBlock(x.q, s.cb)}
    <div class="advice" style="--c:${tcol(Math.min(x.tier, 4))}"><ul>${advice(x).map(a => `<li>${a}</li>`).join("")}</ul></div>
    <div><h3>Cost and impact estimate</h3>${imp}</div></div>`;
  $("#clr").onclick = () => select(null);
}

// ---------- timeline ----------
function renderTimeline() {
  const ids = new Set(VIEW.slice(0, 60).flatMap(x => [x.p.id, x.q.id]));
  const rows = PROJECTS.filter(p => ids.has(p.id)).sort((a, b) => (a.utility === state.utilA ? 0 : 1) - (b.utility === state.utilA ? 0 : 1) || mon(a.start) - mon(b.start));
  const svg = d3.select("#tl"); svg.selectAll("*").remove();
  const W = 1340, LW = 300, RH = 16, top = 26, H = Math.max(80, top + rows.length * RH + 10);
  svg.attr("viewBox", `0 0 ${W} ${H}`).style("min-width", "820px");
  if (!rows.length) { svg.append("text").attr("x", 16).attr("y", 40).attr("fill", css("--ink2")).text("No flagged projects."); return; }
  const lo = Math.floor(d3.min(rows, p => mon(p.start)) / 12) * 12, hi = Math.ceil(d3.max(rows, p => mon(p.in_service)) / 12) * 12;
  const x = d3.scaleLinear().domain([lo, hi]).range([LW, W - 16]);
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
    .on("click", (ev, d) => { const pr = VIEW.find(x => x.p === d || x.q === d); if (pr) select(pr); })
    .on("mousemove", (ev, d) => showTip(ev, d)).on("mouseleave", hideTip);
  g.append("text").attr("x", LW - 8).attr("y", 11).attr("text-anchor", "end").attr("font-size", 11).attr("fill", d => uColor(d.utility))
    .text(d => d.name.length > 44 ? d.name.slice(0, 43) + "…" : d.name);
  g.append("rect").attr("x", d => x(mon(d.start))).attr("width", d => Math.max(3, x(mon(d.in_service)) - x(mon(d.start)))).attr("y", 3).attr("height", RH - 6).attr("rx", 2)
    .attr("fill", d => uColor(d.utility)).attr("fill-opacity", .35);
  g.append("rect").attr("x", d => x(mon(d.in_service)) - 3).attr("width", 3).attr("y", 2).attr("height", RH - 4).attr("fill", d => uColor(d.utility));
}

// ---------- utilities, legend, datasets ----------
function renderPickers() {
  const us = utilities();
  if (!us.includes(state.utilA)) state.utilA = us[0];
  if (!us.includes(state.utilB) || state.utilB === state.utilA) state.utilB = us.find(u => u !== state.utilA) || state.utilA;
  for (const [id, cur] of [["#utilA", state.utilA], ["#utilB", state.utilB]])
    $(id).innerHTML = us.map(u => `<option value="${esc(u)}"${u === cur ? " selected" : ""}>${esc(lbl(u))} (${PROJECTS.filter(p => p.utility === u).length})</option>`).join("");
}
function legend() {
  $("#legend").innerHTML = [state.utilA, state.utilB].map(u => `<span><i class="sw" style="background:${uColor(u)}"></i>${esc(lbl(u))}</span>`).join("") +
    `<span><i class="sw" style="background:${css("--ink3")};opacity:.6"></i>existing asset</span><span><i class="sw dash"></i>approximate location</span>`;
}
function renderDatasets() {
  $("#datasets").innerHTML = DATASETS.map(d => `<li><span><b>${esc(d.name)}</b> <span class="note">${d.count} projects${d.utils ? " · " + esc(d.utils.join(", ")) : ""}</span></span>${d.builtin ? "" : `<button type="button" class="btn" data-rm="${esc(d.id)}">Remove</button>`}</li>`).join("");
  $("#datasets").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const id = b.dataset.rm;
    PROJECTS = PROJECTS.filter(p => p.dataset !== id);
    DATASETS.splice(DATASETS.findIndex(d => d.id === id), 1);
    renderDatasets(); rebuild();
  });
}

// ---------- import ----------
function importText(text, filename) {
  const report = $("#impReport");
  try {
    const id = "ds-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const res = Ingest.parsePlan(text, filename, { utility: $("#impUtil").value.trim(), source: $("#impSrc").value.trim(), batch: id });
    if (!res.projects.length) throw new Error(res.errors[0] || "no rows found");
    res.projects.forEach(p => p.dataset = id);
    PROJECTS = PROJECTS.concat(res.projects);
    const utils = [...new Set(res.projects.map(p => p.utility))];
    DATASETS.push({ id, name: filename, count: res.projects.length, utils });
    // Compare the new utility against whichever current utility is nearest to its projects.
    state.utilB = utils[0];
    if (state.utilA === state.utilB) state.utilA = utilities().find(u => u !== state.utilB);
    report.innerHTML = `<p class="ok">Loaded ${res.projects.length} of ${res.total} rows from ${esc(filename)} (${esc(utils.join(", "))}). Now comparing with ${esc(lbl(state.utilA))}.</p>` +
      (res.errors.length ? `<p class="warn">Skipped ${res.errors.length}: ${res.errors.slice(0, 4).map(esc).join("; ")}${res.errors.length > 4 ? "…" : ""}</p>` : "");
    renderDatasets(); rebuild();
  } catch (err) {
    report.innerHTML = `<p class="warn">Couldn't load ${esc(filename)}: ${esc(err.message)}. Check it has a project name, a utility, coordinates and an in-service date.</p>`;
  }
}
async function importFiles(files) { for (const f of files) importText(await f.text(), f.name); }

// ---------- wiring ----------
function select(x) { state.sel = x; renderMap(); renderList(); renderDetail(); renderTimeline(); }
function refresh() {
  $("#distv").textContent = `${state.D} km (${Math.round(state.D / 1.609)} mi)`;
  $("#bufv").textContent = `±${state.B} mo`;
  compute();
  if (state.sel) state.sel = VIEW.find(x => x.p === state.sel.p && x.q === state.sel.q) || null;
  renderStats(); renderTiers(); renderMap(); renderList(); renderDetail(); renderTimeline();
}
function rebuild() { state.sel = null; renderPickers(); compute(); drawMap(); legend(); refresh(); }

$("#utilA").onchange = e => { state.utilA = e.target.value; if (state.utilB === state.utilA) state.utilB = utilities().find(u => u !== state.utilA); rebuild(); };
$("#utilB").onchange = e => { state.utilB = e.target.value; if (state.utilA === state.utilB) state.utilA = utilities().find(u => u !== state.utilB); rebuild(); };
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
$("#basemap").onchange = e => { state.basemap = e.target.value; try { localStorage.setItem("seamline.basemap", state.basemap); } catch (err) {} drawMap(); refresh(); };
try { const b = localStorage.getItem("seamline.basemap"); if (BASEMAPS[b]) { state.basemap = b; $("#basemap").value = b; } } catch (err) {}
$("#zin").onclick = () => d3.select("#map").transition().duration(250).call(zoomBehavior.scaleBy, 1.6);
$("#zout").onclick = () => d3.select("#map").transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.6);
$("#zreset").onclick = () => d3.select("#map").transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity);
$("#openImport").onclick = () => { const s = $("#import"); s.hidden = !s.hidden; $("#openImport").setAttribute("aria-expanded", !s.hidden); if (!s.hidden) $("#impUtil").focus(); };
$("#tpl").textContent = Ingest.TEMPLATE;
$("#copyTpl").onclick = () => navigator.clipboard.writeText(Ingest.TEMPLATE).then(() => $("#impReport").innerHTML = `<p class="ok">Template copied.</p>`, () => { getSelection().selectAllChildren($("#tpl")); });
$("#pasteHelp").onclick = () => { $("#paste").hidden = $("#loadPaste").hidden = false; $("#paste").focus(); };
$("#loadPaste").onclick = () => { const t = $("#paste").value.trim(); if (t) importText(t, "pasted rows.csv"); };
$("#file").onchange = e => { importFiles([...e.target.files]); e.target.value = ""; };
const drop = $("#drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => importFiles([...e.dataTransfer.files]));
$("#copy").onclick = () => {
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
