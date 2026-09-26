// Run with: node tests/samples.test.js
// Loads every file in samples/ through the same readers the browser uses (src/formats.js with the vendored
// libraries, and xmldom standing in for the browser's DOMParser) and checks what each one yields.
const assert = require("assert"), fs = require("fs"), path = require("path");
globalThis.self = globalThis; // the browser builds of shpjs and SheetJS look for self
globalThis.DOMParser = require("@xmldom/xmldom").DOMParser;
globalThis.XLSX = require("../vendor/xlsx.full.min.js");
globalThis.JSZip = require("../vendor/jszip.min.js");
globalThis.shp = require("../vendor/shp.min.js");
globalThis.toGeoJSON = require("../vendor/togeojson.umd.js");
globalThis.Libs = { need: async () => {} };
const E = require("../src/engine.js");
const I = require("../src/ingest.js");
const F = require("../src/formats.js");

const DIR = path.join(__dirname, "../samples");
const builtin = require("../data/projects.json").filter(p => !p.existing);
const file = name => {
  const buf = fs.readFileSync(path.join(DIR, name));
  return { name, text: async () => buf.toString("utf8"), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
// Same steps as importParsed in src/app.js.
async function load(names, extra = {}) {
  const out = [];
  for (const r of await F.read(names.map(file))) {
    if (r.error) throw new Error(`${r.name}: ${r.error}`);
    const d = Object.assign({ utility: r.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") }, extra);
    out.push(r.rows ? I.parseRows(r.rows, d) : r.geojson ? I.parseGeoJSON(r.geojson, d) : I.parsePlan(r.text, r.name, d));
  }
  return out;
}
// Closest built-in project from either DESC or Georgia.
function nearest(projects) {
  let best = { km: Infinity };
  for (const p of projects) for (const q of builtin) { const [km] = E.closest(p, q); if (km < best.km) best = { km, p, q }; }
  return best;
}

const EXPECT = [
  // file, utility, projects loaded, rows skipped, nearest built-in project must be within this many km, import panel defaults
  ["lowcountry-power.csv", "Lowcountry Power Cooperative", 5, 0, 1],
  ["aiken-edgefield-electric.tsv", "Aiken-Edgefield Electric Cooperative", 4, 0, 5],
  ["ogeechee-transmission.json", "Ogeechee Transmission Cooperative", 4, 0, 5],
  ["coastal-georgia-power.geojson", "Coastal Georgia Power Authority", 4, 0, 5],
  ["midlands-rural-electric.xlsx", "Midlands Rural Electric", 4, 1, 5],
  ["savannah-river-transmission.kml", "Savannah River Transmission Co.", 3, 0, 5],
  ["piedmont-lakes-electric.kmz", "Piedmont Lakes Electric", 3, 0, 5],
  ["tri-county-grid-shapefile.zip", "Tri-County Grid Cooperative", 5, 0, 5],
  ["edisto-electric-survey.gpx", "Edisto Electric Cooperative", 3, 0, 1, { utility: "Edisto Electric Cooperative", in_service: "2029-06-30", start: "2028-01-01" }],
];

let n = 0;
(async () => {
  for (const [name, utility, count, skipped, maxKm, extra] of EXPECT) {
    const [res] = await load([name], extra);
    assert.strictEqual(res.projects.length, count, `${name}: loaded ${res.projects.length}, errors: ${res.errors.join("; ")}`);
    assert.strictEqual(res.errors.length, skipped, `${name}: ${res.errors.join("; ")}`);
    assert(res.projects.every(p => p.utility === utility), `${name}: utility ${res.projects[0].utility}`);
    assert(res.projects.every(p => p.coords.every(([lat, lon]) => lat > 31 && lat < 35 && lon > -84 && lon < -80)), `${name}: coordinates outside SC/GA`);
    const near = nearest(res.projects);
    assert(near.km <= maxKm, `${name}: nearest built-in project is ${near.km.toFixed(1)} km away`);
    n++; console.log(`ok - ${name}: ${count} projects${skipped ? `, ${skipped} skipped` : ""}; closest pair ${near.km.toFixed(1)} km (${near.p.name} / ${near.q.name})`);
  }

  const [xlsx] = await load(["midlands-rural-electric.xlsx"]);
  assert.match(xlsx.errors[0], /in-service/);
  const lex = xlsx.projects.find(p => /Lexington/.test(p.name));
  assert.strictEqual(lex.start, "2027-04-01"); assert.strictEqual(lex.in_service, "2028-09-30"); assert.strictEqual(lex.cost, 14000000);
  n++; console.log("ok - Excel: both sheets read, title rows skipped, date cells kept, incomplete row reported");

  const [tsv] = await load(["aiken-edgefield-electric.tsv"]);
  assert.deepStrictEqual(tsv.projects.map(p => p.cost), [12400000, 6500000, 4000000, null]);
  assert.deepStrictEqual(tsv.projects.map(p => p.in_service), ["2028-12-31", "2029-12-01", "2027-07-01", "2030-06-01"]);
  n++; console.log("ok - TSV: other column names, $ and M costs, mixed date styles");

  const [shp] = await load(["tri-county-grid-shapefile.zip"]);
  const holly = shp.projects.find(p => /Holly Hill/.test(p.name));
  assert(Math.abs(holly.coords[0][0] - 33.27) < 1e-4 && Math.abs(holly.coords[0][1] + 80.45) < 1e-4, JSON.stringify(holly.coords[0]));
  n++; console.log("ok - shapefile: UTM 17N coordinates reprojected to latitude and longitude");

  const [kml] = await load(["savannah-river-transmission.kml"]);
  assert.strictEqual(kml.projects.find(p => /Vogtle/.test(p.name)).kv, 500);
  n++; console.log("ok - KML: attributes read from the HTML table in each description");

  const [bare] = await load(["edisto-electric-survey.gpx"]);
  assert.strictEqual(bare.projects.length, 0); assert.match(bare.errors[0], /default in-service date/);
  const [gpx] = await load(["edisto-electric-survey.gpx"], { in_service: "2029" });
  assert(gpx.projects.every(p => p.in_service === "2029-06-01" && !p.start_published));
  assert.strictEqual(gpx.projects.find(p => /Route/.test(p.name)).coords.length, 5);
  n++; console.log("ok - GPX: needs a default in-service date, then loads the route and waypoints");

  // Existing-infrastructure layer (HIFLD field layout): no dates or names needed; names come from SUB_1 and SUB_2.
  const [ex] = await load(["hifld-style-existing-lines.geojson"], { utility: "", in_service: "2000", existing: true });
  assert.strictEqual(ex.projects.length, 4, ex.errors.join("; "));
  assert.deepStrictEqual(ex.projects.map(p => p.name), ["North Augusta – Graniteville", "Vogtle – Wadley", "Hardeeville – Port Wentworth", "Existing facility"]);
  assert.deepStrictEqual(ex.projects.map(p => p.kv), [230, 500, 115, 230]);
  assert(ex.projects.every(p => p.utility === "Example Existing Owner"));
  n++; console.log("ok - existing lines: HIFLD-style fields load as a background layer");

  // Loading every sample together gives eight utilities, each with overlaps against DESC or Georgia.
  const all = (await Promise.all(EXPECT.map(e => load([e[0]], e[5])))).flat().flatMap(r => r.projects);
  const withBuiltin = builtin.concat(all);
  for (const [, utility] of EXPECT) {
    const hits = ["DESC", "GPC"].map(u => E.findOverlaps(withBuiltin, { utilA: utility, utilB: u, maxKm: 40, bufferMonths: 0, mode: "near" }).pairs.length);
    assert(hits[0] + hits[1] > 0, utility);
  }
  n++; console.log("ok - all samples load together and each utility overlaps DESC or Georgia");

  assert.deepStrictEqual(I.rowsFromTable([["Plan 2026"], ["note"], ["Project", "kV", "ISD", "Lat", "Lon"], ["A", "115", "2029", "33", "-81"]]), [{ Project: "A", kV: "115", ISD: "2029", Lat: "33", Lon: "-81" }]);
  assert.deepStrictEqual(I.rowsFromTable([["just", "some", "text"]]), []);
  n++; console.log("ok - header detection ignores notes and needs a name column");

  console.log(`\n${n} tests passed`);
})().catch(err => { console.error(err.message || err); process.exit(1); });
