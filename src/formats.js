// Nexxo file readers: turn dropped files into something the importer understands.
//   CSV, TSV, TXT, JSON, GeoJSON     -> text          -> Ingest.parsePlan
//   XLSX, XLSM, XLS, ODS             -> row objects   -> Ingest.parseRows   (SheetJS)
//   KML, KMZ, GPX                    -> GeoJSON       -> Ingest.parseGeoJSON (togeojson, JSZip)
//   Shapefile (.zip, or .shp + .dbf) -> GeoJSON       -> Ingest.parseGeoJSON (shpjs; reprojects using .prj)
// Parsing libraries load on first use through Libs.need, so the page stays light until someone imports a file.
(function (root) {
  // Libraries register globally in the browser; tests in Node put them on globalThis and provide Libs and DOMParser.
  const G = typeof window !== "undefined" ? window : globalThis;
  const Ingest = G.Ingest || require("./ingest.js");
  const need = (...names) => G.Libs.need(...names);
  const ext = name => (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  const base = name => name.replace(/\.[^.]+$/, "").toLowerCase();
  const TEXT = ["csv", "tsv", "txt", "json", "geojson"], SHEET = ["xlsx", "xlsm", "xls", "ods"], GPS = ["kml", "gpx"];
  const ACCEPT = [...TEXT, ...SHEET, ...GPS, "kmz", "zip", "shp", "dbf", "prj", "cpg"].map(e => "." + e).join(",");

  // Exports from ArcGIS put every attribute in an HTML table inside the KML description. Lift those into properties.
  const strip = h => h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  function liftDescriptionTable(gj) {
    for (const f of gj.features || []) {
      const d = f.properties && f.properties.description;
      const html = typeof d === "string" ? d : d && d.value;
      if (!html || !/<td/i.test(html)) continue;
      for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => strip(m[1]));
        if (cells.length === 2 && cells[0] && !(cells[0] in f.properties)) f.properties[cells[0]] = cells[1];
      }
      delete f.properties.description; // it was only the attribute table
    }
    return gj;
  }
  async function kmlToGeoJSON(text, kind = "kml") {
    await need("toGeoJSON");
    const dom = new G.DOMParser().parseFromString(text, "text/xml");
    if (!dom || !dom.documentElement || dom.getElementsByTagName("parsererror").length) throw new Error("the file isn't valid " + kind.toUpperCase());
    return liftDescriptionTable(G.toGeoJSON[kind](dom));
  }

  function sheetRows(buf) {
    const wb = G.XLSX.read(buf, { type: "array", cellDates: true });
    const rows = [];
    for (const name of wb.SheetNames) {
      // raw: false keeps what the cell shows (formatted dates and numbers), which the importer already understands
      const table = G.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
      rows.push(...Ingest.rowsFromTable(table));
    }
    if (!rows.length) throw new Error("no sheet has a header row with a project name column");
    return rows;
  }

  async function fromZip(buf, filename) {
    await need("JSZip");
    const zip = await G.JSZip.loadAsync(buf), names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !/(^|\/)__MACOSX\//.test(n));
    if (names.some(n => ext(n) === "shp")) {
      await need("shp");
      return { geojson: await G.shp(buf) };
    }
    const kml = names.find(n => ext(n) === "kml");
    if (kml) return { geojson: await kmlToGeoJSON(await zip.files[kml].async("string")) };
    const inner = names.find(n => [...TEXT, ...SHEET].includes(ext(n)));
    if (inner) return readOne({ name: inner, arrayBuffer: () => zip.files[inner].async("arraybuffer"), text: () => zip.files[inner].async("string") });
    throw new Error(`${filename} has no shapefile, KML, spreadsheet or CSV inside`);
  }

  // One file -> { text } | { rows } | { geojson }
  async function readOne(file) {
    const e = ext(file.name);
    if (TEXT.includes(e) || !e) return { text: await file.text() };
    if (SHEET.includes(e)) { await need("XLSX"); return { rows: sheetRows(await file.arrayBuffer()) }; }
    if (GPS.includes(e)) return { geojson: await kmlToGeoJSON(await file.text(), e) };
    if (e === "kmz" || e === "zip") return fromZip(await file.arrayBuffer(), file.name);
    throw new Error(`.${e} files aren't supported. Try CSV, Excel, GeoJSON, KML/KMZ or a zipped shapefile`);
  }

  // Loose shapefile parts picked together (.shp + .dbf, optional .prj and .cpg) are combined into one layer.
  async function readShapefileParts(parts) {
    const byExt = Object.fromEntries(parts.map(f => [ext(f.name), f]));
    if (!byExt.shp) throw new Error("a shapefile needs its .shp file. Pick the .shp, .dbf and .prj together, or zip them");
    await need("shp");
    const buf = async e => byExt[e] ? byExt[e].arrayBuffer() : undefined, txt = async e => byExt[e] ? byExt[e].text() : undefined;
    return { geojson: await G.shp({ shp: await buf("shp"), dbf: await buf("dbf"), prj: await txt("prj"), cpg: await txt("cpg") }) };
  }

  // Many files -> [{ name, text|rows|geojson } | { name, error }], grouping shapefile parts by base name.
  async function read(files) {
    const out = [], shpGroups = {};
    for (const f of files) {
      if (["shp", "dbf", "prj", "cpg", "shx"].includes(ext(f.name))) (shpGroups[base(f.name)] ||= []).push(f);
      else out.push(readOne(f).then(r => Object.assign({ name: f.name }, r), err => ({ name: f.name, error: err.message })));
    }
    for (const [b, parts] of Object.entries(shpGroups)) {
      out.push(readShapefileParts(parts).then(r => Object.assign({ name: b + ".shp" }, r), err => ({ name: b + ".shp", error: err.message })));
    }
    return Promise.all(out);
  }

  const api = { read, ACCEPT, ext };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Formats = api;
})(this);
