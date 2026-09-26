// Seamline 3D: a realistic scene of one flagged pair — both utilities' lattice towers, wires, substations and plants,
// the closest-point link, and the shared zone the tier allows (corridor, laydown yard or staging yard).
// three.js loads on first use. Horizontal positions are to scale; heights are exaggerated so towers read.
// Rendering: PBR materials, a physical sky that also lights the scene, soft shadows, HDR bloom and ACES tone mapping.
// Quality presets trade speed for sharpness: pixel ratio, shadow map size, terrain and texture detail, SSAO and SMAA.
(function (root) {
  const PAL = {
    fog: 0xa9bccb, sun: 0xfff1d6,
    grass: 0x5f8058, grassDark: 0x3f5c47, grassDry: 0x93a06c, rock: 0x4a5560, lowland: 0x62806f,
    steel: 0xaebfcc, steelDark: 0x5c6f80, porcelain: 0xe2d6bd, gravel: 0x9d9b90, concrete: 0xb9b7ac,
    fence: 0x46525c, ridge: 0x4f6b55, water: 0x24505c, pine: 0x2f5140, trunk: 0x4a3b2e, crane: 0xe0a93e,
  };

  let ctx = null, last = null, walkCtl = null;
  // Extension points for add-on files (loaded after this one) to plug in without editing it:
  //   hooks.vehicle(T, bag, kind, x, y, z, rot, k, put) returns true when it built that kind itself;
  //   hooks.setupRender({ T, renderer, scene, cam, composer, Q, built }) runs once per open, before the first frame.
  const hooks = { vehicle: null, setupRender: null };
  // Two looks. Detailed (the default) is the stylized scene with full models, ambient occlusion and SMAA.
  // Ultra-realistic adds texture maps, galvanized steel and bare aluminum wires, loblolly pines, denser ground
  // cover, finer terrain and a wider occlusion kernel. dpr caps the pixel ratio; seg and tex set terrain and grass
  // detail. Old saved settings map onto the new pair.
  const QUALITY = {
    detailed: { dpr: 2, shadow: 4096, seg: 200, tex: 512, ssao: 16, smaa: true, real: false },
    realistic: { dpr: 2, shadow: 4096, seg: 260, tex: 1024, ssao: 24, smaa: true, real: true },
  };
  const qualityKey = q => QUALITY[q] ? q : q === "ultra" ? "realistic" : "detailed";
  const ensureThree = q => root.Libs.need("THREE", "OrbitControls", "ThreeExtras")
    .then(() => q.ssao || q.smaa ? root.Libs.need("ThreeQuality").then(() => q, () => Object.assign({}, q, { ssao: 0, smaa: false })) : q);

  // ---------- helpers ----------
  // PBR material helper. `rough` and `metal` set roughness and metalness; `shininess` of 40 or more means a glossy surface.
  const pbr = (T, color, extra = {}) => {
    const { shininess, rough, metal, ...rest } = extra;
    return new T.MeshStandardMaterial(Object.assign({ color, roughness: rough ?? (shininess >= 40 ? 0.35 : 0.85), metalness: metal ?? 0 }, rest));
  };
  const STEEL = { metal: 0.65, rough: 0.38 };
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const makeLabel = (text, color, pos, size = "") => ({ text, color, pos: pos.clone(), size });
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // Concatenate geometries into one non-indexed geometry (one draw call per structure).
  function merge(T, geos) {
    const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
    const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    parts.forEach(g => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; });
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.BufferAttribute(pos, 3));
    out.setAttribute("normal", new T.BufferAttribute(nor, 3));
    return out;
  }
  // A square beam from a to b.
  function beam(T, a, b, t) {
    const d = b.clone().sub(a), len = d.length();
    const g = new T.BoxGeometry(t, len, t);
    g.applyMatrix4(new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize())));
    const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z);
    return g;
  }
  const boxAt = (T, w, h, d, x, y, z) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const cylAt = (T, r1, r2, h, seg, x, y, z) => { const g = new T.CylinderGeometry(r1, r2, h, seg); g.translate(x, y, z); return g; };
  function mesh(T, geo, mat, shadow = true) { const m = new T.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; return m; }

  // ---------- materials ----------
  // One set of materials per scene. Ultra-realistic adds tiling texture maps (corrugated siding, concrete, gravel)
  // and drops the colored glow on utility trim, so steel looks galvanized and wires look like aluminum.
  function canvasTex(T, N, draw, rep = 1) {
    const c = document.createElement("canvas"); c.width = c.height = N;
    draw(c.getContext("2d"), N, rng(N + 5));
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep, rep); t.encoding = T.sRGBEncoding;
    return t;
  }
  function kit(T, real, aniso) {
    const texs = [];
    const tex = (N, draw, rep) => { const t = canvasTex(T, N, draw, rep); t.anisotropy = aniso || 4; texs.push(t); return t; };
    const speckle = (x, N, r, base, spread, n, sz) => {
      x.fillStyle = `rgb(${base},${base},${base})`; x.fillRect(0, 0, N, N);
      for (let i = 0; i < n; i++) { const v = base + Math.round((r() - 0.5) * spread); x.fillStyle = `rgb(${v},${v},${v - 4})`; x.fillRect(r() * N, r() * N, 1 + r() * sz, 1 + r() * sz); }
    };
    // vertical ribs of corrugated metal siding, one tile per scene unit
    const siding = real && tex(64, (x, N) => { for (let i = 0; i < N; i++) { const v = 206 + Math.round(34 * Math.sin(i / N * Math.PI * 2 * 6)); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, N); } });
    const concrete = real && tex(128, (x, N, r) => { speckle(x, N, r, 214, 40, 2600, 2); x.strokeStyle = "rgba(90,90,90,.35)"; x.strokeRect(0.5, 0.5, N - 1, N - 1); });
    const gravel = real && tex(128, (x, N, r) => speckle(x, N, r, 190, 110, 5200, 3), 1);
    const grime = real && tex(128, (x, N, r) => { speckle(x, N, r, 236, 26, 900, 3); for (let i = 0; i < 40; i++) { x.fillStyle = "rgba(120,110,95,.06)"; x.fillRect(r() * N, 0, 1 + r() * 3, N); } });
    const m = (color, o = {}) => pbr(T, color, o);
    const K = {
      real, texs,
      steel: m(PAL.steel, STEEL), galv: m(real ? 0xa9b1b6 : PAL.steel, real ? { metal: 0.75, rough: 0.5, map: grime } : STEEL),
      dark: m(0x2b3137, { rough: 0.7 }), darkSteel: m(PAL.steelDark, STEEL),
      concrete: m(PAL.concrete, real ? { map: concrete, rough: 0.92 } : {}), gravel: m(PAL.gravel, real ? { map: gravel, bumpMap: gravel, bumpScale: 0.02, rough: 1 } : {}),
      siding: m(0xdcdfdc, real ? { map: siding, bumpMap: siding, bumpScale: 0.015, metal: 0.35, rough: 0.55 } : {}),
      sidingDark: m(0x6d7a84, real ? { map: siding, bumpMap: siding, bumpScale: 0.015, metal: 0.35, rough: 0.55 } : {}),
      hrsg: m(0x9aa4aa, real ? { map: siding, metal: 0.3, rough: 0.6 } : {}), roof: m(0x8e979c, { rough: 0.7 }),
      stack: m(real ? 0xb4b8b8 : 0xc3cbd0, real ? { metal: 0.55, rough: 0.45, map: grime } : STEEL),
      ctower: m(0x9fb0b8, real ? { map: siding, rough: 0.8 } : {}), white: m(0xeceeec, real ? { map: grime, rough: 0.6 } : {}),
      pipe: m(0xd6d9d6, { rough: 0.5, metal: 0.3 }), gas: m(0xe0b83a, { rough: 0.5 }),
      trans: m(0x7e8b93, real ? { map: grime, rough: 0.55, metal: 0.25 } : {}), porcelain: m(real ? 0x8a5d45 : PAL.porcelain, { shininess: 40 }),
      alum: m(0xc9ced2, { metal: 0.8, rough: 0.3 }), asphalt: m(0x3a3d40, { rough: 0.95 }),
      glass: m(real ? 0x223038 : 0x6f93ad, { rough: 0.08, metal: 0.4 }), tire: m(0x1a1c1f, { rough: 0.92 }), rim: m(0xb9bfc4, { metal: 0.85, rough: 0.3 }),
      paint: m(0xf1f1ec, { rough: 0.35, metal: 0.1 }), yellow: m(0xe7ae1c, { rough: 0.45, metal: 0.1 }), orange: m(0xee7a22, { rough: 0.5 }),
      lamp: m(0xfff4d8, { emissive: 0xfff1cc, emissiveIntensity: 0.5, rough: 0.2 }), red: m(0xb3261e, { emissive: 0x5a0d08, emissiveIntensity: 0.4 }),
      amber: m(0xf29a1f, { emissive: 0x7a4200, emissiveIntensity: 0.5 }), wood: m(0x8a6440, { rough: 0.9 }), fence: m(PAL.fence, { metal: 0.5, rough: 0.5 }),
      trimOf: c => real ? m(c, { rough: 0.5 }) : m(c, { emissive: c, emissiveIntensity: 0.2 }),
    };
    return K;
  }
  // Box-projected texture coordinates in scene units, so siding ribs and concrete panels keep their size on any face.
  function boxUV(T, geo, k = 1) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
      uv[i * 2] = u * k; uv[i * 2 + 1] = v * k;
    }
    geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
    return geo;
  }
  // Parts are collected per material in a bag, then each material becomes one merged mesh.
  const put = (B, key, ...geos) => (B[key] || (B[key] = [])).push(...geos);
  function flush(T, B, K, g, uvk = 1) {
    Object.entries(B).forEach(([k, list]) => { if (list.length) g.add(mesh(T, boxUV(T, merge(T, list), uvk), K[k])); });
    return g;
  }
  const cylX = (T, r1, r2, len, seg, x, y, z) => { const g = new T.CylinderGeometry(r1, r2, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g; };
  const cylZ = (T, r1, r2, len, seg, x, y, z) => { const g = new T.CylinderGeometry(r1, r2, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g; };
  // A porcelain or polymer insulator: a core with n weather sheds, standing on y0.
  function insulator(T, B, x, y0, z, h, r, n = 7, key = "porcelain") {
    put(B, key, cylAt(T, r * 0.45, r * 0.5, h, 8, x, y0 + h / 2, z));
    for (let i = 0; i < n; i++) put(B, key, cylAt(T, r, r, h * 0.035, 10, x, y0 + h * (0.12 + 0.8 * i / Math.max(1, n - 1)), z));
    put(B, "alum", cylAt(T, r * 0.55, r * 0.55, h * 0.06, 8, x, y0 + h, z));
  }
  // Power transformer of footprint a: tank, radiator banks, conservator, bushings with sheds, on a concrete plinth.
  function transformer(T, B, x, y0, z, a, rot = 0) {
    const parts = {}, P = (k, g) => put(parts, k, g);
    P("concrete", boxAt(T, a * 1.3, 0.08, a * 0.95, 0, 0.04, 0));
    P("trans", boxAt(T, a, a * 0.78, a * 0.58, 0, 0.08 + a * 0.39, 0));
    P("trans", boxAt(T, a * 1.02, a * 0.04, a * 0.6, 0, 0.08 + a * 0.8, 0));
    for (const s of [-1, 1]) for (let k = 0; k < 7; k++) P("trans", boxAt(T, a * 0.025, a * 0.62, a * 0.24, -a * 0.39 + k * a * 0.13, 0.08 + a * 0.4, s * (a * 0.29 + a * 0.13)));
    for (const s of [-1, 1]) P("trans", boxAt(T, a * 0.86, a * 0.03, a * 0.03, 0, 0.08 + a * 0.68, s * a * 0.53), boxAt(T, a * 0.86, a * 0.03, a * 0.03, 0, 0.08 + a * 0.14, s * a * 0.53));
    const top = 0.08 + a * 0.82;
    P("trans", cylX(T, a * 0.1, a * 0.1, a * 0.62, 14, -a * 0.05, top + a * 0.34, -a * 0.2));
    for (const dx of [-0.25, 0.15]) P("darkSteel", boxAt(T, a * 0.03, a * 0.26, a * 0.03, dx * a, top + a * 0.13, -a * 0.2));
    [-0.3, 0, 0.3].forEach(dx => insulatorTo(parts, dx * a, top, a * 0.12, a * 0.5, a * 0.07, 9));
    [-0.25, 0, 0.25].forEach(dx => insulatorTo(parts, dx * a, top, -a * 0.05, a * 0.24, a * 0.05, 5));
    P("dark", boxAt(T, a * 0.14, a * 0.22, a * 0.08, a * 0.42, 0.08 + a * 0.25, a * 0.34));
    function insulatorTo(bag, ix, iy, iz, h, r, n) { insulator(T, bag, ix, iy, iz, h, r, n); }
    const mtx = new T.Matrix4().makeRotationY(rot).setPosition(x, y0, z);
    Object.entries(parts).forEach(([k, list]) => list.forEach(g => put(B, k, g.applyMatrix4(mtx))));
  }
  // Square lattice column (4 legs with zigzag bracing) and a lattice girder between two columns.
  function latticeColumn(T, list, x, z, h, w, y0 = 0) {
    const V = (a, b, c) => new T.Vector3(a, b, c), n = Math.max(3, Math.round(h / w / 1.2)), t = w * 0.09;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push(beam(T, V(x + sx * w / 2, y0, z + sz * w / 2), V(x + sx * w / 2, y0 + h, z + sz * w / 2), t));
    for (let i = 0; i < n; i++) {
      const a = y0 + h * i / n, b = y0 + h * (i + 1) / n, s = i % 2 ? 1 : -1;
      for (const sz of [-1, 1]) list.push(beam(T, V(x - s * w / 2, a, z + sz * w / 2), V(x + s * w / 2, b, z + sz * w / 2), t * 0.55));
      for (const sx of [-1, 1]) list.push(beam(T, V(x + sx * w / 2, a, z - s * w / 2), V(x + sx * w / 2, b, z + s * w / 2), t * 0.55));
    }
  }
  function latticeGirder(T, list, x0, x1, y, z, d) {
    const V = (a, b, c) => new T.Vector3(a, b, c), n = Math.max(4, Math.round((x1 - x0) / d)), t = d * 0.1;
    for (const dy of [0, d]) for (const dz of [-d / 2, d / 2]) list.push(beam(T, V(x0, y + dy, z + dz), V(x1, y + dy, z + dz), t));
    for (let i = 0; i < n; i++) {
      const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n;
      for (const dz of [-d / 2, d / 2]) list.push(beam(T, V(a, y + (i % 2 ? d : 0), z + dz), V(b, y + (i % 2 ? 0 : d), z + dz), t * 0.6));
      list.push(beam(T, V(b, y, z - d / 2), V(b, y + d, z + d / 2), t * 0.5));
    }
  }

  // ---------- vehicles ----------
  // Real proportions in meters (x forward, y up, origin at ground under the middle), then placed with a matrix.
  // Kinds: pickup, flatbed (with a cable reel), bucket truck, all-terrain crane, excavator.
  // When vehicles3d.js is loaded, its richer models replace these for the kinds it has; they are added to `g`.
  const V3D = { pickup: "pickup", bucket: "bucket", flatbed: "flatbed", crane: "truckCrane", excavator: "excavator" };
  let vehLevel = "detailed";
  function vehicle(T, B, kind, x, y, z, rot, k, g) {
    if (hooks.vehicle && hooks.vehicle(T, B, kind, x, y, z, rot, k, put, g)) return;
    if (g && root.Vehicles3D && V3D[kind] && root.Vehicles3D.KINDS.includes(V3D[kind])) {
      const v = root.Vehicles3D.build(T, V3D[kind], { level: vehLevel });
      v.scale.setScalar(k); v.position.set(x, y, z); v.rotation.y = rot; v.userData.vehicle = kind;
      v.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(v); v.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(v);
      return { box, move(dx, dz) { v.position.x += dx; v.position.z += dz; box.translate(new T.Vector3(dx, 0, dz)); } };
    }
    const P = {}, box = (key, w, h, d, px, py, pz) => put(P, key, boxAt(T, w, h, d, px, py, pz));
    const wheel = (px, pz, r, w) => { put(P, "tire", cylZ(T, r, r, w, 18, px, r, pz)); put(P, "rim", cylZ(T, r * 0.58, r * 0.58, w + 0.02, 12, px, r, pz)); };
    const cabAt = (cx, w, h, d, y0, color) => {
      box(color, w, h, d, cx, y0 + h / 2, 0);
      box("glass", 0.05, h * 0.46, d * 0.9, cx + w / 2 + 0.01, y0 + h * 0.7, 0);          // windshield
      box("glass", w * 0.8, h * 0.4, d + 0.02, cx + w * 0.05, y0 + h * 0.7, 0);           // side windows
      for (const s of [-1, 1]) box("dark", 0.1, 0.16, 0.22, cx + w / 2 - 0.1, y0 + h * 0.65, s * (d / 2 + 0.14));
    };
    const front = (fx, y0, wid) => {
      box("dark", 0.2, 0.26, wid, fx + 0.1, y0, 0);
      box("dark", 0.04, 0.36, wid * 0.6, fx + 0.01, y0 + 0.33, 0);
      for (const s of [-1, 1]) box("lamp", 0.04, 0.13, 0.26, fx + 0.02, y0 + 0.36, s * wid * 0.38);
    };
    const rear = (bx, y0, wid) => { box("dark", 0.18, 0.2, wid, bx - 0.09, y0, 0); for (const s of [-1, 1]) box("red", 0.04, 0.26, 0.12, bx - 0.02, y0 + 0.35, s * wid * 0.44); };
    if (kind === "pickup") {
      box("dark", 5.4, 0.25, 1.6, 0, 0.55, 0);
      box("paint", 5.8, 0.55, 2.0, 0, 0.86, 0);
      box("paint", 1.5, 0.22, 1.96, 2.1, 1.24, 0);
      cabAt(0.35, 2.2, 0.78, 1.9, 1.13, "paint");
      box("glass", 0.04, 0.38, 1.6, -0.76, 1.55, 0);
      for (const s of [-1, 1]) box("paint", 2.6, 0.42, 0.08, -1.6, 1.34, s * 0.96);
      box("paint", 0.08, 0.42, 1.96, -2.86, 1.34, 0);
      box("dark", 0.5, 0.36, 1.9, -0.6, 1.3, 0);
      box("amber", 0.26, 0.08, 1.2, 0.5, 1.95, 0);
      for (const px of [-1.75, 1.75]) box("dark", 1.08, 0.12, 2.06, px, 1.06, 0);
      front(2.85, 0.72, 1.98); rear(-2.9, 0.72, 1.98);
      for (const px of [-1.75, 1.75]) for (const s of [-1, 1]) wheel(px, s * 0.86, 0.4, 0.28);
    } else if (kind === "flatbed" || kind === "bucket") {
      box("dark", 8.2, 0.3, 0.95, -0.2, 0.78, 0);
      cabAt(2.45, 2.2, 1.45, 2.3, 1.02, "paint");
      box("paint", 1.35, 0.85, 2.1, 4.2, 1.5, 0);
      box("dark", 0.05, 0.5, 1.5, 4.89, 1.5, 0);
      box("amber", 0.3, 0.1, 1.5, 2.45, 2.53, 0);
      front(4.88, 0.85, 2.3); rear(-4.3, 0.95, 2.4);
      for (const s of [-1, 1]) { wheel(4.0, s * 1.02, 0.5, 0.32); for (const px of [-1.9, -3.1]) { wheel(px, s * 0.86, 0.5, 0.3); wheel(px, s * 1.18, 0.5, 0.3); } }
      if (kind === "flatbed") {
        box("wood", 5.9, 0.16, 2.45, -1.35, 1.28, 0);
        box("darkSteel", 0.1, 1.0, 2.3, 1.3, 1.86, 0);
        put(P, "wood", cylZ(T, 1.05, 1.05, 0.12, 20, -1.2, 2.43, -0.55), cylZ(T, 1.05, 1.05, 0.12, 20, -1.2, 2.43, 0.55), cylZ(T, 0.62, 0.62, 1.0, 16, -1.2, 2.43, 0));
        put(P, "dark", cylZ(T, 0.9, 0.9, 1.0, 20, -1.2, 2.43, 0));
        box("orange", 0.06, 0.8, 0.06, -2.4, 1.8, 1.2);
      } else {
        box("paint", 4.8, 1.3, 2.45, -1.6, 1.62, 0);
        for (let i = 0; i < 4; i++) for (const s of [-1, 1]) box("dark", 0.03, 1.05, 0.02, -3.6 + i * 1.2, 1.62, s * 1.235);
        box("darkSteel", 0.9, 0.5, 0.9, -3.2, 2.52, 0);
        const V = (a, b, c) => new T.Vector3(a, b, c);
        put(P, "paint", beam(T, V(-3.2, 2.7, 0), V(-1.4, 7.4, 0), 0.34), beam(T, V(-1.4, 7.4, 0), V(1.0, 9.2, 0), 0.26));
        box("yellow", 0.85, 1.05, 0.85, 1.35, 8.8, 0);
        for (const s of [-1, 1]) for (const px of [-3.9, 0.6]) box("dark", 0.2, 0.25, 1.1, px, 0.7, s * 1.5), box("dark", 0.45, 0.06, 0.45, px, 0.05, s * 2.0);
      }
    } else if (kind === "crane") {
      box("yellow", 11.4, 1.25, 2.6, 0, 1.55, 0);
      box("dark", 11.0, 0.3, 2.0, 0, 0.8, 0);
      cabAt(5.1, 1.5, 1.3, 1.1, 1.6, "yellow"); // carrier cab sits to one side
      for (const px of [-4.2, -2.7, 2.6, 4.1]) for (const s of [-1, 1]) wheel(px, s * 1.08, 0.62, 0.5);
      box("yellow", 4.6, 1.5, 2.4, -1.5, 3.0, 0);
      box("dark", 1.3, 1.5, 2.7, -4.4, 3.0, 0);
      box("yellow", 1.8, 1.6, 0.9, 0.5, 3.0, 1.35); box("glass", 1.2, 0.8, 0.92, 0.9, 3.3, 1.35);
      for (const s of [-1, 1]) for (const px of [-3.6, 3.6]) box("dark", 0.3, 0.3, 2.0, px, 0.9, s * 2.2), box("darkSteel", 0.7, 0.1, 0.7, px, 0.05, s * 3.1);
      const V = (a, b, c) => new T.Vector3(a, b, c), a0 = V(-2.4, 3.9, 0), dir = V(Math.cos(1.0), Math.sin(1.0), 0);
      [[0, 9, 1.05], [8, 8, 0.82], [15, 7, 0.62]].forEach(([s0, len, t]) => put(P, "yellow", beam(T, a0.clone().addScaledVector(dir, s0), a0.clone().addScaledVector(dir, s0 + len), t)));
      const tip = a0.clone().addScaledVector(dir, 22);
      put(P, "dark", cylAt(T, 0.03, 0.03, tip.y - 4.2, 4, tip.x + 0.3, 4.2 + (tip.y - 4.2) / 2, 0));
      box("orange", 0.5, 0.7, 0.4, tip.x + 0.3, 3.9, 0);
    } else if (kind === "excavator") {
      for (const s of [-1, 1]) box("dark", 4.4, 0.85, 0.7, 0, 0.45, s * 1.25);
      box("darkSteel", 1.2, 0.5, 1.8, 0, 1.05, 0);
      box("yellow", 3.2, 1.1, 2.5, -0.5, 1.8, 0);
      box("dark", 0.9, 1.0, 2.5, -1.9, 1.8, 0);
      box("yellow", 1.1, 1.5, 0.95, 0.95, 2.6, 0.75); box("glass", 1.12, 0.9, 0.97, 1.0, 2.85, 0.75);
      const V = (a, b, c) => new T.Vector3(a, b, c);
      put(P, "yellow", beam(T, V(1.0, 2.0, -0.35), V(3.4, 4.0, -0.35), 0.5), beam(T, V(3.4, 4.0, -0.35), V(4.6, 1.3, -0.35), 0.38));
      box("darkSteel", 0.9, 0.8, 1.1, 4.7, 0.9, -0.35);
    }
    const mtx = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), rot), new T.Vector3(k, k, k));
    const geos = [], fp = new T.Box3();
    Object.entries(P).forEach(([key, list]) => list.forEach(g => { put(B, key, g.applyMatrix4(mtx)); g.computeBoundingBox(); fp.union(g.boundingBox); geos.push(g); }));
    return { box: fp, move(dx, dz) { geos.forEach(q => q.translate(dx, 0, dz)); fp.translate(new T.Vector3(dx, 0, dz)); } };
  }

  // Slide a vehicle to the free spot nearest where it was asked for: its full footprint (booms, outriggers and
  // buckets included) plus a margin must clear everything already placed and stay inside [x0, x1] x [z0, z1].
  function park(v, taken, lim, m = 0.12) {
    if (!v) return;
    const b = v.box, hits = (dx, dz) => b.min.x + dx < lim[0] || b.max.x + dx > lim[1] || b.min.z + dz < lim[2] || b.max.z + dz > lim[3] ||
      taken.some(t => b.min.x + dx < t.max.x + m && b.max.x + dx > t.min.x - m && b.min.z + dz < t.max.z + m && b.max.z + dz > t.min.z - m);
    let best = null;
    for (let r = 0; r <= 160 && !best; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const dx = i * 0.1, dz = j * 0.1;
      if (!hits(dx, dz) && (!best || dx * dx + dz * dz < best[0] * best[0] + best[1] * best[1])) best = [dx, dz];
    }
    if (best && (best[0] || best[1])) v.move(best[0], best[1]);
    taken.push(b.clone());
  }

  // ---------- structures ----------
  // Lattice transmission tower. Arms run along local x; the line runs along local z.
  function towerParts(T, h) {
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const b = 0.75, tp = 0.22, yw = h * 0.78, w = y => b + (tp - b) * y / yw;
    const steel = [], accent = [], ins = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      steel.push(beam(T, V(sx * b, 0, sz * b), V(sx * tp, yw, sz * tp), 0.11));
      steel.push(beam(T, V(sx * tp, yw, sz * tp), V(sx * tp * 0.5, h, sz * tp * 0.5), 0.08));
    }
    const L = 5;
    for (let i = 0; i < L; i++) {
      const y0 = i * yw / L, y1 = (i + 1) * yw / L, a = w(y0), c = w(y1);
      for (const s of [-1, 1]) {
        steel.push(beam(T, V(-a, y0, s * a), V(c, y1, s * c), 0.045), beam(T, V(a, y0, s * a), V(-c, y1, s * c), 0.045));
        steel.push(beam(T, V(s * a, y0, -a), V(s * c, y1, c), 0.045), beam(T, V(s * a, y0, a), V(s * c, y1, -c), 0.045));
        steel.push(beam(T, V(-c, y1, s * c), V(c, y1, s * c), 0.04), beam(T, V(s * c, y1, -c), V(s * c, y1, c), 0.04));
      }
    }
    const arms = [[yw, 1.35], [h * 0.6, 1.05]], attach = [];
    for (const [y, half] of arms) {
      const ww = w(Math.min(y, yw));
      for (const s of [-1, 1]) {
        for (const z of [-0.12, 0.12]) steel.push(beam(T, V(0, y, z), V(s * half, y, z * 0.3), 0.07));
        steel.push(beam(T, V(s * half, y, 0), V(s * ww, y + 0.55, 0), 0.05));
        for (let k = 0; k < 7; k++) ins.push(cylAt(T, 0.1, 0.1, 0.035, 8, s * half, y - 0.06 - k * 0.062, 0));
        ins.push(cylAt(T, 0.02, 0.02, 0.46, 4, s * half, y - 0.23, 0));
        accent.push(boxAt(T, 0.34, 0.04, 0.06, s * half, y - 0.47, 0));
        attach.push([s * half, y - 0.48]);
      }
    }
    accent.push(boxAt(T, 0.22, 0.18, 0.22, 0, h + 0.05, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) steel.push(boxAt(T, 0.36, 0.12, 0.36, sx * b, 0.06, sz * b));
    attach.push([0, h + 0.1]);
    return { steel: merge(T, steel), accent: merge(T, accent), ins: merge(T, ins), attach };
  }

  // One meter in scene units for people and vehicles (a worker is about 0.54 units tall).
  const U = 0.3;

  // Substation: galvanized lattice gantries and girders, power transformers with radiators and conservators,
  // dead-tank breakers, disconnect switches on insulator stacks, tubular aluminum bus, lightning masts,
  // a control house, all inside a chain-link fence on a gravel pad.
  function substationGroup(T, s, color, K0, withFence = true) {
    const K = Object.assign({}, K0, { trim: K0.trimOf(color) }), g = new T.Group(), B = {}, P = 0.16;
    const box = (k, w, h, d, x, y, z) => put(B, k, boxAt(T, w, h, d, x, P + y + h / 2, z));
    const pad = mesh(T, boxUV(T, new T.BoxGeometry(s, 3, s * 0.8)), K.gravel, false); pad.position.y = 0.16 - 1.5; g.add(pad);
    const hw = s * 0.52, hd = s * 0.42;
    if (withFence) {
      const posts = [], n = Math.round(hw * 2 / 0.9);
      for (let i = 0; i <= n; i++) { const t = -hw + i * hw * 2 / n; posts.push(cylAt(T, 0.025, 0.025, 0.72, 5, t, 0.36, hd), cylAt(T, 0.025, 0.025, 0.72, 5, t, 0.36, -hd)); }
      for (let i = 0; i <= Math.round(hd * 2 / 0.9); i++) { const t = -hd + i * hd * 2 / Math.round(hd * 2 / 0.9); posts.push(cylAt(T, 0.025, 0.025, 0.72, 5, hw, 0.36, t), cylAt(T, 0.025, 0.025, 0.72, 5, -hw, 0.36, t)); }
      for (const y of [0.1, 0.4, 0.7]) posts.push(boxAt(T, hw * 2, 0.02, 0.02, 0, y, hd), boxAt(T, hw * 2, 0.02, 0.02, 0, y, -hd), boxAt(T, 0.02, 0.02, hd * 2, hw, y, 0), boxAt(T, 0.02, 0.02, hd * 2, -hw, y, 0));
      put(B, "fence", ...posts);
      // chain-link mesh as a see-through panel
      const netMat = new T.MeshStandardMaterial({ color: 0x77828a, metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.28, side: T.DoubleSide, depthWrite: false });
      const net = new T.Mesh(merge(T, [boxAt(T, hw * 2, 0.62, 0.005, 0, 0.4, hd), boxAt(T, hw * 2, 0.62, 0.005, 0, 0.4, -hd), boxAt(T, 0.005, 0.62, hd * 2, hw, 0.4, 0), boxAt(T, 0.005, 0.62, hd * 2, -hw, 0.4, 0)]), netMat);
      g.add(net);
      put(B, "yellow", boxAt(T, 0.9, 0.5, 0.03, s * 0.1, 0.4, hd + 0.02));
    }
    // two power transformers with a firewall between them
    const a = s * 0.14;
    for (const x of [-s * 0.21, s * 0.21]) transformer(T, B, x, P, -s * 0.2, a);
    box("concrete", s * 0.025, a * 1.25, a * 1.1, 0, 0, -s * 0.2);
    // oil containment curbs
    for (const x of [-s * 0.21, s * 0.21]) box("concrete", a * 1.6, 0.05, a * 1.25, x, -0.02, -s * 0.2);
    // lattice gantries carrying the high side bus, two bays wide
    const gh = s * 0.42, gz = s * 0.14, cw = s * 0.045, lat = [];
    for (const x of [-s * 0.4, 0, s * 0.4]) latticeColumn(T, lat, x, gz, gh, cw, P);
    latticeGirder(T, lat, -s * 0.4, s * 0.4, P + gh - cw, gz, cw);
    for (const [x, z] of [[-s * 0.47, -s * 0.37], [s * 0.47, s * 0.37]]) latticeColumn(T, lat, x, z, s * 0.62, cw * 0.7, P);
    put(B, "galv", ...lat);
    // strain insulator strings hanging from the girder and the three phase conductors leaving the yard
    for (const dz of [-0.26, 0, 0.26]) for (const x of [-s * 0.2, s * 0.2]) {
      insulator(T, B, x, P + gh - cw - s * 0.09, gz + dz * s * 0.08, s * 0.09, s * 0.011, 8);
    }
    // tubular aluminum bus on post insulators, dead-tank breakers and disconnect switches in each bay
    for (const dz of [-1, 0, 1]) {
      const z = gz + dz * s * 0.065, by = P + s * 0.2;
      put(B, "alum", cylX(T, s * 0.008, s * 0.008, s * 0.8, 8, 0, by, z));
      for (const x of [-s * 0.34, -s * 0.12, s * 0.12, s * 0.34]) {
        box("galv", s * 0.02, s * 0.1, s * 0.02, x, 0, z);
        insulator(T, B, x, P + s * 0.1, z, s * 0.09, s * 0.018, 6);
      }
      for (const x of [-s * 0.23, s * 0.23]) {
        box("galv", s * 0.08, s * 0.05, s * 0.03, x, 0, z);
        put(B, "trans", cylX(T, s * 0.022, s * 0.022, s * 0.08, 12, x, P + s * 0.075, z));
        for (const dx of [-0.025, 0.025]) insulator(T, B, x + dx * s, P + s * 0.09, z, s * 0.07, s * 0.013, 6);
        box("darkSteel", s * 0.03, s * 0.04, s * 0.025, x + s * 0.05, 0, z);
      }
      // switch blades between post pairs
      for (const x of [-s * 0.34, s * 0.12]) put(B, "alum", boxAt(T, s * 0.22, s * 0.006, s * 0.006, x + s * 0.11, P + s * 0.195, z));
    }
    // low side: breakers in a row with cable trench
    for (let i = 0; i < 6; i++) {
      const x = -s * 0.3 + i * s * 0.12, z = s * 0.34;
      box("galv", s * 0.05, s * 0.04, s * 0.04, x, 0, z);
      put(B, "trans", cylAt(T, s * 0.02, s * 0.02, s * 0.06, 12, x, P + s * 0.07, z));
      insulator(T, B, x, P + s * 0.1, z, s * 0.05, s * 0.01, 5);
    }
    box("concrete", s * 0.8, 0.03, s * 0.04, 0, 0, s * 0.27);
    // control house with a door, windows and an air conditioner
    const hx = -s * 0.38, hz = -s * 0.32, w = s * 0.2, h = s * 0.1, d = s * 0.12;
    box("siding", w, h, d, hx, 0, hz); box("trim", w * 1.06, s * 0.012, d * 1.1, hx, h, hz);
    box("dark", s * 0.025, s * 0.06, 0.02, hx + w * 0.3, 0, hz + d / 2 + 0.005);
    box("glass", w * 0.2, s * 0.025, 0.02, hx - w * 0.2, h * 0.5, hz + d / 2 + 0.005);
    box("white", s * 0.03, s * 0.03, s * 0.03, hx - w / 2 - s * 0.02, 0, hz);
    return flush(T, B, K, g);
  }

  // Combined-cycle power plant (Plant McIntosh style): two gas turbine trains, each with an inlet filter house,
  // turbine enclosure, heat recovery steam generator (HRSG) and a tall exhaust stack; a steam turbine hall;
  // a row of mechanical-draft cooling tower cells; water and fuel tanks, a pipe rack and its own switchyard.
  function plantGroup(T, s, color, K0) {
    const K = Object.assign({}, K0, { trim: K0.trimOf(color) }), g = new T.Group(), B = {}, P = 0.16, stacks = [];
    const box = (k, w, h, d, x, y, z) => put(B, k, boxAt(T, w * s, h * s, d * s, x * s, P + (y + h / 2) * s, z * s));
    const cyl = (k, r1, r2, h, seg, x, y, z) => put(B, k, cylAt(T, r1 * s, r2 * s, h * s, seg, x * s, P + (y + h / 2) * s, z * s));
    const pad = mesh(T, boxUV(T, new T.BoxGeometry(s * 1.3, 3, s * 1.0)), K.concrete, false); pad.position.y = 0.16 - 1.5; g.add(pad);
    // plant roads
    box("asphalt", 1.3, 0.002, 0.05, 0, 0, 0.08);
    for (const zc of [-0.4, -0.14]) {
      // inlet filter house on legs, with louvered hoods
      box("sidingDark", 0.08, 0.12, 0.12, -0.53, 0.09, zc);
      for (let k = 0; k < 4; k++) box("dark", 0.082, 0.006, 0.122, -0.53, 0.1 + k * 0.028, zc);
      for (const dx of [-0.035, 0.035]) for (const dz of [-0.055, 0.055]) box("galv", 0.006, 0.09, 0.006, -0.53 + dx, 0, zc + dz);
      box("siding", 0.05, 0.05, 0.05, -0.47, 0.06, zc);
      // gas turbine enclosure and generator
      box("siding", 0.16, 0.06, 0.07, -0.37, 0, zc);
      for (let k = 0; k < 3; k++) box("dark", 0.02, 0.012, 0.02, -0.42 + k * 0.05, 0.06, zc);
      box("trans", 0.07, 0.05, 0.06, -0.37, 0, zc + 0.075);
      // transition duct widening into the HRSG
      box("hrsg", 0.05, 0.13, 0.075, -0.265, 0.02, zc);
      // HRSG: cased box with exposed columns, girts, a steam drum on top and a stair tower
      box("hrsg", 0.27, 0.22, 0.09, -0.105, 0, zc);
      for (let k = 0; k <= 6; k++) box("galv", 0.006, 0.225, 0.094, -0.24 + k * 0.045, 0, zc);
      for (const y of [0.07, 0.145]) box("galv", 0.274, 0.004, 0.094, -0.105, y, zc);
      box("galv", 0.28, 0.006, 0.1, -0.105, 0.22, zc);
      put(B, "white", cylX(T, 0.013 * s, 0.013 * s, 0.12 * s, 12, -0.1 * s, P + 0.24 * s, zc * s));
      const lat = [];
      latticeColumn(T, lat, 0.045 * s, (zc - 0.07) * s, 0.23 * s, 0.035 * s, P);
      put(B, "galv", ...lat);
      // breeching duct and exhaust stack with a platform and a dark band at the top
      box("hrsg", 0.05, 0.035, 0.05, 0.04, 0.17, zc);
      cyl("stack", 0.024, 0.027, 0.52, 24, 0.085, 0, zc);
      cyl("galv", 0.036, 0.036, 0.004, 24, 0.085, 0.44, zc);
      cyl("dark", 0.0245, 0.0245, 0.02, 24, 0.085, 0.5, zc);
      stacks.push([0.085 * s, P + 0.52 * s, zc * s, 0]);
      // generator step-up transformer
      transformer(T, B, -0.37 * s, P, (zc + 0.13) * s, 0.045 * s, Math.PI / 2);
    }
    // steam turbine hall with a band of windows, a roll-up door and the owner's colored trim
    box("siding", 0.3, 0.16, 0.2, 0.32, 0, -0.25); box("roof", 0.31, 0.01, 0.21, 0.32, 0.16, -0.25);
    box("glass", 0.302, 0.022, 0.202, 0.32, 0.11, -0.25); box("trim", 0.303, 0.01, 0.203, 0.32, 0.145, -0.25);
    box("dark", 0.05, 0.07, 0.203, 0.24, 0, -0.25);
    for (let k = 0; k < 3; k++) box("sidingDark", 0.03, 0.02, 0.03, 0.24 + k * 0.08, 0.17, -0.25);
    // mechanical-draft cooling tower: a row of cells on a basin, each with a fan stack venting a plume
    box("concrete", 0.4, 0.02, 0.12, 0.3, 0, 0.2);
    box("ctower", 0.38, 0.08, 0.1, 0.3, 0.02, 0.2);
    for (let k = 0; k < 3; k++) box("dark", 0.382, 0.008, 0.102, 0.3, 0.03 + k * 0.018, 0.2);
    for (let k = 0; k < 6; k++) {
      const x = 0.3 - 0.157 + k * 0.063;
      cyl("ctower", 0.024, 0.021, 0.035, 18, x, 0.1, 0.2);
      box("galv", 0.003, 0.082, 0.102, x + 0.031, 0.02, 0.2);
      stacks.push([x * s, P + 0.135 * s, 0.2 * s, 1]);
    }
    // water and fuel tanks
    cyl("white", 0.05, 0.05, 0.1, 28, 0.0, 0, 0.25); cyl("white", 0.04, 0.04, 0.09, 28, 0.02, 0, 0.4);
    cyl("white", 0.065, 0.065, 0.07, 28, 0.56, 0, 0.4);
    // pipe rack along the power block
    for (let k = 0; k < 11; k++) box("galv", 0.005, 0.07, 0.035, -0.48 + k * 0.09, 0, -0.05);
    [[0.07, 0.007, "pipe"], [0.07, 0.005, "gas"], [0.058, 0.006, "pipe"]].forEach(([y, r, key], i) => put(B, key, cylX(T, r * s, r * s, 0.95 * s, 10, -0.03 * s, P + y * s, (-0.05 - 0.01 + i * 0.01) * s)));
    // admin building
    box("concrete", 0.14, 0.05, 0.08, 0.38, 0, 0.36); box("glass", 0.142, 0.018, 0.082, 0.38, 0.02, 0.36); box("trim", 0.143, 0.006, 0.083, 0.38, 0.05, 0.36);
    flush(T, B, K, g);
    // the plant's own switchyard, fed from the step-up transformers
    const sy = substationGroup(T, s * 0.42, color, K0);
    sy.position.set(-s * 0.3, 0.01, s * 0.3); g.add(sy);
    g.userData.stacks = stacks;
    return g;
  }

  // Shared laydown yard: gravel pad inside a fence, cable reels, stacked steel poles, an office trailer,
  // and real-proportion equipment: pickups, a flatbed carrying a reel, a bucket truck, an all-terrain crane
  // and an excavator.
  function yardGroup(T, w, d, K) {
    const g = new T.Group(), B = {};
    const pad = mesh(T, boxUV(T, new T.BoxGeometry(w, 3, d)), K.gravel, false); pad.position.y = 0.12 - 1.5; g.add(pad);
    const Y = 0.12;
    // fence with an open gate on the front
    const f = [], hw = w / 2, hd = d / 2;
    for (let i = 0; i <= 20; i++) { const t = -hw + i * w / 20; f.push(cylAt(T, 0.02, 0.02, 0.6, 5, t, Y + 0.3, -hd)); if (Math.abs(t - hw * 0.5) > 0.7) f.push(cylAt(T, 0.02, 0.02, 0.6, 5, t, Y + 0.3, hd)); }
    for (let i = 0; i <= 12; i++) { const t = -hd + i * d / 12; f.push(cylAt(T, 0.02, 0.02, 0.6, 5, hw, Y + 0.3, t), cylAt(T, 0.02, 0.02, 0.6, 5, -hw, Y + 0.3, t)); }
    f.push(boxAt(T, w, 0.02, 0.02, 0, Y + 0.58, -hd), boxAt(T, 0.02, 0.02, d, hw, Y + 0.58, 0), boxAt(T, 0.02, 0.02, d, -hw, Y + 0.58, 0));
    f.push(boxAt(T, hw * 1.5 - 0.7, 0.02, 0.02, -hw + (hw * 1.5 - 0.7) / 2, Y + 0.58, hd), boxAt(T, hw * 0.5 - 0.7, 0.02, 0.02, hw - (hw * 0.5 - 0.7) / 2, Y + 0.58, hd));
    put(B, "fence", ...f);
    // cable reels (2 m drums) in a row
    for (let i = 0; i < 5; i++) {
      const x = -hw + 1.0 + i * 0.85, z = -hd + 0.7;
      put(B, "wood", cylZ(T, 0.33, 0.33, 0.04, 18, x, Y + 0.33, z - 0.18), cylZ(T, 0.33, 0.33, 0.04, 18, x, Y + 0.33, z + 0.18));
      put(B, "dark", cylZ(T, 0.26, 0.26, 0.32, 16, x, Y + 0.33, z));
    }
    // steel poles stacked on dunnage
    for (let k = 0; k < 3; k++) for (let i = 0; i < 4 - k; i++) put(B, "galv", cylX(T, 0.08, 0.11, 3.2, 12, hw - 2.0, Y + 0.14 + k * 0.17, -hd + 0.6 + (i + k * 0.5) * 0.19));
    for (const dx of [-1.2, 0, 1.2]) put(B, "wood", boxAt(T, 0.08, 0.06, 0.9, hw - 2.0 + dx, Y + 0.03, -hd + 0.85));
    // office trailer with steps, windows and an AC unit
    put(B, "white", boxAt(T, 2.4, 0.72, 0.9, -hw + 1.6, Y + 0.5, hd - 0.75));
    put(B, "glass", boxAt(T, 0.4, 0.18, 0.02, -hw + 1.2, Y + 0.6, hd - 0.29), boxAt(T, 0.4, 0.18, 0.02, -hw + 2.0, Y + 0.6, hd - 0.29));
    put(B, "dark", boxAt(T, 0.26, 0.45, 0.02, -hw + 1.6, Y + 0.45, hd - 0.29), boxAt(T, 0.3, 0.1, 0.25, -hw + 1.6, Y + 0.12, hd - 0.15));
    put(B, "white", boxAt(T, 0.24, 0.2, 0.2, -hw + 0.55, Y + 0.95, hd - 0.75));
    // portable toilets
    put(B, "orange", boxAt(T, 0.3, 0.7, 0.3, hw - 0.4, Y + 0.35, hd - 0.4), boxAt(T, 0.3, 0.7, 0.3, hw - 0.75, Y + 0.35, hd - 0.4));
    // cones along the gate
    for (let i = 0; i < 6; i++) put(B, "orange", cylAt(T, 0.015, 0.07, 0.22, 10, hw * 0.5 - 0.6 + i * 0.24, Y + 0.11, hd + 0.3));
    // equipment, in meters times U, each slid to the nearest spot clear of the stock, the trailer, the crew and the
    // vehicles parked before it (big ones first, so the pickups fill in around them)
    const Bx = (x0, x1, z0, z1) => new T.Box3(new T.Vector3(x0, 0, z0), new T.Vector3(x1, 2, z1));
    const taken = [Bx(-hw + 0.6, -hw + 4.8, -hd, -hd + 1.1), Bx(hw - 3.65, hw - 0.35, -hd, -hd + 1.35),
      Bx(-hw, -hw + 2.85, hd - 1.25, hd), Bx(hw - 0.95, hw, hd - 0.6, hd), Bx(-2.65, -1.15, -2.1, -0.6)];
    const lim = [-hw + 0.08, hw - 0.08, -hd + 0.08, hd - 0.08];
    park(vehicle(T, B, "flatbed", -0.6, Y, 0.3, 0, U, g), taken, lim);
    park(vehicle(T, B, "crane", hw - 3.0, Y, 2.2, Math.PI, U, g), taken, lim);
    park(vehicle(T, B, "bucket", 1.2, Y, -1.0, Math.PI, U, g), taken, lim);
    park(vehicle(T, B, "excavator", hw - 1.3, Y, -0.6, Math.PI, U, g), taken, lim);
    park(vehicle(T, B, "pickup", -hw + 0.8, Y, -0.3, Math.PI / 2, U, g), taken, lim);
    park(vehicle(T, B, "pickup", -hw + 1.8, Y, -0.3, Math.PI / 2, U, g), taken, lim);
    park(vehicle(T, B, "pickup", -hw + 2.8, Y, -0.3, Math.PI / 2 + 0.05, U, g), taken, lim);
    flush(T, B, K, g);
    const crew = crewGroup(T, 6, 11, 1.2); crew.position.set(-1.9, Y, -1.35); g.add(crew);
    return g;
  }

  // Small construction crew: hard hats, hi-vis vests. Scaled up so people read next to exaggerated towers.
  function crewGroup(T, n, seed, spread) {
    const r = rng(seed), legs = [], vest = [], head = [], hat = [];
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * spread, z = (r() - 0.5) * spread;
      legs.push(boxAt(T, 0.07, 0.2, 0.06, x - 0.045, 0.1, z), boxAt(T, 0.07, 0.2, 0.06, x + 0.045, 0.1, z));
      vest.push(boxAt(T, 0.19, 0.2, 0.11, x, 0.3, z), boxAt(T, 0.05, 0.17, 0.05, x - 0.12, 0.3, z), boxAt(T, 0.05, 0.17, 0.05, x + 0.12, 0.3, z));
      const hd = new T.SphereGeometry(0.06, 6, 4); hd.translate(x, 0.46, z); head.push(hd);
      const ht = new T.SphereGeometry(0.068, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2); ht.translate(x, 0.48, z); hat.push(ht, cylAt(T, 0.085, 0.085, 0.01, 8, x, 0.48, z));
    }
    const g = new T.Group();
    g.add(mesh(T, merge(T, legs), pbr(T, 0x2c3a52)), mesh(T, merge(T, vest), pbr(T, 0xf2c230, { emissive: 0x6b5200, emissiveIntensity: 0.3 })),
      mesh(T, merge(T, head), pbr(T, 0xc99a74)), mesh(T, merge(T, hat), pbr(T, 0xffffff, { shininess: 50 })));
    return g;
  }

  // Tiling normal map for ripples on ponds: a few summed sine waves, converted to normals.
  function waterNormals(T) {
    const N = 128, c = document.createElement("canvas"); c.width = c.height = N;
    const x = c.getContext("2d"), img = x.createImageData(N, N), TAU = Math.PI * 2;
    const hgt = (i, j) => Math.sin(TAU * (i * 3 + j) / N) + 0.6 * Math.sin(TAU * (i * -2 + j * 5) / N) + 0.35 * Math.sin(TAU * (i * 7 - j * 4) / N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = hgt(i + 1, j) - hgt(i - 1, j), dy = hgt(i, j + 1) - hgt(i, j - 1), l = Math.hypot(dx, dy, 4), o = (j * N + i) * 4;
      img.data[o] = 128 - 127 * dx / l; img.data[o + 1] = 128 - 127 * dy / l; img.data[o + 2] = 128 + 127 * 4 / l; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(5, 5);
    return t;
  }
  // Colors in this file are written as sRGB hex. The renderer works in linear light, so convert every
  // material, light, vertex and instance color once after the scene is built.
  function linearize(T, scene, envI) {
    const seen = new Set(), c = new T.Color();
    const conv = arr => { for (let i = 0; i < arr.length; i += 3) { c.fromArray(arr, i).convertSRGBToLinear().toArray(arr, i); } };
    scene.traverse(o => {
      if (o.isLight) o.color.convertSRGBToLinear();
      if (o.isHemisphereLight) o.groundColor.convertSRGBToLinear();
      if (o.isInstancedMesh && o.instanceColor) conv(o.instanceColor.array);
      if (o.geometry && o.geometry.attributes && o.geometry.attributes.color && !seen.has(o.geometry)) { seen.add(o.geometry); conv(o.geometry.attributes.color.array); }
      [].concat(o.material || []).forEach(m => {
        if (seen.has(m) || m.isShaderMaterial) return; seen.add(m);
        if (m.color) m.color.convertSRGBToLinear();
        if (m.isMeshStandardMaterial && m.envMapIntensity === 1) m.envMapIntensity = envI; // sky light fills shadows without washing out color
        if (m.emissive) m.emissive.convertSRGBToLinear();
      });
    });
    scene.fog.color.convertSRGBToLinear();
  }

  // Soft round sprite texture for steam.
  function softTexture(T) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.5, "rgba(245,248,250,0.5)"); gr.addColorStop(1, "rgba(240,244,248,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  // ---------- build ----------
  // Where the pair sits in the scene: centered between the closest points, S scene units per km, a square block
  // 2H units across.
  function frame(pair) {
    const c0 = [(pair.ca[0] + pair.cb[0]) / 2, (pair.ca[1] + pair.cb[1]) / 2];
    const KX = 111.32 * Math.cos(c0[0] * Math.PI / 180), KY = 110.57, Rkm = Math.max(2.5, pair.km * 1.5), S = 32 / Rkm;
    const R = 40, RG = R * 1.7, H = RG * 0.92;
    return { c0, KX, KY, S, R, RG, H, lonAt: x => c0[1] + x / (KX * S), latAt: z => c0[0] - z / (KY * S) };
  }

  // Real ground elevation from the public AWS Terrain Tiles (Terrarium PNGs: SRTM and USGS data, no key needed).
  // Returns a sampler in meters, or null when the tiles can't be reached (offline, or a preview that blocks images).
  const demCache = new Map();
  function loadDEM(pair) {
    const F = frame(pair), key = pair.ca.concat(pair.cb).join(",");
    if (demCache.has(key)) return demCache.get(key);
    const halfKm = F.H / F.S, lat = F.c0[0], cos = Math.cos(lat * Math.PI / 180);
    // about 600 elevation pixels across the block
    const z = Math.max(7, Math.min(13, Math.round(Math.log2(156543 * cos * 600 / (2000 * halfKm)))));
    const n = 2 ** z, gx = lon => (lon + 180) / 360 * n * 256;
    const gy = la => { const r = la * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n * 256; };
    const x0 = gx(F.lonAt(-F.H)), x1 = gx(F.lonAt(F.H)), y0 = gy(F.latAt(-F.H)), y1 = gy(F.latAt(F.H));
    const tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256), ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);
    const W = (tx1 - tx0 + 1) * 256, Hh = (ty1 - ty0 + 1) * 256;
    const tiles = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push(new Promise((ok, bad) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => ok({ im, tx, ty }); im.onerror = bad;
      im.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
    }));
    const timeout = new Promise((ok, bad) => setTimeout(() => bad(new Error("timeout")), 6000));
    const p = Promise.race([Promise.all(tiles), timeout]).then(list => {
      const c = document.createElement("canvas"); c.width = W; c.height = Hh;
      const g = c.getContext("2d");
      list.forEach(t => g.drawImage(t.im, (t.tx - tx0) * 256, (t.ty - ty0) * 256));
      const px = g.getImageData(0, 0, W, Hh).data, m = new Float32Array(W * Hh);
      for (let i = 0; i < m.length; i++) m[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      const at = (la, lo) => {
        const X = Math.max(0, Math.min(W - 1.001, gx(lo) - tx0 * 256)), Y = Math.max(0, Math.min(Hh - 1.001, gy(la) - ty0 * 256));
        const i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j, o = j * W + i;
        return (m[o] * (1 - fx) + m[o + 1] * fx) * (1 - fy) + (m[o + W] * (1 - fx) + m[o + W + 1] * fx) * fy;
      };
      return { at, source: "AWS Terrain Tiles (SRTM, USGS)" };
    }).catch(() => { demCache.delete(key); return null; }); // try again next time instead of caching the failure
    demCache.set(key, p);
    return p;
  }

  function build(pair, opts, Q, dem) {
    const T = root.THREE, rnd = rng(7);
    const F = frame(pair), { c0, KX, KY, S, R, RG, H } = F, LOW = -14;
    const TS = Math.max(1, Math.min(2.2, pair.km / 8));        // exaggerate structures when the pair is far apart
    const K = kit(T, Q.real, Q.aniso), REAL = Q.real;
    vehLevel = REAL ? "ultra" : "detailed";

    // Ground height. With real elevation: meters above the block's low ground, stretched so the relief reads (the
    // Savannah River lowlands are flat), and the factor is shown in the footer. Without it: a gentle made-up roll.
    let heightAt, relief = null;
    if (dem) {
      const ss = [];
      for (let i = 0; i < 48; i++) for (let j = 0; j < 48; j++) ss.push(dem.at(F.latAt((j / 47 * 2 - 1) * H), F.lonAt((i / 47 * 2 - 1) * H)));
      ss.sort((a, b) => a - b);
      const base = ss[Math.floor(ss.length * 0.03)], top = ss[Math.floor(ss.length * 0.99)], span = Math.max(1, top - base);
      const ex = Math.max(1, Math.min(5, 6 / (span / 1000 * S))); // kept modest so slopes and bluffs look like the real ones
      const k = S / 1000 * ex;
      heightAt = (x, z) => Math.max(-1.2, (dem.at(F.latAt(z), F.lonAt(x)) - base) * k - 0.15); // lowest ground sits just under the water
      relief = { ex, low: base, high: top };
    } else {
      heightAt = (x, z) => {
        const r = Math.hypot(x, z), k = smooth(R * 0.75, R * 1.45, r);
        return 0.35 * Math.sin(x * 0.11) * Math.cos(z * 0.09) + 0.2 * Math.sin((x + z) * 0.23) + k * (2.2 + 1.6 * Math.sin(x * 0.07 + 1) * Math.cos(z * 0.06 - 0.5));
      };
    }
    // distance from the center to the block's square edge, in direction a
    const edge = a => H / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    // highest ground within r of a point, so a pad sits on top of any slope under it
    const topOf = (x, z, r) => { let m = -Infinity; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) m = Math.max(m, heightAt(x + i * r / 3, z + j * r / 3)); return m; };
    const toV = ([lat, lon]) => { const x = (lon - c0[1]) * KX * S, z = -(lat - c0[0]) * KY * S; return new T.Vector3(x, heightAt(x, z), z); };

    const scene = new T.Scene();
    scene.fog = new T.FogExp2(PAL.fog, REAL ? 0.0028 : 0.0036);
    const sunDir = new T.Vector3(0.55, 0.52, 0.35).normalize();

    // physical (Preetham) sky; a copy of it also becomes the environment light
    const sky = new T.Sky(); sky.scale.setScalar(3000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.5; u.rayleigh.value = 2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(sunDir);
    scene.add(sky);

    scene.add(new T.HemisphereLight(0xdde8f2, 0x46584c, 0.2));
    const sun = new T.DirectionalLight(PAL.sun, 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -H * 1.05; sc.right = sc.top = H * 1.05; sc.near = 1; sc.far = R * 5;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    // the block's top: ground with vertex colors
    const gGeo = new T.PlaneGeometry(H * 2, H * 2, Q.seg, Q.seg); gGeo.rotateX(-Math.PI / 2);
    const pos = gGeo.attributes.position, cols = [], tmp = new T.Color();
    const cG = new T.Color(PAL.grass), cD = new T.Color(PAL.grassDark), cY = new T.Color(PAL.grassDry), cR = new T.Color(PAL.rock);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z); pos.setY(i, y);
      const n = 0.5 + 0.5 * Math.sin(x * 0.31 + Math.cos(z * 0.27) * 2) * Math.cos(z * 0.19 - x * 0.07);
      tmp.copy(cG).lerp(cD, Math.max(0, 0.6 - n) * 1.3).lerp(cY, smooth(1.6, 3.6, y) * 0.7 + Math.max(0, n - 0.8) * 1.5);
      if (dem && y < 0.15) tmp.lerp(cR, 0.35); // wet river banks
      cols.push(tmp.r, tmp.g, tmp.b);
    }
    gGeo.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
    gGeo.computeVertexNormals();
    // Height of the drawn ground (its triangles, not the raw elevation between vertices), so a walker's feet stay on
    // the surface that is on screen instead of sinking into or floating over it.
    const GN = Q.seg, GC = 2 * H / GN, gy = pos.array;
    const groundAt = (x, z) => {
      const X = Math.max(0, Math.min(GN - 1e-4, (x + H) / GC)), Z = Math.max(0, Math.min(GN - 1e-4, (z + H) / GC));
      const ix = Math.floor(X), iz = Math.floor(Z), fx = X - ix, fz = Z - iz, Y = (i, j) => gy[((j) * (GN + 1) + i) * 3 + 1];
      const a = Y(ix, iz), b = Y(ix, iz + 1), c = Y(ix + 1, iz + 1), d = Y(ix + 1, iz);
      return fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
    };
    // A flat strip laid on the drawn ground along a path, w scene units wide (a right-of-way, a painted line).
    // Returns the strip and its two edges, so a boundary can be outlined.
    // over the river the strip rides the water surface (with real terrain the water sits at 0.02)
    const surf = (x, z) => dem ? Math.max(0.02, groundAt(x, z)) : groundAt(x, z);
    const stripGeo = (path, w, off, edges = [[], []]) => {
      const xz = [], P = [], I = [], step = GC * 0.5;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) xz.push([a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n]);
      }
      xz.forEach(([x, z], i) => {
        const pa = xz[Math.max(0, i - 1)], pb = xz[Math.min(xz.length - 1, i + 1)], l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
        const nx = -(pb[1] - pa[1]) / l, nz = (pb[0] - pa[0]) / l;
        [-1, 1].forEach((sd, e) => { const X = x + nx * sd * w / 2, Z = z + nz * sd * w / 2, Y = surf(X, Z) + off; P.push(X, Y, Z); edges[e].push(new T.Vector3(X, Y + 0.01, Z)); });
        if (i) { const o = (i - 1) * 2; I.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      });
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
      return g;
    };
    const drape = (path, w, mat, off = 0.04) => {
      const edges = [[], []], m = new T.Mesh(stripGeo(path, w, off, edges), mat); m.receiveShadow = true; scene.add(m);
      return { m, edges };
    };
    // Survey marks keep a minimum size on screen: each frame the renderer passes the world size of one pixel at the
    // mark, and a mark smaller than its minimum grows (a strip gets wider, a pole taller). Lengths never change.
    const marks = [];
    const strip = (a, b, w, mat, off, minPx, grow) => {
      const c = a.clone().lerp(b, 0.5), s = drape([a, b], w, mat, off);
      let f0 = 1;
      marks.push({ at: c, fit: px => {
        const f = Math.max(1, minPx * px / w);
        if (Math.abs(f - f0) < 0.06 * f0) return;
        f0 = f; s.m.geometry.dispose();
        s.m.geometry = stripGeo(grow ? [c.clone().lerp(a, f), c.clone().lerp(b, f)] : [a, b], w * f, off);
      } });
      return s;
    };
    const flat = (color, opacity = 1) => new T.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const outline = (pts, color) => { const l = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color })); scene.add(l); return l; };
    // Typical cleared right-of-way widths: about 100 ft at 115 kV, 150 ft at 230 kV, 200 ft at 500 kV.
    const rowM = kv => kv >= 500 ? 61 : kv >= 230 ? 46 : 30, mU = S / 1000;
    // speckled grass texture, multiplied over the vertex colors
    const GS = Q.tex, gc = document.createElement("canvas"); gc.width = gc.height = GS;
    const gx = gc.getContext("2d"), gr = rng(3); gx.fillStyle = "#eef2ea"; gx.fillRect(0, 0, GS, GS);
    for (let i = 0; i < 9000 * (GS / 256) ** 2; i++) { const v = 188 + Math.floor(gr() * 55); gx.fillStyle = `rgb(${v - 10},${v},${v - 18})`; gx.fillRect(Math.floor(gr() * GS), Math.floor(gr() * GS), 1 + Math.floor(gr() * 2), 1 + Math.floor(gr() * 3)); }
    // grass blades and a few bare patches
    {
      for (let i = 0; i < 2200 * (GS / 256) ** 2; i++) { const x = gr() * GS, y = gr() * GS, v = 150 + Math.floor(gr() * 90); gx.strokeStyle = `rgba(${v - 30},${v},${v - 60},0.7)`; gx.beginPath(); gx.moveTo(x, y); gx.lineTo(x + (gr() - 0.5) * 3, y - 2 - gr() * 4); gx.stroke(); }
      for (let i = 0; i < 14; i++) { gx.fillStyle = "rgba(205,190,160,0.18)"; gx.beginPath(); gx.arc(gr() * GS, gr() * GS, (6 + gr() * 18) * GS / 256, 0, 7); gx.fill(); }
    }
    const groundTex = new T.CanvasTexture(gc); groundTex.wrapS = groundTex.wrapT = T.RepeatWrapping; groundTex.repeat.set(26, 26);
    groundTex.encoding = T.sRGBEncoding; groundTex.anisotropy = Q.aniso || 4;
    const ground = new T.Mesh(gGeo, pbr(T, 0xffffff, { vertexColors: true, rough: 0.95, map: groundTex, bumpMap: groundTex, bumpScale: 0.015 })); ground.receiveShadow = true; scene.add(ground);

    // earthen side walls, like a cut-out terrain model: topsoil, then clay and sand layers down to the base
    const wallGeo = () => {
      const N = Q.seg, rows = [0, 0.06, 0.25, 0.5, 0.75, 1], P = [], C = [], I = [];
      const band = [new T.Color(0x4a3a26), new T.Color(0x6e5436), new T.Color(0x8a6a44), new T.Color(0x7a5c3a), new T.Color(0x5e4a33), new T.Color(0x4a3b2c)];
      for (let side = 0; side < 4; side++) {
        const b0 = P.length / 3;
        for (let i = 0; i <= N; i++) {
          const t = -H + 2 * H * i / N, x = [t, H, -t, -H][side], z = [H, -t, -H, t][side];
          const top = Math.max(heightAt(x, z), dem ? 0.02 : -9);
          rows.forEach((r, k) => { P.push(x, top + (LOW - top) * r, z); const c = band[k]; C.push(c.r, c.g, c.b); });
        }
        for (let i = 0; i < N; i++) for (let k = 0; k < rows.length - 1; k++) {
          const a = b0 + i * rows.length + k, b = a + rows.length;
          I.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(P, 3)); g.setAttribute("color", new T.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals();
      return g;
    };
    const walls = new T.Mesh(wallGeo(), pbr(T, 0xffffff, { vertexColors: true, rough: 1 })); walls.material.side = T.DoubleSide; walls.receiveShadow = true; scene.add(walls);
    const mtx = new T.Matrix4(), q = new T.Quaternion(), sv = new T.Vector3(), pv = new T.Vector3();

    // lowland, and low forested ridges fading into haze so the sky shows above the horizon
    const low = new T.Mesh(new T.PlaneGeometry(R * 20, R * 20), pbr(T, PAL.lowland, { rough: 1 })); low.rotation.x = -Math.PI / 2; low.position.y = LOW - 0.3; scene.add(low);
    const hMat = pbr(T, PAL.ridge, { rough: 1 }), hGeo = new T.SphereGeometry(1, 24, 12);
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2 + 0.1, r = R * 4.2 + (i % 4) * 18, w = 40 + (i * 13 % 25);
      const m = new T.Mesh(hGeo, hMat); m.scale.set(w, 9 + (i * 7 % 8), w * 0.7);
      m.position.set(Math.cos(a) * r, LOW, Math.sin(a) * r); m.rotation.y = a; scene.add(m);
    }
    // soft cumulus clouds: clusters of billboard puffs, brighter on top
    const tex = softTexture(T), clouds = [];
    for (let i = 0; i < 11; i++) {
      const cl = new T.Group();
      for (let k = 0; k < 9; k++) {
        const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, color: k < 5 ? 0xffffff : 0xdfe6ee, opacity: 0.85 }));
        const w = 9 + rnd() * 9; sp.scale.set(w, w * 0.62, 1); sp.position.set((rnd() - 0.5) * 22, (k < 5 ? 1.6 : -0.6) + rnd() * 2.2, (rnd() - 0.5) * 8); cl.add(sp);
      }
      cl.position.set((rnd() - 0.5) * R * 6, 34 + rnd() * 14, (rnd() - 0.5) * R * 6); scene.add(cl); clouds.push(cl);
    }

    // ---------- the two projects ----------
    const obstacles = [], steam = [], solids = []; // solids: what a walker bumps into, [x, z, radius]
    const towerCache = {};
    const towerAt = [];
    let towerTop = 0;
    const place = (p, color) => {
      const kvH = (p.kv >= 500 ? 4.4 : p.kv >= 230 ? 3.4 : 2.6) * TS;
      const colorHex = new T.Color(color).getHex();
      let pts = [];
      // a multi-part line shows the part nearest the pair's meeting point, so no span is drawn across a gap
      const d0 = c => Math.min(...c.map(([la, lo]) => Math.hypot(la - c0[0], lo - c0[1])));
      const lc = (p.parts || [p.coords]).filter(c => c.length > 1).sort((a, b) => d0(a) - d0(b))[0] || [];
      if (lc.length > 1) {
        for (let i = 1; i < lc.length; i++) {
          const a = toV(lc[i - 1]), b = toV(lc[i]), n = Math.max(1, Math.ceil(a.distanceTo(b) / (4 * TS)));
          for (let k = i === 1 ? 0 : 1; k <= n; k++) { const v = a.clone().lerp(b, k / n); v.y = heightAt(v.x, v.z); pts.push(v); }
        }
        // no tower on the plateau's edge, and none inside a substation or plant placed before this line
        pts = pts.filter(v => Math.hypot(v.x, v.z) < R * 1.3 && obstacles.every(([ox, oz, r]) => Math.hypot(v.x - ox, v.z - oz) > r + 0.8 * TS));
      }
      if (pts.length >= 2) {
        const key = kvH.toFixed(2), parts = towerCache[key] || (towerCache[key] = towerParts(T, kvH / TS));
        const steelMat = REAL ? pbr(T, 0xa9b1b6, { metal: 0.75, rough: 0.5 }) : pbr(T, PAL.steel, Object.assign({ shininess: 30 }, STEEL));
        const steelI = new T.InstancedMesh(parts.steel, steelMat, pts.length);
        const accI = new T.InstancedMesh(parts.accent, REAL ? steelMat : pbr(T, colorHex, { emissive: colorHex, emissiveIntensity: 0.2 }), pts.length);
        const insI = new T.InstancedMesh(parts.ins, pbr(T, PAL.porcelain, { shininess: 40 }), pts.length);
        // bundled conductors: 1 wire per phase at 115 kV, 2 at 230 kV, 4 at 500 kV
        const offs = p.kv >= 500 ? [[-0.13, 0.11], [0.13, 0.11], [-0.13, -0.11], [0.13, -0.11]] : p.kv >= 230 ? [[-0.13, 0], [0.13, 0]] : [[0, 0]];
        const heads = [];
        pts.forEach((v, i) => {
          const d = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]); d.y = 0; d.normalize();
          const rot = Math.atan2(d.x, d.z), side = new T.Vector3(Math.cos(rot), 0, -Math.sin(rot));
          mtx.compose(v, q.setFromAxisAngle(sv.set(0, 1, 0), rot), sv.clone().set(TS, TS, TS));
          steelI.setMatrixAt(i, mtx); accI.setMatrixAt(i, mtx); insI.setMatrixAt(i, mtx);
          const at = (ax, ay) => v.clone().add(side.clone().multiplyScalar(ax * TS)).add(new T.Vector3(0, ay * TS, 0)), last = parts.attach.length - 1;
          heads.push(parts.attach.flatMap(([ax, ay], k) => k === last ? [at(ax, ay)] : offs.map(([ox, oy]) => at(ax + ox, ay + oy))));
          obstacles.push([v.x, v.z, 1.6 * TS]);
        });
        steelI.castShadow = accI.castShadow = insI.castShadow = true; scene.add(steelI, accI, insI);
        // the cleared right-of-way at its real width, mowed lighter than the fields, with its limits marked
        const row = drape(pts, rowM(p.kv) * mU, flat(0xcfc792, 0.32), 0.03);
        row.edges.forEach(e => outline(e, colorHex));
        // sagging conductors between towers
        const cond = [], shield = [], balls = [], SH = heads[0].length - 1;
        for (let i = 1; i < heads.length; i++) heads[i].forEach((b, k) => {
          const a = heads[i - 1][k], sagD = Math.min(1.4, a.distanceTo(b) * (k === SH ? 0.04 : 0.08)), out = k === SH ? shield : cond;
          if (k === SH && i % 2 === 1) for (const t of [0.35, 0.65]) { const m = a.clone().lerp(b, t); m.y -= sagD * 4 * t * (1 - t); balls.push(m); }
          for (let j = 0; j < 10; j++) {
            const t0 = j / 10, t1 = (j + 1) / 10;
            for (const t of [t0, t1]) { const v = a.clone().lerp(b, t); v.y -= sagD * 4 * t * (1 - t); out.push(v.x, v.y, v.z); }
          }
        });
        const lineGeo = arr => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(arr, 3)); return g; };
        scene.add(new T.LineSegments(lineGeo(cond), new T.LineBasicMaterial({ color: REAL ? 0x8f989e : colorHex }))); // real conductors are bare aluminum
        scene.add(new T.LineSegments(lineGeo(shield), new T.LineBasicMaterial({ color: 0x55636f })));
        // orange aviation marker balls on the shield wire
        const ballI = new T.InstancedMesh(new T.SphereGeometry(0.16 * TS, 8, 6), pbr(T, 0xf07a22, { emissive: 0x7a3000, emissiveIntensity: 0.3 }), Math.max(1, balls.length));
        balls.forEach((m, i) => { mtx.makeTranslation(m.x, m.y, m.z); ballI.setMatrixAt(i, mtx); }); ballI.count = balls.length; scene.add(ballI);
        towerAt.push(...pts);
        if (!parts.steel.boundingBox) parts.steel.computeBoundingBox();
        towerTop = Math.max(towerTop, parts.steel.boundingBox.max.y * TS);
        return { anchor: pts[Math.floor(pts.length / 2)], top: kvH };
      }
      const v = toV(p.coords[0]);
      const gen = p.type === "generation", s = (gen ? 10 : p.kv >= 500 ? 7 : 5.5) * TS;
      const node = gen ? plantGroup(T, s, colorHex, K) : substationGroup(T, s, colorHex, K);
      node.position.copy(v); node.position.y = topOf(v.x, v.z, s * 0.62); node.rotation.y = 0.35; node.userData.kind = gen ? "plant" : "sub"; scene.add(node);
      obstacles.push([v.x, v.z, s * 0.8]);
      if (node.userData.stacks) node.userData.stacks.forEach(st => { const w = new T.Vector3(st[0], st[1], st[2]).applyAxisAngle(sv.set(0, 1, 0), 0.35).add(node.position); steam.push({ at: w, big: !!st[3], s }); });
      return { anchor: v, top: gen ? s * 0.65 : s * 0.45 };
    };
    // substations and plants first, so the other project's towers can keep off their pads
    const isL = p => (p.parts || [p.coords]).some(c => c.length > 1);
    let A, B;
    if (isL(pair.p) && !isL(pair.q)) { B = place(pair.q, opts.colorB); A = place(pair.p, opts.colorA); } else { A = place(pair.p, opts.colorA); B = place(pair.q, opts.colorB); }

    // ---------- the closest-point link and what the tier lets them share ----------
    const va = toV(pair.ca), vb = toV(pair.cb), tierHex = new T.Color(opts.tierColor).getHex();
    const mid = va.clone().lerp(vb, 0.5), pulse = [];
    const dirAB = vb.clone().sub(va); dirAB.y = 0; if (dirAB.lengthSq() < 1e-6) dirAB.set(1, 0, 0); dirAB.normalize();
    const perp = new T.Vector3(dirAB.z, 0, -dirAB.x);
    // the side of the gap the default camera looks from (see open), so the yard can go behind the line, not in front
    // It is the side with fewer towers standing between the camera and the line, else the side nearer the usual view.
    const gapLen = va.distanceTo(vb), inFront = sd => towerAt.filter(t => { const r = t.clone().sub(mid); return Math.abs(r.dot(dirAB)) < gapLen / 2 + 4 && r.dot(sd) > 1; }).length;
    const nA = inFront(perp), nB = inFront(perp.clone().negate());
    const camSide = (nA === nB ? perp.dot(new T.Vector3(0.75, 0, 0.85)) < 0 : nA > nB) ? perp.clone().negate() : perp.clone();
    // How the gap is marked on site: a surveyor's stake with flagging tape at each closest point, a painted line on
    // the ground between them (its length is the real gap, to scale), and a short marker post at every even step.
    // Stakes and posts are drawn a few times life size so they can be found from the air; the line itself is not.
    const kS = U * 2.2 * Math.min(1.6, TS), wood = pbr(T, 0xb08a5a, { rough: 0.9 }), paint = pbr(T, 0xff5a1f, { rough: 0.6 });
    const tape = new T.MeshLambertMaterial({ color: 0xff3d9a, side: T.DoubleSide });
    // a surveyor's range pole (red and white half-meter bands) with flagging tape, set on each closest point
    const white = pbr(T, 0xf2f2ee, { rough: 0.6 }), red = pbr(T, 0xd8322a, { rough: 0.6 });
    const stake = (v, minPx = 56, minH = 0, thick = 6) => {
      const g = new T.Group();
      for (let k = 0; k < 5; k++) g.add(mesh(T, new T.CylinderGeometry(0.05 * kS, 0.05 * kS, 0.5 * kS, 8).translate(0, (k + 0.5) * 0.5 * kS, 0), k % 2 ? white : red, false));
      g.add(mesh(T, new T.BoxGeometry(0.4 * kS, 0.08 * kS, 0.4 * kS).translate(0, 0.04 * kS, 0), wood, false)); // hub stake driven flush, painted
      g.add(mesh(T, new T.BoxGeometry(0.1 * kS, 0.06 * kS, 0.1 * kS).translate(0, 0.1 * kS, 0), paint, false));
      [[0.06, 0.3], [-0.05, -0.35]].forEach(([x, r]) => { const f = new T.Mesh(new T.PlaneGeometry(0.06 * kS, 0.6 * kS), tape); f.position.set(x * kS, 2.2 * kS, 0.05 * kS); f.rotation.set(0.1, r, r * 0.4); g.add(f); });
      // a survey flag at the top of the pole, the brightest thing on it from the air
      const flag = new T.Mesh(new T.PlaneGeometry(0.5 * kS, 0.3 * kS).translate(0.25 * kS, 0, 0), tape); flag.position.set(0.05 * kS, 2.35 * kS, 0); g.add(flag);
      g.userData.kind = "stake"; g.position.set(v.x, surf(v.x, v.z), v.z); g.rotation.y = Math.atan2(dirAB.x, dirAB.z); scene.add(g);
      solids.push([v.x, v.z, 0.2 * kS]);
      // at least 56 px tall and 6 px thick, so the pole stands out even where it sits among a crossing's towers
      marks.push({ at: g.position, fit: px => { const h = Math.max(1, minPx * px / (2.5 * kS), minH / (2.5 * kS)); g.scale.set(Math.min(h, Math.max(1, thick * px / (0.1 * kS))), h, Math.min(h, Math.max(1, thick * px / (0.1 * kS)))); } });
    };
    if (pair.km > 0.1) { stake(va); stake(vb); } else {
      // where the lines cross, a tower usually stands on the point, so the pole goes on the nearest clear ground as a
      // witness stake (what a crew sets when the point itself is taken), with a painted cross on the crossing
      let at = va;
      for (let rad = 1.5 * TS; rad < 12 * TS && at === va; rad += 0.5 * TS) for (let k = 0; k < 12 && at === va; k++) {
        const c = va.clone().add(new T.Vector3(Math.cos(k * Math.PI / 6) * rad, 0, Math.sin(k * Math.PI / 6) * rad));
        if (obstacles.every(([ox, oz, r]) => Math.hypot(c.x - ox, c.z - oz) > r * 0.8 + 0.4)) at = c;
      }
      stake(at, 120, 1.5 * towerTop, 9); // half again as tall as the crossing's towers, so it stands out among them
      const x = 0.25 * TS;
      for (const d of [dirAB.clone().add(perp), dirAB.clone().sub(perp)]) { d.normalize(); strip(va.clone().addScaledVector(d, -1.2 * TS), va.clone().addScaledVector(d, 1.2 * TS), x, flat(0xff5a1f), 0.09, 4); }
      if (at !== va) strip(va, at, x * 0.6, flat(0xfbfaf4), 0.08, 3);
    }
    const fmtD = d => d < 1 ? Math.round(d * 1000) + " m" : (d < 10 ? +d.toFixed(2) : +d.toFixed(1)) + " km";
    let every = null;
    const chain = [];
    if (pair.km > 0.1) {
      const w = Math.max(0.16, Math.min(0.45, pair.km * S * 0.012));
      // brush cut along the line, as a survey crew clears it to sight pole to pole, so no tree hides the paint
      for (let t = 0, nc = Math.ceil(va.distanceTo(vb) / 1.5); t <= nc; t++) { const c = va.clone().lerp(vb, t / Math.max(1, nc)); obstacles.push([c.x, c.z, 1.4]); }
      // white paint over a dark casing, so the line reads over grass, sand and water alike
      strip(va, vb, w * 2, flat(0x1d2328), 0.07, 9);
      strip(va, vb, w, flat(0xfbfaf4), 0.08, 4);
      // end caps and step ticks painted across the line, a marker post beside each tick
      const cross = (v, len) => strip(v.clone().addScaledVector(perp, -len / 2), v.clone().addScaledVector(perp, len / 2), w, flat(0xfbfaf4), 0.085, 3, true);
      cross(va, w * 9); cross(vb, w * 9);
      const step = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10].find(st => pair.km / st <= 10) || 10, n = Math.floor(pair.km / step - 1e-6);
      if (n >= 1) {
        const post = new T.InstancedMesh(new T.BoxGeometry(0.08 * kS, 1.2 * kS, 0.08 * kS).translate(0, 0.6 * kS, 0), pbr(T, 0xf2f2ee, { rough: 0.7 }), n);
        const cap = new T.InstancedMesh(new T.BoxGeometry(0.085 * kS, 0.2 * kS, 0.085 * kS).translate(0, 1.1 * kS, 0), pbr(T, tierHex, { rough: 0.6 }), n);
        const lab = Math.max(1, Math.ceil(n / 4)); // up to four stakes carry their distance from the first pole
        for (let j = 1; j <= n; j++) {
          const v = va.clone().lerp(vb, j * step / pair.km), major = j % 5 === 0;
          if (j % lab === 0 && j * step < pair.km - step * 0.6) chain.push([fmtD(j * step), v.clone().addScaledVector(perp, w * 5).setY(surf(v.x, v.z) + 1.6 * kS)]);
          cross(v, w * (major ? 7 : 4));
          const pp = v.clone().addScaledVector(perp, w * 5); pp.y = surf(pp.x, pp.z);
          const set = k => { mtx.makeScale(k, k, k).setPosition(pp); post.setMatrixAt(j - 1, mtx); cap.setMatrixAt(j - 1, mtx); post.instanceMatrix.needsUpdate = cap.instanceMatrix.needsUpdate = true; };
          set(1);
          // at least 22 px tall, stepping out from the line as it grows so it never stands on the paint
          let k0 = 1;
          marks.push({ at: pp, fit: px => { const k = Math.max(1, 22 * px / (1.2 * kS)); if (Math.abs(k - k0) > 0.06 * k0) { k0 = k; pp.copy(v).addScaledVector(perp, w * 5 * k); pp.y = surf(pp.x, pp.z); set(k); } } });
        }
        scene.add(post, cap);
        every = fmtD(step);
      }
    }
    mid.y = surf(mid.x, mid.z);
    const mi = pair.km / 1.609344, gapText = pair.km > 0.1 ? `${fmtD(pair.km)} · ${mi < 10 ? +mi.toFixed(2) : +mi.toFixed(1)} mi between closest points` : "The two projects cross here";

    const labels = [
      makeLabel(`${gapText}${every ? ` · a post every ${every}` : ""}`, opts.tierColor, new T.Vector3(mid.x, mid.y + 4.5 * Math.min(1.6, TS), mid.z), "big"),
      makeLabel(opts.nameA, opts.colorA, new T.Vector3(A.anchor.x, A.anchor.y + A.top + 1.6, A.anchor.z)),
      makeLabel(opts.nameB, opts.colorB, new T.Vector3(B.anchor.x, B.anchor.y + B.top + 1.6, B.anchor.z)),
      // each project's own measurements, just under its name
      ...[[opts.measureA, opts.colorA, A], [opts.measureB, opts.colorB, B]].filter(m => m[0]).map(([t, c, P]) => makeLabel(t, c, new T.Vector3(P.anchor.x, P.anchor.y + P.top + 0.4, P.anchor.z), "small")),
      ...chain.map(([t, v]) => makeLabel(t, opts.tierColor, v, "tick")),
    ];
    if (pair.tier <= 1) {
      // shared right-of-way at the wider of the two lines' real widths, with a gravel access road down the middle
      const ext = Math.max(5, 4 * TS), gm = mid.clone(), e0 = va.clone().addScaledVector(dirAB, -ext), e1 = vb.clone().addScaledVector(dirAB, ext);
      const shared = drape([e0, e1], Math.max(rowM(pair.p.kv), rowM(pair.q.kv)) * mU, flat(tierHex, 0.22), 0.035);
      shared.edges.forEach(e => outline(e, tierHex));
      drape([e0, e1], 5 * mU, flat(0xa58d68), 0.045);
      obstacles.push([gm.x, gm.z, 3]);
      labels.push(makeLabel("Shared right-of-way and access road", opts.tierColor, new T.Vector3(gm.x + perp.x * 5, gm.y + 0.4, gm.z + perp.z * 5), "small"));
    } else if (pair.tier <= 3) {
      // distance from the painted gap line, so the yard never sits on top of it
      const offGap = (x, z) => { const ax = vb.x - va.x, az = vb.z - va.z, t = Math.max(0, Math.min(1, ((x - va.x) * ax + (z - va.z) * az) / (ax * ax + az * az || 1))); return Math.hypot(x - va.x - ax * t, z - va.z - az * t); };
      // the yard goes on the nearest open ground beside the meeting point, clear of towers, substations and plants
      const yd = yardGroup(T, 12, 8, K), yr = 7.4 * TS;
      let spot = null;
      for (let rad = 6; rad <= R && !spot; rad += 2) for (let k = 0; k < 24 && !spot; k++) {
        const a = Math.atan2(-camSide.z, -camSide.x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12;
        const x = mid.x + Math.cos(a) * rad, z = mid.z + Math.sin(a) * rad;
        if (Math.hypot(x, z) < R * 1.05 && offGap(x, z) > yr + 3 && obstacles.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r + yr)) spot = [x, z];
      }
      if (!spot) spot = [mid.x - camSide.x * 6, mid.z - camSide.z * 6];
      yd.userData.kind = "yard"; yd.scale.setScalar(TS); yd.position.set(spot[0], topOf(spot[0], spot[1], 6.6 * TS), spot[1]); yd.rotation.y = Math.atan2(dirAB.x, dirAB.z) + Math.PI / 2; scene.add(yd);
      obstacles.push([yd.position.x, yd.position.z, yr]);
      labels.push(makeLabel(pair.tier === 2 ? "Shared laydown yard" : "Shared crew staging yard", "#e0a93e", new T.Vector3(yd.position.x, yd.position.y + 3 * TS, yd.position.z), "small"));
    }
    // Drop-in start: a few steps back from where the walker landed, clear of towers and pads, facing the meeting
    // point. The spot and a line of sight toward the pair are kept free of trees, ponds and rocks.
    obstacles.forEach(([x, z, r]) => solids.push([x, z, r * 0.7]));
    let walkStart = null;
    if (opts.walkAt) {
      const at = toV(opts.walkAt), f0 = va.clone().lerp(vb, 0.5), away = at.clone().sub(f0); away.y = 0;
      if (away.lengthSq() < 1e-6) away.copy(perp);
      away.normalize();
      const clearOf = v => obstacles.every(([ox, oz, r]) => Math.hypot(v.x - ox, v.z - oz) > r + 3 * TS);
      walkStart = at.clone().add(away.clone().multiplyScalar(4 * TS));
      for (let k = 0; k < 30 && !clearOf(walkStart); k++) walkStart.add(away.clone().multiplyScalar(1.5));
      const look = f0.clone().sub(walkStart); look.y = 0;
      const steps = Math.min(8, Math.ceil(look.length() / 4));
      for (let k = 0; k <= steps; k++) { const v = walkStart.clone().lerp(f0, k / Math.max(1, steps) * 0.6); obstacles.push([v.x, v.z, k ? 2.5 : 4]); }
    }
    const clear = (x, z, pad) => (!dem || heightAt(x, z) > 0.12) && obstacles.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r + pad) && Math.hypot(x - mid.x, z - mid.z) > 7;

    // ponds
    const waterTex = waterNormals(T);
    const water = new T.MeshStandardMaterial({ color: PAL.water, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.94, normalMap: waterTex, normalScale: new T.Vector2(0.15, 0.15), envMapIntensity: 1.3 });
    if (dem) {
      // real terrain: one water level at the block's low ground fills the river channels and creeks
      const lake = new T.Mesh(new T.PlaneGeometry(H * 2, H * 2), water); lake.rotation.x = -Math.PI / 2; lake.position.y = 0.02; lake.receiveShadow = true; scene.add(lake);
    }
    for (let i = 0, made = 0; i < 40 && made < (dem ? 0 : 6); i++) {
      const x = (rnd() - 0.5) * R * 2.6, z = (rnd() - 0.5) * R * 2.6, r = 2.5 + rnd() * 4;
      if (Math.hypot(x, z) > RG - 10 || !clear(x, z, r + 1)) continue;
      const pond = new T.Mesh(new T.CircleGeometry(r, 14), water); pond.scale.set(1, 0.6 + rnd() * 0.4, 1);
      pond.rotation.x = -Math.PI / 2; pond.rotation.z = rnd() * 3; pond.position.set(x, heightAt(x, z) + 0.12, z); pond.receiveShadow = true; scene.add(pond);
      obstacles.push([x, z, r]); solids.push([x, z, r]); made++;
    }

    // instanced pines
    // Ultra-realistic draws loblolly pines as they grow in Georgia and South Carolina: a tall bare trunk with a
    // rounded crown of needle clumps at the top. Detailed keeps the stacked-cone pine.
    const blob = (r, x, y, z) => { const g = new T.IcosahedronGeometry(r, 1); g.translate(x, y, z); return g; };
    const fol = REAL ? merge(T, [blob(0.5, 0, 2.55, 0), blob(0.42, 0.38, 2.35, 0.1), blob(0.4, -0.34, 2.4, -0.15), blob(0.36, 0.05, 2.9, 0.25), blob(0.34, -0.1, 2.2, 0.38), blob(0.3, 0.2, 2.95, -0.3)])
      : merge(T, [cylAt(T, 0, 0.55, 1.2, 9, 0, 1.0, 0), cylAt(T, 0, 0.42, 1.0, 9, 0, 1.6, 0), cylAt(T, 0, 0.28, 0.7, 9, 0, 2.1, 0)]);
    const trk = REAL ? merge(T, [cylAt(T, 0.05, 0.1, 2.6, 7, 0, 1.3, 0), beam(T, new T.Vector3(0, 1.9, 0), new T.Vector3(0.4, 2.3, 0.1), 0.035), beam(T, new T.Vector3(0, 2.1, 0), new T.Vector3(-0.35, 2.4, -0.15), 0.03)])
      : merge(T, [cylAt(T, 0.07, 0.1, 0.6, 5, 0, 0.3, 0)]);
    const NP = REAL ? 420 : 300, pinesF = new T.InstancedMesh(fol, pbr(T, 0xffffff), NP), pinesT = new T.InstancedMesh(trk, pbr(T, PAL.trunk), NP);
    let np = 0;
    for (let i = 0; i < NP * 3 && np < NP; i++) {
      // clump trees: pick a grove center then scatter around it
      const gx = Math.cos(i * 2.39996) * (8 + (i * 7.3) % (RG - 12)), gz = Math.sin(i * 2.39996) * (8 + (i * 7.3) % (RG - 12));
      const x = gx + (rnd() - 0.5) * 6, z = gz + (rnd() - 0.5) * 6;
      if (Math.hypot(x, z) > edge(Math.atan2(z, x)) - 2.5 || !clear(x, z, 1.8)) continue;
      const k = 0.7 + rnd() * 0.9;
      mtx.compose(pv.set(x, heightAt(x, z) - 0.05, z), q.setFromAxisAngle(sv.set(0, 1, 0), rnd() * 6), sv.clone().set(k, k * (0.9 + rnd() * 0.4), k));
      pinesF.setMatrixAt(np, mtx); pinesT.setMatrixAt(np, mtx); solids.push([x, z, 0.14 * k]);
      pinesF.setColorAt(np, tmp.setHex(REAL ? 0x33502f : PAL.pine).offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.08)); np++;
    }
    pinesF.count = pinesT.count = np; pinesF.castShadow = pinesT.castShadow = true;
    scene.add(pinesF, pinesT);

    // more vegetation and ground clutter: broadleaf trees, bushes, rocks, grass tufts
    const scatter = (geo, mat, n, pad, kMin, kMax, base, jitter, shade, twin) => {
      const im = new T.InstancedMesh(geo, mat, n), im2 = twin && new T.InstancedMesh(twin[0], twin[1], n); let c = 0;
      for (let i = 0; i < n * 4 && c < n; i++) {
        const x = (rnd() - 0.5) * RG * 2, z = (rnd() - 0.5) * RG * 2;
        if (Math.hypot(x, z) > edge(Math.atan2(z, x)) - 2 || !clear(x, z, pad)) continue;
        const k = kMin + rnd() * (kMax - kMin);
        mtx.compose(pv.set(x, heightAt(x, z) - 0.05, z), q.setFromAxisAngle(sv.set(0, 1, 0), rnd() * 6), sv.clone().set(k, k * (0.8 + rnd() * 0.4), k));
        im.setMatrixAt(c, mtx); if (im2) im2.setMatrixAt(c, mtx); im.setColorAt(c, tmp.setHex(base).offsetHSL((rnd() - 0.5) * jitter, 0, (rnd() - 0.5) * shade)); c++;
      }
      im.count = c; im.castShadow = true; im.receiveShadow = true; scene.add(im);
      if (im2) { im2.count = c; im2.castShadow = true; scene.add(im2); }
      return im;
    };
    const canopy = merge(T, [(() => { const g = new T.IcosahedronGeometry(0.75, 1); g.translate(0, 1.5, 0); return g; })(), (() => { const g = new T.IcosahedronGeometry(0.55, 1); g.translate(0.35, 1.95, 0.1); return g; })(), (() => { const g = new T.IcosahedronGeometry(0.5, 1); g.translate(-0.3, 1.85, -0.2); return g; })()]);
    scatter(canopy, pbr(T, 0xffffff), 110, 1.8, 0.8, 1.4, 0x5b8a47, 0.06, 0.12, [merge(T, [cylAt(T, 0.06, 0.1, 1.3, 5, 0, 0.65, 0)]), pbr(T, PAL.trunk)]);
    const bush = merge(T, [(() => { const g = new T.IcosahedronGeometry(0.35, 1); g.translate(0, 0.25, 0); return g; })(), (() => { const g = new T.IcosahedronGeometry(0.25, 1); g.translate(0.3, 0.18, 0.1); return g; })()]);
    scatter(bush, pbr(T, 0xffffff), REAL ? 420 : 260, 0.6, 0.7, 1.5, 0x4f7a45, 0.05, 0.14);
    const rock = new T.DodecahedronGeometry(0.35, 0); rock.translate(0, 0.12, 0);
    scatter(rock, pbr(T, 0xffffff), 90, 0.5, 0.5, 1.8, 0x7d8790, 0.02, 0.12);
    const tuft = merge(T, [cylAt(T, 0, 0.05, 0.3, 3, 0, 0.15, 0), cylAt(T, 0, 0.04, 0.24, 3, 0.07, 0.12, 0.03), cylAt(T, 0, 0.04, 0.22, 3, -0.06, 0.11, -0.04)]);
    const tufts = scatter(tuft, pbr(T, 0xffffff), REAL ? 2400 : 900, 0.3, 0.8, 1.6, 0x88a860, 0.05, 0.14); tufts.castShadow = false;

    // work crews at the closest points
    [va, vb].forEach((v, i) => {
      const cr = crewGroup(T, 4, 21 + i, 1.4), sg = i ? -1 : 1;
      let off = 1.4;
      while (off < 14 && !obstacles.every(([ox, oz, r]) => Math.hypot(v.x + perp.x * off * sg - ox, v.z + perp.z * off * sg - oz) > r)) off += 1;
      const x = v.x + perp.x * off * sg, z = v.z + perp.z * off * sg;
      cr.scale.setScalar(Math.min(1.6, TS)); cr.position.set(x, heightAt(x, z), z); scene.add(cr);
      // their pickup, parked beside them facing along the line
      // their truck, parked beside them facing along the line: far enough out that its whole footprint (bucket boom
      // included) clears the crew and any plant, substation or yard
      const VB = {}, tr = new T.Group();
      const v3 = vehicle(T, VB, i ? "bucket" : "pickup", 0, 0, 0, Math.atan2(-dirAB.z, dirAB.x), U * Math.min(1.6, TS), tr);
      flush(T, VB, K, tr);
      const half = v3 ? Math.hypot(v3.box.max.x - v3.box.min.x, v3.box.max.z - v3.box.min.z) / 2 : 0.8 * TS;
      const crewR = 0.75 * 1.4 * Math.min(1.6, TS);
      let d = crewR + half + 0.15, px, pz;
      for (; d < crewR + half + 14; d += 0.25) {
        px = x + perp.x * sg * d; pz = z + perp.z * sg * d;
        if (obstacles.every(([ox, oz, r]) => Math.hypot(px - ox, pz - oz) > r + half)) break;
      }
      tr.position.set(px, heightAt(px, pz), pz); scene.add(tr);
    });

    // steam sprites over stacks and cooling towers
    const puffs = [];
    steam.forEach(st => { for (let i = 0; i < (st.big ? 14 : 8); i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffffff })); sp.userData = { at: st.at, t: i / (st.big ? 14 : 8), big: st.big, s: st.s }; scene.add(sp); puffs.push(sp); } });

    // aim the sun's shadow camera at the pair
    const focus = va.clone().lerp(vb, 0.5);
    sun.target.position.copy(focus); sun.position.copy(focus).add(sunDir.clone().multiplyScalar(R * 2));

    linearize(T, scene, REAL ? 0.55 : 0.35);
    return { scene, sky, marks, puffs, pulse, clouds, labels, focus, relief, K, demSource: dem && dem.source, span: Math.max(12, va.distanceTo(vb)), tex, groundTex, waterTex, heightAt, groundAt, toV, TS, R, obstacles, solids, water: !!dem, walkStart, camSide: pair.km > 0.1 ? camSide : null };
  }

  // ---------- modal and render loop ----------
  let openSeq = 0, shownTags = () => {};
  function open(pair, opts) {
    last = { pair, opts };
    const token = ++openSeq; // a later open (another pair, or a quality change) wins over this one if it loads first
    const modal = document.getElementById("m3d");
    modal.hidden = false;
    document.getElementById("m3dTitle").textContent = opts.title;
    document.getElementById("m3dSub").textContent = opts.subtitle;
    const stage = document.getElementById("m3dStage"), msg = document.getElementById("m3dMsg");
    msg.textContent = "Loading 3D…"; msg.hidden = false;
    document.getElementById("m3dClose").focus();
    Promise.all([ensureThree(QUALITY[qualityKey(opts.quality)]), loadDEM(pair)]).then(([q, dem]) => {
      if (modal.hidden || token !== openSeq) return;
      close(true);
      const T = root.THREE, renderer = new T.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
      const Q = Object.assign({ aniso: renderer.capabilities.getMaxAnisotropy() }, q), built = build(pair, opts, Q, dem);
      const ft = built.relief ? `Real ground elevation from ${built.demSource}, ${Math.round(built.relief.low)} to ${Math.round(built.relief.high)} m, heights stretched ×${built.relief.ex.toFixed(1)} so the gentle slopes show.` : "Ground shape is illustrative (elevation tiles didn't load).";
      document.getElementById("m3dFoot").textContent = `Drag to fly over the scene, right-drag or Ctrl-drag to turn, scroll to climb or descend. The painted gap line, its marker posts and the right-of-way widths are true to scale; towers, stakes and vehicles are drawn larger so they can be seen. ${ft}`;
      renderer.setClearColor(PAL.fog);
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      // nothing that casts a shadow moves, so the shadow map is drawn once instead of every frame
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
      stage.innerHTML = ""; stage.appendChild(renderer.domElement);
      const overlay = document.createElement("div"); overlay.className = "m3d-labels"; stage.appendChild(overlay);
      // each tag has a small x that removes it; turning Labels back on brings every removed tag back
      const tags = built.labels.map(l => {
        const el = document.createElement("span"), t = { el, pos: l.pos, w: 0 };
        el.className = "m3d-tag " + l.size; el.style.setProperty("--c", l.color); el.textContent = l.text;
        const x = document.createElement("button"); x.type = "button"; x.className = "m3d-tag-x"; x.textContent = "×"; x.setAttribute("aria-label", `Remove the tag ${l.text}`);
        x.addEventListener("pointerdown", e => e.stopPropagation());
        x.onclick = e => { e.stopPropagation(); t.gone = true; };
        el.appendChild(x); overlay.appendChild(el); return t;
      });
      shownTags = () => tags.forEach(t => { t.gone = false; });
      tags.forEach(t => { t.w = t.el.offsetWidth || t.el.textContent.length * 7.5; t.h = t.el.offsetHeight || 26; }); // sizes are read once, here
      const v = new T.Vector3();
      // Labels follow their points on screen. Styles are written only when they change (to the nearest tenth of a pixel),
      // and the stage size is read on resize, not every frame, so placing them never makes the page recalculate layout.
      let stageW = 1, stageH = 1, headB = 0;
      const placeTags = () => {
        const shown = [];
        tags.forEach(t => {
          v.copy(t.pos).project(cam);
          t.hide = v.z > 1 || !!t.gone;
          // keep the whole label inside the view
          const half = t.w / 2 + 8;
          t.X = Math.max(half, Math.min(stageW - half, (v.x + 1) / 2 * stageW)); t.Y = (1 - v.y) / 2 * stageH;
          if (!t.hide) shown.push(t);
        });
        // labels that would overlap are stacked: working up from the lowest, each one moves above any it would cover
        shown.sort((a, b) => b.Y - a.Y);
        shown.forEach((t, i) => {
          for (let moved = true; moved;) {
            moved = false;
            for (const o of shown.slice(0, i)) {
              if (Math.abs(t.X - o.X) < (t.w + o.w) / 2 + 4 && t.Y > o.Y - o.h - 3 && t.Y - t.h < o.Y) { t.Y = o.Y - o.h - 3; moved = true; }
            }
          }
        });
        // nothing may sit under the title bar: labels pushed up into it drop back below, stacking downward
        const clash = (t, o) => Math.abs(t.X - o.X) < (t.w + o.w) / 2 + 4 && t.Y > o.Y - o.h - 3 && t.Y - t.h < o.Y + 3;
        if (shown.some(t => t.Y - t.h < headB)) {
          shown.sort((a, b) => a.Y - b.Y);
          shown.forEach((t, i) => {
            if (t.Y - t.h < headB) t.Y = headB + t.h;
            for (let moved = true; moved;) { moved = false; for (const o of shown.slice(0, i)) if (clash(t, o)) { t.Y = o.Y + t.h + 3; moved = true; } }
          });
        }
        tags.forEach(t => {
          const tf = t.hide ? t.tf : `translate(${t.X.toFixed(1)}px, ${t.Y.toFixed(1)}px) translate(-50%, -100%)`;
          if (t.hide !== t.off) { t.off = t.hide; t.el.style.display = t.hide ? "none" : ""; }
          if (tf !== t.tf) { t.tf = tf; t.el.style.transform = tf; }
        });
      };


      const cam = new T.PerspectiveCamera(42, 1, 0.5, 9000);
      const f = built.focus, d = built.span * 1.5 + 16;
      // the default view looks across the gap from the side, not along it, so its whole length reads at true scale
      const hd = new T.Vector3(0.75, 0, 0.85), hl = d * hd.length(); hd.normalize();
      if (built.camSide) hd.addScaledVector(built.camSide, 3).normalize();
      const endPos = new T.Vector3(f.x + hd.x * hl, f.y + d * (built.camSide ? 0.62 : 0.5), f.z + hd.z * hl), rel = endPos.clone().sub(f);
      const endR = rel.length(), endAz = Math.atan2(rel.x, rel.z), endEl = Math.asin(rel.y / endR);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const INTRO = reduced || opts.walkAt ? 0 : 2.6;
      const orbitAt = (r, az, el) => cam.position.set(f.x + r * Math.cos(el) * Math.sin(az), f.y + r * Math.sin(el), f.z + r * Math.cos(el) * Math.cos(az));
      if (INTRO) orbitAt(endR * 2.3, endAz + 1.1, Math.min(1.25, endEl + 0.5)); else cam.position.copy(endPos);
      cam.lookAt(f);

      const controls = new T.OrbitControls(cam, renderer.domElement);
      controls.target.copy(f); controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 6; controls.maxDistance = 150;
      controls.autoRotateSpeed = 0.5; controls.enabled = !INTRO; controls.autoRotate = false;
      // Fly over the scene like a drone: dragging slides the view across the ground at the current height, right-drag
      // (or Ctrl-drag) turns it, the wheel climbs and descends. On touch, one finger slides, two turn and zoom.
      controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
      controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
      controls.screenSpacePanning = false; controls.panSpeed = 1.1;
      // keep the spot under the view on the block and the camera above the ground
      const keepIn = () => {
        const t = controls.target, r = Math.hypot(t.x, t.z), lim = built.R * 1.1;
        if (r > lim) { const k = lim / r, dx = t.x * (k - 1), dz = t.z * (k - 1); t.x += dx; t.z += dz; cam.position.x += dx; cam.position.z += dz; }
        const floor = built.heightAt(cam.position.x, cam.position.z) + 2;
        if (cam.position.y < floor) cam.position.y = floor;
      };
      controls.addEventListener("change", keepIn);
      controls.addEventListener("start", () => { controls.autoRotate = false; });

      // Walk mode: stand on the ground where the drop-in figure landed and walk around with the keyboard.
      // W/A/S/D or the arrow keys move, dragging looks around, Shift runs. The camera stays at eye height over the
      // terrain and inside the plateau.
      const eye = 0.85 * Math.min(1.6, built.TS), walk = { on: false, yaw: 0, pitch: -0.05, keys: new Set(), drag: null, vx: 0, vz: 0, look: null };
      const canLock = !!renderer.domElement.requestPointerLock;
      const gAt = built.groundAt || built.heightAt, BODY = 0.3 * Math.min(1.6, built.TS);
      const walkBtn = document.getElementById("m3dWalk"), foot = document.querySelector("#m3d .m3d-foot"), orbitNote = foot ? foot.textContent : ""; // the terrain note set above
      const setWalk = on => {
        const was = walk.on;
        walk.on = on; walk.keys.clear(); controls.enabled = !on && !(INTRO && !was); controls.autoRotate = false;
        if (on) {
          const d = f.clone().sub(cam.position); walk.yaw = Math.atan2(d.x, d.z); walk.vx = walk.vz = 0; walk.look = null;
          cam.position.y = gAt(cam.position.x, cam.position.z) + eye;
        } else if (was) { // leaving walk: orbit around the spot ahead; opening straight into orbit keeps the overview target
          const ahead = new T.Vector3(Math.sin(walk.yaw), 0, Math.cos(walk.yaw)).multiplyScalar(12).add(cam.position);
          controls.target.copy(ahead); cam.position.y += 8;
        }
        if (walkBtn) { walkBtn.setAttribute("aria-pressed", on); walkBtn.textContent = on ? "Walking" : "Walk"; }
        if (foot) foot.textContent = on ? (canLock ? "Click the view, then move the mouse to look around (Esc frees the mouse). W A S D or the arrow keys walk, Shift runs."
          : "Walk with W A S D or the arrow keys, drag to look around, hold Shift to run.") + " Orbit returns to the overview." : orbitNote;
        if (!on && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      };
      const typing = e => /input|select|textarea/i.test(e.target.tagName);
      const MOVE = { KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0], KeyA: [0, 1], ArrowLeft: [0, 1], KeyD: [0, -1], ArrowRight: [0, -1] };
      const onKeyDown = e => { if (!walk.on || typing(e)) return; if (MOVE[e.code] || e.code === "ShiftLeft" || e.code === "ShiftRight") { walk.keys.add(e.code); e.preventDefault(); } };
      const onKeyUp = e => walk.keys.delete(e.code);
      const onBlur = () => walk.keys.clear(); // a key released while the window is in the background never sends keyup
      const cv = renderer.domElement;
      // dragging sets where the view should point; the camera eases toward it each frame, so look-around is smooth
      // even when pointer events arrive in bursts
      // Walking looks around with the mouse itself (pointer lock, as in a game): a click in the view captures the
      // pointer and Esc releases it. Browsers without pointer lock fall back to dragging.
      const locked = () => document.pointerLockElement === cv;
      const onLock = () => { if (!locked()) walk.unlockAt = performance.now(); };
      document.addEventListener("pointerlockchange", onLock);
      const onDown = e => {
        if (!walk.on || e.button !== 0) return;
        if (canLock) { if (!locked()) { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } return; }
        walk.drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId);
      };
      const onMouse = e => {
        if (!walk.on || !locked()) return;
        const L = walk.look || (walk.look = [walk.yaw, walk.pitch]);
        L[0] -= e.movementX * 0.0022; L[1] = Math.max(-1.2, Math.min(1.0, L[1] - e.movementY * 0.0022));
      };
      document.addEventListener("mousemove", onMouse);
      const onMove = e => {
        if (!walk.on || !walk.drag) return;
        const L = walk.look || (walk.look = [walk.yaw, walk.pitch]);
        L[0] -= (e.clientX - walk.drag[0]) * 0.005; L[1] = Math.max(-1.1, Math.min(0.9, L[1] - (e.clientY - walk.drag[1]) * 0.004));
        walk.drag = [e.clientX, e.clientY];
      };
      const onUp = e => { walk.drag = null; if (cv.hasPointerCapture && cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId); };
      addEventListener("keydown", onKeyDown); addEventListener("keyup", onKeyUp); addEventListener("blur", onBlur);
      cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerup", onUp); cv.addEventListener("pointercancel", onUp);
      if (walkBtn) walkBtn.onclick = () => setWalk(!walk.on);
      // Esc that only freed the mouse must not also end the walk
      walkCtl = { on: () => walk.on, off: () => { if (performance.now() - (walk.unlockAt || 0) > 400) setWalk(false); } };
      // Walking: speed eases up and down instead of jumping, the walker slides around structures, tree trunks and
      // ponds rather than passing through them, stays out of the river, and the eye follows the ground smoothly.
      const solids = built.solids || [];
      const wet = (x, z) => built.water && gAt(x, z) < 0.05;
      const pushOut = (x, z) => {
        for (let pass = 0; pass < 2; pass++) for (const [ox, oz, r] of solids) {
          const dx = x - ox, dz = z - oz, d = Math.hypot(dx, dz), min = r + BODY;
          if (d < min && d > 1e-6) { x = ox + dx / d * min; z = oz + dz / d * min; }
        }
        return [x, z];
      };
      const stepWalk = dt => {
        let fw = 0, sd = 0;
        walk.keys.forEach(k => { if (MOVE[k]) { fw += MOVE[k][0]; sd += MOVE[k][1]; } });
        const n = Math.hypot(fw, sd) || 1; fw /= n; sd /= n; // diagonal is no faster
        if (walk.look) {
          const e = 1 - Math.exp(-18 * dt);
          walk.yaw += (walk.look[0] - walk.yaw) * e; walk.pitch += (walk.look[1] - walk.pitch) * e;
          if (!walk.drag && Math.abs(walk.look[0] - walk.yaw) + Math.abs(walk.look[1] - walk.pitch) < 1e-4) walk.look = null;
        }
        const top = walk.keys.has("ShiftLeft") || walk.keys.has("ShiftRight") ? 14 : 5, p = cam.position;
        const fx = Math.sin(walk.yaw), fz = Math.cos(walk.yaw);
        const e = 1 - Math.exp(-(fw || sd ? 9 : 12) * dt);
        walk.vx += ((fx * fw + fz * sd) * top - walk.vx) * e; walk.vz += ((fz * fw - fx * sd) * top - walk.vz) * e;
        let nx = p.x + walk.vx * dt, nz = p.z + walk.vz * dt;
        const r = Math.hypot(nx, nz), lim = built.R * 1.25;
        if (r > lim) { nx *= lim / r; nz *= lim / r; }
        [nx, nz] = pushOut(nx, nz);
        // the river and ground too steep to climb (the relief is stretched, so some bluffs are near-vertical) act as
        // walls: keep whichever axis is still passable, like sliding along a wall
        const h0 = gAt(p.x, p.z), stop = (x, z) => {
          const d = Math.hypot(x - p.x, z - p.z);
          return (wet(x, z) && !wet(p.x, p.z)) || (d > 1e-6 && (gAt(x, z) - h0) / d > 1.3);
        };
        if (stop(nx, nz)) {
          if (!stop(nx, p.z)) nz = p.z; else if (!stop(p.x, nz)) nx = p.x; else { nx = p.x; nz = p.z; }
          walk.vx *= 0.5; walk.vz *= 0.5;
        }
        // the eye rides the ground averaged over a stride around the feet, so the exaggerated relief reads as a
        // slope rather than as steps; it catches up faster when the ground rises close to it, and never goes under
        const g0 = gAt(nx, nz), sr = eye * 0.8;
        let ga = g0 * 2; for (let k = 0; k < 6; k++) ga += gAt(nx + Math.cos(k * 1.047) * sr, nz + Math.sin(k * 1.047) * sr);
        const g = Math.max(ga / 8, g0 - eye * 0.3) + eye, rate = p.y < g0 + eye * 0.6 ? 26 : 9;
        p.set(nx, Math.max(g0 + eye * 0.3, p.y + (g - p.y) * (1 - Math.exp(-rate * dt))), nz);
        cam.lookAt(p.x + Math.sin(walk.yaw) * Math.cos(walk.pitch), p.y + Math.sin(walk.pitch), p.z + Math.cos(walk.yaw) * Math.cos(walk.pitch));
      };
      if (built.walkStart) {
        const w0 = built.walkStart;
        cam.position.set(w0.x, gAt(w0.x, w0.z) + eye, w0.z);
        setWalk(true);
      } else setWalk(false);

      // Render in linear HDR (half-float target), add bloom, then ACES tone mapping, sRGB conversion and FXAA.
      const pmrem = new T.PMREMGenerator(renderer);
      const envScene = new T.Scene(); envScene.add(built.sky.clone());
      built.scene.environment = pmrem.fromScene(envScene).texture;
      const rt = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
      const composer = new T.EffectComposer(renderer, rt);
      let ssao = null;
      if (Q.ssao) {
        // Ambient occlusion darkens creases where towers meet the ground and parts touch. The pass renders the scene
        // itself; its beauty buffer is switched to half-float so bloom and tone mapping still get HDR input.
        ssao = new T.SSAOPass(built.scene, cam, 1, 1);
        ssao.beautyRenderTarget.texture.type = T.HalfFloatType;
        ssao.normalRenderTarget.depthTexture.type = T.UnsignedIntType; // 16-bit depth bands badly over this camera range
        ssao.kernelSize = Q.ssao; ssao.generateSampleKernel();
        ssao.ssaoMaterial.defines.KERNEL_SIZE = Q.ssao; ssao.ssaoMaterial.uniforms.kernel.value = ssao.kernel; ssao.ssaoMaterial.needsUpdate = true;
        ssao.kernelRadius = 1.4; ssao.minDistance = 0.000002; ssao.maxDistance = 0.0006;
        // clouds, steam and labels are sprites: keep them out of the occlusion pass
        const hide = ssao.overrideVisibility.bind(ssao), skip = [];
        built.scene.traverse(o => { if (o.isSprite || o === built.sky) skip.push(o); });
        ssao.overrideVisibility = function () { hide(); skip.forEach(o => { o.visible = false; }); };
        composer.addPass(ssao);
      } else composer.addPass(new T.RenderPass(built.scene, cam));
      const bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), Q.real ? 0.08 : 0.18, 0.55, 0.95); composer.addPass(bloom);
      const tone = new T.ShaderPass(T.ACESFilmicToneMappingShader); tone.uniforms.exposure.value = Q.real ? 0.78 : 0.72; composer.addPass(tone);
      composer.addPass(new T.ShaderPass(T.GammaCorrectionShader));
      // SMAA keeps thin wires and lattice members crisp; FXAA is the cheaper fallback.
      const fxaa = Q.smaa ? null : new T.ShaderPass(T.FXAAShader), smaa = Q.smaa ? new T.SMAAPass(1, 1) : null;
      composer.addPass(fxaa || smaa);

      if (hooks.setupRender) hooks.setupRender({ T, renderer, scene: built.scene, cam, composer, Q, built });
      const size = () => {
        const w = stage.clientWidth, h = stage.clientHeight, pr = Math.min(Q.dpr, devicePixelRatio);
        stageW = w; stageH = h;
        const head = document.querySelector("#m3d .m3d-head"), sub = document.getElementById("m3dSub");
        headB = head ? Math.max(0, (sub || head).getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 8) : 0;
        renderer.setPixelRatio(pr);
        renderer.setSize(Math.max(1, w), Math.max(1, h), false);
        renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
        composer.setPixelRatio(pr); composer.setSize(w, h);
        if (fxaa) fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        cam.aspect = w / h; cam.updateProjectionMatrix();
      };
      size();
      const clock = new T.Clock();
      let raf;
      let lastT = 0;
      const loop = () => {
        const t = clock.getElapsedTime(), dt = Math.min(0.05, t - lastT); lastT = t;
        if (INTRO && !controls.enabled) {
          const k = Math.min(1, t / INTRO), e = 1 - Math.pow(1 - k, 3);
          orbitAt(endR * (2.3 - 1.3 * e), endAz + 1.1 * (1 - e), endEl + (Math.min(1.25, endEl + 0.5) - endEl) * (1 - e)); cam.lookAt(f);
          if (k >= 1) controls.enabled = true; // no slow spin afterwards: it would turn the side-on view of the gap away
        }
        built.puffs.forEach(p => {
          const u = p.userData, k = (u.t + t * (u.big ? 0.07 : 0.11)) % 1, rise = u.s * (u.big ? 0.9 : 0.7);
          p.position.set(u.at.x + Math.sin(k * 5 + u.t * 9) * k * 0.8 + k * rise * 0.35, u.at.y + k * rise, u.at.z + k * rise * 0.15);
          p.scale.setScalar((u.big ? 1.6 : 0.8) * (0.6 + k * 2.4));
          p.material.opacity = 0.8 * Math.min(1, k * 6) * (1 - k);
        });
        // one pixel in world units at a mark: its distance times the view's height in world units per pixel
        const pxAt = 2 * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, stageH);
        built.marks.forEach(mk => mk.fit(cam.position.distanceTo(mk.at) * pxAt));
        built.pulse.forEach(({ m, kind }) => {
          if (kind === "ring") { const k = (t * 0.5) % 1; m.scale.setScalar(0.6 + k * 1.8); m.material.opacity = 0.7 * (1 - k); }
          else if (kind === "beam") m.material.opacity = 0.28 + 0.14 * Math.sin(t * 2.4);
          else m.scale.setScalar(1 + 0.25 * Math.sin(t * 3));
        });
        built.clouds.forEach((c, i) => { c.position.x += 0.012 * (1 + (i % 3) * 0.4); if (c.position.x > 260) c.position.x = -260; });
        built.waterTex.offset.set(t * 0.012, t * 0.007);
        if (walk.on) stepWalk(dt); else controls.update();
        composer.render();
        placeTags(); raf = requestAnimationFrame(loop);
      };
      loop();
      msg.hidden = true;
      const onResize = () => size();
      addEventListener("resize", onResize);
      ctx = {
        stop: () => {
          cancelAnimationFrame(raf); removeEventListener("resize", onResize); controls.dispose();
          removeEventListener("keydown", onKeyDown); removeEventListener("keyup", onKeyUp); removeEventListener("blur", onBlur);
          document.removeEventListener("pointerlockchange", onLock); document.removeEventListener("mousemove", onMouse);
          if (locked()) document.exitPointerLock();
          built.scene.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); });
          [built.tex, built.groundTex, built.waterTex, built.scene.environment, ...built.K.texs].forEach(x => x && x.dispose());
          composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); pmrem.dispose();
          if (ssao) ssao.dispose(); if (smaa) { smaa.edgesRT.dispose(); smaa.weightsRT.dispose(); smaa.areaTexture.dispose(); smaa.searchTexture.dispose(); }
          renderer.dispose(); renderer.forceContextLoss(); // browsers cap live WebGL contexts; free this one now
        },
      };
    }).catch(err => { msg.hidden = false; msg.textContent = root.THREE ? "The 3D view couldn't be drawn: " + err.message : "The 3D view needs an internet connection to load three.js. " + err.message; });
  }
  function close(keepOpen) {
    if (ctx) { ctx.stop(); ctx = null; }
    walkCtl = null;
    if (!keepOpen) { document.getElementById("m3d").hidden = true; document.getElementById("m3dStage").innerHTML = ""; }
  }
  // Re-open the current pair at a new quality setting.
  const reopen = quality => { if (last && !document.getElementById("m3d").hidden) open(last.pair, Object.assign({}, last.opts, { quality })); };
  // Escape in the page first stops walking, then closes the view.
  const isWalking = () => !!(walkCtl && walkCtl.on()), stopWalking = () => walkCtl && walkCtl.off();
  root.Scene3D = { open, close, reopen, restoreTags: () => shownTags(), QUALITY, qualityKey, isWalking, stopWalking, hooks };
})(this);
