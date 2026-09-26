// Seamline 3D: a stylized scene of one flagged pair — both utilities' lattice towers, wires, substations and plants,
// the closest-point link, and the shared zone the tier allows (corridor, laydown yard or staging yard).
// three.js loads on first use. Horizontal positions are to scale; heights are exaggerated so towers read.
(function (root) {
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const ORBIT_URL = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js";
  const PAL = {
    skyTop: 0x3f6488, horizon: 0xcfdbe3, fog: 0xbccbd5, sun: 0xfff1d6,
    grass: 0x5f8058, grassDark: 0x3f5c47, grassDry: 0x93a06c, rock: 0x4a5560, lowland: 0x62806f,
    steel: 0xaebfcc, steelDark: 0x5c6f80, porcelain: 0xe2d6bd, gravel: 0x9d9b90, concrete: 0xb9b7ac,
    fence: 0x46525c, snow: 0xf2f6f8, mountain: 0x6c8196, water: 0x3f7d8f, pine: 0x2f5140, trunk: 0x4a3b2e, crane: 0xe0a93e,
  };

  let loading = null, ctx = null;
  const load = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src)); document.head.appendChild(s); });
  const ensureThree = () => loading || (loading = (root.THREE ? Promise.resolve() : load(THREE_URL)).then(() => root.THREE.OrbitControls ? null : load(ORBIT_URL)));

  // ---------- helpers ----------
  const phong = (T, color, extra) => new T.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 8 }, extra));
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
    const steel = [], accent = [];
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
        accent.push(cylAt(T, 0.07, 0.07, 0.45, 6, s * half, y - 0.24, 0));
        attach.push([s * half, y - 0.48]);
      }
    }
    accent.push(boxAt(T, 0.22, 0.18, 0.22, 0, h + 0.05, 0));
    attach.push([0, h + 0.1]);
    return { steel: merge(T, steel), accent: merge(T, accent), attach };
  }

  function substationGroup(T, s, color) {
    const g = new T.Group(), steel = phong(T, PAL.steel), dark = phong(T, PAL.steelDark);
    const pad = mesh(T, new T.BoxGeometry(s, 0.16, s * 0.8), phong(T, PAL.gravel), false); pad.position.y = 0.08; g.add(pad);
    // fence
    const f = [], hw = s * 0.52, hd = s * 0.42;
    for (let i = 0; i <= 12; i++) { const t = -1 + i / 6; if (Math.abs(t) <= 1) { f.push(boxAt(T, 0.05, 0.6, 0.05, t * hw, 0.4, hd), boxAt(T, 0.05, 0.6, 0.05, t * hw, 0.4, -hd), boxAt(T, 0.05, 0.6, 0.05, hw, 0.4, t * hd), boxAt(T, 0.05, 0.6, 0.05, -hw, 0.4, t * hd)); } }
    for (const y of [0.35, 0.68]) f.push(boxAt(T, hw * 2, 0.03, 0.03, 0, y, hd), boxAt(T, hw * 2, 0.03, 0.03, 0, y, -hd), boxAt(T, 0.03, 0.03, hd * 2, hw, y, 0), boxAt(T, 0.03, 0.03, hd * 2, -hw, y, 0));
    g.add(mesh(T, merge(T, f), phong(T, PAL.fence)));
    // transformers with radiator fins and porcelain bushings
    const tank = [], bush = [];
    for (const x of [-s * 0.2, s * 0.2]) {
      tank.push(boxAt(T, s * 0.16, s * 0.14, s * 0.12, x, 0.16 + s * 0.07, -s * 0.18));
      for (let i = 0; i < 5; i++) tank.push(boxAt(T, 0.04, s * 0.11, s * 0.1, x - s * 0.1 - 0.02 - i * 0.02, 0.16 + s * 0.065, -s * 0.18));
      for (let i = -1; i <= 1; i++) bush.push(cylAt(T, 0.06, 0.09, s * 0.08, 6, x + i * s * 0.045, 0.16 + s * 0.18, -s * 0.18));
    }
    g.add(mesh(T, merge(T, tank), phong(T, 0x6d7f8e)));
    g.add(mesh(T, merge(T, bush), phong(T, PAL.porcelain, { shininess: 40 })));
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
    g.add(mesh(T, merge(T, bus), new T.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.25, flatShading: true })));
    // breakers
    const brk = [];
    for (let i = 0; i < 6; i++) brk.push(cylAt(T, 0.09, 0.09, s * 0.12, 8, -s * 0.3 + i * s * 0.12, 0.16 + s * 0.06, s * 0.3));
    g.add(mesh(T, merge(T, brk), dark));
    // control house
    const house = mesh(T, new T.BoxGeometry(s * 0.2, s * 0.12, s * 0.14), phong(T, PAL.concrete)); house.position.set(-s * 0.36, 0.16 + s * 0.06, -s * 0.3); g.add(house);
    const roof = mesh(T, new T.BoxGeometry(s * 0.22, 0.08, s * 0.16), phong(T, color)); roof.position.set(-s * 0.36, 0.2 + s * 0.12, -s * 0.3); g.add(roof);
    return g;
  }

  function plantGroup(T, s, color) {
    const g = new T.Group(), steel = phong(T, PAL.steel), dark = phong(T, PAL.steelDark);
    const pad = mesh(T, new T.BoxGeometry(s * 1.2, 0.16, s * 0.9), phong(T, PAL.concrete), false); pad.position.y = 0.08; g.add(pad);
    const hall = mesh(T, new T.BoxGeometry(s * 0.5, s * 0.22, s * 0.3), dark); hall.position.set(-s * 0.2, s * 0.11 + 0.16, s * 0.08); g.add(hall);
    const stripe = mesh(T, new T.BoxGeometry(s * 0.51, s * 0.035, s * 0.31), phong(T, color, { emissive: color, emissiveIntensity: 0.15 })); stripe.position.set(-s * 0.2, s * 0.19 + 0.16, s * 0.08); g.add(stripe);
    const hr = [], stacks = [];
    for (const x of [s * 0.12, s * 0.3]) {
      hr.push(boxAt(T, s * 0.12, s * 0.28, s * 0.24, x, s * 0.14 + 0.16, s * 0.02));
      hr.push(cylAt(T, s * 0.03, s * 0.036, s * 0.62, 10, x, s * 0.31 + 0.16, -s * 0.16));
      stacks.push([x, s * 0.62 + 0.16, -s * 0.16]);
    }
    g.add(mesh(T, merge(T, hr), steel));
    const bands = [];
    for (const x of [s * 0.12, s * 0.3]) bands.push(cylAt(T, s * 0.039, s * 0.039, s * 0.05, 10, x, s * 0.54 + 0.16, -s * 0.16));
    g.add(mesh(T, merge(T, bands), phong(T, color)));
    // hyperbolic cooling tower
    const prof = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new T.Vector2(s * (0.1 + 0.07 * Math.pow(2 * t - 1.2, 2)), t * s * 0.46)); }
    const ct = mesh(T, new T.LatheGeometry(prof, 18), phong(T, 0xd3d9dc, { side: T.DoubleSide })); ct.position.set(-s * 0.32, 0.16, -s * 0.24); g.add(ct);
    stacks.push([-s * 0.32, s * 0.46 + 0.16, -s * 0.24, 1]);
    // pipe rack along the front, like the reference art
    const pipes = [];
    for (const [y, r] of [[s * 0.08, s * 0.03], [s * 0.14, s * 0.022], [s * 0.19, s * 0.018]]) { const p = cylAt(T, r, r, s * 1.05, 8, 0, 0, 0); p.rotateZ(Math.PI / 2); p.translate(0, y + 0.16, s * 0.34); pipes.push(p); }
    for (let i = 0; i < 6; i++) pipes.push(boxAt(T, 0.06, s * 0.22, 0.06, -s * 0.5 + i * s * 0.2, s * 0.11 + 0.16, s * 0.34));
    g.add(mesh(T, merge(T, pipes), steel));
    const tanks = [];
    for (const x of [s * 0.44, s * 0.52]) tanks.push(cylAt(T, s * 0.05, s * 0.05, s * 0.12, 12, x, s * 0.06 + 0.16, s * 0.16));
    g.add(mesh(T, merge(T, tanks), phong(T, 0xdde2e4)));
    g.userData.stacks = stacks;
    return g;
  }

  function yardGroup(T, w, d) {
    const g = new T.Group(), V = (x, y, z) => new T.Vector3(x, y, z);
    const pad = mesh(T, new T.BoxGeometry(w, 0.12, d), phong(T, PAL.gravel), false); pad.position.y = 0.06; g.add(pad);
    const reels = [];
    for (let i = 0; i < 5; i++) { const x = -w * 0.38 + i * 0.95; for (const z of [-0.22, 0.22]) { const r = cylAt(T, 0.52, 0.52, 0.06, 12, 0, 0, 0); r.rotateX(Math.PI / 2); r.translate(x, 0.64, -d * 0.24 + z); reels.push(r); } const hub = cylAt(T, 0.3, 0.3, 0.4, 10, 0, 0, 0); hub.rotateX(Math.PI / 2); hub.translate(x, 0.64, -d * 0.24); reels.push(hub); }
    g.add(mesh(T, merge(T, reels), phong(T, 0x8a6440)));
    const trucks = [], cabs = [];
    for (let i = 0; i < 3; i++) { const x = -w * 0.3 + i * 1.7; trucks.push(boxAt(T, 1.0, 0.25, 0.55, x - 0.2, 0.4, d * 0.24)); cabs.push(boxAt(T, 0.45, 0.45, 0.55, x + 0.5, 0.5, d * 0.24)); }
    g.add(mesh(T, merge(T, trucks), phong(T, 0x39434b)));
    g.add(mesh(T, merge(T, cabs), phong(T, 0xe6e0d0)));
    const steel = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 4 - k; i++) steel.push(boxAt(T, 2.2, 0.12, 0.12, w * 0.18, 0.18 + k * 0.13, -d * 0.02 + (i - 1.5 + k * 0.5) * 0.14));
    g.add(mesh(T, merge(T, steel), phong(T, 0x7b8a96)));
    // crawler crane with a lattice boom
    const cr = [], cx = w * 0.34, cz = d * 0.1;
    cr.push(boxAt(T, 1.1, 0.3, 0.9, cx, 0.3, cz), boxAt(T, 0.8, 0.55, 0.7, cx, 0.72, cz));
    const b0 = V(cx - 0.2, 1.0, cz), b1 = V(cx - 2.6, 4.2, cz);
    for (const dz of [-0.14, 0.14]) for (const dy of [-0.1, 0.1]) cr.push(beam(T, b0.clone().add(V(0, dy, dz)), b1.clone().add(V(0, dy, dz)), 0.05));
    for (let i = 0; i < 8; i++) { const a = b0.clone().lerp(b1, i / 8), c = b0.clone().lerp(b1, (i + 1) / 8); cr.push(beam(T, a.clone().add(V(0, 0, -0.14)), c.clone().add(V(0, 0, 0.14)), 0.03)); }
    cr.push(beam(T, b1, V(b1.x, 2.0, cz), 0.02));
    g.add(mesh(T, merge(T, cr), phong(T, PAL.crane)));
    return g;
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
  function build(pair, opts) {
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
    scene.fog = new T.FogExp2(PAL.fog, 0.0075);
    const sunDir = new T.Vector3(0.55, 0.75, 0.35).normalize();

    // sky dome: gradient plus a warm glow around the sun
    scene.add(new T.Mesh(new T.SphereGeometry(R * 9, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { top: { value: new T.Color(PAL.skyTop) }, horizon: { value: new T.Color(PAL.horizon) }, sunC: { value: new T.Color(PAL.sun) }, sunDir: { value: sunDir } },
      vertexShader: "varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 horizon; uniform vec3 sunC; uniform vec3 sunDir; varying vec3 vd;" +
        "void main(){ float h = max(vd.y, 0.0); vec3 c = mix(horizon, top, pow(h, 0.55)); float s = max(dot(vd, sunDir), 0.0);" +
        "c += sunC * (pow(s, 400.0) * 1.2 + pow(s, 12.0) * 0.25); gl_FragColor = vec4(c, 1.0); }",
    })));

    scene.add(new T.HemisphereLight(0xdde8f2, 0x46584c, 0.75));
    const sun = new T.DirectionalLight(PAL.sun, 0.95);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -R * 1.4; sc.right = sc.top = R * 1.4; sc.near = 1; sc.far = R * 5;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    // plateau ground with vertex colors
    const size = RG * 2.4, gGeo = new T.PlaneGeometry(size, size, 130, 130); gGeo.rotateX(-Math.PI / 2);
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
    const ground = new T.Mesh(gGeo, phong(T, 0xffffff, { vertexColors: true, shininess: 2 })); ground.receiveShadow = true; scene.add(ground);

    // basalt columns around the cliff
    const colGeo = new T.CylinderGeometry(1, 1, 1, 6); colGeo.translate(0, 0.5, 0);
    const NC = 340, cols3 = new T.InstancedMesh(colGeo, phong(T, 0xffffff), NC), mtx = new T.Matrix4(), q = new T.Quaternion(), sv = new T.Vector3(), pv = new T.Vector3();
    for (let i = 0; i < NC; i++) {
      const a = i / NC * Math.PI * 2 + rnd() * 0.02, rr = edge(a) - 1.2 + rnd() * 2.6, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const top = heightAt(Math.cos(a) * (edge(a) - 1.5), Math.sin(a) * (edge(a) - 1.5)) - 0.2 - (rr > edge(a) ? rnd() * 5 : rnd() * 0.8), rad = 0.9 + rnd() * 0.7;
      mtx.compose(pv.set(x, LOW - 1, z), q.setFromAxisAngle(sv.set(0, 1, 0), rnd() * 1.1), sv.clone().set(rad, top - LOW + 1, rad)); cols3.setMatrixAt(i, mtx);
      cols3.setColorAt(i, tmp.setHex(PAL.rock).offsetHSL(0, 0, (rnd() - 0.5) * 0.08));
    }
    cols3.castShadow = true; cols3.receiveShadow = true; scene.add(cols3);

    // lowland, distant snowcapped mountains, clouds
    const low = new T.Mesh(new T.PlaneGeometry(R * 20, R * 20), phong(T, PAL.lowland)); low.rotation.x = -Math.PI / 2; low.position.y = LOW - 0.3; scene.add(low);
    const mMat = phong(T, PAL.mountain), sMat = phong(T, PAL.snow);
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2 + 0.2, r = R * 3.3 + (i % 3) * 12, h = 22 + (i * 37 % 15), w = 34 + (i * 13 % 18);
      const m = new T.Mesh(new T.ConeGeometry(w, h, 7), mMat); m.position.set(Math.cos(a) * r, LOW + h / 2, Math.sin(a) * r); m.rotation.y = i; scene.add(m);
      const cap = new T.Mesh(new T.ConeGeometry(w * 0.31, h * 0.3, 7), sMat); cap.position.set(m.position.x, LOW + h * 0.85 + 0.1, m.position.z); cap.rotation.y = i; scene.add(cap);
    }
    const clouds = [], cMat = new T.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 9; i++) {
      const cl = new T.Group();
      for (let k = 0; k < 5; k++) { const p = new T.Mesh(new T.IcosahedronGeometry(2.5 + rnd() * 2.5, 0), cMat); p.position.set((k - 2) * 2.8 + rnd(), rnd() * 1.2, rnd() * 2.5); p.scale.y = 0.55; cl.add(p); }
      cl.position.set((rnd() - 0.5) * R * 5, 26 + rnd() * 10, (rnd() - 0.5) * R * 5); scene.add(cl); clouds.push(cl);
    }

    // ---------- the two projects ----------
    const obstacles = [], steam = [];
    const towerCache = {};
    const place = (p, color) => {
      const kvH = (p.kv >= 500 ? 4.4 : p.kv >= 230 ? 3.4 : 2.6) * TS;
      const colorHex = new T.Color(color).getHex();
      let pts = [];
      if (p.coords.length > 1) {
        for (let i = 1; i < p.coords.length; i++) {
          const a = toV(p.coords[i - 1]), b = toV(p.coords[i]), n = Math.max(1, Math.ceil(a.distanceTo(b) / (4 * TS)));
          for (let k = i === 1 ? 0 : 1; k <= n; k++) { const v = a.clone().lerp(b, k / n); v.y = heightAt(v.x, v.z); pts.push(v); }
        }
        pts = pts.filter(v => Math.hypot(v.x, v.z) < R * 1.3);
      }
      if (pts.length >= 2) {
        const key = kvH.toFixed(2), parts = towerCache[key] || (towerCache[key] = towerParts(T, kvH / TS));
        const steelI = new T.InstancedMesh(parts.steel, phong(T, PAL.steel, { shininess: 30 }), pts.length);
        const accI = new T.InstancedMesh(parts.accent, phong(T, colorHex, { emissive: colorHex, emissiveIntensity: 0.2 }), pts.length);
        const heads = [];
        pts.forEach((v, i) => {
          const d = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]); d.y = 0; d.normalize();
          const rot = Math.atan2(d.x, d.z), side = new T.Vector3(Math.cos(rot), 0, -Math.sin(rot));
          mtx.compose(v, q.setFromAxisAngle(sv.set(0, 1, 0), rot), sv.clone().set(TS, TS, TS));
          steelI.setMatrixAt(i, mtx); accI.setMatrixAt(i, mtx);
          heads.push(parts.attach.map(([ax, ay]) => v.clone().add(side.clone().multiplyScalar(ax * TS)).add(new T.Vector3(0, ay * TS, 0))));
          obstacles.push([v.x, v.z, 1.6 * TS]);
        });
        steelI.castShadow = accI.castShadow = true; scene.add(steelI, accI);
        // sagging conductors between towers
        const cond = [], shield = [];
        for (let i = 1; i < heads.length; i++) heads[i].forEach((b, k) => {
          const a = heads[i - 1][k], sagD = Math.min(1.4, a.distanceTo(b) * (k === 4 ? 0.04 : 0.08)), out = k === 4 ? shield : cond;
          for (let j = 0; j < 10; j++) {
            const t0 = j / 10, t1 = (j + 1) / 10;
            for (const t of [t0, t1]) { const v = a.clone().lerp(b, t); v.y -= sagD * 4 * t * (1 - t); out.push(v.x, v.y, v.z); }
          }
        });
        const lineGeo = arr => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(arr, 3)); return g; };
        scene.add(new T.LineSegments(lineGeo(cond), new T.LineBasicMaterial({ color: colorHex })));
        scene.add(new T.LineSegments(lineGeo(shield), new T.LineBasicMaterial({ color: 0x55636f })));
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
    const A = place(pair.p, opts.colorA), B = place(pair.q, opts.colorB);

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
      const road = mesh(T, new T.PlaneGeometry(0.9, len), phong(T, 0xa58d68), false); road.rotation.set(-Math.PI / 2, 0, ang); road.position.set(gm.x, gm.y + 0.1, gm.z); scene.add(road);
      obstacles.push([gm.x, gm.z, 3]);
      labels.push(makeLabel("Shared right-of-way and access road", opts.tierColor, new T.Vector3(gm.x + perp.x * 5, gm.y + 0.4, gm.z + perp.z * 5), "small"));
    } else if (pair.tier <= 3) {
      const yd = yardGroup(T, 7, 4.6), o = perp.clone().multiplyScalar(6);
      yd.scale.setScalar(TS); yd.position.set(mid.x + o.x, heightAt(mid.x + o.x, mid.z + o.z), mid.z + o.z); yd.rotation.y = Math.atan2(dirAB.x, dirAB.z) + Math.PI / 2; scene.add(yd);
      obstacles.push([yd.position.x, yd.position.z, 5 * TS]);
      labels.push(makeLabel(pair.tier === 2 ? "Shared laydown yard" : "Shared crew staging yard", "#e0a93e", new T.Vector3(yd.position.x, yd.position.y + 3 * TS, yd.position.z), "small"));
    }
    const clear = (x, z, pad) => obstacles.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r + pad) && Math.hypot(x - mid.x, z - mid.z) > 7;

    // ponds
    const water = phong(T, PAL.water, { shininess: 90, specular: 0x9fc3d0, transparent: true, opacity: 0.92, flatShading: false });
    for (let i = 0, made = 0; i < 40 && made < 6; i++) {
      const x = (rnd() - 0.5) * R * 2.6, z = (rnd() - 0.5) * R * 2.6, r = 2.5 + rnd() * 4;
      if (Math.hypot(x, z) > RG - 10 || !clear(x, z, r + 1)) continue;
      const pond = new T.Mesh(new T.CircleGeometry(r, 14), water); pond.scale.set(1, 0.6 + rnd() * 0.4, 1);
      pond.rotation.x = -Math.PI / 2; pond.rotation.z = rnd() * 3; pond.position.set(x, heightAt(x, z) + 0.12, z); pond.receiveShadow = true; scene.add(pond);
      obstacles.push([x, z, r]); made++;
    }

    // instanced pines
    const fol = merge(T, [cylAt(T, 0, 0.55, 1.2, 6, 0, 1.0, 0), cylAt(T, 0, 0.42, 1.0, 6, 0, 1.6, 0), cylAt(T, 0, 0.28, 0.7, 6, 0, 2.1, 0)]);
    const trk = merge(T, [cylAt(T, 0.07, 0.1, 0.6, 5, 0, 0.3, 0)]);
    const NP = 300, pinesF = new T.InstancedMesh(fol, phong(T, 0xffffff), NP), pinesT = new T.InstancedMesh(trk, phong(T, PAL.trunk), NP);
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

    // steam sprites over stacks and cooling towers
    const tex = softTexture(T), puffs = [];
    steam.forEach(st => { for (let i = 0; i < (st.big ? 14 : 8); i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffffff })); sp.userData = { at: st.at, t: i / (st.big ? 14 : 8), big: st.big, s: st.s }; scene.add(sp); puffs.push(sp); } });

    // aim the sun's shadow camera at the pair
    const focus = va.clone().lerp(vb, 0.5);
    sun.target.position.copy(focus); sun.position.copy(focus).add(sunDir.clone().multiplyScalar(R * 2));

    return { scene, puffs, pulse, clouds, labels, focus, span: Math.max(12, va.distanceTo(vb)), tex };
  }

  // ---------- modal and render loop ----------
  function open(pair, opts) {
    const modal = document.getElementById("m3d");
    modal.hidden = false;
    document.getElementById("m3dTitle").textContent = opts.title;
    document.getElementById("m3dSub").textContent = opts.subtitle;
    const stage = document.getElementById("m3dStage"), msg = document.getElementById("m3dMsg");
    msg.textContent = "Loading 3D…"; msg.hidden = false;
    document.getElementById("m3dClose").focus();
    ensureThree().then(() => {
      if (modal.hidden) return;
      close(true);
      const T = root.THREE, built = build(pair, opts);
      const renderer = new T.WebGLRenderer({ antialias: true });
      renderer.setClearColor(PAL.fog);
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      stage.innerHTML = ""; stage.appendChild(renderer.domElement);
      const overlay = document.createElement("div"); overlay.className = "m3d-labels"; stage.appendChild(overlay);
      const tags = built.labels.map(l => { const el = document.createElement("span"); el.className = "m3d-tag " + l.size; el.style.setProperty("--c", l.color); el.textContent = l.text; overlay.appendChild(el); return { el, pos: l.pos }; });
      const v = new T.Vector3();
      const placeTags = () => { const w = stage.clientWidth, h = stage.clientHeight; tags.forEach(t => { v.copy(t.pos).project(cam); const off = v.z > 1; t.el.style.display = off ? "none" : ""; t.el.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, -100%)`; }); };

      const cam = new T.PerspectiveCamera(42, 1, 0.5, 2500);
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
      controls.autoRotateSpeed = 0.5; controls.enabled = !INTRO; controls.autoRotate = !reduced && !INTRO;
      controls.addEventListener("start", () => { controls.autoRotate = false; });

      const size = () => {
        const w = stage.clientWidth, h = stage.clientHeight, px = document.getElementById("m3dPixel").checked ? 3 : 1;
        renderer.setPixelRatio(px === 1 ? Math.min(1.5, devicePixelRatio) : 1);
        renderer.setSize(Math.max(1, Math.round(w / px)), Math.max(1, Math.round(h / px)), false);
        renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
        stage.classList.toggle("pixel", px > 1);
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
        built.clouds.forEach((c, i) => { c.position.x += 0.012 * (1 + (i % 3) * 0.4); if (c.position.x > 200) c.position.x = -200; });
        controls.update(); renderer.render(built.scene, cam); placeTags(); raf = requestAnimationFrame(loop);
      };
      loop();
      msg.hidden = true;
      const onResize = () => size();
      addEventListener("resize", onResize);
      document.getElementById("m3dPixel").onchange = size;
      ctx = { stop: () => {
        cancelAnimationFrame(raf); removeEventListener("resize", onResize); controls.dispose();
        built.scene.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); });
        built.tex.dispose(); renderer.dispose();
      } };
    }).catch(err => { msg.hidden = false; msg.textContent = root.THREE ? "The 3D view couldn't be drawn: " + err.message : "The 3D view needs an internet connection to load three.js. " + err.message; });
  }
  function close(keepOpen) {
    if (ctx) { ctx.stop(); ctx = null; }
    if (!keepOpen) { document.getElementById("m3d").hidden = true; document.getElementById("m3dStage").innerHTML = ""; }
  }
  root.Scene3D = { open, close };
})(this);
