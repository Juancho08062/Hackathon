// Seamline overlap engine: geometry, distance tiers, build windows and the rough savings model.
// Pure functions with no DOM access, so the same file runs in the browser and in Node (tests/engine.test.js).
(function (root) {
  // ---------- geometry (km, local equirectangular projection) ----------
  const LAT0 = 33;
  const KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 110.57;
  const xy = ([lat, lon]) => [lon * KX, lat * KY];
  const unxy = ([x, y]) => [y / KY, x / KX];

  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * dx, a[1] + t * dy];
    return [Math.hypot(p[0] - q[0], p[1] - q[1]), q];
  }
  function crosses(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  }
  // A project is one or more parts (a multi-part line, or several points); coords is every point, parts keeps them apart
  // so no segment is ever drawn or measured between two separate parts.
  const partsOf = p => p.parts || [p.coords];
  const isLine = p => partsOf(p).some(c => c.length > 1);
  function segments(p) {
    return partsOf(p).flatMap(part => { const c = part.map(xy); return c.length === 1 ? [[c[0], c[0]]] : c.slice(1).map((v, i) => [c[i], v]); });
  }
  // Distance between the closest points of two projects (lines or points), not their centers.
  // Returns [km, closest point on p, closest point on q] with points as [lat, lon].
  function closest(p, q) {
    let best = [Infinity, null, null];
    for (const [a, b] of segments(p)) for (const [c, d] of segments(q)) {
      if (a !== b && c !== d && crosses(a, b, c, d)) {
        const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
        const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
        const X = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        return [0, unxy(X), unxy(X)];
      }
      for (const [pt, s1, s2] of [[a, c, d], [b, c, d]]) { const [dd, qq] = segDist(pt, s1, s2); if (dd < best[0]) best = [dd, pt, qq]; }
      for (const [pt, s1, s2] of [[c, a, b], [d, a, b]]) { const [dd, qq] = segDist(pt, s1, s2); if (dd < best[0]) best = [dd, qq, pt]; }
    }
    return [best[0], unxy(best[1]), unxy(best[2])];
  }
  const lengthKm = p => p.miles ? p.miles * 1.609
    : isLine(p) ? segments(p).reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0) : 0;

  // ---------- distance tiers (challenge spec) ----------
  const TIERS = [
    { max: 0.1, label: "Touching or crossing", short: "Touching", means: "Must coordinate outage timing and crossing structures", tok: "--t0" },
    { max: 1.6, label: "Under 1.6 km", short: "Shared land", means: "Can share right-of-way, access roads and permits", tok: "--t1" },
    { max: 8, label: "Under 8 km", short: "Shared site", means: "Can share laydown yards and deliveries", tok: "--t2" },
    { max: 40, label: "Under 40 km", short: "Shared crews", means: "Can share crews, cranes and contractors", tok: "--t3" },
    { max: Infinity, label: "Over 40 km", short: "Outside 40 km", means: "Beyond one staging yard's daily drive", tok: "--ink3" },
  ];
  const tierOf = km => TIERS.findIndex(t => km <= t.max);
  // What each tier lets two projects share, in the challenge's own words. Closer tiers also get everything farther
  // tiers allow. Crew and yard sharing only happens if both are under construction at the same time (window: true).
  const SHARES = [
    { tier: 0, label: "Touching or crossing", items: ["Outage timing", "Crossing structures"], window: false },
    { tier: 1, label: "Under 1.6 km", items: ["Right-of-way", "Access roads", "Permits"], window: false },
    { tier: 2, label: "Under 8 km", items: ["Laydown yards", "Deliveries"], window: true },
    { tier: 3, label: "Under 40 km", items: ["Crews", "Cranes", "Contractors"], window: true },
  ];
  const shareable = x => SHARES.filter(s => x.tier <= s.tier).map(s => Object.assign({}, s, { active: !s.window || x.sameWindow }));

  // ---------- build windows ----------
  const monthIndex = iso => { const d = new Date(iso + "T00:00:00Z"); return d.getUTCFullYear() * 12 + d.getUTCMonth() + d.getUTCDate() / 31; };
  // Positive = months the two build windows overlap; negative = months between them.
  function windowOverlap(p, q) {
    return Math.min(monthIndex(p.in_service), monthIndex(q.in_service)) - Math.max(monthIndex(p.start), monthIndex(q.start));
  }
  // Construction duration used when a plan lists only an in-service date.
  function estMonths(type, kv, miles) {
    if (type === "generation") return 36;
    if (type === "substation") return kv >= 500 ? 18 : 12;
    if (type === "new_line") return kv >= 500 ? 36 : (miles || 0) > 10 ? 24 : 18;
    return Math.round(Math.min(30, 10 + (miles || 5) * 0.5));
  }

  // ---------- shared resources ----------
  const kvClass = kv => kv >= 500 ? "500 kV" : kv >= 230 ? "230 kV" : kv >= 115 ? "115 kV" : "sub-115 kV";
  const conductor = p => { const m = (p.desc || "").match(/(795|954|1033|1113|1272|1351)\s*(ACSS|ACSR|ACCR)?/i); return m ? m[1] : null; };
  function sharedResources(p, q) {
    const r = [];
    if (kvClass(p.kv) === kvClass(q.kv)) r.push(`${kvClass(p.kv)} crews`);
    if (p.type === q.type) r.push({ new_line: "line construction and stringing equipment", rebuild: "rebuild and reconductor crews", substation: "substation crews and equipment", generation: "plant construction labor" }[p.type]);
    const cp = conductor(p), cq = conductor(q);
    if (cp && cp === cq) r.push(`${cp} conductor bulk order`);
    if (p.type === "generation" || q.type === "generation") r.push("heavy-haul routes");
    if ((p.kv >= 500 || q.kv >= 500) && p.kv >= 230 && q.kv >= 230) r.push("heavy cranes");
    return r.filter(Boolean);
  }

  // ---------- rough cost / impact model ----------
  // Planning-level unit costs, used only when a plan lists no cost.
  const PER_KM = { new_line: { 500: 2.5e6, 230: 1.4e6, 115: 0.95e6, 46: 0.6e6 }, rebuild: { 500: 1.25e6, 230: 0.75e6, 115: 0.55e6, 46: 0.4e6 } };
  const SUB = { 500: 60e6, 230: 25e6, 115: 8e6, 46: 4e6 };
  // Unit costs behind each shared item. Planning assumptions, editable in the app's Cost assumptions panel.
  // "check" names a public source to compare against; the values are Seamline's round planning numbers, not quotes from it.
  const ASSUMPTIONS = [
    { key: "outage", group: "Touching or crossing", label: "Coordinated outage", unit: "$ per outage avoided", value: 250e3, check: "switching crews, standby and replacement power for one planned outage" },
    { key: "crossing", group: "Touching or crossing", label: "Crossing structure design", unit: "$ per crossing", value: 120e3, check: "engineering and one set of crossing structures designed once" },
    { key: "rowKm", group: "Under 1.6 km", label: "Shared corridor length", unit: "km", value: 1.0, check: "length where the two projects could run side by side" },
    { key: "rowWidthM", group: "Under 1.6 km", label: "Right-of-way width", unit: "m", value: 45, check: "typical 115 to 230 kV easement is 30 to 45 m (100 to 150 ft)" },
    { key: "landPerAcre", group: "Under 1.6 km", label: "Easement cost", unit: "$ per acre", value: 15e3, check: "compare with USDA NASS Land Values; easements usually cost more than the land's farm value" },
    { key: "accessPerKm", group: "Under 1.6 km", label: "Access road", unit: "$ per km", value: 90e3, check: "gravel construction access road, grading and culverts" },
    { key: "permits", group: "Under 1.6 km", label: "Permit package", unit: "$ per package", value: 150e3, check: "environmental review, wetlands and local permits filed once" },
    { key: "yard", group: "Under 8 km", label: "Laydown yard", unit: "$ per yard", value: 400e3, check: "about 3 ha (7 acres) of lease, grading, fencing and security for the build" },
    { key: "loads", group: "Under 8 km", label: "Shared deliveries", unit: "loads combined", value: 12, check: "heavy-haul loads that can share one trip" },
    { key: "perLoad", group: "Under 8 km", label: "Heavy-haul trip", unit: "$ per load", value: 5e3, check: "oversize permit, escort and trucking for one load" },
    { key: "mobPct", group: "Under 40 km", label: "Crew mobilization", unit: "% of project cost", value: 5, check: "mobilization is commonly 3 to 7% of construction cost" },
    { key: "craneDays", group: "Under 40 km", label: "Crane days shared", unit: "days", value: 20, check: "days a crane can move between the two sites instead of two rentals" },
    { key: "craneDay", group: "Under 40 km", label: "Crane rental", unit: "$ per day", value: 6.5e3, check: "crawler or truck crane with operator, compare with local rental rates" },
    { key: "contractorPct", group: "Under 40 km", label: "Contractor overhead", unit: "% of project cost", value: 1, check: "bidding, supervision and site setup a shared contractor avoids" },
    { key: "haulKm", group: "Shared yard", label: "Haul distance to the yard", unit: "km one way", value: 160, check: "from the supplier or equipment depot; with one shared yard, heavy loads for every project ride the same trips" },
    { key: "shuttles", group: "Shared yard", label: "Yard-to-site trips", unit: "round trips per project", value: 40, check: "material and equipment runs from the yard to each work site over the build" },
    { key: "circuity", group: "Shared yard", label: "Road distance factor", unit: "× straight line", value: 1.3, check: "roads are longer than a straight line; 1.2 to 1.4 is typical in rural areas" },
    { key: "mph", group: "Shared yard", label: "Average truck speed", unit: "mph", value: 45, check: "mixed highway and county roads" },
    { key: "mpg", group: "Shared yard", label: "Heavy truck fuel economy", unit: "miles per gallon", value: 6, check: "loaded Class 8 diesel trucks usually get 5 to 7 mpg" },
    { key: "co2Gal", group: "Shared yard", label: "CO2 per gallon of diesel", unit: "kg", value: 10.21, check: "EPA GHG Emission Factors Hub, diesel fuel" },
    { key: "share", group: "All", label: "Each side’s share of a shared cost", unit: "%", value: 50, check: "a shared cost is split, so half of one side's cost is saved" },
  ];
  const DEFAULTS = Object.fromEntries(ASSUMPTIONS.map(a => [a.key, a.value]));
  const ASSUME = Object.assign({}, DEFAULTS);
  const kvKey = kv => kv >= 500 ? 500 : kv >= 230 ? 230 : kv >= 115 ? 115 : 46;
  function estCost(p) {
    if (p.cost) return { v: p.cost, est: false };
    if (p.type === "generation") return { v: 30e6, est: true, note: "switchyard and interconnection share only" };
    if (p.type === "substation") return { v: SUB[kvKey(p.kv)], est: true };
    return { v: PER_KM[p.type === "new_line" ? "new_line" : "rebuild"][kvKey(p.kv)] * Math.max(lengthKm(p), 3), est: true };
  }
  // One line per shareable item, each with its own estimate and the math behind it.
  function savings(x) {
    const A = ASSUME, items = [], sh = A.share / 100;
    const ca = estCost(x.p), cb = estCost(x.q), small = ca.v <= cb.v ? ca : cb;
    const add = (share, k, v, how) => items.push({ share, k, v, how });
    const sm = `${fmtMoney(small.v)}${small.est ? " est." : ""}`;
    if (x.tier === 0) {
      add("Outage timing", "One coordinated outage", A.outage, `one planned outage instead of two, ${fmtMoney(A.outage)}`);
      add("Crossing structures", "Crossing designed once", A.crossing, `one crossing design and structure set, ${fmtMoney(A.crossing)}`);
    }
    if (x.tier <= 1) {
      const acres = A.rowKm * 1000 * A.rowWidthM / 4046.86;
      add("Right-of-way", "Shared right-of-way", acres * A.landPerAcre * sh, `${acres.toFixed(1)} acres (${A.rowKm} km × ${A.rowWidthM} m) × ${fmtMoney(A.landPerAcre)}/acre × ${A.share}%`);
      add("Access roads", "Shared access road", A.rowKm * A.accessPerKm * sh, `${A.rowKm} km × ${fmtMoney(A.accessPerKm)}/km × ${A.share}%`);
      add("Permits", "Joint permit package", A.permits * sh, `one ${fmtMoney(A.permits)} package instead of two × ${A.share}%`);
    }
    if (x.tier <= 2 && x.sameWindow) {
      add("Laydown yards", "One laydown yard", A.yard * sh, `one ${fmtMoney(A.yard)} yard instead of two × ${A.share}%`);
      add("Deliveries", "Combined deliveries", A.loads * A.perLoad * sh, `${A.loads} loads × ${fmtMoney(A.perLoad)} × ${A.share}%`);
    }
    if (x.tier <= 3 && x.sameWindow) {
      add("Crews", "One crew mobilization", small.v * A.mobPct / 100 * sh, `${A.mobPct}% of the smaller project (${sm}) × ${A.share}%`);
      add("Cranes", "Shared crane time", A.craneDays * A.craneDay * sh, `${A.craneDays} days × ${fmtMoney(A.craneDay)}/day × ${A.share}%`);
      add("Contractors", "One contractor setup", small.v * A.contractorPct / 100 * sh, `${A.contractorPct}% of the smaller project (${sm}) × ${A.share}%`);
    }
    return { items, total: items.reduce((s, i) => s + i.v, 0), ca, cb };
  }
  const setAssumptions = vals => { Object.assign(ASSUME, DEFAULTS); for (const [k, v] of Object.entries(vals || {})) if (k in DEFAULTS && isFinite(v) && v >= 0) ASSUME[k] = +v; };
  const customized = () => ASSUMPTIONS.some(a => ASSUME[a.key] !== a.value);
  const fmtMoney = c => c == null ? "" : c >= 1e6 ? "$" + (c / 1e6).toFixed(1) + "M" : c >= 1e4 || c === 0 ? "$" + Math.round(c / 1e3) + "K" : c >= 1e3 ? "$" + +(c / 1e3).toFixed(1) + "K" : "$" + Math.round(c);

  // ---------- shared yard finder ----------
  // Distance (km) from a point (x, y km) to a project's nearest point, and that point.
  function toProject(y, p) {
    let best = [Infinity, null];
    for (const [a, b] of segments(p)) { const r = segDist(y, a, b); if (r[0] < best[0]) best = r; }
    return best;
  }
  // One staging yard for a group of projects: the point with the smallest total straight-line distance to every
  // project's nearest point (a geometric median, by Weiszfeld's method). If an existing substation or plant, or one of
  // the projects' own substations, is almost as good (within 15% more total distance and still inside maxKm of every
  // site), the yard moves there, since those sites already have road access and fenced land.
  function yardFor(ps, anchors, maxKm = 40) {
    const mid = p => { const c = p.coords.map(xy); return [c.reduce((s, v) => s + v[0], 0) / c.length, c.reduce((s, v) => s + v[1], 0) / c.length]; };
    let y = ps.map(mid).reduce((s, v) => [s[0] + v[0] / ps.length, s[1] + v[1] / ps.length], [0, 0]);
    for (let it = 0; it < 80; it++) {
      let nx = 0, ny = 0, w = 0;
      for (const p of ps) { const [d, q] = toProject(y, p), k = 1 / Math.max(d, 0.05); nx += q[0] * k; ny += q[1] * k; w += k; }
      const n = [nx / w, ny / w], moved = Math.hypot(n[0] - y[0], n[1] - y[1]);
      y = n; if (moved < 0.01) break;
    }
    const measure = pt => { const d = ps.map(p => toProject(pt, p)[0]); return { d, total: d.reduce((s, v) => s + v, 0), max: Math.max(...d) }; };
    let best = Object.assign({ pt: y, near: null }, measure(y));
    const opt = best.total;
    const cands = ps.filter(p => p.coords.length === 1).concat((anchors || []).filter(a => a.coords && a.coords.length === 1));
    let pick = null;
    for (const c of cands) {
      const pt = xy(c.coords[0]), m = measure(pt);
      if (m.total <= opt * 1.15 + 1 && m.max <= maxKm && (!pick || m.total < pick.total)) pick = Object.assign({ pt, near: c.name.split(" (")[0] }, m);
    }
    if (pick) best = pick;
    return { at: unxy(best.pt), near: best.near, dists: best.d, total: best.total, max: best.max, spokes: ps.map(p => unxy(toProject(best.pt, p)[1])) };
  }
  // What one shared yard saves on the road. Heavy loads for every project after the first ride shared trips from the
  // depot; the yard-to-site runs the shared yard adds are subtracted. Miles are net of both.
  function yardImpact(yd, n) {
    const A = ASSUME, km2mi = 1 / 1.609;
    const haulMi = A.loads * (n - 1) * 2 * A.haulKm * km2mi;
    const shuttleMi = yd.dists.reduce((s, d) => s + d * A.circuity * 2 * A.shuttles, 0) * km2mi;
    const netMi = haulMi - shuttleMi;
    return { n, haulMi, shuttleMi, netMi, hours: netMi / A.mph, co2t: netMi / A.mpg * A.co2Gal / 1000, yardsAvoided: n - 1, dollars: A.yard * (n - 1) };
  }
  // Coordination clusters: chains of cross-utility pairs that are near and built in the same window, joined into
  // groups of 3 or more projects. Each group gets one yard; a project farther than maxKm from it is dropped (farthest
  // first) until everyone left is within a day's drive. Only groups with both utilities and 3+ projects are kept.
  function clusters(pairs, anchors, maxKm = 40) {
    const cand = pairs.filter(x => x.near && x.sameWindow && x.km <= maxKm), par = new Map();
    const find = p => { while (par.get(p) !== p) p = par.get(p); return p; };
    for (const x of cand) for (const p of [x.p, x.q]) if (!par.has(p)) par.set(p, p);
    for (const x of cand) par.set(find(x.p), find(x.q));
    const groups = new Map();
    for (const p of par.keys()) { const r = find(p); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
    const out = [];
    for (let ps of groups.values()) {
      if (ps.length < 3) continue;
      let yd = yardFor(ps, anchors, maxKm);
      while (ps.length >= 3 && yd.max > maxKm) { const i = yd.dists.indexOf(yd.max); ps = ps.filter((_, j) => j !== i); yd = yardFor(ps, anchors, maxKm); }
      if (ps.length < 3 || new Set(ps.map(p => p.utility)).size < 2) continue;
      out.push({ projects: ps, yard: yd, impact: yardImpact(yd, ps.length), pairs: cand.filter(x => ps.includes(x.p) && ps.includes(x.q)) });
    }
    return out.sort((a, b) => b.projects.length - a.projects.length || b.impact.netMi - a.impact.netMi);
  }

  // ---------- pairing and ranking ----------
  // opts: { utilA, utilB, maxKm, bufferMonths, mode: "near" | "both" | "time" }
  function findOverlaps(projects, opts) {
    const A = projects.filter(p => p.utility === opts.utilA), B = projects.filter(p => p.utility === opts.utilB);
    const out = [];
    for (const p of A) for (const q of B) {
      const [km, ca, cb] = closest(p, q);
      const ov = windowOverlap(p, q);
      const near = km <= opts.maxKm, sameWindow = -ov <= opts.bufferMonths;
      if (opts.mode === "both" && !(near && sameWindow)) continue;
      if (opts.mode === "near" && !near) continue;
      if (opts.mode === "time" && !sameWindow) continue;
      const x = { p, q, km, tier: tierOf(km), ov: Math.max(0, ov), gap: Math.max(0, -ov), sameWindow, near, res: sharedResources(p, q), ca, cb };
      x.sav = savings(x);
      out.push(x);
    }
    // Geography first (tier), then timing (same build window first), then closest distance.
    out.sort(opts.mode === "time"
      ? (a, b) => b.ov - a.ov || a.km - b.km
      : (a, b) => a.tier - b.tier || b.sameWindow - a.sameWindow || a.km - b.km);
    return { pairs: out, checked: A.length * B.length };
  }

  // findOverlaps, remembered: the same projects, options and data version return the cached result, so filtering
  // and search never re-run the comparison. version must change whenever the project list or cost assumptions change.
  let lastKey = null, lastResult = null;
  function cachedOverlaps(projects, opts, version) {
    const key = JSON.stringify([opts, projects.length, version, ASSUME]);
    if (key !== lastKey) { lastKey = key; lastResult = findOverlaps(projects, opts); }
    return lastResult;
  }

  // ---------- what-if schedule shift ----------
  // An ISO date moved by m whole months (day capped at 28 so every month has it).
  const shiftISO = (iso, m) => { const d = new Date(iso + "T00:00:00Z"), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m); d.setUTCDate(Math.min(day, 28)); return d.toISOString().slice(0, 10); };
  // Smallest move of one project ("p" or "q") that gives the two builds a real shared window: 6 months, or all of the
  // shorter build. 0 if they already share it, null if no move within 5 years does. Remembered per pair and dates.
  const recCache = new Map();
  function recommendShift(x, who) {
    const key = `${x.p.id}|${x.q.id}|${who}|${x.p.start}|${x.p.in_service}|${x.q.start}|${x.q.in_service}`;
    if (recCache.has(key)) return recCache.get(key);
    recommendShift.computed++;
    const dur = p => monthIndex(p.in_service) - monthIndex(p.start), need = Math.min(6, dur(x.p), dur(x.q));
    const moved = m => { const o = x[who], n = { start: shiftISO(o.start, m), in_service: shiftISO(o.in_service, m) }; return who === "p" ? windowOverlap(n, x.q) : windowOverlap(x.p, n); };
    let rec = null;
    if (windowOverlap(x.p, x.q) >= need) rec = 0;
    else for (let a = 1; a <= 60 && rec == null; a++) for (const m of [-a, a]) if (moved(m) >= need) { rec = m; break; }
    recCache.set(key, rec);
    return rec;
  }
  recommendShift.computed = 0;

  // ---------- schedule risk ----------
  // Plans move. slips holds, per utility, how many months each project's date moved between two published plans
  // (data/model.json). Each draw moves both projects by a month count picked from their utility's list and checks
  // whether they still share a window; the chance is the share of draws that do. The random numbers are seeded from
  // the pair, so the same pair always gets the same answer. A project that is likely built has no window left.
  // opts: { bufferMonths, draws, today }
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) || 1; };
  function overlapChance(x, slips, opts = {}) {
    const draws = opts.draws || 2000, buf = opts.bufferMonths || 0;
    if (x.p.likely_built || x.q.likely_built) return { p: 0, why: "built" };
    const pooled = Object.values(slips || {}).flatMap(s => s.months || []);
    const list = u => (slips && slips[u] && slips[u].months && slips[u].months.length ? slips[u].months : pooled.length ? pooled : [0]);
    const la = list(x.p.utility), lb = list(x.q.utility);
    const a0 = monthIndex(x.p.start), a1 = monthIndex(x.p.in_service), b0 = monthIndex(x.q.start), b1 = monthIndex(x.q.in_service);
    let seed = hash(x.p.id + "|" + x.q.id);
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // With opts.today, only time from today on counts: a window that has already closed cannot be shared any more.
    const now = opts.today ? monthIndex(opts.today) : -Infinity;
    let hit = 0;
    for (let i = 0; i < draws; i++) {
      const sa = la[Math.floor(rnd() * la.length)], sb = lb[Math.floor(rnd() * lb.length)];
      const end = Math.min(a1 + sa, b1 + sb);
      if (end <= now) continue;
      const ov = end - Math.max(a0 + sa, b0 + sb, now);
      if (-ov <= buf) hit++;
    }
    return { p: hit / draws, draws };
  }
  // Savings weighted by that chance: items that need both crews in the field together (yards, deliveries, crews,
  // cranes, contractors) count by the chance; outage, crossing, right-of-way, access roads and permits count in full.
  // A pair with a likely built project has nothing left to share.
  function expectedSavings(x, chance) {
    if (x.p.likely_built || x.q.likely_built) return { fixed: 0, windowed: 0, expected: 0 };
    const all = savings(Object.assign({}, x, { sameWindow: true })).items;
    const needs = new Set(SHARES.filter(s => s.window).flatMap(s => s.items));
    const fixed = all.filter(i => !needs.has(i.share)).reduce((s, i) => s + i.v, 0);
    const windowed = all.filter(i => needs.has(i.share)).reduce((s, i) => s + i.v, 0);
    return { fixed, windowed, expected: fixed + chance * windowed };
  }

  // Which shared windows a plan update opened or closed: each pair is checked again with the dates the previous
  // plan listed for any project that has a drift record (months moved), keeping the other project where it is.
  function driftChanges(pairs, bufferMonths = 0) {
    const before = p => p.drift && p.drift.months ? { start: shiftISO(p.start, -p.drift.months), in_service: shiftISO(p.in_service, -p.drift.months) } : p;
    const opened = [], closed = [];
    for (const x of pairs) {
      if (!(x.p.drift && x.p.drift.months) && !(x.q.drift && x.q.drift.months)) continue;
      const was = -windowOverlap(before(x.p), before(x.q)) <= bufferMonths;
      if (!was && x.sameWindow) opened.push(x);
      if (was && !x.sameWindow) closed.push(x);
    }
    return { opened, closed };
  }

  // ---------- joint schedule optimizer ----------
  // Which few date moves raise the pairs' total expected savings the most? Greedy: each round tries moving every
  // project that has not started yet (and is not likely built or a power plant) by each step up to maxShift months either way, never
  // starting before today, and keeps the single move worth the most; it stops when no move is worth minGain or after
  // maxMoves. Each project moves at most once. Chances use the same seeded draws, so comparisons are fair.
  // opts: { today, bufferMonths, maxShift = 6, step = 3, maxMoves = 8, minGain = 25000, draws = 600, utilities (only these move) }
  function optimizeSchedule(pairs, slips, opts = {}) {
    const o = Object.assign({ bufferMonths: 0, maxShift: 6, step: 3, maxMoves: 8, minGain: 25000, draws: 600 }, opts);
    const now = o.today ? monthIndex(o.today) : -Infinity;
    const shifted = new Map();                       // project id -> moved copy
    const cur = p => shifted.get(p.id) || p;
    const rows = pairs.map(x => { const e = expectedSavings(x, 0); return { x, fixed: e.fixed, windowed: e.windowed }; });
    const chanceOf = (r, p, q) => r.windowed ? overlapChance({ p, q }, slips, { bufferMonths: o.bufferMonths, today: o.today, draws: o.draws }).p : 0;
    rows.forEach(r => { r.c = chanceOf(r, r.x.p, r.x.q); });
    const total = () => rows.reduce((s, r) => s + r.fixed + r.c * r.windowed, 0);
    const byProject = new Map();
    rows.forEach(r => [r.x.p, r.x.q].forEach(p => { if (!byProject.has(p.id)) byProject.set(p.id, { p, rows: [] }); byProject.get(p.id).rows.push(r); }));
    // Power plants are left where they are: their dates follow resource planning, not transmission crews.
    const movable = [...byProject.values()].filter(({ p }) => !p.existing && !p.likely_built && p.type !== "generation" && monthIndex(p.start) > now &&
      (!o.utilities || o.utilities.includes(p.utility)));
    const before = total(), moves = [];
    while (moves.length < o.maxMoves) {
      let best = null;
      for (const { p, rows: rs } of movable) {
        if (shifted.has(p.id)) continue;
        for (let m = -o.maxShift; m <= o.maxShift; m += o.step) {
          if (!m) continue;
          const n = Object.assign({}, p, { start: shiftISO(p.start, m), in_service: shiftISO(p.in_service, m) });
          if (monthIndex(n.start) < now) continue;
          let gain = 0;
          const after = rs.map(r => { const c = chanceOf(r, r.x.p === p ? n : cur(r.x.p), r.x.q === p ? n : cur(r.x.q)); gain += (c - r.c) * r.windowed; return c; });
          if (gain >= o.minGain && (!best || gain > best.gain + 1e-6)) best = { p, n, m, gain, rs, after };
        }
      }
      if (!best) break;
      shifted.set(best.p.id, best.n);
      const affected = best.rs.map((r, i) => ({ x: r.x, before: r.c, after: best.after[i] })).filter(a => Math.abs(a.after - a.before) > 1e-9);
      best.rs.forEach((r, i) => { r.c = best.after[i]; });
      moves.push({ id: best.p.id, project: best.p, months: best.m, gain: best.gain,
        from: { start: best.p.start, in_service: best.p.in_service }, to: { start: best.n.start, in_service: best.n.in_service }, pairs: affected });
    }
    return { moves, before, after: total() };
  }

  const api = { optimizeSchedule, driftChanges, overlapChance, expectedSavings, cachedOverlaps, shiftISO, recommendShift, partsOf, isLine, closest, lengthKm, TIERS, tierOf, SHARES, shareable, ASSUMPTIONS, setAssumptions, customized, monthIndex, windowOverlap, estMonths, sharedResources, estCost, savings, yardFor, yardImpact, clusters, ASSUME, fmtMoney, findOverlaps };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Engine = api;
})(this);
