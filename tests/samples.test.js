// Run with: node tests/samples.test.js
// Loads every file in samples/ through the same parsers the browser uses (KML needs a browser DOM, so it is
// covered by the KMZ/GeoJSON equivalents here) and checks each one yields the five sample projects.
const assert = require("assert"), fs = require("fs"), path = require("path");
const E = require("../src/engine.js");
const I = require("../src/ingest.js");
const XLSX = require("../vendor/xlsx.full.min.js");
globalThis.self = globalThis; // the browser build of shpjs expects self
const shp = require("../vendor/shp.min.js");
const S = f => path.join(__dirname, "../samples", f);
const builtin = require("../data/projects.json").filter(p => !p.existing);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok -", name); };
const U = "Example Electric Cooperative";

function check(res, label) {
  assert.strictEqual(res.errors.length, 0, label + ": " + res.errors.join("; "));
  assert.strictEqual(res.projects.length, 5, label);
  assert(res.projects.every(p => p.utility === U), label + " utility");
  const line = res.projects.find(p => /Clearwater/.test(p.name));
  assert.strictEqual(line.kv, 230, label + " kv");
  assert.strictEqual(line.in_service, "2028-11-30", label + " in-service");
  assert(line.coords.length >= 2, label + " line geometry");
  // the samples sit along the Savannah River, so they should overlap the built-in plans
  const { pairs } = E.findOverlaps(builtin.concat(res.projects), { utilA: U, utilB: "DESC", maxKm: 40, bufferMonths: 0, mode: "near" });
  assert(pairs.length > 0, label + " overlaps");
  return res;
}

(async () => {
  await t("CSV sample", () => check(I.parsePlan(fs.readFileSync(S("sample-plan.csv"), "utf8"), "sample-plan.csv", {}), "csv"));
  await t("GeoJSON sample", () => check(I.parsePlan(fs.readFileSync(S("sample-plan.geojson"), "utf8"), "sample-plan.geojson", {}), "geojson"));
  await t("Excel sample: title rows above the header are skipped", () => {
    const wb = XLSX.read(fs.readFileSync(S("sample-plan.xlsx")), { type: "buffer" });
    const table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
    check(I.parseRows(I.rowsFromTable(table), {}), "xlsx");
  });
  await t("zipped shapefile sample (two layers, 10-character field names)", async () => {
    const gj = await shp(fs.readFileSync(S("sample-plan-shapefile.zip")));
    check(I.parseGeoJSON(gj, {}), "shapefile");
  });
  await t("header detection ignores notes and needs a name column", () => {
    const rows = I.rowsFromTable([["Plan 2026"], ["note"], ["Project", "kV", "ISD", "Lat", "Lon"], ["A", "115", "2029", "33", "-81"]]);
    assert.deepStrictEqual(rows, [{ Project: "A", kV: "115", ISD: "2029", Lat: "33", Lon: "-81" }]);
    assert.deepStrictEqual(I.rowsFromTable([["just", "some", "text"]]), []);
  });
  console.log(`\n${n} tests passed`);
})().catch(err => { console.error(err); process.exit(1); });
