// Seamline 3D vehicles: procedural work trucks for the pair view, built from three.js primitives (no downloads).
// Each vehicle is modeled in meters, faces +x, sits on y = 0 and is centered on its chassis; the scene scales it
// (SCENE_SCALE matches the pair view, where a 7 m truck is about 1.4 units long).
// Two levels: "detailed" merges each vehicle into one mesh per material (about ten draw calls, a few thousand
// triangles), and "ultra" adds rounded bodies, tread blocks, lug nuts, mirrors, grille bars, lights and
// clear-coated paint on MeshPhysicalMaterial, so it looks right under the scene's sky environment light.
(function (root) {
  const LEVELS = {
    detailed: { wheelSeg: 18, round: 10, curve: 5, bevel: false, tread: 0, lugs: 0, lattice: 9, extras: false },
    ultra: { wheelSeg: 40, round: 20, curve: 12, bevel: true, tread: 26, lugs: 8, lattice: 20, extras: true },
  };
  const COLORS = { pickup: 0xf3f3ef, bucket: 0xf3f3ef, flatbed: 0x1d3a5c, lowboy: 0x7d1d1d, truckCrane: 0xe0a93e, crawlerCrane: 0xe0a93e };

  // Surface specs. rough and metal are PBR roughness and metalness; clear adds clearcoat at the ultra level.
  const SPEC = color => ({
    paint: { color, rough: 0.34, metal: 0.2, clear: true },
    white: { color: 0xf1f1ec, rough: 0.4, metal: 0.1, clear: true },
    trim: { color: 0x2a2f33, rough: 0.55, metal: 0.2 },
    black: { color: 0x151719, rough: 0.75, metal: 0.05 },
    chrome: { color: 0xdfe3e6, rough: 0.1, metal: 1, env: 1.4 },
    alu: { color: 0xb9bfc5, rough: 0.28, metal: 0.9, env: 1.2 },
    steel: { color: 0x4a535b, rough: 0.55, metal: 0.6 },
    tire: { color: 0x1a1b1d, rough: 0.93, metal: 0 },
    rim: { color: 0xc9ced2, rough: 0.22, metal: 0.9, env: 1.2 },
    glass: { color: 0x1c2831, rough: 0.04, metal: 0.2, glass: true },
    lamp: { color: 0xfffbea, rough: 0.1, emissive: 0xfff2cc, ei: 0.7 },
    tail: { color: 0xa3141b, rough: 0.2, emissive: 0x700000, ei: 0.6 },
    amber: { color: 0xff9a1a, rough: 0.25, emissive: 0xff7a00, ei: 0.8 },
    wood: { color: 0x86674a, rough: 0.88 },
    woodDark: { color: 0x6a4f36, rough: 0.9 },
    yellow: { color: 0xf2c230, rough: 0.45, clear: true },
    fiber: { color: 0xeeeee6, rough: 0.35, clear: true },
    tank: { color: 0x7b8993, rough: 0.5, metal: 0.35 },
    porcelain: { color: 0x7a4a2e, rough: 0.2, clear: true },
    cable: { color: 0x1f2224, rough: 0.5, metal: 0.6 },
    strap: { color: 0xe8b21c, rough: 0.7 },
  });

  function Kit(T, level, color) {
    const L = LEVELS[level] || LEVELS.detailed, ultra = level === "ultra", spec = SPEC(color);
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const parts = {};
    const put = (key, g) => { (parts[key] || (parts[key] = [])).push(g); return g; };

    const material = key => {
      const s = spec[key];
      const p = { color: s.color, roughness: s.rough ?? 0.6, metalness: s.metal ?? 0 };
      if (s.emissive) Object.assign(p, { emissive: s.emissive, emissiveIntensity: s.ei });
      if (s.glass) Object.assign(p, { transparent: true, opacity: ultra ? 0.78 : 0.88, side: T.DoubleSide });
      if (ultra && T.MeshPhysicalMaterial) {
        if (s.env) p.envMapIntensity = s.env;
        if (s.clear || s.glass) Object.assign(p, { clearcoat: 1, clearcoatRoughness: s.glass ? 0.02 : 0.08 });
        return new T.MeshPhysicalMaterial(p);
      }
      return new T.MeshStandardMaterial(p);
    };

    // ---- geometry helpers (meters, world axes of the vehicle) ----
    const box = (key, w, h, d, x, y, z) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return put(key, g); };
    const turn = (g, axis) => (axis === "x" ? g.rotateZ(Math.PI / 2) : axis === "z" ? g.rotateX(Math.PI / 2) : g);
    const cyl = (key, r, len, x, y, z, axis = "y", seg = L.round) => { const g = turn(new T.CylinderGeometry(r, r, len, seg), axis); g.translate(x, y, z); return put(key, g); };
    const orient = (g, a, b, from) => {
      const d = b.clone().sub(a).normalize();
      g.applyMatrix4(new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion().setFromUnitVectors(from, d)));
      const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); return g;
    };
    const rod = (key, a, b, r, seg = 8) => put(key, orient(new T.CylinderGeometry(r, r, a.distanceTo(b), seg), a, b, V(0, 1, 0)));
    // Box from a to b with cross-section w (across, z) by h; used for booms and beams in the vehicle's x-y plane.
    const bar = (key, a, b, w, h) => put(key, orient(new T.BoxGeometry(a.distanceTo(b), h, w), a, b, V(1, 0, 0)));
    // Side profile extruded across the vehicle. `top` runs from the front-bottom corner over the roof to the
    // rear-bottom corner; with `bottom` set, the underside runs back to the front with wheel arches cut in.
    const ext = (key, top, width, { bottom, arches = [], z = 0, bevel = L.bevel } = {}) => {
      const s = new T.Shape();
      s.moveTo(top[0][0], top[0][1]);
      top.slice(1).forEach(p => s.lineTo(p[0], p[1]));
      if (bottom !== undefined) {
        arches.slice().sort((a, b) => a.x - b.x).forEach(a => { s.lineTo(a.x - a.r, bottom); s.absarc(a.x, bottom, a.r, Math.PI, 0, true); });
        s.lineTo(top[0][0], bottom);
      }
      s.closePath();
      const bt = bevel ? Math.min(0.035, width * 0.2) : 0;
      const g = new T.ExtrudeGeometry(s, { depth: width - 2 * bt, bevelEnabled: bevel, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 2, curveSegments: L.curve, steps: 1 });
      g.translate(0, 0, z - width / 2 + bt);
      return put(key, g);
    };
    // Flat polygon (x-y points) at depth z, for side windows and door panels.
    const pane = (key, pts, z) => {
      const s = new T.Shape(); pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
      const g = new T.ShapeGeometry(s); g.translate(0, 0, z); return put(key, g);
    };
    const paneBoth = (key, pts, halfW) => { pane(key, pts, halfW + 0.006); pane(key, pts, -halfW - 0.006); };
    // Windshield on a sloped cab face from p0 (bottom) to p1 (top), both [x, y], pushed slightly out of the body.
    const windshield = (p0, p1, halfW) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), nx = dy / l * 0.012, ny = -dx / l * 0.012;
      const a = [p0[0] + nx, p0[1] + ny], b = [p1[0] + nx, p1[1] + ny];
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute([a[0], a[1], -halfW, a[0], a[1], halfW, b[0], b[1], halfW, a[0], a[1], -halfW, b[0], b[1], halfW, b[0], b[1], -halfW], 3));
      g.computeVertexNormals(); return put("glass", g);
    };

    // Wheel at axle x, center on the ground at z: tire with rounded shoulders, rim, hub; dual puts two tires side by side.
    const wheel = (x, r, z, wid, dual = false) => {
      const side = Math.sign(z) || 1, w = wid / 2;
      const tires = dual ? [z - side * wid * 0.53, z + side * wid * 0.53] : [z];
      const prof = ultra
        ? [[r * 0.6, w * 0.93], [r * 0.88, w], [r * 0.97, w * 0.9], [r, w * 0.62], [r, -w * 0.62], [r * 0.97, -w * 0.9], [r * 0.88, -w], [r * 0.6, -w * 0.93]]
        : [[r * 0.6, w], [r * 0.95, w], [r, w * 0.7], [r, -w * 0.7], [r * 0.95, -w], [r * 0.6, -w]];
      tires.forEach((tz, ti) => {
        const g = new T.LatheGeometry(prof.map(p => new T.Vector2(p[0], p[1])), L.wheelSeg);
        g.rotateX(Math.PI / 2); g.translate(x, r, tz); put("tire", g);
        cyl("rim", r * 0.6, wid * 0.86, x, r, tz, "z", L.wheelSeg);
        for (let i = 0; i < L.tread; i++) for (const row of [-1, 1]) {
          const a = (i + (row > 0 ? 0.5 : 0)) / L.tread * Math.PI * 2, t = new T.BoxGeometry(r * 0.15, 0.03, wid * 0.36);
          t.translate(0, r - 0.004, row * wid * 0.2); t.rotateZ(a); t.translate(x, r, tz); put("tire", t);
        }
        const outer = !dual || ti === 1, fz = tz + side * wid * 0.44;
        if (!outer) return;
        cyl("chrome", r * 0.2, 0.08, x, r, fz + side * 0.03, "z");
        if (ultra) {
          const ring = new T.TorusGeometry(r * 0.5, r * 0.04, 6, L.wheelSeg); ring.translate(x, r, fz); put("chrome", ring);
          for (let i = 0; i < L.lugs; i++) { const a = i / L.lugs * Math.PI * 2; cyl("chrome", r * 0.035, 0.06, x + Math.cos(a) * r * 0.3, r + Math.sin(a) * r * 0.3, fz + side * 0.02, "z", 6); }
        }
      });
    };
    // Fender arc over a wheel (open half-cylinder), width across z.
    const fender = (key, x, r, z, width) => {
      const g = new T.CylinderGeometry(r, r, width, L.round, 1, true, Math.PI / 2, Math.PI);
      g.rotateX(Math.PI / 2); g.translate(x, r - 0.12, z); return put(key, g);
    };
    const mirror = (x, y, z) => {
      const s = Math.sign(z);
      box("black", 0.07, 0.42, 0.18, x, y, z);
      rod("chrome", V(x, y + 0.15, z - s * 0.08), V(x + 0.05, y + 0.12, z - s * 0.32), 0.015);
      rod("chrome", V(x, y - 0.15, z - s * 0.08), V(x + 0.05, y - 0.2, z - s * 0.32), 0.015);
      if (ultra) box("glass", 0.01, 0.36, 0.14, x - 0.04, y, z);
    };
    const hook = (x, y, z) => {
      box("yellow", 0.5, 0.7, 0.35, x, y, z);
      cyl("steel", 0.2, 0.4, x, y + 0.2, z, "z");
      const h = new T.TorusGeometry(0.16, 0.05, 6, 12, Math.PI * 1.4); h.rotateZ(Math.PI * 0.8); h.translate(x, y - 0.6, z); put("steel", h);
      rod("steel", V(x, y - 0.35, z), V(x, y - 0.46, z), 0.05);
    };
    // Lattice boom from a to b (in the x-y plane): four chords and zig-zag lacing on each face.
    const lattice = (key, a, b, size, n) => {
      const d = b.clone().sub(a).normalize(), up = V(-d.y, d.x, 0), side = V(0, 0, 1), h = size / 2;
      const corner = (p, i, j) => p.clone().addScaledVector(up, i * h).addScaledVector(side, j * h);
      for (const i of [-1, 1]) for (const j of [-1, 1]) rod(key, corner(a, i, j), corner(b, i, j), 0.06, 6);
      for (let k = 0; k < n; k++) {
        const p = a.clone().lerp(b, k / n), q = a.clone().lerp(b, (k + 1) / n);
        for (const i of [-1, 1]) {
          rod(key, corner(p, i, -1), corner(q, i, 1), 0.025, 4);
          rod(key, corner(p, -1, i), corner(q, 1, i), 0.025, 4);
          if (ultra) { rod(key, corner(q, i, -1), corner(q, i, 1), 0.02, 4); rod(key, corner(q, -1, i), corner(q, 1, i), 0.02, 4); }
        }
      }
    };

    // Merge everything per material into one mesh each.
    const finish = () => {
      const g = new T.Group();
      let tris = 0;
      Object.keys(parts).forEach(key => {
        const geos = parts[key].map(p => (p.index ? p.toNonIndexed() : p));
        const n = geos.reduce((s, p) => s + p.attributes.position.count, 0);
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
        let o = 0;
        geos.forEach(p => { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; p.dispose(); });
        parts[key].forEach(p => p.dispose());
        const geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.BufferAttribute(pos, 3));
        geo.setAttribute("normal", new T.BufferAttribute(nor, 3));
        geo.computeBoundingSphere();
        const m = new T.Mesh(geo, material(key));
        m.castShadow = !spec[key].glass; m.receiveShadow = true;
        g.add(m); tris += n / 3;
      });
      g.userData.tris = Math.round(tris);
      return g;
    };
    return { T, L, ultra, V, put, box, cyl, rod, bar, ext, pane, paneBoth, windshield, wheel, fender, mirror, hook, lattice, finish };
  }

  // ---------- shared cabs ----------
  // Class 8 day-cab tractor with a long hood, bumper at x = xf. Returns the fifth-wheel x.
  function tractor(k, xf) {
    const { box, cyl, ext, paneBoth, windshield, wheel, fender, mirror, rod, V, ultra } = k;
    ext("paint", [[xf - 0.15, 0.85], [xf - 0.12, 1.8], [xf - 0.4, 1.9], [xf - 2.25, 2.05], [xf - 2.25, 0.85]], 1.45);
    ext("paint", [[xf - 2.25, 0.95], [xf - 2.25, 2.1], [xf - 2.65, 3.02], [xf - 2.85, 3.15], [xf - 4.2, 3.15], [xf - 4.2, 0.95]], 2.35);
    windshield([xf - 2.26, 2.16], [xf - 2.63, 2.98], 1.06);
    paneBoth("glass", [[xf - 2.33, 2.16], [xf - 2.67, 2.97], [xf - 3.3, 2.97], [xf - 3.3, 2.16]], 1.175);
    for (const s of [-1, 1]) {
      fender("paint", xf - 1.1, 0.66, s * 0.95, 0.5);
      box("lamp", 0.05, 0.16, 0.3, xf - 0.14, 1.2, s * 0.52);
      cyl("alu", 0.32, 1.3, xf - 3.3, 0.9, s * 1.0, "x");
      cyl("chrome", 0.08, 2.9, xf - 4.3, 2.35, s * 0.95);
      box("steel", 7.0, 0.28, 0.12, xf - 3.6, 1.0, s * 0.45);
      mirror(xf - 2.35, 2.5, s * 1.45);
      box("tail", 0.04, 0.12, 0.2, xf - 7.1, 1.05, s * 0.9);
    }
    box(ultra ? "chrome" : "trim", 0.06, 0.95, 1.25, xf - 0.13, 1.33, 0);
    box("chrome", 0.26, 0.36, 2.45, xf + 0.02, 0.72, 0);
    box("black", 1.1, 0.12, 1.15, xf - 5.95, 1.22, 0);
    wheel(xf - 1.1, 0.52, 1.0, 0.3); wheel(xf - 1.1, 0.52, -1.0, 0.3);
    for (const ax of [xf - 5.3, xf - 6.6]) { wheel(ax, 0.52, 0.87, 0.28, true); wheel(ax, 0.52, -0.87, 0.28, true); }
    if (ultra) {
      for (let i = 0; i < 9; i++) box("trim", 0.02, 0.85, 0.03, xf - 0.1, 1.33, -0.54 + i * 0.135);
      box("paint", 0.35, 0.05, 2.3, xf - 2.72, 3.12, 0);
      for (let i = 0; i < 5; i++) box("amber", 0.06, 0.05, 0.1, xf - 2.9, 3.19, -0.8 + i * 0.4);
      for (const s of [-1, 1]) {
        box("black", 0.012, 0.9, 0.012, xf - 3.32, 1.6, s * 1.18);
        box("chrome", 0.14, 0.03, 0.03, xf - 3.2, 1.75, s * 1.19);
        box("alu", 0.45, 0.04, 0.3, xf - 2.7, 0.55, s * 1.05);
        cyl("chrome", 0.22, 0.7, xf - 2.0, 1.75, s * 0.85);
        fender("black", xf - 5.95, 0.64, s * 0.9, 0.62);
        rod("chrome", V(xf - 2.4, 3.22, s * 0.4), V(xf - 1.9, 3.22, s * 0.4), 0.05);
      }
      cyl("steel", 0.22, 1.0, xf - 4.6, 0.95, 0, "z");
    }
    return xf - 5.95;
  }

  // Medium-duty conventional cab (bucket trucks, service trucks), bumper at x = xf.
  function mediumCab(k, xf) {
    const { box, ext, paneBoth, windshield, mirror, ultra } = k;
    ext("paint", [[xf, 0.62], [xf + 0.04, 1.05], [xf, 1.5], [xf - 1.55, 1.68], [xf - 1.7, 1.72], [xf - 2.15, 2.6], [xf - 2.3, 2.66], [xf - 3.35, 2.66], [xf - 3.4, 2.55], [xf - 3.4, 0.62]], 2.3,
      { bottom: 0.62, arches: [{ x: xf - 1.1, r: 0.62 }] });
    windshield([xf - 1.72, 1.76], [xf - 2.13, 2.56], 1.03);
    paneBoth("glass", [[xf - 1.85, 1.78], [xf - 2.17, 2.52], [xf - 2.85, 2.52], [xf - 2.85, 1.78]], 1.15);
    box("glass", 0.02, 0.45, 1.5, xf - 3.41, 2.2, 0);
    box(ultra ? "chrome" : "trim", 0.05, 0.6, 1.3, xf + 0.02, 1.1, 0);
    box("chrome", 0.2, 0.3, 2.35, xf + 0.08, 0.62, 0);
    for (const s of [-1, 1]) { box("lamp", 0.05, 0.16, 0.3, xf + 0.02, 1.2, s * 0.85); mirror(xf - 1.9, 2.1, s * 1.4); }
    box("amber", 0.3, 0.12, 1.1, xf - 2.8, 2.72, 0);
    if (ultra) {
      for (let i = 0; i < 5; i++) box("trim", 0.02, 0.03, 1.2, xf + 0.05, 0.9 + i * 0.1, 0);
      for (const s of [-1, 1]) { box("black", 0.012, 0.9, 0.012, xf - 2.88, 1.55, s * 1.155); box("chrome", 0.14, 0.03, 0.03, xf - 2.75, 1.7, s * 1.16); }
    }
  }

  // ---------- vehicles ----------
  const BUILD = {
    // Crew-cab utility pickup with an amber light bar.
    pickup(k) {
      const { box, ext, paneBoth, windshield, wheel, mirror, ultra } = k;
      ext("paint", [[3.2, 0.5], [3.25, 0.95], [3.2, 1.3], [1.45, 1.38], [0.75, 1.95], [0.55, 1.98], [-0.95, 1.98], [-1.05, 1.9], [-1.1, 0.5]], 2.0,
        { bottom: 0.5, arches: [{ x: 1.95, r: 0.5 }] });
      for (const s of [-1, 1]) ext("paint", [[-1.15, 0.55], [-1.15, 1.32], [-3.2, 1.32], [-3.2, 0.55]], 0.08, { bottom: 0.55, arches: [{ x: -1.75, r: 0.5 }], z: s * 0.96, bevel: false });
      box("black", 2.0, 0.06, 1.84, -2.17, 0.75, 0);
      box("paint", 0.08, 0.6, 1.84, -1.19, 1.02, 0);
      box("paint", 0.08, 0.62, 1.92, -3.17, 1.0, 0);
      for (const s of [-1, 1]) box("black", 2.1, 0.04, 0.12, -2.17, 1.34, s * 0.96);
      box("black", 5.6, 0.2, 1.1, 0, 0.45, 0);
      box("chrome", 0.2, 0.3, 2.02, 3.3, 0.62, 0);
      box("chrome", 0.2, 0.2, 1.95, -3.27, 0.58, 0);
      box(ultra ? "chrome" : "trim", 0.04, 0.32, 1.25, 3.25, 1.08, 0);
      windshield([1.42, 1.42], [0.78, 1.92], 0.9);
      paneBoth("glass", [[1.3, 1.45], [0.78, 1.9], [0.05, 1.9], [0.05, 1.45]], 1.0);
      paneBoth("glass", [[-0.05, 1.45], [-0.05, 1.9], [-0.9, 1.9], [-0.95, 1.45]], 1.0);
      box("glass", 0.02, 0.36, 1.5, -1.1, 1.66, 0);
      for (const s of [-1, 1]) {
        box("lamp", 0.04, 0.16, 0.3, 3.24, 1.14, s * 0.74);
        box("tail", 0.04, 0.4, 0.1, -3.22, 1.05, s * 0.93);
        mirror(1.2, 1.55, s * 1.13);
        wheel(1.95, 0.42, s * 0.84, 0.3); wheel(-1.75, 0.42, s * 0.84, 0.3);
      }
      box("black", 0.3, 0.05, 1.3, -0.3, 2.0, 0);
      box("amber", 0.22, 0.09, 1.2, -0.3, 2.07, 0);
      if (ultra) {
        for (let i = 0; i < 4; i++) box("chrome", 0.02, 0.025, 1.2, 3.27, 0.96 + i * 0.08, 0);
        for (const s of [-1, 1]) {
          for (const x of [0.02, -1.02]) box("black", 0.012, 0.8, 0.012, x, 1.05, s * 1.005);
          for (const x of [-0.2, -0.95]) box("chrome", 0.14, 0.03, 0.03, x, 1.3, s * 1.01);
          box("black", 0.9, 0.08, 0.14, 0.7, 0.45, s * 0.95);
        }
        box("black", 0.3, 0.12, 0.5, -3.3, 0.45, 0);
      }
    },

    // Bucket truck: medium-duty cab, utility service body, articulating insulated boom with the basket raised.
    bucket(k, o) {
      const { box, bar, rod, cyl, wheel, V, ultra } = k;
      mediumCab(k, 4.0);
      for (const s of [-1, 1]) box("steel", 7.6, 0.25, 0.12, 0.2, 0.9, s * 0.45);
      const bx0 = 0.5, bx1 = -3.9;
      for (const s of [-1, 1]) {
        box("paint", bx0 - bx1, 1.25, 0.55, (bx0 + bx1) / 2, 1.6, s * 0.95);
        if (ultra) for (let i = 0; i < 4; i++) {
          const cx = bx0 - 0.55 - i * 1.1;
          box("black", 0.012, 1.05, 0.012, cx + 0.55, 1.6, s * 1.228);
          box("chrome", 0.12, 0.03, 0.03, cx, 1.95, s * 1.235);
        }
        box("amber", 0.05, 0.06, 0.08, bx1 + 0.05, 2.18, s * 1.2);
        box("tail", 0.04, 0.3, 0.14, bx1 - 0.02, 1.4, s * 1.1);
      }
      box("steel", bx0 - bx1, 0.08, 1.4, (bx0 + bx1) / 2, 1.1, 0);
      box("chrome", 0.2, 0.2, 2.3, -4.0, 0.62, 0);
      wheel(2.9, 0.5, 0.98, 0.3); wheel(2.9, 0.5, -0.98, 0.3);
      wheel(-2.0, 0.5, 0.86, 0.28, true); wheel(-2.0, 0.5, -0.86, 0.28, true);
      for (const s of [-1, 1]) { box("steel", 0.25, 0.25, 0.9, -3.3, 1.0, s * 1.4); cyl("steel", 0.08, 0.8, -3.3, 0.5, s * 1.75); cyl("black", 0.25, 0.06, -3.3, 0.03, s * 1.75); }
      // boom: pedestal at the rear, lower steel arm, upper insulated fiberglass arm, basket
      const up = o.stowed ? 0 : 1, ped = V(-3.0, 2.35, 0);
      cyl("paint", 0.4, 0.35, ped.x, 2.4, 0);
      cyl("steel", 0.25, 0.8, ped.x, 2.9, 0);
      const heel = V(ped.x, 3.25, 0), knee = up ? V(-1.3, 7.8, 0) : V(1.7, 3.35, 0), tip = up ? V(1.6, 11.2, 0) : V(-2.4, 3.5, 0.35);
      bar("paint", heel, knee, 0.34, 0.42);
      bar("fiber", knee, tip, 0.26, 0.3);
      rod("steel", V(ped.x + 0.3, 2.9, 0.25), heel.clone().lerp(knee, 0.45).add(V(0, 0, 0.25)), 0.07);
      rod("chrome", heel.clone().lerp(knee, 0.45).add(V(0, 0, 0.25)), heel.clone().lerp(knee, 0.62).add(V(0, 0, 0.25)), 0.04);
      cyl("steel", 0.22, 0.5, knee.x, knee.y, 0, "z");
      box("yellow", 0.75, 1.05, 0.75, tip.x + 0.35, tip.y - 0.4, 0);
      if (ultra) { box("black", 0.8, 0.06, 0.8, tip.x + 0.35, tip.y + 0.12, 0); rod("fiber", knee.clone().add(V(0, 0.2, 0.18)), tip.clone().add(V(-0.1, 0.2, 0.18)), 0.03); }
    },

    // Tractor with a 48 ft flatbed carrying tower steel and a cable reel.
    flatbed(k) {
      const { box, cyl, wheel, rod, V, ultra } = k;
      const kp = tractor(k, 9.8), f = kp + 0.9, r = f - 14.6, cx = (f + r) / 2;
      for (const s of [-1, 1]) { box("steel", 14.6, 0.5, 0.12, cx, 1.15, s * 0.42); box("steel", 14.6, 0.18, 0.1, cx, 1.47, s * 1.22); }
      if (ultra) for (let i = 0; i < 16; i++) box(i % 2 ? "wood" : "woodDark", 14.5, 0.08, 0.145, cx, 1.56, -1.12 + i * 0.15);
      else box("wood", 14.5, 0.08, 2.4, cx, 1.56, 0);
      for (const ax of [r + 1.4, r + 2.65]) for (const s of [-1, 1]) wheel(ax, 0.5, s * 0.87, 0.28, true);
      for (const s of [-1, 1]) { box("steel", 0.12, 1.0, 0.12, f - 3.0, 0.62, s * 0.8); box("steel", 0.3, 0.05, 0.3, f - 3.0, 0.08, s * 0.8); box("tail", 0.05, 0.12, 0.22, r - 0.02, 1.3, s * 1.0); }
      box("steel", 0.15, 0.2, 2.4, r - 0.05, 1.05, 0);
      // load: two bundles of galvanized tower angles, then a cable reel
      for (const [x0, len] of [[f - 1.5, 5.2], [f - 7.2, 3.8]]) {
        for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) box("alu", len, 0.14, 0.14, x0 - len / 2, 1.72 + row * 0.15, (i - (5 - row) / 2) * 0.17);
        for (const s of [-1, 1]) box("woodDark", 0.12, 0.1, 1.4, x0 - len / 2 + s * len * 0.35, 1.64, 0);
        for (const s of [-1, 1]) box("strap", 0.06, 0.62, 1.12, x0 - len / 2 + s * len * 0.3, 1.94, 0);
      }
      const rx = r + 2.2;
      cyl("wood", 1.05, 0.1, rx, 2.7, 0.62, "z", k.L.round * 2); cyl("wood", 1.05, 0.1, rx, 2.7, -0.62, "z", k.L.round * 2);
      cyl("cable", 0.8, 1.14, rx, 2.7, 0, "z", k.L.round * 2);
      for (const s of [-1, 1]) box("woodDark", 0.2, 0.2, 1.6, rx + s * 1.0, 1.7, 0);
      if (ultra) { for (const s of [-1, 1]) rod("strap", V(rx - 0.9, 1.62, s * 1.1), V(rx, 3.74, s * 0.7), 0.025); for (let i = 0; i < 10; i++) box("steel", 0.1, 0.08, 0.1, f - 0.8 - i * 1.4, 1.42, 1.27); }
    },

    // Tractor with a lowboy trailer carrying a substation power transformer.
    lowboy(k) {
      const { box, cyl, wheel, rod, V, ultra } = k;
      const kp = tractor(k, 10.4), f = kp + 1.0;
      box("steel", 3.0, 0.3, 2.5, f - 1.5, 1.55, 0);
      for (const s of [-1, 1]) { rod("steel", V(f - 2.9, 1.5, s * 1.0), V(f - 3.6, 0.8, s * 1.0), 0.18); box("steel", 8.0, 0.5, 0.2, f - 7.6, 0.72, s * 1.15); }
      box("wood", 8.0, 0.1, 2.1, f - 7.6, 0.52, 0);
      box("steel", 4.4, 0.3, 2.5, f - 13.8, 1.1, 0);
      for (const ax of [f - 12.6, f - 13.8, f - 15.0]) for (const s of [-1, 1]) wheel(ax, 0.42, s * 0.87, 0.26, true);
      for (const s of [-1, 1]) box("tail", 0.05, 0.12, 0.22, f - 16.02, 1.2, s * 1.0);
      box("amber", 0.3, 0.1, 2.0, f - 16.0, 1.3, 0);
      // transformer: tank, radiators on both sides, bushings, conservator tank
      const tx = f - 7.6;
      box("tank", 4.0, 2.5, 2.0, tx, 1.82, 0);
      box("tank", 4.1, 0.12, 2.1, tx, 3.1, 0);
      const fins = ultra ? 16 : 5;
      for (const s of [-1, 1]) for (let i = 0; i < fins; i++) box("tank", ultra ? 0.05 : 0.5, 1.9, 0.38, tx - 1.6 + i * 3.2 / (fins - 1), 1.9, s * 1.2);
      for (let i = 0; i < 3; i++) { cyl("porcelain", 0.13, 1.1, tx - 1.0 + i * 1.0, 3.7, -0.4); cyl("alu", 0.07, 0.2, tx - 1.0 + i * 1.0, 4.35, -0.4, "y", 8); }
      for (let i = 0; i < 3; i++) cyl("porcelain", 0.08, 0.6, tx - 0.8 + i * 0.8, 3.45, 0.55);
      cyl("tank", 0.32, 2.6, tx + 0.4, 3.9, 0.55, "x");
      for (const s of [-1, 1]) rod("steel", V(tx + 0.4 + s * 1.0, 3.15, 0.55), V(tx + 0.4 + s * 1.0, 3.6, 0.55), 0.05);
      if (ultra) {
        for (const sx of [-1, 1]) for (const s of [-1, 1]) rod("cable", V(tx + sx * 2.0, 3.0, s * 1.0), V(tx + sx * 3.0, 0.9, s * 1.15), 0.03, 6);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) cyl("porcelain", 0.19, 0.05, tx - 1.0 + i * 1.0, 3.25 + j * 0.16, -0.4);
      }
    },

    // Hydraulic truck crane on outriggers, telescopic boom raised (o.boom meters long, o.angle degrees).
    truckCrane(k, o) {
      const { box, cyl, bar, rod, ext, paneBoth, wheel, hook, V, ultra } = k;
      box("paint", 12.0, 0.9, 2.5, 0, 1.35, 0);
      box("steel", 12.2, 0.25, 2.3, 0, 0.9, 0);
      ext("paint", [[6.2, 0.95], [6.3, 2.6], [5.9, 3.0], [4.6, 3.0], [4.6, 0.95]], 1.0, { z: -0.72 });
      paneBoth("glass", [[6.1, 1.9], [5.85, 2.85], [4.8, 2.85], [4.8, 1.9]], 0.5);
      box("glass", 0.02, 0.8, 0.85, 6.31, 2.35, -0.72);
      box("chrome", 0.2, 0.3, 2.5, 6.15, 0.75, 0);
      for (const s of [-1, 1]) box("lamp", 0.04, 0.14, 0.25, 6.08, 1.3, s * 0.95);
      for (const ax of [4.4, 2.9, -2.7, -4.2]) for (const s of [-1, 1]) wheel(ax, 0.62, s * 1.0, 0.46);
      for (const s of [-1, 1]) { box("black", 3.4, 0.08, 0.6, 3.65, 1.3, s * 1.0); box("black", 3.4, 0.08, 0.6, -3.45, 1.3, s * 1.0); }
      for (const x of [5.4, -5.6]) {
        box("paint", 0.35, 0.32, 6.8, x, 1.2, 0);
        for (const s of [-1, 1]) { cyl("steel", 0.14, 1.1, x, 0.6, s * 3.25); cyl("black", 0.45, 0.08, x, 0.04, s * 3.25, "y", k.L.round); }
      }
      // superstructure
      cyl("steel", 1.15, 0.35, -2.0, 1.97, 0, "y", k.L.round * 2);
      box("paint", 4.6, 1.1, 2.5, -2.8, 2.7, 0);
      box("steel", 1.3, 1.4, 2.5, -5.3, 2.85, 0);
      ext("paint", [[-0.35, 2.15], [-0.25, 3.25], [-0.7, 3.65], [-2.0, 3.65], [-2.0, 2.15]], 0.9, { z: 1.0 });
      paneBoth("glass", [[-0.4, 2.7], [-0.35, 3.2], [-0.72, 3.55], [-1.8, 3.55], [-1.8, 2.7]], 0.45);
      box("glass", 0.02, 0.8, 0.75, -0.28, 3.0, 1.0);
      // telescopic boom: four nested box sections
      const ang = (o.angle ?? 58) * Math.PI / 180, total = o.boom ?? 26, d = V(Math.cos(ang), Math.sin(ang), 0);
      const heel = V(-4.5, 3.4, -0.25), secLen = (total - 10) / 3 + 1.5;
      let s0 = 0, s1 = 10;
      for (let i = 0; i < 4; i++) {
        bar("paint", heel.clone().addScaledVector(d, s0), heel.clone().addScaledVector(d, s1), 0.95 - i * 0.14, 1.15 - i * 0.16);
        s0 = s1 - 1.5; s1 = s0 + secLen;
      }
      const tipLen = s0 + 1.5, tip = heel.clone().addScaledVector(d, tipLen);
      bar("steel", tip, tip.clone().addScaledVector(d, 0.9), 0.5, 0.7);
      cyl("steel", 0.35, 0.4, tip.x + d.x * 0.9, tip.y + d.y * 0.9, heel.z, "z");
      const cylBase = V(-2.2, 2.6, -0.25), cylTop = heel.clone().addScaledVector(d, 4.8);
      rod("steel", cylBase, cylBase.clone().lerp(cylTop, 0.6), 0.2);
      rod("chrome", cylBase.clone().lerp(cylTop, 0.6), cylTop, 0.12);
      const hx = tip.x + d.x * 0.9 + 0.35, hy = Math.max(3.5, tip.y * 0.35);
      rod("cable", V(hx, tip.y + d.y * 0.9, heel.z), V(hx, hy + 0.35, heel.z), 0.03, 6);
      hook(hx, hy, heel.z);
      if (ultra) {
        for (let i = 0; i < 3; i++) box("black", 0.02, 0.9, 0.02, -3.4 + i * 1.0, 2.7, 1.26);
        box("amber", 0.15, 0.15, 0.15, 5.3, 3.08, -0.72);
        for (const x of [5.4, -5.6]) for (const s of [-1, 1]) box("black", 0.36, 0.33, 0.15, x, 1.2, s * 3.1);
        box("yellow", 0.1, 0.05, 2.5, -5.96, 2.3, 0);
      }
    },

    // Crawler crane with a lattice boom, gantry and pendant lines (o.boom meters, o.angle degrees).
    crawlerCrane(k, o) {
      const { box, cyl, rod, ext, paneBoth, lattice, hook, V, ultra, L } = k;
      for (const s of [-1, 1]) {
        const z = s * 2.1;
        if (ultra) {
          // individual track shoes around the idler, sprocket and bottom run
          const n = 40, len = 5.6, rr = 0.52;
          for (let i = 0; i < n; i++) {
            const t = i / n * (2 * len + 2 * Math.PI * rr); let x, y, a;
            if (t < len) { x = len / 2 - t; y = 0; a = 0; }
            else if (t < len + Math.PI * rr) { const u = (t - len) / rr; x = -len / 2 - Math.sin(u) * rr; y = rr - Math.cos(u) * rr; a = u; }
            else if (t < 2 * len + Math.PI * rr) { x = -len / 2 + (t - len - Math.PI * rr); y = 2 * rr; a = Math.PI; }
            else { const u = (t - 2 * len - Math.PI * rr) / rr; x = len / 2 + Math.sin(u) * rr; y = rr + Math.cos(u) * rr; a = Math.PI + u; }
            const g = new k.T.BoxGeometry(0.34, 0.08, 1.0); g.translate(0, 0.04, 0); g.rotateZ(-a); g.translate(x, y + 0.02, z);
            k.put("black", g);
          }
        }
        box("black", 5.6, 0.95, ultra ? 0.78 : 0.9, 0, 0.55, z);
        for (const x of [-2.8, 2.8]) cyl("black", 0.52, 0.9, x, 0.54, z, "z");
        for (let i = 0; i < 6; i++) cyl("steel", 0.18, 0.95, -2.0 + i * 0.8, 0.3, z, "z", 8);
        box("paint", 5.2, 0.35, 0.95, 0, 1.0, z);
      }
      box("steel", 3.0, 0.8, 3.4, 0, 1.2, 0);
      cyl("steel", 1.4, 0.3, 0, 1.75, 0, "y", L.round * 2);
      box("paint", 5.0, 2.2, 3.0, -0.6, 3.0, 0);
      box("steel", 1.6, 2.2, 3.2, -3.9, 2.9, 0);
      ext("paint", [[2.6, 1.95], [2.7, 3.2], [2.3, 3.7], [1.2, 3.7], [1.2, 1.95]], 1.0, { z: -1.2 });
      paneBoth("glass", [[2.5, 2.7], [2.55, 3.15], [2.25, 3.6], [1.35, 3.6], [1.35, 2.7]], 0.5);
      box("glass", 0.02, 0.9, 0.85, 2.71, 2.9, -1.2);
      const ang = (o.angle ?? 62) * Math.PI / 180, len = o.boom ?? 30, d = V(Math.cos(ang), Math.sin(ang), 0);
      const heel = V(1.6, 2.4, 0.4), tip = heel.clone().addScaledVector(d, len);
      lattice("paint", heel, tip, 1.3, L.lattice);
      const gantry = V(-2.2, 6.2, 0.4);
      for (const s of [-1, 1]) { rod("steel", V(-0.6, 4.1, 0.4 + s * 1.2), gantry, 0.1); rod("steel", V(-3.4, 4.1, 0.4 + s * 1.2), gantry, 0.1); }
      for (const s of [-1, 1]) rod("cable", gantry.clone().add(V(0, 0, s * 0.3)), tip.clone().add(V(0, 0, s * 0.5)), 0.035, 5);
      box("steel", 1.0, 0.9, 1.4, tip.x + 0.3, tip.y, tip.z);
      const hy = Math.max(3.5, tip.y * 0.3);
      rod("cable", V(tip.x + 0.7, tip.y - 0.3, tip.z), V(tip.x + 0.7, hy + 0.35, tip.z), 0.03, 6);
      hook(tip.x + 0.7, hy, tip.z);
      if (ultra) {
        box("amber", 0.15, 0.15, 0.15, 1.8, 3.8, -1.2);
        for (let i = 0; i < 4; i++) box("steel", 0.05, 1.8, 3.21, -4.3 + i * 0.4, 2.9, 0);
        box("yellow", 0.1, 0.1, 3.0, -3.1, 1.95, 0);
      }
    },
  };

  // Build one vehicle. kind: one of KINDS. opts: { level: "detailed" | "ultra", color, boom, angle, stowed }.
  function build(T, kind, opts = {}) {
    const level = LEVELS[opts.level] ? opts.level : "detailed";
    const k = Kit(T, level, opts.color ?? COLORS[kind] ?? 0xffffff);
    (BUILD[kind] || BUILD.pickup)(k, opts);
    const g = k.finish();
    g.name = "vehicle-" + kind;
    Object.assign(g.userData, { kind, level });
    return g;
  }
  // The pair view's Quality menu maps onto the two vehicle levels.
  const levelFor = quality => (quality === "ultra" ? "ultra" : "detailed");

  root.Vehicles3D = { build, levelFor, KINDS: Object.keys(BUILD), LEVELS: Object.keys(LEVELS), SCENE_SCALE: 0.2 };
})(this);
