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
  function segments(p) {
    const c = p.coords.map(xy);
    return c.length === 1 ? [[c[0], c[0]]] : c.slice(1).map((v, i) => [c[i], v]);
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
    : p.coords.length > 1 ? segments(p).reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0) : 0;

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
  const ASSUME = { mobPct: 0.05, mobShare: 0.5, yard: 400e3, rowKm: 1.0, rowWidthM: 45, landPerHa: 37e3, access: 90e3, permits: 150e3, outage: 250e3 };
  const kvKey = kv => kv >= 500 ? 500 : kv >= 230 ? 230 : kv >= 115 ? 115 : 46;
  function estCost(p) {
    if (p.cost) return { v: p.cost, est: false };
    if (p.type === "generation") return { v: 30e6, est: true, note: "switchyard and interconnection share only" };
    if (p.type === "substation") return { v: SUB[kvKey(p.kv)], est: true };
    return { v: PER_KM[p.type === "new_line" ? "new_line" : "rebuild"][kvKey(p.kv)] * Math.max(lengthKm(p), 3), est: true };
  }
  function savings(x) {
    const A = ASSUME, items = [];
    const ca = estCost(x.p), cb = estCost(x.q), small = ca.v <= cb.v ? ca : cb;
    if (x.tier <= 3 && x.sameWindow) items.push({ k: "Shared crews, cranes and contractors", v: small.v * A.mobPct * A.mobShare, how: `one mobilization instead of two: half of a ${A.mobPct * 100}% mobilization cost on the smaller project (${fmtMoney(small.v)}${small.est ? ", estimated" : ""})` });
    if (x.tier <= 2 && x.sameWindow) items.push({ k: "One laydown yard and shared deliveries", v: A.yard, how: "about 3 ha yard lease, grading and security for the build" });
    if (x.tier <= 1) {
      const ha = A.rowKm * A.rowWidthM / 10;
      items.push({ k: "Shared right-of-way, access roads and permits", v: ha * A.landPerHa + A.access + A.permits, how: `${ha.toFixed(1)} ha of ${A.rowWidthM} m corridor over ${A.rowKm} km at ${fmtMoney(A.landPerHa)}/ha, plus one access road and a joint permit package` });
    }
    if (x.tier === 0) items.push({ k: "One coordinated outage and crossing design", v: A.outage, how: "one crossing outage and crew standby instead of two, with crossing structures designed once" });
    return { items, total: items.reduce((s, i) => s + i.v, 0), ca, cb };
  }
  const fmtMoney = c => c == null ? "" : c >= 1e6 ? "$" + (c / 1e6).toFixed(1) + "M" : "$" + Math.round(c / 1e3) + "K";

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

  const api = { closest, lengthKm, TIERS, tierOf, SHARES, shareable, monthIndex, windowOverlap, estMonths, sharedResources, estCost, savings, ASSUME, fmtMoney, findOverlaps };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Engine = api;
})(this);
