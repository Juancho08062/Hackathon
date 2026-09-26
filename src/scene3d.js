// Seamline 3D: a stylized scene of one flagged pair — both utilities' towers, wires and substations,
// the closest-point link, and the shared zone the tier allows (corridor, laydown yard or staging yard).
// three.js loads on first use. Horizontal positions are to scale; heights are exaggerated so towers read.
(function (root) {
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const ORBIT_URL = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js";
  const PAL = { skyTop: 0x5d7690, skyLow: 0xc9d6e0, fog: 0xaebfcc, ground: 0x587865, groundDark: 0x33443f, rock: 0x2c3a44,
    steel: 0x9fb4c4, steelDark: 0x5f7486, snow: 0xeef3f6, mountain: 0x6f8397, pad: 0x8a8f86, fence: 0x3e4f5c, steam: 0xf2f6f9 };

  let loading = null, ctx = null;
  const load = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src)); document.head.appendChild(s); });
  const ensureThree = () => loading || (loading = (root.THREE ? Promise.resolve() : load(THREE_URL)).then(() => root.THREE.OrbitControls ? null : load(ORBIT_URL)));

  // ---------- helpers ----------
  // Labels are HTML placed over the canvas each frame, so they stay sharp in pixel-art mode.
  function makeLabel(T, text, color, pos, size = "") { return { text, color, pos: pos.clone(), size }; }
  const lambert = (T, color, extra) => new T.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 6 }, extra));
  function box(T, w, h, d, color) { return new T.Mesh(new T.BoxGeometry(w, h, d), lambert(T, color)); }

  // Deterministic rolling ground so the scene looks the same every time.
  const heightAt = (x, z) => 0.35 * Math.sin(x * 0.11) * Math.cos(z * 0.09) + 0.2 * Math.sin((x + z) * 0.23);

  function tower(T, h, color) {
    const g = new T.Group(), steel = lambert(T, PAL.steel), dark = lambert(T, PAL.steelDark);
    const legs = new T.Mesh(new T.CylinderGeometry(0.12, 0.55, h, 4, 1, true), dark); legs.position.y = h / 2; g.add(legs);
    const core = new T.Mesh(new T.CylinderGeometry(0.06, 0.2, h, 4), steel); core.position.y = h / 2; g.add(core);
    for (const [y, w] of [[h * 0.92, 2.4], [h * 0.72, 1.8]]) { const arm = box(T, w, 0.12, 0.16, PAL.steel); arm.position.y = y; g.add(arm); }
    const cap = box(T, 0.3, 0.3, 0.3, color); cap.position.y = h + 0.15; g.add(cap);
    return g;
  }
  function substation(T, size, color) {
    const g = new T.Group();
    const pad = box(T, size, 0.12, size, PAL.pad); pad.position.y = 0.06; g.add(pad);
    for (let i = 0; i < 3; i++) {
      const t = box(T, size * 0.16, size * 0.18, size * 0.22, PAL.steelDark); t.position.set(-size * 0.28 + i * size * 0.28, size * 0.09 + 0.12, -size * 0.12); g.add(t);
      const fin = box(T, size * 0.18, size * 0.05, size * 0.05, PAL.steel); fin.position.set(t.position.x, t.position.y + size * 0.12, t.position.z); g.add(fin);
    }
    for (let i = 0; i < 4; i++) {
      const gantry = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, size * 0.45, 4), lambert(T, PAL.steel));
      gantry.position.set(-size * 0.36 + i * size * 0.24, size * 0.22, size * 0.2); g.add(gantry);
    }
    const bus = box(T, size * 0.8, 0.08, 0.08, color); bus.position.set(0, size * 0.44, size * 0.2); g.add(bus);
    const fence = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(size * 1.08, size * 0.12, size * 1.08)), new T.LineBasicMaterial({ color: PAL.fence }));
    fence.position.y = size * 0.06; g.add(fence);
    return g;
  }
  function plant(T, size, color) {
    const g = new T.Group();
    const hall = box(T, size * 0.7, size * 0.3, size * 0.4, PAL.steelDark); hall.position.set(-size * 0.1, size * 0.15, 0); g.add(hall);
    const stripe = box(T, size * 0.71, size * 0.04, size * 0.41, color); stripe.position.set(-size * 0.1, size * 0.27, 0); g.add(stripe);
    for (const x of [size * 0.3, size * 0.45]) { const st = new T.Mesh(new T.CylinderGeometry(size * 0.05, size * 0.07, size * 0.8, 8), lambert(T, PAL.steel)); st.position.set(x, size * 0.4, -size * 0.1); g.add(st); }
    // horizontal pipes, like the reference art
    for (const y of [size * 0.08, size * 0.18]) { const p = new T.Mesh(new T.CylinderGeometry(size * 0.035, size * 0.035, size * 1.1, 8), lambert(T, PAL.steel)); p.rotation.z = Math.PI / 2; p.position.set(0, y, size * 0.28); g.add(p); }
    g.userData.stacks = [[size * 0.3, size * 0.8, -size * 0.1], [size * 0.45, size * 0.8, -size * 0.1]];
    return g;
  }
  function yard(T, w, d, label) {
    const g = new T.Group();
    const pad = box(T, w, 0.1, d, 0x9a9785); pad.position.y = 0.05; g.add(pad);
    for (let i = 0; i < 4; i++) { const reel = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.45, 10), lambert(T, 0x7a5a3a)); reel.rotation.x = Math.PI / 2; reel.position.set(-w * 0.35 + i * 0.9, 0.55, -d * 0.25); g.add(reel); }
    for (let i = 0; i < 3; i++) { const truck = box(T, 1.2, 0.55, 0.55, [0xd9a441, 0xe6e0d0, 0xd9a441][i]); truck.position.set(-w * 0.3 + i * 1.6, 0.35, d * 0.22); g.add(truck); }
    const mast = box(T, 0.18, 3.2, 0.18, 0xd9a441); mast.position.set(w * 0.32, 1.7, 0); g.add(mast);
    const jib = box(T, 2.6, 0.14, 0.14, 0xd9a441); jib.position.set(w * 0.32 - 0.9, 3.2, 0); g.add(jib);
    g.userData.label = label;
    return g;
  }
  function mountains(T, scene, R) {
    const mat = lambert(T, PAL.mountain), snow = lambert(T, PAL.snow);
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2 + 0.3, r = R * 2.2 + (i % 3) * 8, h = 10 + (i * 37 % 11), w = 9 + (i * 13 % 7);
      const m = new T.Mesh(new T.ConeGeometry(w, h, 5), mat); m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r); scene.add(m);
      const cap = new T.Mesh(new T.ConeGeometry(w * 0.32, h * 0.32, 5), snow); cap.position.set(m.position.x, h - h * 0.16 - 1, m.position.z); scene.add(cap);
    }
  }
  function sag(T, a, b, h, color) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new T.Vector3(a.x + (b.x - a.x) * t, h - 0.9 * Math.sin(Math.PI * t) + (a.y + (b.y - a.y) * t), a.z + (b.z - a.z) * t)); }
    return new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color }));
  }

  // ---------- build ----------
  function build(pair, opts) {
    const T = root.THREE;
    const c0 = [(pair.ca[0] + pair.cb[0]) / 2, (pair.ca[1] + pair.cb[1]) / 2];
    const KX = 111.32 * Math.cos(c0[0] * Math.PI / 180), KY = 110.57;
    const Rkm = Math.max(2.5, pair.km * 1.5);
    const S = 32 / Rkm;                                        // scene units per km
    const toV = ([lat, lon]) => { const x = (lon - c0[1]) * KX * S, z = -(lat - c0[0]) * KY * S; return new T.Vector3(x, heightAt(x, z), z); };
    const R = 32 * 1.25;
    const TS = Math.max(1, Math.min(2.2, pair.km / 8));        // exaggerate structures when the pair is far apart

    const scene = new T.Scene();
    scene.fog = new T.Fog(PAL.fog, R * 1.2, R * 3.6);
    scene.add(new T.HemisphereLight(0xdfe9f2, 0x3b4a44, 0.9));
    const sun = new T.DirectionalLight(0xffffff, 0.75); sun.position.set(30, 50, 20); scene.add(sun);

    // sky dome with a vertical gradient
    const sky = new T.Mesh(new T.SphereGeometry(R * 5, 24, 12), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { top: { value: new T.Color(PAL.skyTop) }, low: { value: new T.Color(PAL.skyLow) } },
      vertexShader: "varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 low; varying float h; void main(){ gl_FragColor = vec4(mix(low, top, clamp(h*1.6,0.0,1.0)), 1.0); }",
    }));
    scene.add(sky);

    // ground
    const gGeo = new T.PlaneGeometry(R * 4, R * 4, 80, 80); gGeo.rotateX(-Math.PI / 2);
    const pos = gGeo.attributes.position;
    const cols = [], cA = new T.Color(PAL.ground), cB = new T.Color(PAL.groundDark), cC = new T.Color(0x7d9a6f), tmp = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, heightAt(x, z));
      const n = 0.5 + 0.5 * Math.sin(x * 0.31 + Math.cos(z * 0.27) * 2) * Math.cos(z * 0.19 - x * 0.07);
      tmp.copy(cA).lerp(n > 0.72 ? cC : cB, n > 0.72 ? (n - 0.72) * 2.5 : (0.72 - n) * 0.9); cols.push(tmp.r, tmp.g, tmp.b);
    }
    gGeo.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
    gGeo.computeVertexNormals();
    scene.add(new T.Mesh(gGeo, lambert(T, 0xffffff, { vertexColors: true })));
    // ponds and pines, placed deterministically, echoing the reference art
    const rnd = (i => () => (i = (i * 16807) % 2147483647) / 2147483647)(7);
    for (let i = 0; i < 5; i++) {
      const x = (rnd() - 0.5) * R * 2.4, z = (rnd() - 0.5) * R * 2.4; if (Math.hypot(x, z) < 10) continue;
      const pond = new T.Mesh(new T.CircleGeometry(3 + rnd() * 4, 9), new T.MeshPhongMaterial({ color: 0x557d77, shininess: 30, flatShading: true }));
      pond.rotation.x = -Math.PI / 2; pond.position.set(x, heightAt(x, z) + 0.08, z); scene.add(pond);
    }
    const pineMat = lambert(T, 0x2f4a3e), trunk = lambert(T, 0x4a3b2e);
    for (let i = 0; i < 160; i++) {
      const x = (rnd() - 0.5) * R * 3, z = (rnd() - 0.5) * R * 3; if (Math.hypot(x, z) < 6) continue;
      const h = 1.2 + rnd() * 1.4, t = new T.Group();
      const c = new T.Mesh(new T.ConeGeometry(h * 0.35, h, 5), pineMat); c.position.y = h / 2 + 0.3; t.add(c);
      const tr = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 0.4, 4), trunk); tr.position.y = 0.2; t.add(tr);
      t.position.set(x, heightAt(x, z), z); scene.add(t);
    }
    const rim = new T.Mesh(new T.CylinderGeometry(R * 2, R * 2.05, 3, 48, 1, true), lambert(T, PAL.rock, { side: T.DoubleSide })); rim.position.y = -1.2; scene.add(rim);
    mountains(T, scene, R);

    const steam = [];
    const place = (p, color) => {
      const kvH = (p.kv >= 500 ? 4.2 : p.kv >= 230 ? 3.2 : 2.4) * TS;
      const g = new T.Group(); scene.add(g);
      // clip long lines to the scene: densify, keep points within the view radius
      let pts = [];
      if (p.coords.length > 1) {
        for (let i = 1; i < p.coords.length; i++) {
          const a = toV(p.coords[i - 1]), b = toV(p.coords[i]), n = Math.max(1, Math.ceil(a.distanceTo(b) / 4));
          for (let k = 0; k <= n; k++) { const v = a.clone().lerp(b, k / n); v.y = heightAt(v.x, v.z); pts.push(v); }
        }
        pts = pts.filter(v => Math.hypot(v.x, v.z) < R * 1.3);
      }
      if (pts.length >= 2) {
        const towers = pts.map(v => { const t = tower(T, kvH, color); t.scale.set(TS, 1, TS); t.position.copy(v); g.add(t); return v; });
        const dir = towers[towers.length - 1].clone().sub(towers[0]).normalize();
        towers.forEach(t => g.children.forEach(ch => { if (ch.position.equals(t)) ch.rotation.y = Math.atan2(dir.x, dir.z); }));
        const side = new T.Vector3(dir.z, 0, -dir.x);
        for (let i = 1; i < towers.length; i++) for (const [o, hh] of [[-1.1, 0.92], [1.1, 0.92], [0, 0.72]]) {
          const a = towers[i - 1].clone().add(side.clone().multiplyScalar(o)), b = towers[i].clone().add(side.clone().multiplyScalar(o));
          g.add(sag(T, a, b, kvH * hh, color));
        }
        return { anchor: pts[Math.floor(pts.length / 2)], top: kvH };
      }
      const v = toV(p.coords[0]);
      const node = p.type === "generation" ? plant(T, 7 * TS, color) : substation(T, (p.kv >= 500 ? 6 : 4.5) * TS, color);
      node.position.copy(v); g.add(node);
      if (node.userData.stacks) node.userData.stacks.forEach(s => steam.push(new T.Vector3(v.x + s[0], v.y + s[1], v.z + s[2])));
      return { anchor: v, top: (p.type === "generation" ? 6 : 3) * TS };
    };
    const A = place(pair.p, opts.colorA), B = place(pair.q, opts.colorB);

    // closest-point link
    const va = toV(pair.ca), vb = toV(pair.cb), lift = 0.25;
    va.y += lift; vb.y += lift;
    const tierHex = new T.Color(opts.tierColor).getHex();
    if (pair.km > 0.1) {
      const link = new T.Line(new T.BufferGeometry().setFromPoints([va, vb]), new T.LineDashedMaterial({ color: tierHex, dashSize: 0.8, gapSize: 0.5 }));
      link.computeLineDistances(); scene.add(link);
      [va, vb].forEach(v => { const m = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 0.2, 12), new T.MeshBasicMaterial({ color: tierHex })); m.position.copy(v); scene.add(m); });
    }
    const mid = va.clone().lerp(vb, 0.5);
    const labels = [
      makeLabel(T, opts.distText, opts.tierColor, new T.Vector3(mid.x, mid.y + 2.5 * TS, mid.z), "big"),
      makeLabel(T, opts.nameA, opts.colorA, new T.Vector3(A.anchor.x, A.anchor.y + A.top + 1.5, A.anchor.z)),
      makeLabel(T, opts.nameB, opts.colorB, new T.Vector3(B.anchor.x, B.anchor.y + B.top + 1.5, B.anchor.z)),
    ];

    // what the tier lets the two utilities share
    const pulse = [];
    if (pair.tier === 0) {
      const ring = new T.Mesh(new T.TorusGeometry(2.2, 0.14, 6, 32), new T.MeshBasicMaterial({ color: tierHex })); ring.rotation.x = Math.PI / 2; ring.position.copy(mid); scene.add(ring); pulse.push(ring);
    }
    if (pair.tier <= 1) {
      const len = Math.max(8, va.distanceTo(vb) + 6), corr = new T.Mesh(new T.PlaneGeometry(3.6, len), new T.MeshBasicMaterial({ color: tierHex, transparent: true, opacity: 0.22, depthWrite: false }));
      corr.rotation.x = -Math.PI / 2; corr.rotation.z = -Math.atan2(vb.x - va.x, vb.z - va.z); corr.position.set(mid.x, mid.y + 0.05, mid.z); scene.add(corr);
      labels.push(makeLabel(T, "Shared right-of-way and access road", opts.tierColor, new T.Vector3(mid.x + 3, mid.y + 0.5, mid.z + 3), "small"));
    } else if (pair.tier <= 3) {
      const y = yard(T, 6.5, 4.2, pair.tier === 2 ? "Shared laydown yard" : "Shared crew staging yard");
      const off = new T.Vector3(vb.z - va.z, 0, -(vb.x - va.x)).normalize().multiplyScalar(5);
      y.scale.setScalar(TS); y.position.set(mid.x + off.x, heightAt(mid.x + off.x, mid.z + off.z), mid.z + off.z); scene.add(y);
      labels.push(makeLabel(T, y.userData.label, "#d9a441", new T.Vector3(y.position.x, y.position.y + 4.5 * TS, y.position.z), "small"));
    }

    // steam puffs over plant stacks
    const puffs = [];
    steam.forEach(s => { for (let i = 0; i < 7; i++) { const m = new T.Mesh(new T.IcosahedronGeometry(0.6 + i * 0.15, 0), new T.MeshPhongMaterial({ color: PAL.steam, transparent: true, opacity: 0.8, flatShading: true, shininess: 0 })); m.userData = { base: s, t: i / 7 }; scene.add(m); puffs.push(m); } });

    return { scene, puffs, pulse, labels, focus: mid, span: Math.max(12, va.distanceTo(vb)) };
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
      const renderer = new T.WebGLRenderer({ antialias: false });
      renderer.setClearColor(PAL.fog);
      stage.innerHTML = ""; stage.appendChild(renderer.domElement);
      const overlay = document.createElement("div"); overlay.className = "m3d-labels"; stage.appendChild(overlay);
      const tags = built.labels.map(l => { const el = document.createElement("span"); el.className = "m3d-tag " + l.size; el.style.setProperty("--c", l.color); el.textContent = l.text; overlay.appendChild(el); return { el, pos: l.pos }; });
      const v = new T.Vector3();
      const placeTags = () => { const w = stage.clientWidth, h = stage.clientHeight; tags.forEach(t => { v.copy(t.pos).project(cam); const off = v.z > 1; t.el.style.display = off ? "none" : ""; t.el.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, -100%)`; }); };
      const cam = new T.PerspectiveCamera(45, 1, 0.5, 2000);
      const f = built.focus, d = built.span * 1.6 + 14;
      cam.position.set(f.x + d * 0.75, f.y + d * 0.55, f.z + d * 0.85);
      const controls = new T.OrbitControls(cam, renderer.domElement);
      controls.target.copy(f); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 6; controls.maxDistance = 140;
      controls.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches; controls.autoRotateSpeed = 0.6;
      controls.addEventListener("start", () => { controls.autoRotate = false; });
      const size = () => {
        const w = stage.clientWidth, h = stage.clientHeight, px = document.getElementById("m3dPixel").checked ? 3 : 1;
        renderer.setPixelRatio(px === 1 ? Math.min(2, devicePixelRatio) : 1);
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
        built.puffs.forEach(p => { const k = (p.userData.t + t * 0.12) % 1; p.position.set(p.userData.base.x + Math.sin(k * 6 + p.userData.t * 9) * k * 1.2, p.userData.base.y + k * 7, p.userData.base.z + k * 1.5); p.scale.setScalar(0.6 + k * 1.8); p.material.opacity = 0.85 * (1 - k); });
        built.pulse.forEach(r => r.scale.setScalar(1 + 0.25 * Math.sin(t * 3)));
        controls.update(); renderer.render(built.scene, cam); placeTags(); raf = requestAnimationFrame(loop);
      };
      loop();
      msg.hidden = true;
      const onResize = () => size();
      addEventListener("resize", onResize);
      document.getElementById("m3dPixel").onchange = size;
      ctx = { stop: () => { cancelAnimationFrame(raf); removeEventListener("resize", onResize); controls.dispose(); renderer.dispose(); built.scene.traverse(o => { o.geometry && o.geometry.dispose(); }); } };
    }).catch(err => { msg.hidden = false; msg.textContent = "The 3D view needs an internet connection to load three.js. " + err.message; });
  }
  function close(keepOpen) {
    if (ctx) { ctx.stop(); ctx = null; }
    if (!keepOpen) { document.getElementById("m3d").hidden = true; document.getElementById("m3dStage").innerHTML = ""; }
  }
  root.Scene3D = { open, close };
})(this);
