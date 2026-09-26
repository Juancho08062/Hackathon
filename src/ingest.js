// Seamline importer: turns a utility's plan (CSV, TSV, JSON or GeoJSON) into Seamline projects.
// Column names are matched loosely so exports from different utilities load without editing.
(function (root) {
  const Engine = root.Engine || (typeof require !== "undefined" ? require("./engine.js") : null);

  const ALIASES = {
    utility: ["utility", "owner", "company", "transmission_owner", "to", "utility_name"],
    name: ["name", "project", "project_name", "title", "description_short"],
    desc: ["desc", "description", "scope", "details", "notes"],
    kv: ["kv", "voltage", "voltage_kv", "kv_class", "nominal_kv"],
    type: ["type", "project_type", "category", "work_type"],
    start: ["start", "start_date", "construction_start", "begin"],
    in_service: ["in_service", "in_service_date", "isd", "expected_in_service", "completion", "year", "in_service_year"],
    cost: ["cost", "cost_usd", "estimated_cost", "est_cost", "budget"],
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

  // Minimal RFC 4180 parser (quoted fields, commas or tabs).
  function parseDelimited(text) {
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
    const [head, ...body] = rows.filter(r => r.some(v => v.trim() !== ""));
    return (body || []).map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
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
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return { iso: `${y}-${m[1].padStart(2, "0")}-${String(Math.min(28, +m[2])).padStart(2, "0")}`, precision: "day" }; }
    if ((m = s.match(/(spring|summer|fall|autumn|winter)\s+(\d{4})/i))) { const mo = { spring: "04", summer: "07", fall: "10", autumn: "10", winter: "01" }[m[1].toLowerCase()]; return { iso: `${m[2]}-${mo}-01`, precision: "season" }; }
    const d = new Date(s); return isNaN(d) ? null : { iso: d.toISOString().slice(0, 10), precision: "day" };
  }
  const num = v => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "").replace(/(\d)k$/i, "$1e3").replace(/(\d)m$/i, "$1e6")); return isFinite(n) ? n : null; };
  function minusMonths(iso, m) { const d = new Date(iso + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); }

  // row: flat object; coords: optional [[lat, lon], ...] (from GeoJSON). Returns { project } or { error }.
  function toProject(row, coords, defaults, i) {
    const name = pick(row, "name"), utility = pick(row, "utility") || defaults.utility;
    if (!name) return { error: "no project name" };
    if (!utility) return { error: "no utility (add a utility column or type a name above)" };
    if (!coords) {
      const lat = num(pick(row, "lat")), lon = num(pick(row, "lon")), lat2 = num(pick(row, "lat2")), lon2 = num(pick(row, "lon2"));
      if (lat == null || lon == null) return { error: "no latitude/longitude" };
      coords = [[lat, lon]].concat(lat2 != null && lon2 != null ? [[lat2, lon2]] : []);
    }
    if (coords.some(([a, b]) => Math.abs(a) > 90 || Math.abs(b) > 180)) return { error: "coordinates out of range" };
    const isd = toDate(pick(row, "in_service"));
    if (!isd) return { error: "no in-service date" };
    const kv = num(pick(row, "kv")) || 115;
    const type = toType(pick(row, "type") || name, coords.length > 1);
    const kmv = num(pick(row, "km")), miles = num(pick(row, "miles")) ?? (kmv ? kmv / 1.609 : null);
    const st = toDate(pick(row, "start"));
    return {
      project: {
        id: `${String(utility).replace(/\W+/g, "")}-${defaults.batch}-${i}`, utility: String(utility).trim(), owner: String(utility).trim(),
        name: String(name).trim(), desc: String(pick(row, "desc") || ""), kv, miles, type,
        in_service: isd.iso, date_precision: isd.precision === "day" ? "day" : "year",
        start: st ? st.iso : minusMonths(isd.iso, Engine.estMonths(type, kv, miles)), start_published: !!st,
        cost: num(pick(row, "cost")), coords, loc: "med", source: defaults.source || "", page: "", imported: true,
      },
    };
  }

  function fromGeoJSON(gj, defaults) {
    const feats = gj.type === "FeatureCollection" ? gj.features : gj.type === "Feature" ? [gj] : [];
    return feats.map((f, i) => {
      const g = f.geometry || {};
      let c = null;
      if (g.type === "Point") c = [g.coordinates];
      else if (g.type === "LineString") c = g.coordinates;
      else if (g.type === "MultiLineString") c = g.coordinates.flat();
      else if (g.type === "Polygon") c = [centroid(g.coordinates[0])];
      else if (g.type === "MultiPoint") c = g.coordinates;
      if (!c) return { error: `unsupported geometry ${g.type || "(none)"}` };
      return toProject(f.properties || {}, c.map(([lon, lat]) => [lat, lon]), defaults, i);
    });
  }
  const centroid = ring => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

  // Parse file text by extension/content. defaults: { utility, source, batch }.
  function parsePlan(text, filename, defaults) {
    const d = Object.assign({ batch: Date.now().toString(36) }, defaults);
    let results;
    const t = text.trim();
    if (/\.(geo)?json$/i.test(filename) || t.startsWith("{") || t.startsWith("[")) {
      const js = JSON.parse(t);
      if (js.type === "FeatureCollection" || js.type === "Feature") results = fromGeoJSON(js, d);
      else {
        const arr = Array.isArray(js) ? js : js.projects || [];
        results = arr.map((r, i) => r.coords ? toProject(r, r.coords, d, i) : toProject(r, null, d, i));
      }
    } else results = parseDelimited(text).map((r, i) => toProject(r, null, d, i));
    const projects = results.filter(r => r.project).map(r => r.project);
    const errors = results.map((r, i) => r.error ? `row ${i + 1}: ${r.error}` : null).filter(Boolean);
    return { projects, errors, total: results.length };
  }

  const TEMPLATE = [
    "utility,name,kv,type,start,in_service,lat,lon,lat2,lon2,cost,description",
    "Santee Cooper,Example 230 kV line,230,new_line,2027-01-01,2028-12-31,33.20,-80.10,33.40,-79.90,42000000,Two-point line from A to B",
    "Santee Cooper,Example substation,115,substation,,2029,33.05,-80.00,,,8000000,Year-only dates are fine",
  ].join("\n");

  const api = { parsePlan, parseDelimited, toDate, toType, TEMPLATE, ALIASES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Ingest = api;
})(this);
