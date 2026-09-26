// Seamline importer: turns a utility's plan into Seamline projects. It takes text (CSV, TSV, JSON, GeoJSON),
// spreadsheet rows (from src/formats.js) or GeoJSON (from KML, KMZ, GPX or shapefiles).
// Column names are matched loosely so exports from different utilities load without editing.
(function (root) {
  const Engine = root.Engine || (typeof require !== "undefined" ? require("./engine.js") : null);

  const ALIASES = {
    utility: ["utility", "owner", "company", "transmission_owner", "to", "utility_name", "entity", "member"],
    name: ["name", "project", "project_name", "title", "description_short", "project_title", "facility", "facility_name", "proj_name"],
    desc: ["desc", "description", "scope", "details", "notes"],
    kv: ["kv", "voltage", "voltage_kv", "kv_class", "nominal_kv", "volt", "voltage_class", "kv_level", "max_kv", "kv_nominal"],
    type: ["type", "project_type", "category", "work_type", "proj_type"],
    start: ["start", "start_date", "construction_start", "begin", "const_start", "start_year"],
    in_service: ["in_service", "in_service_date", "isd", "expected_in_service", "completion", "year", "in_service_year", "in_serv", "inservice", "expected_isd", "projected_isd", "isd_year", "planned_isd"],
    cost: ["cost", "cost_usd", "estimated_cost", "est_cost", "budget", "cost_estimate", "project_cost"],
    miles: ["miles", "length_mi", "line_miles"],
    km: ["km", "length_km"],
    lat: ["lat", "latitude", "lat1", "from_lat", "start_lat", "y"],
    lon: ["lon", "lng", "long", "longitude", "lon1", "from_lon", "start_lon", "x"],
    lat2: ["lat2", "to_lat", "end_lat"],
    lon2: ["lon2", "lng2", "to_lon", "end_lon"],
  };
  const norm = k => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  function pick(row, field) {
    const keys = Object.keys(row);
    for (const a of ALIASES[field]) { const k = keys.find(k => norm(k) === a); if (k != null && row[k] !== "" && row[k] != null) return row[k]; }
    return undefined;
  }

  // Minimal RFC 4180 parser (quoted fields, commas or tabs). Returns rows as arrays.
  function parseTable(text) {
    const delim = text.split("\n", 1)[0].includes("\t") ? "\t" : ",";
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim() !== ""));
  }
  function parseDelimited(text) {
    const [head, ...body] = parseTable(text);
    return head ? body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()]))) : [];
  }

  // Spreadsheets often put a title and notes above the real header. Given rows as arrays, find the header
  // (the first row in the top 25 that names a project and at least one other known field) and return row objects.
  function rowsFromTable(table) {
    const known = new Set([].concat(...Object.values(ALIASES)));
    const score = r => { const n = r.map(norm); return ALIASES.name.some(a => n.includes(a)) ? n.filter(k => known.has(k)).length : 0; };
    let h = -1;
    for (let i = 0; i < Math.min(25, table.length); i++) if (score(table[i] || []) >= 2) { h = i; break; }
    if (h < 0) return [];
    const head = table[h].map(v => String(v).trim());
    return table.slice(h + 1)
      .filter(r => r && r.some(v => String(v).trim() !== ""))
      .map(r => Object.fromEntries(head.map((k, i) => [k, r[i] == null ? "" : String(r[i]).trim()]).filter(([k]) => k)));
  }

  function toType(v, hasLine) {
    const s = String(v || "").toLowerCase();
    if (/gen|plant|unit|combined|solar|battery|bess/.test(s)) return "generation";
    if (/sub|station|transformer|bank|switch|bus|breaker|capacitor|reactor/.test(s)) return "substation";
    if (/rebuild|reconductor|upgrade|replace|convert|uprate|move/.test(s)) return "rebuild";
    if (/new|construct|line|build/.test(s)) return "new_line";
    return hasLine ? "new_line" : "substation";
  }
  // Accepts 2029, "2029-06", "6/1/2029", "2029-06-01", "Summer 2027".
  function toDate(v) {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})$/))) return { iso: `${m[1]}-06-01`, precision: "year" };
    if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/))) return { iso: `${m[1]}-${m[2].padStart(2, "0")}-${(m[3] || "01").padStart(2, "0")}`, precision: m[3] ? "day" : "month" };
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; const last = new Date(Date.UTC(+y, +m[1], 0)).getUTCDate(); return { iso: `${y}-${m[1].padStart(2, "0")}-${String(Math.min(last, +m[2])).padStart(2, "0")}`, precision: "day" }; }
    if ((m = s.match(/(spring|summer|fall|autumn|winter)\s+(\d{4})/i))) { const mo = { spring: "04", summer: "07", fall: "10", autumn: "10", winter: "01" }[m[1].toLowerCase()]; return { iso: `${m[2]}-${mo}-01`, precision: "season" }; }
    const d = new Date(s); return isNaN(d) ? null : { iso: d.toISOString().slice(0, 10), precision: "day" };
  }
  const num = v => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "").replace(/(\d)k$/i, "$1e3").replace(/(\d)m$/i, "$1e6")); return isFinite(n) ? n : null; };
  // KML descriptions can be HTML or {"@type": "html", value}; keep readable text only.
  const plainText = v => { if (v == null) return ""; if (typeof v === "object") v = v.value ?? ""; return String(v).replace(/<(br|\/p|\/tr)[^>]*>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); };
  function minusMonths(iso, m) { const d = new Date(iso + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); }

  // row: flat object; coords: optional [[lat, lon], ...] (from GeoJSON). Returns { project } or { error }.
  function toProject(row, coords, defaults, i) {
    const ends = ["sub_1", "sub_2"].map(k => Object.entries(row).find(([c]) => norm(c) === k)).filter(e => e && e[1] && !/^not available$/i.test(e[1])).map(e => e[1]);
    const name = pick(row, "name") || (defaults.existing && (ends.length ? ends.join(" – ") : "Existing facility")), utility = pick(row, "utility") || defaults.utility;
    if (!name) return { error: "no project name" };
    if (!utility) return { error: "no utility (add a utility column or type a name above)" };
    if (!coords) {
      const lat = num(pick(row, "lat")), lon = num(pick(row, "lon")), lat2 = num(pick(row, "lat2")), lon2 = num(pick(row, "lon2"));
      if (lat == null || lon == null) return { error: "no latitude/longitude" };
      coords = [[lat, lon]].concat(lat2 != null && lon2 != null ? [[lat2, lon2]] : []);
    }
    if (coords.some(([a, b]) => Math.abs(a) > 90 || Math.abs(b) > 180)) return { error: "coordinates out of range" };
    const isd = toDate(pick(row, "in_service")) || toDate(defaults.in_service);
    if (!isd) return { error: "no in-service date (add a column, or set a default in-service date above)" };
    const kv = num(pick(row, "kv")) || 115;
    const type = toType(pick(row, "type") || name, coords.length > 1);
    const kmv = num(pick(row, "km")), miles = num(pick(row, "miles")) ?? (kmv ? kmv / 1.609 : null);
    const st = toDate(pick(row, "start")) || toDate(defaults.start);
    return {
      project: {
        id: `${String(utility).replace(/\W+/g, "")}-${defaults.batch}-${i}`, utility: String(utility).trim(), owner: String(utility).trim(),
        name: String(name).trim(), desc: plainText(pick(row, "desc")), kv, miles, type,
        in_service: isd.iso, date_precision: isd.precision === "day" ? "day" : "year",
        start: st ? st.iso : minusMonths(isd.iso, Engine.estMonths(type, kv, miles)), start_published: !!st,
        cost: num(pick(row, "cost")), coords, loc: "med", source: defaults.source || "", page: "", imported: true,
      },
    };
  }

  // Reduce any GeoJSON geometry to the [lon, lat] points Seamline measures from.
  function geomPoints(g) {
    if (!g) return null;
    switch (g.type) {
      case "Point": return [g.coordinates];
      case "MultiPoint": case "LineString": return g.coordinates;
      case "MultiLineString": return g.coordinates.flat();
      case "Polygon": return [centroid(g.coordinates[0])];
      case "MultiPolygon": return g.coordinates.map(p => centroid(p[0]));
      case "GeometryCollection": { const parts = g.geometries.map(geomPoints).filter(Boolean); return parts.length ? parts.sort((x, y) => y.length - x.length)[0] : null; }
      default: return null;
    }
  }
  function fromGeoJSON(gj, defaults) {
    const list = Array.isArray(gj) ? gj : [gj];
    const feats = list.flatMap(x => x.type === "FeatureCollection" ? x.features : x.type === "Feature" ? [x] : []);
    return feats.map((f, i) => {
      const c = geomPoints(f.geometry);
      if (!c || !c.length) return { error: `unsupported geometry ${(f.geometry && f.geometry.type) || "(none)"}` };
      return toProject(f.properties || {}, c.map(([lon, lat]) => [lat, lon]), defaults, i);
    });
  }
  const centroid = ring => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

  function summarize(results) {
    const projects = results.filter(r => r.project).map(r => r.project);
    const errors = results.map((r, i) => r.error ? `row ${i + 1}: ${r.error}` : null).filter(Boolean);
    return { projects, errors, total: results.length };
  }
  const withDefaults = defaults => Object.assign({ batch: Date.now().toString(36) }, defaults);

  // Parse file text by extension/content. defaults: { utility, source, batch }.
  function parsePlan(text, filename, defaults) {
    const d = withDefaults(defaults), t = text.trim();
    if (/\.(geo)?json$/i.test(filename) || t.startsWith("{") || t.startsWith("[")) {
      const js = JSON.parse(t);
      if (js.type === "FeatureCollection" || js.type === "Feature") return summarize(fromGeoJSON(js, d));
      const arr = Array.isArray(js) ? js : js.projects || [];
      return summarize(arr.map((r, i) => toProject(r, r.coords || null, d, i)));
    }
    return parseRows(rowsFromTable(parseTable(text)), d);
  }
  // Row objects, e.g. from a spreadsheet.
  const parseRows = (rows, defaults) => { const d = withDefaults(defaults); return summarize(rows.map((r, i) => toProject(r, null, d, i))); };
  // GeoJSON, e.g. converted from KML or a shapefile.
  const parseGeoJSON = (gj, defaults) => summarize(fromGeoJSON(gj, withDefaults(defaults)));

  const TEMPLATE = [
    "utility,name,kv,type,start,in_service,lat,lon,lat2,lon2,cost,description",
    "Santee Cooper,Example 230 kV line,230,new_line,2027-01-01,2028-12-31,33.20,-80.10,33.40,-79.90,42000000,Two-point line from A to B",
    "Santee Cooper,Example substation,115,substation,,2029,33.05,-80.00,,,8000000,Year-only dates are fine",
  ].join("\n");

  const api = { parsePlan, parseRows, parseGeoJSON, parseDelimited, parseTable, rowsFromTable, toDate, toType, TEMPLATE, ALIASES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Ingest = api;
})(this);
