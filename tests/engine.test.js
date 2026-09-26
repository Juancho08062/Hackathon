// Run with: node tests/engine.test.js
const assert = require("assert");
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
  assert.strictEqual(checked, 54 * 39);
  assert.strictEqual(pairs.length, 20);
  assert.strictEqual(pairs[0].tier, 0);
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
t("importer template loads", () => { assert.strictEqual(I.parsePlan(I.TEMPLATE, "t.csv", {}).projects.length, 2); });
console.log(`\n${n} tests passed`);
