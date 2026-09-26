// Run with: node tests/engine.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const E = require("../src/engine.js");
const I = require("../src/ingest.js");
const projects = require("../data/projects.json").filter(p => !p.existing);
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

const P = (id, utility, coords, start = "2027-01-01", in_service = "2028-01-01", extra = {}) =>
  Object.assign({ id, utility, name: id, kv: 230, type: "new_line", coords, start, in_service }, extra);

t("crossing lines are 0 km apart", () => {
  const [d] = E.closest(P("a", "A", [[33, -82], [33.2, -81.8]]), P("b", "B", [[33.2, -82], [33, -81.8]]));
  assert.strictEqual(d, 0);
});
t("distance uses closest points, not centers", () => {
  // 100 km line passing 5 km from a substation near one end
  const line = P("l", "A", [[33, -82], [33, -80.93]]);
  const sub = P("s", "B", [[33.045, -81.9]]);
  const [d] = E.closest(line, sub);
  assert(d > 4.5 && d < 5.5, d);
});
t("tiers follow the challenge spec", () => {
  assert.deepStrictEqual([0, 1.2, 5, 30, 55].map(E.tierOf), [0, 1, 2, 3, 4]);
});
t("build-window overlap in months", () => {
  const a = P("a", "A", [[0, 0]], "2027-01-01", "2028-01-01"), b = P("b", "B", [[0, 0]], "2027-07-01", "2029-01-01");
  assert(Math.abs(E.windowOverlap(a, b) - 6) < 0.1);
});
t("ranking: tier first, then same window, then distance", () => {
  const r = E.findOverlaps([
    P("a1", "A", [[33, -82]]), P("a2", "A", [[33.5, -82]], "2030-01-01", "2031-01-01"),
    P("b1", "B", [[33.2, -82]]), P("b2", "B", [[33.5, -82.001]]),
  ], { utilA: "A", utilB: "B", maxKm: 40, bufferMonths: 0, mode: "near" }).pairs;
  assert.strictEqual(r[0].tier, 0); // a2-b2 touching, even though not same window
  assert(r[1].sameWindow && !r[2].sameWindow || r[1].km <= r[2].km);
});
t("built-in data: DESC vs Georgia within 40 km", () => {
  const { pairs, checked } = E.findOverlaps(projects, { utilA: "DESC", utilB: "GPC", maxKm: 40, bufferMonths: 0, mode: "near" });
  const n = u => projects.filter(p => p.utility === u).length;
  assert.strictEqual(checked, n("DESC") * n("GPC"));
  assert(n("DESC") >= 60 && n("GPC") >= 150, `${n("DESC")} DESC, ${n("GPC")} GPC`);
  // most of the dataset does not overlap: a small share of pairs is flagged
  assert(pairs.length > 50 && pairs.length < checked * 0.03, `${pairs.length} of ${checked}`);
  assert.strictEqual(pairs[0].tier, 0);
});
t("built-in data: every overlap in the challenge's reference table is flagged", () => {
  const { pairs } = E.findOverlaps(projects, { utilA: "DESC", utilB: "GPC", maxKm: 40, bufferMonths: 0, mode: "near" });
  const rows = fs.readFileSync(path.join(__dirname, "../data/official/reference_overlaps.csv"), "utf8").trim().split("\n").slice(1);
  assert.strictEqual(rows.length, 6);
  for (const row of rows) {
    const [id, mi, , , , a, b] = row.split(",");
    const x = pairs.find(x => (x.p.id === a && x.q.id === b) || (x.p.id === b && x.q.id === a));
    assert(x, `${id} ${a} / ${b} not flagged`);
    // the reference measures centre to centre; closest points can only be as close or closer
    assert(x.km <= +mi * 1.609344 + 0.5, `${id}: ${x.km.toFixed(2)} km vs reference ${mi} mi`);
  }
});
t("built-in data: official projects carry their source and how each end point was placed", () => {
  const irp = projects.filter(p => p.id.startsWith("IRP-"));
  assert(irp.length > 100);
  for (const p of irp) {
    assert(/IRP/.test(p.source) && /TEAMS/.test(p.page), p.id);
    assert(p.located.some(l => l.method !== "not found"), p.id);
    assert(p.start <= p.in_service, p.id);
  }
  const evans = projects.find(p => p.id === "IRP-20793");
  assert.strictEqual(evans.project_start, "2029-06-01");
  assert.strictEqual(evans.in_service, "2033-06-01");
});
t("importer: loose column names, $ costs, year-only dates", () => {
  const csv = 'Owner,Project Name,Voltage,Work Type,ISD,Latitude,Longitude,To_Lat,To_Lon,Estimated Cost\nSantee Cooper,"Pee Dee - Kingsburg 230 kV, rebuild",230,Rebuild,2029,34.2,-79.7,34.0,-79.5,"$12,500,000"';
  const r = I.parsePlan(csv, "plan.csv", {});
  assert.strictEqual(r.projects.length, 1);
  const p = r.projects[0];
  assert.deepStrictEqual([p.utility, p.kv, p.type, p.in_service, p.cost, p.coords.length], ["Santee Cooper", 230, "rebuild", "2029-06-01", 12500000, 2]);
  assert(p.start < p.in_service);
});
t("importer: GeoJSON lines and a default utility", () => {
  const gj = JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", properties: { name: "New line", kv: 500, in_service: "2030-05-01" }, geometry: { type: "LineString", coordinates: [[-81, 33], [-80.5, 33.2]] } },
    { type: "Feature", properties: { kv: 115 }, geometry: { type: "Point", coordinates: [-81, 33] } } ] });
  const r = I.parsePlan(gj, "x.geojson", { utility: "Duke" });
  assert.strictEqual(r.projects.length, 1);
  assert.deepStrictEqual(r.projects[0].coords[0], [33, -81]);
  assert.strictEqual(r.errors.length, 1);
});
t("shareable: closer tiers include everything farther tiers allow, in the challenge's words", () => {
  const all = x => E.shareable(x).flatMap(g => g.items);
  assert.deepStrictEqual(all({ tier: 3, sameWindow: true }), ["Crews", "Cranes", "Contractors"]);
  assert.deepStrictEqual(all({ tier: 0, sameWindow: true }), ["Outage timing", "Crossing structures", "Right-of-way", "Access roads", "Permits", "Laydown yards", "Deliveries", "Crews", "Cranes", "Contractors"]);
  const g = E.shareable({ tier: 1, sameWindow: false });
  assert.deepStrictEqual(g.map(x => x.active), [true, false, false]); // land yes; yards and crews need a shared window
});
t("savings: one line per shareable item, with the math, and editable unit costs", () => {
  const p = { type: "substation", kv: 230, coords: [[33, -81]] }, q = { type: "substation", kv: 115, coords: [[33, -81]] };
  const x = { p, q, tier: 0, sameWindow: true };
  const s = E.savings(x);
  assert.deepStrictEqual(s.items.map(i => i.share), E.shareable(x).flatMap(g => g.items)); // every shareable item gets a figure
  const row = s.items.find(i => i.share === "Right-of-way"); // 1 km × 45 m = 11.1 acres × $15K × 50%
  assert.ok(Math.abs(row.v - 1000 * 45 / 4046.86 * 15e3 * 0.5) < 1 && /11\.1 acres/.test(row.how));
  assert.strictEqual(s.items.find(i => i.share === "Crews").v, 8e6 * 0.05 * 0.5); // 5% of the smaller ($8M) project, half each
  assert.strictEqual(E.savings({ p, q, tier: 3, sameWindow: false }).items.length, 0); // crews need a shared window
  E.setAssumptions({ landPerAcre: 30e3, bogus: 1, permits: -5 });
  assert.ok(E.customized() && Math.abs(E.savings(x).items.find(i => i.share === "Right-of-way").v - 2 * row.v) < 1);
  assert.strictEqual(E.ASSUME.permits, 150e3); // bad values are ignored
  E.setAssumptions({});
  assert.ok(!E.customized() && E.savings(x).total === s.total);
});
t("shared yard: geometric median, snapped to a substation, and 3+ project clusters", () => {
  const sub = (id, u, lat, lon) => ({ id, utility: u, name: id, type: "substation", kv: 115, coords: [[lat, lon]], start: "2027-01-01", in_service: "2028-01-01" });
  const a = sub("A", "X", 33, -81), b = sub("B", "Y", 33, -80.8), c = sub("C", "X", 33.15, -80.9);
  const yd = E.yardFor([a, b, c], [], 40);
  assert.ok(yd.max < 20 && yd.near); // snapped to one of the three substations, all within a day's drive
  const im = E.yardImpact({ dists: [0, 0] }, 2);
  assert.ok(Math.abs(im.haulMi - 12 * 2 * 160 / 1.609) < 0.01 && im.shuttleMi === 0 && im.co2t > 0);
  const r = E.findOverlaps([a, b, c], { utilA: "X", utilB: "Y", maxKm: 40, bufferMonths: 0, mode: "near" });
  const cl = E.clusters(r.pairs, [], 40);
  assert.strictEqual(cl.length, 1); assert.strictEqual(cl[0].projects.length, 3);
  const far = sub("D", "Y", 35, -80.8); // 220 km away: not in any cluster
  assert.strictEqual(E.clusters(E.findOverlaps([a, b, far], { utilA: "X", utilB: "Y", maxKm: 400, bufferMonths: 0, mode: "near" }).pairs, [], 40).length, 0);
});
t("dates: impossible months are refused, day-first dates are read, and one bad row doesn't sink the file", () => {
  assert.strictEqual(I.toDate("2029-13"), null);
  assert.strictEqual(I.toDate("13/13/2029"), null);
  assert.strictEqual(I.toDate("25/12/2029").iso, "2029-12-25"); // day first, since 25 can't be a month
  assert.strictEqual(I.toDate("12/25/2029").iso, "2029-12-25");
  assert.strictEqual(I.toDate("2/31/2029").iso, "2029-02-28");
  const csv = "utility,name,in_service,start,lat,lon\nU,Good,2029,,33,-81\nU,Bad month,2029-13,,33,-81\nU,Bad start,2029,2028-14,33,-81\nU,Day first,25/12/2029,,33,-81";
  const r = I.parsePlan(csv, "t.csv", {});
  assert.deepStrictEqual(r.projects.map(p => p.name), ["Good", "Day first"]);
  assert.ok(r.projects.every(p => !isNaN(E.monthIndex(p.start)) && !isNaN(E.monthIndex(p.in_service))));
  assert.strictEqual(r.errors.length, 2);
  assert.ok(/2029-13/.test(r.errors[0]) && /2028-14/.test(r.errors[1]));
});
t("multi-part lines keep their parts apart for distance, length and cost", () => {
  // two short east-west parts about 110 km apart, and a substation halfway between (about 55 km from each)
  const gj = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Two parts", utility: "U", in_service: "2029", kv: 230, type: "new_line" },
    geometry: { type: "MultiLineString", coordinates: [[[-81.0, 33.0], [-80.9, 33.0]], [[-81.0, 34.0], [-80.9, 34.0]]] } },
    { type: "Feature", properties: { name: "Collection", utility: "U", in_service: "2029" },
    geometry: { type: "GeometryCollection", geometries: [{ type: "LineString", coordinates: [[-81.0, 33.0], [-80.9, 33.0]] }, { type: "Point", coordinates: [-81.0, 34.0] }] } }] };
  const [ml, gc] = I.parsePlan(JSON.stringify(gj), "t.geojson", {}).projects;
  assert.strictEqual(ml.parts.length, 2);
  const mid = { type: "substation", kv: 230, coords: [[33.5, -80.95]] };
  assert.ok(E.closest(ml, mid)[0] > 50, "a point in the gap is not touching");
  assert.ok(Math.abs(E.lengthKm(ml) - 2 * 9.3) < 0.5, "length is the two parts, not the gap");
  assert.strictEqual(gc.parts.length, 2); // the collection keeps its line and its point
  assert.ok(E.closest(gc, { coords: [[34.0, -81.0]] })[0] < 0.1);
});
t("From and To substation columns are not read as utilities", () => {
  const csv = "name,from,to,in_service,lat,lon\nLine A,Graniteville,Vogtle,2029,33.5,-81.8\nLine B,Hardeeville,Port Wentworth,2030,32.2,-81.1";
  const r = I.parsePlan(csv, "t.csv", { utility: "Typed Utility" });
  assert.deepStrictEqual(r.projects.map(p => p.utility), ["Typed Utility", "Typed Utility"]);
  assert.ok(!I.ALIASES.utility.includes("to"));
});
t("pair comparison is cached: same inputs reuse it, a data or option change reruns it", () => {
  const a = { id: "a", utility: "X", name: "a", type: "substation", kv: 115, coords: [[33, -81]], start: "2027-01-01", in_service: "2028-01-01" };
  const b = Object.assign({}, a, { id: "b", utility: "Y", coords: [[33, -80.9]] });
  const o = { utilA: "X", utilB: "Y", maxKm: 40, bufferMonths: 0, mode: "near" };
  const r1 = E.cachedOverlaps([a, b], o, 1);
  assert.strictEqual(E.cachedOverlaps([a, b], Object.assign({}, o), 1), r1);
  assert.notStrictEqual(E.cachedOverlaps([a, b], o, 2), r1);
  assert.notStrictEqual(E.cachedOverlaps([a, b], Object.assign({}, o, { maxKm: 8 }), 2).pairs, r1.pairs);
});
t("suggested shift is worked out once per pair, not once per slider tick", () => {
  const p = { id: "p1", start: "2026-01-01", in_service: "2027-01-01" }, q = { id: "q1", start: "2028-01-01", in_service: "2029-01-01" };
  const x = { p, q }, before = E.recommendShift.computed;
  const m = E.recommendShift(x, "q");
  assert.strictEqual(m, -18); // moving q 18 months earlier gives 6 shared months
  for (let i = 0; i < 100; i++) E.recommendShift(x, "q");
  assert.strictEqual(E.recommendShift.computed - before, 1);
  assert.strictEqual(E.shiftISO("2029-01-31", 1), "2029-02-28");
});
t("overlap chance: with no schedule risk it is the plan's own answer", () => {
  const still = { A: { months: [0] }, B: { months: [0] } };
  const a = P("a", "A", [[33, -82]], "2027-01-01", "2028-01-01"), b = P("b", "B", [[33, -81.9]], "2027-06-01", "2028-06-01");
  const c = P("c", "B", [[33, -81.9]], "2031-01-01", "2032-01-01");
  assert.strictEqual(E.overlapChance({ p: a, q: b }, still, { bufferMonths: 0 }).p, 1);
  assert.strictEqual(E.overlapChance({ p: a, q: c }, still, { bufferMonths: 0 }).p, 0);
});
t("overlap chance: slips move it between 0 and 1, the same answer every time", () => {
  const slips = { A: { months: [0, 12, 24] }, B: { months: [-12, 0, 12] } };
  const a = P("a", "A", [[33, -82]], "2027-01-01", "2028-01-01"), b = P("b", "B", [[33, -81.9]], "2028-03-01", "2029-03-01");
  const r = E.overlapChance({ p: a, q: b }, slips, { bufferMonths: 0 });
  assert(r.p > 0.2 && r.p < 0.9, r.p);
  assert.strictEqual(E.overlapChance({ p: a, q: b }, slips, { bufferMonths: 0 }).p, r.p);
  const far = P("f", "B", [[33, -81.9]], "2036-01-01", "2037-01-01");
  assert.strictEqual(E.overlapChance({ p: a, q: far }, slips, { bufferMonths: 0 }).p, 0);
});
t("overlap chance: a project that is likely built has no window left to share", () => {
  const a = P("a", "A", [[33, -82]], "2023-01-01", "2024-12-31", { likely_built: true }), b = P("b", "B", [[33, -81.9]], "2024-01-01", "2025-01-01");
  const r = E.overlapChance({ p: a, q: b }, { A: { months: [0] }, B: { months: [0] } }, { bufferMonths: 0 });
  assert.strictEqual(r.p, 0);
  assert.strictEqual(r.why, "built");
});
t("overlap chance: a shared window that has already closed does not count", () => {
  const still = { A: { months: [0] }, B: { months: [0] } };
  const a = P("a", "A", [[33, -82]], "2025-01-01", "2026-03-01"), b = P("b", "B", [[33, -81.9]], "2025-06-01", "2027-01-01");
  assert.strictEqual(E.overlapChance({ p: a, q: b }, still, { bufferMonths: 0 }).p, 1);
  assert.strictEqual(E.overlapChance({ p: a, q: b }, still, { bufferMonths: 0, today: "2026-09-26" }).p, 0);
  const late = { A: { months: [12] }, B: { months: [0] } }; // a slips a year, so both are in the field after today
  assert.strictEqual(E.overlapChance({ p: a, q: b }, late, { bufferMonths: 0, today: "2026-09-26" }).p, 1);
});
t("expected savings: items that need a shared window count by its chance, the rest in full", () => {
  const a = P("a", "A", [[33, -82]], "2027-01-01", "2028-01-01"), b = P("b", "B", [[33, -81.99]], "2029-01-01", "2030-01-01");
  const x = E.findOverlaps([a, b], { utilA: "A", utilB: "B", maxKm: 40, bufferMonths: 0, mode: "near" }).pairs[0];
  const e = E.expectedSavings(x, 0.5);
  assert(e.fixed > 0 && e.windowed > 0, JSON.stringify(e));
  assert(Math.abs(e.expected - (e.fixed + 0.5 * e.windowed)) < 1e-6);
  assert.strictEqual(E.expectedSavings(x, 0).expected, e.fixed);
});
t("built-in slip model comes from the plans themselves", () => {
  const m = require("../data/model.json");
  assert.strictEqual(m.slips.DESC.n, 30);
  assert(m.slips.DESC.months.every(v => v >= 0) && m.slips.DESC.slipped > 20, "DESC dates only slipped");
  assert(m.slips.GPC.n > 80 && m.slips.GPC.advanced > 0);
  assert(m.checks.find(c => c.id === "rows").status === "pass");
  const { pairs } = E.findOverlaps(projects, { utilA: "DESC", utilB: "GPC", maxKm: 40, bufferMonths: 0, mode: "near" });
  const pair = (a, b) => pairs.find(x => x.p.id === a && x.q.id === b);
  const ovl2 = E.overlapChance(pair("DESC-12", "IRP-20277"), m.slips, { bufferMonths: 0, today: m.as_of });
  assert(ovl2.p > 0 && ovl2.p < 1, ovl2.p); // in one window on paper, but DESC usually slips
  assert.strictEqual(E.overlapChance(pair("DESCP-31", "IRP-20793"), m.slips, { bufferMonths: 0 }).p, 0);
  assert.strictEqual(E.expectedSavings(pair("DESCP-31", "IRP-20793"), 0).expected, 0); // Hooks - Thurmond is likely built
});
t("plan drift: the latest plan updates opened and closed shared windows", () => {
  const { pairs } = E.findOverlaps(projects, { utilA: "DESC", utilB: "GPC", maxKm: 40, bufferMonths: 0, mode: "near" });
  const { opened, closed } = E.driftChanges(pairs);
  // 8 opened by DESC's slips, 1 by Georgia pulling Ray Place Rd - Warrenton forward from 2030 to 2027
  assert.deepStrictEqual([opened.length, closed.length], [9, 3]);
  assert(opened.some(x => x.p.id === "DESC-20" && x.q.drift && x.q.drift.months === -36));
  // reference overlap OVL_3 shares a window only because Jasper - Okatie #2 moved 11 months later
  assert(opened.some(x => x.p.id === "DESC-12" && x.q.id === "IRP-20065"));
  const j = projects.find(p => p.id === "DESC-12");
  assert.deepStrictEqual([j.drift.from_in_service, j.drift.to_in_service, j.drift.months], ["2025-12-31", "2026-12-01", 11]);
});
t("schedule optimizer: moves the one project that opens a shared window, and nothing else", () => {
  const still = { A: { months: [0] }, B: { months: [0] } };
  const a = P("a", "A", [[33, -82]], "2027-01-01", "2028-01-01"), b = P("b", "B", [[33, -81.99]], "2028-04-01", "2029-04-01");
  const far = P("z", "B", [[35, -79]], "2027-01-01", "2028-01-01");
  const { pairs } = E.findOverlaps([a, b, far], { utilA: "A", utilB: "B", maxKm: 40, bufferMonths: 0, mode: "near" });
  const r = E.optimizeSchedule(pairs, still, { today: "2026-09-26" });
  assert.strictEqual(r.moves.length, 1, JSON.stringify(r.moves.map(m => [m.id, m.months])));
  const m = r.moves[0];
  assert(["a", "b"].includes(m.id) && Math.abs(m.months) <= 6 && m.months % 3 === 0);
  assert(r.after > r.before && m.gain > 0);
});
t("schedule optimizer: never moves a project already under way or likely built, nor starts one before today", () => {
  const still = { A: { months: [0] }, B: { months: [0] } };
  const started = P("s", "A", [[33, -82]], "2026-01-01", "2027-06-01");
  const built = P("k", "A", [[33, -82.01]], "2023-01-01", "2024-12-31", { likely_built: true });
  const soon = P("n", "B", [[33, -81.99]], "2026-11-01", "2027-02-01");
  const later = P("l", "B", [[33, -81.98]], "2028-01-01", "2028-09-01");
  const { pairs } = E.findOverlaps([started, built, soon, later], { utilA: "A", utilB: "B", maxKm: 40, bufferMonths: 0, mode: "near" });
  const r = E.optimizeSchedule(pairs, still, { today: "2026-09-26" });
  for (const m of r.moves) {
    assert(!["s", "k"].includes(m.id), m.id);
    assert(m.to.start >= "2026-09-01", JSON.stringify(m));
  }
});
t("schedule optimizer: on the built-in plans a few moves raise expected savings", () => {
  const m = require("../data/model.json");
  const { pairs } = E.findOverlaps(projects, { utilA: "DESC", utilB: "GPC", maxKm: 40, bufferMonths: 0, mode: "near" });
  const r = E.optimizeSchedule(pairs, m.slips, { today: m.as_of, maxMoves: 6 });
  assert(r.moves.length > 0 && r.moves.length <= 6);
  assert(r.after - r.before >= r.moves.length * 25000);
  const descOnly = E.optimizeSchedule(pairs, m.slips, { today: m.as_of, utilities: ["DESC"] });
  assert(descOnly.moves.every(x => x.project.utility === "DESC"));
  const again = E.optimizeSchedule(pairs, m.slips, { today: m.as_of, maxMoves: 6 });
  assert.deepStrictEqual(again.moves.map(x => [x.id, x.months]), r.moves.map(x => [x.id, x.months]));
});
// The projection is flat: one fixed latitude for the whole map (LAT0 in engine.js). That is an approximation, and
// the tier boundaries are the product's central claim, so the error is measured rather than assumed. Today the worst
// flagged pair is 0.35 km off geodesic distance and no pair changes tier. This test keeps it that way: widen the
// footprint or touch the projection and it fails instead of quietly reporting wrong distances.
t("flat projection stays close to geodesic distance", () => {
  const R = 6371.0088, rad = d => d * Math.PI / 180;
  const geodesic = ([lat1, lon1], [lat2, lon2]) => {
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const { pairs } = E.findOverlaps(projects, { utilA: "DESC", utilB: "GPC", maxKm: 40, bufferMonths: 0, mode: "near" });
  assert(pairs.length > 100, "expected the built-in comparison to flag a meaningful number of pairs");
  let worst = 0, flips = 0;
  for (const x of pairs) {
    const km = geodesic(x.ca, x.cb);
    worst = Math.max(worst, Math.abs(km - x.km));
    if (E.tierOf(km) !== E.tierOf(x.km)) flips++;
  }
  assert(worst < 0.5, `worst deviation from geodesic distance is ${worst.toFixed(3)} km`);
  assert.strictEqual(flips, 0, `${flips} pairs would change tier if measured geodesically`);
});
t("rows without a date load as undated, geography-only projects", () => {
  const csv = "utility,name,in_service,lat,lon\nA,Dated,2029,33,-81\nB,No date,,33.01,-81";
  const r = I.parsePlan(csv, "t.csv", {});
  assert.strictEqual(r.projects.length, 2); assert.strictEqual(r.errors.length, 0);
  const u = r.projects.find(p => p.name === "No date");
  assert.ok(u.undated && u.date_precision === "none" && !isNaN(E.monthIndex(u.in_service)));
  const { pairs } = E.findOverlaps(r.projects, { utilA: "A", utilB: "B", maxKm: 40, bufferMonths: 0, mode: "near" });
  assert.strictEqual(pairs.length, 1, "still paired on geography");
  assert.strictEqual(pairs[0].sameWindow, false);
  assert.strictEqual(E.overlapChance(pairs[0], {}).p, 0);
  assert.strictEqual(E.findOverlaps(r.projects, { utilA: "A", utilB: "B", maxKm: 40, bufferMonths: 0, mode: "both" }).pairs.length, 0);
});
t("a per-row source link is kept, and falls back to the import default", () => {
  const csv = "utility,name,in_service,lat,lon,source_url\nU,Linked,2029,33,-81,https://example.com/plan.pdf\nU,Plain,2029,33,-81,";
  const r = I.parsePlan(csv, "t.csv", { source: "Typed source" });
  assert.deepStrictEqual(r.projects.map(p => p.source), ["https://example.com/plan.pdf", "Typed source"]);
  for (const col of ["source", "url", "link"]) assert.ok(I.ALIASES.source.includes(col));
});
t("3D tag voltage is the project's own kv, and flags a title that disagrees", () => {
  assert.deepStrictEqual(E.kvOf({ name: "Jasper - Okatie 230kV #2", kv: 230 }), { kv: 230, titleKv: null });
  assert.deepStrictEqual(E.kvOf({ name: "Hooks - Modoc 115/46kV Rebuild", kv: 115 }), { kv: 115, titleKv: null });
  assert.deepStrictEqual(E.kvOf({ name: "Okatie 230-115kV Substation", kv: 115 }), { kv: 115, titleKv: null });
  assert.deepStrictEqual(E.kvOf({ name: "Plant McIntosh Unit 12", kv: 500 }), { kv: 500, titleKv: null });
  // the SCRTP title says 115 kV, its description and the 2024-2028 list say 230 kV
  const rp = projects.find(p => p.name.startsWith("Riverport"));
  assert.deepStrictEqual(E.kvOf(rp), { kv: 230, titleKv: 115 });
  // every other project's kv agrees with its title
  assert.deepStrictEqual(projects.filter(p => E.kvOf(p).titleKv).map(p => p.name), [rp.name]);
});
t("importer template loads", () => { assert.strictEqual(I.parsePlan(I.TEMPLATE, "t.csv", {}).projects.length, 2); });
console.log(`\n${n} tests passed`);
