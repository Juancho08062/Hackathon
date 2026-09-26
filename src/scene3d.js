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

  let ctx = null, last = null;
  // Standard is the lightest; High (the default) adds ambient occlusion and SMAA; Ultra renders at the full screen
  // resolution with a wider occlusion kernel. dpr caps the pixel ratio; seg and tex set terrain and grass detail.
  const QUALITY = {
    standard: { dpr: 1.25, shadow: 2048, seg: 130, tex: 256, ssao: 0, smaa: false },
    high: { dpr: 2, shadow: 4096, seg: 200, tex: 512, ssao: 16, smaa: true },
    ultra: { dpr: 3, shadow: 4096, seg: 280, tex: 1024, ssao: 32, smaa: true },
  };
  const ensureThree = q => root.Libs.need("THREE", "OrbitControls", "ThreeExtras")
    .then(() => q.ssao || q.smaa ? root.Libs.need("ThreeQuality").then(() => q, () => QUALITY.standard) : q);

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

  function substationGroup(T, s, color) {
    const g = new T.Group(), steel = pbr(T, PAL.steel, STEEL), dark = pbr(T, PAL.steelDark, STEEL);
    const pad = mesh(T, new T.BoxGeometry(s, 0.16, s * 0.8), pbr(T, PAL.gravel), false); pad.position.y = 0.08; g.add(pad);
    // fence
    const f = [], hw = s * 0.52, hd = s * 0.42;
    for (let i = 0; i <= 12; i++) { const t = -1 + i / 6; if (Math.abs(t) <= 1) { f.push(boxAt(T, 0.05, 0.6, 0.05, t * hw, 0.4, hd), boxAt(T, 0.05, 0.6, 0.05, t * hw, 0.4, -hd), boxAt(T, 0.05, 0.6, 0.05, hw, 0.4, t * hd), boxAt(T, 0.05, 0.6, 0.05, -hw, 0.4, t * hd)); } }
    for (const y of [0.35, 0.68]) f.push(boxAt(T, hw * 2, 0.03, 0.03, 0, y, hd), boxAt(T, hw * 2, 0.03, 0.03, 0, y, -hd), boxAt(T, 0.03, 0.03, hd * 2, hw, y, 0), boxAt(T, 0.03, 0.03, hd * 2, -hw, y, 0));
    g.add(mesh(T, merge(T, f), pbr(T, PAL.fence)));
    // transformers with radiator fins and porcelain bushings
    const tank = [], bush = [];
    for (const x of [-s * 0.2, s * 0.2]) {
      tank.push(boxAt(T, s * 0.16, s * 0.14, s * 0.12, x, 0.16 + s * 0.07, -s * 0.18));
      for (let i = 0; i < 5; i++) tank.push(boxAt(T, 0.04, s * 0.11, s * 0.1, x - s * 0.1 - 0.02 - i * 0.02, 0.16 + s * 0.065, -s * 0.18));
      for (let i = -1; i <= 1; i++) bush.push(cylAt(T, 0.06, 0.09, s * 0.08, 6, x + i * s * 0.045, 0.16 + s * 0.18, -s * 0.18));
    }
    for (const x of [-s * 0.2, s * 0.2]) {
      const c = cylAt(T, s * 0.025, s * 0.025, s * 0.12, 10, 0, 0, 0); c.rotateZ(Math.PI / 2); c.translate(x, 0.16 + s * 0.2, -s * 0.24); tank.push(c);
      tank.push(boxAt(T, 0.04, s * 0.05, 0.04, x - s * 0.04, 0.16 + s * 0.16, -s * 0.24), boxAt(T, 0.04, s * 0.05, 0.04, x + s * 0.04, 0.16 + s * 0.16, -s * 0.24));
    }
    g.add(mesh(T, merge(T, tank), pbr(T, 0x6d7f8e)));
    const curb = [];
    for (const x of [-s * 0.2, s * 0.2]) curb.push(boxAt(T, s * 0.22, 0.06, 0.05, x, 0.19, -s * 0.28), boxAt(T, s * 0.22, 0.06, 0.05, x, 0.19, -s * 0.08), boxAt(T, 0.05, 0.06, s * 0.2, x - s * 0.11, 0.19, -s * 0.18), boxAt(T, 0.05, 0.06, s * 0.2, x + s * 0.11, 0.19, -s * 0.18));
    g.add(mesh(T, merge(T, curb), pbr(T, PAL.concrete)));
    g.add(mesh(T, merge(T, bush), pbr(T, PAL.porcelain, { shininess: 40 })));
    // lattice gantries and bus
    const gan = [], V = (x, y, z) => new T.Vector3(x, y, z), gh = s * 0.42, gz = s * 0.14;
    for (const x of [-s * 0.38, 0, s * 0.38]) for (const z of [gz - 0.2, gz + 0.2]) {
      gan.push(beam(T, V(x - 0.12, 0, z), V(x - 0.06, gh, z), 0.05), beam(T, V(x + 0.12, 0, z), V(x + 0.06, gh, z), 0.05));
      for (let k = 0; k < 4; k++) gan.push(beam(T, V(x - 0.11, k * gh / 4, z), V(x + 0.1, (k + 1) * gh / 4, z), 0.03));
    }
    for (const z of [gz - 0.2, gz + 0.2]) gan.push(beam(T, V(-s * 0.4, gh, z), V(s * 0.4, gh, z), 0.07));
    g.add(mesh(T, merge(T, gan), steel));
    const bus = [];
    for (const dz of [-0.28, 0, 0.28]) bus.push(boxAt(T, s * 0.78, 0.05, 0.05, 0, gh * 0.78, gz + dz));
    g.add(mesh(T, merge(T, bus), pbr(T, color, { emissive: color, emissiveIntensity: 0.25 })));
    // disconnect switches on porcelain post insulators under the bus, and lightning masts at the corners
    const post = [], blade = [], mast = [];
    for (let i = 0; i < 5; i++) for (const dz of [-0.28, 0, 0.28]) {
      const x = -s * 0.3 + i * s * 0.15;
      post.push(cylAt(T, 0.035, 0.05, s * 0.12, 6, x, 0.16 + s * 0.06, gz + dz), cylAt(T, 0.035, 0.05, s * 0.12, 6, x + 0.3, 0.16 + s * 0.06, gz + dz));
      blade.push(boxAt(T, 0.34, 0.025, 0.025, x + 0.15, 0.2 + s * 0.12, gz + dz));
    }
    for (const [x, z] of [[-s * 0.46, -s * 0.36], [s * 0.46, s * 0.36]]) mast.push(cylAt(T, 0.03, 0.09, s * 0.75, 6, x, s * 0.375, z));
    g.add(mesh(T, merge(T, post), pbr(T, PAL.porcelain, { shininess: 40 })));
    g.add(mesh(T, merge(T, blade), steel));
    g.add(mesh(T, merge(T, mast), dark));
    // breakers
    const brk = [];
    for (let i = 0; i < 6; i++) brk.push(cylAt(T, 0.09, 0.09, s * 0.12, 8, -s * 0.3 + i * s * 0.12, 0.16 + s * 0.06, s * 0.3));
    for (let i = 0; i < 6; i++) brk.push(boxAt(T, 0.16, s * 0.05, 0.14, -s * 0.3 + i * s * 0.12, 0.16 + s * 0.025, s * 0.3 - 0.16));
    g.add(mesh(T, merge(T, brk), dark));
    const gate = mesh(T, new T.BoxGeometry(0.8, 0.5, 0.03), pbr(T, 0xd9a441)); gate.position.set(s * 0.1, 0.36, hd); g.add(gate);
    // control house
    const house = mesh(T, new T.BoxGeometry(s * 0.2, s * 0.12, s * 0.14), pbr(T, PAL.concrete)); house.position.set(-s * 0.36, 0.16 + s * 0.06, -s * 0.3); g.add(house);
    const roof = mesh(T, new T.BoxGeometry(s * 0.22, 0.08, s * 0.16), pbr(T, color)); roof.position.set(-s * 0.36, 0.2 + s * 0.12, -s * 0.3); g.add(roof);
    return g;
  }

  function plantGroup(T, s, color) {
    const g = new T.Group(), steel = pbr(T, PAL.steel, STEEL), dark = pbr(T, PAL.steelDark, STEEL);
    const pad = mesh(T, new T.BoxGeometry(s * 1.2, 0.16, s * 0.9), pbr(T, PAL.concrete), false); pad.position.y = 0.08; g.add(pad);
    const hall = mesh(T, new T.BoxGeometry(s * 0.5, s * 0.22, s * 0.3), dark); hall.position.set(-s * 0.2, s * 0.11 + 0.16, s * 0.08); g.add(hall);
    const stripe = mesh(T, new T.BoxGeometry(s * 0.51, s * 0.035, s * 0.31), pbr(T, color, { emissive: color, emissiveIntensity: 0.15 })); stripe.position.set(-s * 0.2, s * 0.19 + 0.16, s * 0.08); g.add(stripe);
    const hr = [], stacks = [];
    for (const x of [s * 0.12, s * 0.3]) {
      hr.push(boxAt(T, s * 0.12, s * 0.28, s * 0.24, x, s * 0.14 + 0.16, s * 0.02));
      hr.push(cylAt(T, s * 0.03, s * 0.036, s * 0.62, 10, x, s * 0.31 + 0.16, -s * 0.16));
      stacks.push([x, s * 0.62 + 0.16, -s * 0.16]);
    }
    g.add(mesh(T, merge(T, hr), steel));
    const bands = [];
    for (const x of [s * 0.12, s * 0.3]) bands.push(cylAt(T, s * 0.039, s * 0.039, s * 0.05, 10, x, s * 0.54 + 0.16, -s * 0.16));
    g.add(mesh(T, merge(T, bands), pbr(T, color)));
    // hyperbolic cooling tower
    const prof = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new T.Vector2(s * (0.1 + 0.07 * Math.pow(2 * t - 1.2, 2)), t * s * 0.46)); }
    const ct = mesh(T, new T.LatheGeometry(prof, 18), pbr(T, 0xd3d9dc, { side: T.DoubleSide })); ct.position.set(-s * 0.32, 0.16, -s * 0.24); g.add(ct);
    stacks.push([-s * 0.32, s * 0.46 + 0.16, -s * 0.24, 1]);
    // pipe rack along the front, like the reference art
    const pipes = [];
    for (const [y, r] of [[s * 0.08, s * 0.03], [s * 0.14, s * 0.022], [s * 0.19, s * 0.018]]) { const p = cylAt(T, r, r, s * 1.05, 8, 0, 0, 0); p.rotateZ(Math.PI / 2); p.translate(0, y + 0.16, s * 0.34); pipes.push(p); }
    for (let i = 0; i < 6; i++) pipes.push(boxAt(T, 0.06, s * 0.22, 0.06, -s * 0.5 + i * s * 0.2, s * 0.11 + 0.16, s * 0.34));
    g.add(mesh(T, merge(T, pipes), steel));
    const tanks = [];
    for (const x of [s * 0.44, s * 0.52]) tanks.push(cylAt(T, s * 0.05, s * 0.05, s * 0.12, 12, x, s * 0.06 + 0.16, s * 0.16));
    g.add(mesh(T, merge(T, tanks), pbr(T, 0xdde2e4)));
    g.userData.stacks = stacks;
    return g;
  }

  function yardGroup(T, w, d) {
    const g = new T.Group(), V = (x, y, z) => new T.Vector3(x, y, z);
    const pad = mesh(T, new T.BoxGeometry(w, 0.12, d), pbr(T, PAL.gravel), false); pad.position.y = 0.06; g.add(pad);
    const reels = [];
    // cable reels in a row, spaced wider than their 1.04 diameter so they never touch
    for (let i = 0; i < 4; i++) { const x = -w * 0.34 + i * 1.2; for (const z of [-0.22, 0.22]) { const r = cylAt(T, 0.52, 0.52, 0.06, 12, 0, 0, 0); r.rotateX(Math.PI / 2); r.translate(x, 0.64, -d * 0.18 + z); reels.push(r); } const hub = cylAt(T, 0.3, 0.3, 0.4, 10, 0, 0, 0); hub.rotateX(Math.PI / 2); hub.translate(x, 0.64, -d * 0.18); reels.push(hub); }
    g.add(mesh(T, merge(T, reels), pbr(T, 0x8a6440)));
    const trucks = [], cabs = [], tires = [], glass = [];
    for (let i = 0; i < 3; i++) {
      const x = -w * 0.34 + i * 1.6, z = d * 0.26;
      trucks.push(boxAt(T, 0.95, 0.12, 0.55, x - 0.2, 0.3, z), boxAt(T, 0.95, 0.18, 0.04, x - 0.2, 0.44, z - 0.26), boxAt(T, 0.95, 0.18, 0.04, x - 0.2, 0.44, z + 0.26));
      cabs.push(boxAt(T, 0.42, 0.42, 0.55, x + 0.5, 0.47, z));
      glass.push(boxAt(T, 0.02, 0.16, 0.45, x + 0.72, 0.58, z));
      wheels(T, tires, x + 0.1, z, 1.25, 0.56);
    }
    // bucket truck with a raised boom
    const bx = -w * 0.3, bz = -d * 0.02;
    trucks.push(boxAt(T, 1.2, 0.2, 0.55, bx, 0.33, bz), boxAt(T, 0.25, 0.2, 0.25, bx - 0.3, 0.52, bz));
    cabs.push(boxAt(T, 0.42, 0.42, 0.55, bx + 0.78, 0.47, bz)); glass.push(boxAt(T, 0.02, 0.16, 0.45, bx + 1.0, 0.58, bz));
    wheels(T, tires, bx + 0.2, bz, 1.5, 0.56);
    const boom = [beam(T, V(bx - 0.3, 0.6, bz), V(bx + 0.4, 1.9, bz), 0.1), beam(T, V(bx + 0.4, 1.9, bz), V(bx + 1.1, 2.3, bz), 0.08), boxAt(T, 0.3, 0.3, 0.3, bx + 1.2, 2.3, bz)];
    g.add(mesh(T, merge(T, trucks), pbr(T, 0x39434b)));
    g.add(mesh(T, merge(T, cabs), pbr(T, 0xe6e0d0)));
    g.add(mesh(T, merge(T, tires), pbr(T, 0x1d2226)));
    g.add(mesh(T, merge(T, glass), pbr(T, 0x7fa9c4, { shininess: 90 })));
    g.add(mesh(T, merge(T, boom), pbr(T, 0xe6e0d0)));
    // site office trailer, portable toilets, cones
    const off = mesh(T, new T.BoxGeometry(1.8, 0.6, 0.7), pbr(T, 0xf0ede4)); off.position.set(-w * 0.32, 0.42, -d * 0.4 + 0.1); g.add(off);
    const offWin = mesh(T, merge(T, [boxAt(T, 0.35, 0.18, 0.02, -w * 0.32 - 0.5, 0.5, -d * 0.4 + 0.46), boxAt(T, 0.35, 0.18, 0.02, -w * 0.32 + 0.4, 0.5, -d * 0.4 + 0.46)]), pbr(T, 0x7fa9c4)); g.add(offWin);
    g.add(mesh(T, merge(T, [boxAt(T, 0.25, 0.5, 0.25, w * 0.44, 0.37, -d * 0.4), boxAt(T, 0.25, 0.5, 0.25, w * 0.44 - 0.32, 0.37, -d * 0.4)]), pbr(T, 0x3d7fb8)));
    const cones = [];
    for (let i = 0; i < 8; i++) cones.push(cylAt(T, 0.01, 0.06, 0.16, 6, -w / 2 + 0.2 + i * (w - 0.4) / 7, 0.2, d / 2 - 0.12));
    g.add(mesh(T, merge(T, cones), pbr(T, 0xf07a22)));
    const crew = crewGroup(T, 6, 11, 1.2); crew.position.set(-0.4, 0.12, d * 0.08); g.add(crew);
    const steel = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 4 - k; i++) steel.push(boxAt(T, 2.2, 0.12, 0.12, w * 0.18, 0.18 + k * 0.13, -d * 0.02 + (i - 1.5 + k * 0.5) * 0.14));
    g.add(mesh(T, merge(T, steel), pbr(T, 0x7b8a96)));
    // crawler crane with a lattice boom
    const cr = [], cx = w * 0.34, cz = d * 0.1;
    cr.push(boxAt(T, 1.1, 0.3, 0.9, cx, 0.3, cz), boxAt(T, 0.8, 0.55, 0.7, cx, 0.72, cz));
    const b0 = V(cx - 0.2, 1.0, cz), b1 = V(cx - 2.6, 4.2, cz);
    for (const dz of [-0.14, 0.14]) for (const dy of [-0.1, 0.1]) cr.push(beam(T, b0.clone().add(V(0, dy, dz)), b1.clone().add(V(0, dy, dz)), 0.05));
    for (let i = 0; i < 8; i++) { const a = b0.clone().lerp(b1, i / 8), c = b0.clone().lerp(b1, (i + 1) / 8); cr.push(beam(T, a.clone().add(V(0, 0, -0.14)), c.clone().add(V(0, 0, 0.14)), 0.03)); }
    cr.push(beam(T, b1, V(b1.x, 2.0, cz), 0.02));
    g.add(mesh(T, merge(T, cr), pbr(T, PAL.crane)));
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
  const wheels = (T, list, x, z, len, wid) => { for (const dx of [-len / 2 + 0.15, len / 2 - 0.15]) for (const dz of [-wid / 2, wid / 2]) { const w = cylAt(T, 0.13, 0.13, 0.08, 10, 0, 0, 0); w.rotateX(Math.PI / 2); w.translate(x + dx, 0.13, z + dz); list.push(w); } };

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
  function linearize(T, scene) {
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
        if (m.isMeshStandardMaterial && m.envMapIntensity === 1) m.envMapIntensity = 0.35; // sky light fills shadows without washing out color
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
  function build(pair, opts, Q) {
    const T = root.THREE, rnd = rng(7);
    const c0 = [(pair.ca[0] + pair.cb[0]) / 2, (pair.ca[1] + pair.cb[1]) / 2];
    const KX = 111.32 * Math.cos(c0[0] * Math.PI / 180), KY = 110.57;
    const Rkm = Math.max(2.5, pair.km * 1.5);
    const S = 32 / Rkm;                                        // scene units per km
    const R = 40, RG = R * 1.7, LOW = -14;
    const TS = Math.max(1, Math.min(2.2, pair.km / 8));        // exaggerate structures when the pair is far apart

    // Deterministic terrain: gentle roll in the middle, hills toward the rim, a cliff down to the lowland.
    const heightAt = (x, z) => {
      const r = Math.hypot(x, z), k = smooth(R * 0.75, R * 1.45, r);
      return 0.35 * Math.sin(x * 0.11) * Math.cos(z * 0.09) + 0.2 * Math.sin((x + z) * 0.23) + k * (2.2 + 1.6 * Math.sin(x * 0.07 + 1) * Math.cos(z * 0.06 - 0.5));
    };
    const edge = a => RG * (1 + 0.05 * Math.sin(5 * a + 1) + 0.03 * Math.sin(11 * a));
    const toV = ([lat, lon]) => { const x = (lon - c0[1]) * KX * S, z = -(lat - c0[0]) * KY * S; return new T.Vector3(x, heightAt(x, z), z); };

    const scene = new T.Scene();
    scene.fog = new T.FogExp2(PAL.fog, 0.0036);
    const sunDir = new T.Vector3(0.55, 0.52, 0.35).normalize();

    // physical (Preetham) sky; a copy of it also becomes the environment light
    const sky = new T.Sky(); sky.scale.setScalar(3000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.5; u.rayleigh.value = 2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(sunDir);
    scene.add(sky);

    scene.add(new T.HemisphereLight(0xdde8f2, 0x46584c, 0.2));
    const sun = new T.DirectionalLight(PAL.sun, 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -R * 1.4; sc.right = sc.top = R * 1.4; sc.near = 1; sc.far = R * 5;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    // plateau ground with vertex colors
    const size = RG * 2.4, gGeo = new T.PlaneGeometry(size, size, Q.seg, Q.seg); gGeo.rotateX(-Math.PI / 2);
    const pos = gGeo.attributes.position, cols = [], tmp = new T.Color();
    const cG = new T.Color(PAL.grass), cD = new T.Color(PAL.grassDark), cY = new T.Color(PAL.grassDry), cR = new T.Color(PAL.rock);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z), inside = r < edge(Math.atan2(z, x));
      const y = inside ? heightAt(x, z) : LOW - 0.5; pos.setY(i, y);
      const n = 0.5 + 0.5 * Math.sin(x * 0.31 + Math.cos(z * 0.27) * 2) * Math.cos(z * 0.19 - x * 0.07);
      tmp.copy(cG).lerp(cD, Math.max(0, 0.6 - n) * 1.3).lerp(cY, smooth(1.6, 3.6, y) * 0.7 + Math.max(0, n - 0.8) * 1.5);
      if (!inside) tmp.copy(cR);
      cols.push(tmp.r, tmp.g, tmp.b);
    }
    gGeo.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
    gGeo.computeVertexNormals();
    // speckled grass texture, multiplied over the vertex colors
    const GS = Q.tex, gc = document.createElement("canvas"); gc.width = gc.height = GS;
    const gx = gc.getContext("2d"), gr = rng(3); gx.fillStyle = "#eef2ea"; gx.fillRect(0, 0, GS, GS);
    for (let i = 0; i < 9000 * (GS / 256) ** 2; i++) { const v = 170 + Math.floor(gr() * 85); gx.fillStyle = `rgb(${v - 10},${v},${v - 18})`; gx.fillRect(Math.floor(gr() * GS), Math.floor(gr() * GS), 1 + Math.floor(gr() * 2), 1 + Math.floor(gr() * 3)); }
    // grass blades and a few bare patches
    {
      for (let i = 0; i < 2200 * (GS / 256) ** 2; i++) { const x = gr() * GS, y = gr() * GS, v = 150 + Math.floor(gr() * 90); gx.strokeStyle = `rgba(${v - 30},${v},${v - 60},0.7)`; gx.beginPath(); gx.moveTo(x, y); gx.lineTo(x + (gr() - 0.5) * 3, y - 2 - gr() * 4); gx.stroke(); }
      for (let i = 0; i < 14; i++) { gx.fillStyle = "rgba(205,190,160,0.18)"; gx.beginPath(); gx.arc(gr() * GS, gr() * GS, (6 + gr() * 18) * GS / 256, 0, 7); gx.fill(); }
    }
    const groundTex = new T.CanvasTexture(gc); groundTex.wrapS = groundTex.wrapT = T.RepeatWrapping; groundTex.repeat.set(26, 26);
    groundTex.encoding = T.sRGBEncoding; groundTex.anisotropy = Q.aniso || 4;
    const ground = new T.Mesh(gGeo, pbr(T, 0xffffff, { vertexColors: true, rough: 0.95, map: groundTex, bumpMap: groundTex, bumpScale: 0.03 })); ground.receiveShadow = true; scene.add(ground);

    // basalt columns around the cliff
    const colGeo = new T.CylinderGeometry(1, 1, 1, 6); colGeo.translate(0, 0.5, 0);
    const NC = 340, cols3 = new T.InstancedMesh(colGeo, pbr(T, 0xffffff), NC), mtx = new T.Matrix4(), q = new T.Quaternion(), sv = new T.Vector3(), pv = new T.Vector3();
    for (let i = 0; i < NC; i++) {
      const a = i / NC * Math.PI * 2 + rnd() * 0.02, rr = edge(a) - 1.2 + rnd() * 2.6, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const top = heightAt(Math.cos(a) * (edge(a) - 1.5), Math.sin(a) * (edge(a) - 1.5)) - 0.2 - (rr > edge(a) ? rnd() * 5 : rnd() * 0.8), rad = 0.9 + rnd() * 0.7;
      mtx.compose(pv.set(x, LOW - 1, z), q.setFromAxisAngle(sv.set(0, 1, 0), rnd() * 1.1), sv.clone().set(rad, top - LOW + 1, rad)); cols3.setMatrixAt(i, mtx);
      cols3.setColorAt(i, tmp.setHex(PAL.rock).offsetHSL(0, 0, (rnd() - 0.5) * 0.08));
    }
    cols3.castShadow = true; cols3.receiveShadow = true; scene.add(cols3);

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
    const obstacles = [], steam = [];
    const towerCache = {};
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
        const steelI = new T.InstancedMesh(parts.steel, pbr(T, PAL.steel, Object.assign({ shininess: 30 }, STEEL)), pts.length);
        const accI = new T.InstancedMesh(parts.accent, pbr(T, colorHex, { emissive: colorHex, emissiveIntensity: 0.2 }), pts.length);
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
        scene.add(new T.LineSegments(lineGeo(cond), new T.LineBasicMaterial({ color: colorHex })));
        scene.add(new T.LineSegments(lineGeo(shield), new T.LineBasicMaterial({ color: 0x55636f })));
        // orange aviation marker balls on the shield wire
        const ballI = new T.InstancedMesh(new T.SphereGeometry(0.16 * TS, 8, 6), pbr(T, 0xf07a22, { emissive: 0x7a3000, emissiveIntensity: 0.3 }), Math.max(1, balls.length));
        balls.forEach((m, i) => { mtx.makeTranslation(m.x, m.y, m.z); ballI.setMatrixAt(i, mtx); }); ballI.count = balls.length; scene.add(ballI);
        return { anchor: pts[Math.floor(pts.length / 2)], top: kvH };
      }
      const v = toV(p.coords[0]);
      const gen = p.type === "generation", s = (gen ? 8 : p.kv >= 500 ? 7 : 5.5) * TS;
      const node = gen ? plantGroup(T, s, colorHex) : substationGroup(T, s, colorHex);
      node.position.copy(v); node.rotation.y = 0.35; scene.add(node);
      obstacles.push([v.x, v.z, s * 0.8]);
      if (node.userData.stacks) node.userData.stacks.forEach(st => { const w = new T.Vector3(st[0], st[1], st[2]).applyAxisAngle(sv.set(0, 1, 0), 0.35).add(v); steam.push({ at: w, big: !!st[3], s }); });
      return { anchor: v, top: gen ? s * 0.65 : s * 0.45 };
    };
    // substations and plants first, so the other project's towers can keep off their pads
    const isL = p => (p.parts || [p.coords]).some(c => c.length > 1);
    let A, B;
    if (isL(pair.p) && !isL(pair.q)) { B = place(pair.q, opts.colorB); A = place(pair.p, opts.colorA); } else { A = place(pair.p, opts.colorA); B = place(pair.q, opts.colorB); }

    // ---------- the closest-point link and what the tier lets them share ----------
    const va = toV(pair.ca), vb = toV(pair.cb), tierHex = new T.Color(opts.tierColor).getHex();
    const mid = va.clone().lerp(vb, 0.5), pulse = [];
    const glow = c => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, fog: false });
    if (pair.km > 0.1) {
      const arc = [], lift = Math.min(6, 0.8 + va.distanceTo(vb) * 0.18);
      for (let i = 0; i <= 40; i++) { const t = i / 40, v = va.clone().lerp(vb, t); v.y += 0.3 + lift * 4 * t * (1 - t); arc.push(v); }
      const link = new T.Line(new T.BufferGeometry().setFromPoints(arc), new T.LineDashedMaterial({ color: tierHex, dashSize: 0.7, gapSize: 0.45 }));
      link.computeLineDistances(); scene.add(link);
      [va, vb].forEach(v => { const m = new T.Mesh(new T.SphereGeometry(0.35, 12, 8), new T.MeshBasicMaterial({ color: tierHex })); m.position.copy(v).add(new T.Vector3(0, 0.3, 0)); scene.add(m); pulse.push({ m, kind: "dot" }); });
      mid.y = Math.max(va.y, vb.y) + lift;
    }
    const beamM = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 30, 12, 1, true), glow(tierHex)); beamM.position.set(mid.x, heightAt(mid.x, mid.z) + 15, mid.z); scene.add(beamM); pulse.push({ m: beamM, kind: "beam" });
    const ring = new T.Mesh(new T.RingGeometry(1.6, 2.1, 40), glow(tierHex)); ring.rotation.x = -Math.PI / 2; ring.position.set(mid.x, heightAt(mid.x, mid.z) + 0.12, mid.z); scene.add(ring); pulse.push({ m: ring, kind: "ring" });

    const labels = [
      makeLabel(opts.distText, opts.tierColor, new T.Vector3(mid.x, mid.y + 4.5, mid.z), "big"),
      makeLabel(opts.nameA, opts.colorA, new T.Vector3(A.anchor.x, A.anchor.y + A.top + 1.6, A.anchor.z)),
      makeLabel(opts.nameB, opts.colorB, new T.Vector3(B.anchor.x, B.anchor.y + B.top + 1.6, B.anchor.z)),
    ];
    const dirAB = vb.clone().sub(va); dirAB.y = 0; if (dirAB.lengthSq() < 1e-6) dirAB.set(1, 0, 0); dirAB.normalize();
    const perp = new T.Vector3(dirAB.z, 0, -dirAB.x);
    if (pair.tier <= 1) {
      // shared right-of-way strip with a dirt access road down the middle
      const len = Math.max(10, va.distanceTo(vb) + 8), ang = Math.atan2(dirAB.x, dirAB.z), gm = mid.clone(); gm.y = heightAt(mid.x, mid.z);
      const corr = new T.Mesh(new T.PlaneGeometry(4, len), new T.MeshBasicMaterial({ color: tierHex, transparent: true, opacity: 0.25, depthWrite: false }));
      corr.rotation.set(-Math.PI / 2, 0, ang); corr.position.set(gm.x, gm.y + 0.08, gm.z); scene.add(corr);
      const road = mesh(T, new T.PlaneGeometry(0.9, len), pbr(T, 0xa58d68), false); road.rotation.set(-Math.PI / 2, 0, ang); road.position.set(gm.x, gm.y + 0.1, gm.z); scene.add(road);
      obstacles.push([gm.x, gm.z, 3]);
      labels.push(makeLabel("Shared right-of-way and access road", opts.tierColor, new T.Vector3(gm.x + perp.x * 5, gm.y + 0.4, gm.z + perp.z * 5), "small"));
    } else if (pair.tier <= 3) {
      // the yard goes on the nearest open ground beside the meeting point, clear of towers, substations and plants
      const yd = yardGroup(T, 7, 4.6), yr = 4.4 * TS;
      let spot = null;
      for (let rad = 6; rad <= R && !spot; rad += 2) for (let k = 0; k < 24 && !spot; k++) {
        const a = Math.atan2(perp.z, perp.x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12;
        const x = mid.x + Math.cos(a) * rad, z = mid.z + Math.sin(a) * rad;
        if (Math.hypot(x, z) < R * 1.05 && obstacles.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r + yr)) spot = [x, z];
      }
      if (!spot) spot = [mid.x + perp.x * 6, mid.z + perp.z * 6];
      yd.scale.setScalar(TS); yd.position.set(spot[0], heightAt(spot[0], spot[1]), spot[1]); yd.rotation.y = Math.atan2(dirAB.x, dirAB.z) + Math.PI / 2; scene.add(yd);
      obstacles.push([yd.position.x, yd.position.z, yr]);
      labels.push(makeLabel(pair.tier === 2 ? "Shared laydown yard" : "Shared crew staging yard", "#e0a93e", new T.Vector3(yd.position.x, yd.position.y + 3 * TS, yd.position.z), "small"));
    }
    const clear = (x, z, pad) => obstacles.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r + pad) && Math.hypot(x - mid.x, z - mid.z) > 7;

    // ponds
    const waterTex = waterNormals(T);
    const water = new T.MeshStandardMaterial({ color: PAL.water, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.94, normalMap: waterTex, normalScale: new T.Vector2(0.15, 0.15), envMapIntensity: 1.3 });
    for (let i = 0, made = 0; i < 40 && made < 6; i++) {
      const x = (rnd() - 0.5) * R * 2.6, z = (rnd() - 0.5) * R * 2.6, r = 2.5 + rnd() * 4;
      if (Math.hypot(x, z) > RG - 10 || !clear(x, z, r + 1)) continue;
      const pond = new T.Mesh(new T.CircleGeometry(r, 14), water); pond.scale.set(1, 0.6 + rnd() * 0.4, 1);
      pond.rotation.x = -Math.PI / 2; pond.rotation.z = rnd() * 3; pond.position.set(x, heightAt(x, z) + 0.12, z); pond.receiveShadow = true; scene.add(pond);
      obstacles.push([x, z, r]); made++;
    }

    // instanced pines
    const fol = merge(T, [cylAt(T, 0, 0.55, 1.2, 9, 0, 1.0, 0), cylAt(T, 0, 0.42, 1.0, 9, 0, 1.6, 0), cylAt(T, 0, 0.28, 0.7, 9, 0, 2.1, 0)]);
    const trk = merge(T, [cylAt(T, 0.07, 0.1, 0.6, 5, 0, 0.3, 0)]);
    const NP = 300, pinesF = new T.InstancedMesh(fol, pbr(T, 0xffffff), NP), pinesT = new T.InstancedMesh(trk, pbr(T, PAL.trunk), NP);
    let np = 0;
    for (let i = 0; i < NP * 3 && np < NP; i++) {
      // clump trees: pick a grove center then scatter around it
      const gx = Math.cos(i * 2.39996) * (8 + (i * 7.3) % (RG - 12)), gz = Math.sin(i * 2.39996) * (8 + (i * 7.3) % (RG - 12));
      const x = gx + (rnd() - 0.5) * 6, z = gz + (rnd() - 0.5) * 6;
      if (Math.hypot(x, z) > edge(Math.atan2(z, x)) - 2.5 || !clear(x, z, 1.8)) continue;
      const k = 0.7 + rnd() * 0.9;
      mtx.compose(pv.set(x, heightAt(x, z) - 0.05, z), q.setFromAxisAngle(sv.set(0, 1, 0), rnd() * 6), sv.clone().set(k, k * (0.9 + rnd() * 0.4), k));
      pinesF.setMatrixAt(np, mtx); pinesT.setMatrixAt(np, mtx);
      pinesF.setColorAt(np, tmp.setHex(PAL.pine).offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.08)); np++;
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
    scatter(bush, pbr(T, 0xffffff), 260, 0.6, 0.7, 1.5, 0x4f7a45, 0.05, 0.14);
    const rock = new T.DodecahedronGeometry(0.35, 0); rock.translate(0, 0.12, 0);
    scatter(rock, pbr(T, 0xffffff), 90, 0.5, 0.5, 1.8, 0x7d8790, 0.02, 0.12);
    const tuft = merge(T, [cylAt(T, 0, 0.05, 0.3, 3, 0, 0.15, 0), cylAt(T, 0, 0.04, 0.24, 3, 0.07, 0.12, 0.03), cylAt(T, 0, 0.04, 0.22, 3, -0.06, 0.11, -0.04)]);
    const tufts = scatter(tuft, pbr(T, 0xffffff), 900, 0.3, 0.8, 1.6, 0x88a860, 0.05, 0.14); tufts.castShadow = false;

    // work crews at the closest points
    [va, vb].forEach((v, i) => {
      const cr = crewGroup(T, 4, 21 + i, 1.4), sg = i ? -1 : 1;
      let off = 1.4;
      while (off < 14 && !obstacles.every(([ox, oz, r]) => Math.hypot(v.x + perp.x * off * sg - ox, v.z + perp.z * off * sg - oz) > r)) off += 1;
      const x = v.x + perp.x * off * sg, z = v.z + perp.z * off * sg;
      cr.scale.setScalar(Math.min(1.6, TS)); cr.position.set(x, heightAt(x, z), z); scene.add(cr);
    });

    // steam sprites over stacks and cooling towers
    const puffs = [];
    steam.forEach(st => { for (let i = 0; i < (st.big ? 14 : 8); i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffffff })); sp.userData = { at: st.at, t: i / (st.big ? 14 : 8), big: st.big, s: st.s }; scene.add(sp); puffs.push(sp); } });

    // aim the sun's shadow camera at the pair
    const focus = va.clone().lerp(vb, 0.5);
    sun.target.position.copy(focus); sun.position.copy(focus).add(sunDir.clone().multiplyScalar(R * 2));

    linearize(T, scene);
    return { scene, sky, puffs, pulse, clouds, labels, focus, span: Math.max(12, va.distanceTo(vb)), tex, groundTex, waterTex };
  }

  // ---------- modal and render loop ----------
  function open(pair, opts) {
    last = { pair, opts };
    const modal = document.getElementById("m3d");
    modal.hidden = false;
    document.getElementById("m3dTitle").textContent = opts.title;
    document.getElementById("m3dSub").textContent = opts.subtitle;
    const stage = document.getElementById("m3dStage"), msg = document.getElementById("m3dMsg");
    msg.textContent = "Loading 3D…"; msg.hidden = false;
    document.getElementById("m3dClose").focus();
    ensureThree(QUALITY[opts.quality] || QUALITY.high).then(q => {
      if (modal.hidden) return;
      close(true);
      const T = root.THREE, renderer = new T.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
      const Q = Object.assign({ aniso: renderer.capabilities.getMaxAnisotropy() }, q), built = build(pair, opts, Q);
      renderer.setClearColor(PAL.fog);
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      // nothing that casts a shadow moves, so the shadow map is drawn once instead of every frame
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
      stage.innerHTML = ""; stage.appendChild(renderer.domElement);
      const overlay = document.createElement("div"); overlay.className = "m3d-labels"; stage.appendChild(overlay);
      const tags = built.labels.map(l => { const el = document.createElement("span"); el.className = "m3d-tag " + l.size; el.style.setProperty("--c", l.color); el.textContent = l.text; overlay.appendChild(el); return { el, pos: l.pos }; });
      const v = new T.Vector3();
      // Labels follow their points on screen. Styles are written only when they change (to the nearest tenth of a pixel),
      // and the stage size is read on resize, not every frame, so placing them never makes the page recalculate layout.
      let stageW = 1, stageH = 1;
      // Tags that would cover each other are stacked: the one lower on screen keeps its spot, the others move up
      // just clear of it. Tag sizes are measured once (and on resize), not per frame.
      const measureTags = () => tags.forEach(t => { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; });
      const placeTags = () => {
        const shown = [];
        tags.forEach(t => {
          v.copy(t.pos).project(cam);
          t.off2 = v.z > 1; t.x = (v.x + 1) / 2 * stageW; t.y = (1 - v.y) / 2 * stageH;
          if (!t.off2) shown.push(t);
        });
        shown.sort((a, b) => b.y - a.y);
        const placed = [];
        for (const t of shown) {
          let y = t.y;
          for (let guard = 0; guard < 8; guard++) {
            const hit = placed.find(p => Math.abs(p.x - t.x) < (p.w + t.w) / 2 + 4 && y > p.y - p.h - 4 && y - t.h < p.y + 4);
            if (!hit) break;
            y = hit.y - hit.h - 6;
          }
          placed.push({ x: t.x, y, w: t.w || 0, h: t.h || 0 });
          t.y = y;
        }
        tags.forEach(t => {
          const off = t.off2, tf = off ? t.tf : `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%)`;
          if (off !== t.off) { t.off = off; t.el.style.display = off ? "none" : ""; }
          if (tf !== t.tf) { t.tf = tf; t.el.style.transform = tf; }
        });
      };

      const cam = new T.PerspectiveCamera(42, 1, 0.5, 9000);
      const f = built.focus, d = built.span * 1.5 + 16;
      const endPos = new T.Vector3(f.x + d * 0.75, f.y + d * 0.5, f.z + d * 0.85), rel = endPos.clone().sub(f);
      const endR = rel.length(), endAz = Math.atan2(rel.x, rel.z), endEl = Math.asin(rel.y / endR);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const INTRO = reduced ? 0 : 2.6;
      const orbitAt = (r, az, el) => cam.position.set(f.x + r * Math.cos(el) * Math.sin(az), f.y + r * Math.sin(el), f.z + r * Math.cos(el) * Math.cos(az));
      if (INTRO) orbitAt(endR * 2.3, endAz + 1.1, Math.min(1.25, endEl + 0.5)); else cam.position.copy(endPos);
      cam.lookAt(f);

      const controls = new T.OrbitControls(cam, renderer.domElement);
      controls.target.copy(f); controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 6; controls.maxDistance = 150;
      controls.autoRotateSpeed = 0.5; controls.enabled = !INTRO; controls.autoRotate = false;
      controls.addEventListener("start", () => { controls.autoRotate = false; });

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
      composer.addPass(new T.UnrealBloomPass(new T.Vector2(256, 256), 0.18, 0.55, 0.95));
      const tone = new T.ShaderPass(T.ACESFilmicToneMappingShader); tone.uniforms.exposure.value = 0.72; composer.addPass(tone);
      composer.addPass(new T.ShaderPass(T.GammaCorrectionShader));
      // SMAA keeps thin wires and lattice members crisp; FXAA is the cheaper fallback.
      const fxaa = Q.smaa ? null : new T.ShaderPass(T.FXAAShader), smaa = Q.smaa ? new T.SMAAPass(1, 1) : null;
      composer.addPass(fxaa || smaa);

      const size = () => {
        const w = stage.clientWidth, h = stage.clientHeight, pr = Math.min(Q.dpr, devicePixelRatio);
        stageW = w; stageH = h; measureTags();
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
      const loop = () => {
        const t = clock.getElapsedTime();
        if (INTRO && !controls.enabled) {
          const k = Math.min(1, t / INTRO), e = 1 - Math.pow(1 - k, 3);
          orbitAt(endR * (2.3 - 1.3 * e), endAz + 1.1 * (1 - e), endEl + (Math.min(1.25, endEl + 0.5) - endEl) * (1 - e)); cam.lookAt(f);
          if (k >= 1) { controls.enabled = true; controls.autoRotate = true; }
        }
        built.puffs.forEach(p => {
          const u = p.userData, k = (u.t + t * (u.big ? 0.07 : 0.11)) % 1, rise = u.s * (u.big ? 0.9 : 0.7);
          p.position.set(u.at.x + Math.sin(k * 5 + u.t * 9) * k * 0.8 + k * rise * 0.35, u.at.y + k * rise, u.at.z + k * rise * 0.15);
          p.scale.setScalar((u.big ? 1.6 : 0.8) * (0.6 + k * 2.4));
          p.material.opacity = 0.8 * Math.min(1, k * 6) * (1 - k);
        });
        built.pulse.forEach(({ m, kind }) => {
          if (kind === "ring") { const k = (t * 0.5) % 1; m.scale.setScalar(0.6 + k * 1.8); m.material.opacity = 0.7 * (1 - k); }
          else if (kind === "beam") m.material.opacity = 0.28 + 0.14 * Math.sin(t * 2.4);
          else m.scale.setScalar(1 + 0.25 * Math.sin(t * 3));
        });
        built.clouds.forEach((c, i) => { c.position.x += 0.012 * (1 + (i % 3) * 0.4); if (c.position.x > 260) c.position.x = -260; });
        built.waterTex.offset.set(t * 0.012, t * 0.007);
        controls.update();
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
          built.scene.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); });
          [built.tex, built.groundTex, built.waterTex, built.scene.environment].forEach(x => x && x.dispose());
          composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); pmrem.dispose();
          if (ssao) ssao.dispose(); if (smaa) { smaa.edgesRT.dispose(); smaa.weightsRT.dispose(); smaa.areaTexture.dispose(); smaa.searchTexture.dispose(); }
          renderer.dispose();
        },
      };
    }).catch(err => { msg.hidden = false; msg.textContent = root.THREE ? "The 3D view couldn't be drawn: " + err.message : "The 3D view needs an internet connection to load three.js. " + err.message; });
  }
  function close(keepOpen) {
    if (ctx) { ctx.stop(); ctx = null; }
    if (!keepOpen) { document.getElementById("m3d").hidden = true; document.getElementById("m3dStage").innerHTML = ""; }
  }
  // Re-open the current pair at a new quality setting.
  const reopen = quality => { if (last && !document.getElementById("m3d").hidden) open(last.pair, Object.assign({}, last.opts, { quality })); };
  root.Scene3D = { open, close, reopen, QUALITY };
})(this);
