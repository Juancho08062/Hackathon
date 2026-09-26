// Seamline 3D, Ultra-realistic look pass: moves the built pair scene closer to a photo of the site.
// Called by scene3d.js after an Ultra-realistic scene is built and before its colors are linearized (so every color
// here is sRGB hex). detail() projects a procedural texture in world space (triplanar), so merged and instanced
// geometry without UVs still shows grain, roughness variation and bump.
//  - Ground: vertex colors repainted from slope, height and noise (olive grass, dry patches, red Piedmont clay on
//    slopes, dark mud on river banks) with two scales of grass detail so it doesn't visibly tile.
//  - Vegetation: the same trees with irregular (noise displaced) crowns, leaf and bark detail and deeper greens.
//  - Crews: workers with jeans, boots, hi-vis vests with reflective bands, arms and hard hats.
//  - Light: hazier Southeast sky, stronger sun, image-based fill from the sky, and a filmic color grade.
// Nothing is loaded from the network: all textures are drawn on canvases once and cached.
(function (root) {
  // ---------- tileable procedural textures ----------
  const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  // value noise on a lattice that repeats every p cells, so the texture tiles
  const vnoise = (x, y, p, s) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const m = k => ((k % p) + p) % p, a = hash(m(i), m(j), s), b = hash(m(i + 1), m(j), s), c = hash(m(i), m(j + 1), s), d = hash(m(i + 1), m(j + 1), s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, p, s, oct = 4) => { let t = 0, amp = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { t += amp * vnoise(x * f, y * f, p * f, s + o); n += amp; amp *= 0.5; f *= 2; } return t / n; };

  // Build a texture from f(u, v) -> [r, g, b] in 0..1, then rescale so its mean brightness is 0.5 (the shader
  // multiplies surfaces by 0.5 + texel, so the material color stays the average color).
  const cache = {};
  function tex(T, key, N, f, pre) {
    if (cache[key]) return cache[key];
    const c = document.createElement("canvas"); c.width = c.height = N;
    const g = c.getContext("2d");
    if (pre) pre(g, N);
    const img = g.getImageData(0, 0, N, N), d = img.data;
    let sum = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4, base = pre ? [d[o] / 255, d[o + 1] / 255, d[o + 2] / 255] : null;
      const [r, gg, b] = f(x / N, y / N, base);
      d[o] = r * 255; d[o + 1] = gg * 255; d[o + 2] = b * 255; d[o + 3] = 255; sum += (r + gg + b) / 3;
    }
    const k = 0.5 / Math.max(0.05, sum / (N * N));
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8;
    return (cache[key] = t);
  }
  const TEX = {
    // galvanized steel: spangle patches, fine grain and a few dull weathering stains
    metal: T => tex(T, "metal", 256, (u, v) => { const s = 0.62 + 0.18 * vnoise(u * 18, v * 18, 18, 1) + 0.1 * vnoise(u * 64, v * 64, 64, 2) - 0.2 * Math.max(0, fbm(u * 4, v * 4, 4, 3) - 0.55); return [s, s, s * 1.01]; }),
    // painted steel: faint orange peel
    paint: T => tex(T, "paint", 128, (u, v) => { const s = 0.8 + 0.08 * vnoise(u * 32, v * 32, 32, 4) + 0.06 * fbm(u * 4, v * 4, 4, 5); return [s, s, s]; }),
    // cast concrete: blotches, pits and faint form lines
    concrete: T => tex(T, "concrete", 256, (u, v) => {
      let s = 0.62 + 0.22 * fbm(u * 6, v * 6, 6, 6, 5) + 0.08 * vnoise(u * 90, v * 90, 90, 7);
      if (hash(Math.floor(u * 180), Math.floor(v * 180), 8) > 0.985) s -= 0.25;
      if (Math.abs(((v * 4) % 1) - 0.5) > 0.49) s -= 0.08;
      return [s, s * 0.99, s * 0.96];
    }),
    // weathered concrete shell (cooling towers, stacks): vertical rain streaks
    streak: T => tex(T, "streak", 256, (u, v) => { const s = 0.6 + 0.16 * fbm(u * 5, v * 5, 5, 9) - 0.2 * Math.pow(vnoise(u * 48, v * 1.5, 48, 10), 3) + 0.05 * vnoise(u * 96, v * 96, 96, 11); return [s, s * 0.98, s * 0.95]; }),
    // crushed stone: Voronoi stones with per-stone tone and dark gaps between them
    gravel: T => tex(T, "gravel", 512, (u, v) => {
      const G = 56, x = u * G, y = v * G, i = Math.floor(x), j = Math.floor(y);
      let d1 = 9, d2 = 9, id = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ci = ((i + a) % G + G) % G, cj = ((j + b) % G + G) % G, px = i + a + hash(ci, cj, 12), py = j + b + hash(ci, cj, 13), d = Math.hypot(x - px, y - py);
        if (d < d1) { d2 = d1; d1 = d; id = hash(ci, cj, 14); } else if (d < d2) d2 = d;
      }
      const edge = Math.min(1, (d2 - d1) * 5), s = (0.45 + 0.45 * id) * (0.35 + 0.65 * edge) * (0.85 + 0.3 * vnoise(u * 256, v * 256, 256, 15));
      const warm = id > 0.8 ? 1.06 : 1;
      return [s * warm, s, s * (2 - warm)];
    }),
    // soil and clay: clods and small pebbles
    soil: T => tex(T, "soil", 256, (u, v) => { let s = 0.55 + 0.25 * fbm(u * 8, v * 8, 8, 16, 5); if (hash(Math.floor(u * 128), Math.floor(v * 128), 17) > 0.97) s += 0.2; return [s, s * 0.97, s * 0.92]; }),
    rock: T => tex(T, "rock", 256, (u, v) => { const n = fbm(u * 6, v * 6, 6, 18, 5), crack = Math.abs(vnoise(u * 12, v * 12, 12, 19) - 0.5) < 0.02 ? -0.25 : 0; const s = 0.5 + 0.35 * n + crack; return [s, s, s * 0.98]; }),
    // bark: vertical furrows
    bark: T => tex(T, "bark", 128, (u, v) => { const s = 0.35 + 0.5 * Math.pow(vnoise(u * 14, v * 3, 14, 20), 0.7) + 0.1 * vnoise(u * 64, v * 64, 64, 21); return [s, s * 0.95, s * 0.9]; }),
    // metal siding: vertical ribs
    siding: T => tex(T, "siding", 128, (u, v) => { const r = (u * 16) % 1, s = (r < 0.18 ? 0.6 : r < 0.25 ? 0.95 : 0.8) + 0.06 * fbm(u * 4, v * 4, 4, 22); return [s, s, s]; }),
    // grass: drawn blades over a mottled base, with a little hue variation
    grass: T => tex(T, "grass", 512, (u, v, b) => { const n = fbm(u * 8, v * 8, 8, 23); return [b[0] * (0.9 + 0.2 * n), b[1], b[2] * (1.1 - 0.2 * n)]; }, (g, N) => {
      g.fillStyle = "#8a8a8a"; g.fillRect(0, 0, N, N);
      let s = 1; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 26000; i++) {
        const x = r() * N, y = r() * N, l = 3 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 1.1, v = 70 + r() * 150 | 0;
        g.strokeStyle = `rgb(${v * 0.95 | 0},${v},${v * 0.8 | 0})`; g.lineWidth = 0.7 + r() * 0.9;
        for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); }
      }
    }),
    // foliage: overlapping leaves and needle clumps in several tones, with dark gaps
    foliage: T => tex(T, "foliage", 256, (u, v, b) => b, (g, N) => {
      g.fillStyle = "#262626"; g.fillRect(0, 0, N, N);
      let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 5200; i++) {
        const x = r() * N, y = r() * N, v = 60 + r() * 170 | 0;
        g.fillStyle = `rgb(${v * 0.92 | 0},${v},${v * 0.75 | 0})`;
        for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) { g.beginPath(); g.ellipse(x + ox, y + oy, 1.5 + r() * 3, 0.8 + r() * 1.4, r() * 3.14, 0, 7); g.fill(); }
      }
    }),
  };

  // ---------- world-space (triplanar) detail on any standard material ----------
  // tri: { map, scale (repeats per scene unit), amt (albedo contrast 0..1), rough (roughness swing), bump, macro (second
  // larger scale mixed in, for big surfaces) }
  function detail(m, tri) {
    m.userData.tri = tri;
    m.extensions = Object.assign(m.extensions || {}, { derivatives: true });
    m.customProgramCacheKey = () => "tri" + (tri.macro ? "M" : "");
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { triMap: { value: tri.map }, triScale: { value: tri.scale }, triAmt: { value: tri.amt ?? 0.6 }, triRough: { value: tri.rough ?? 0.3 }, triBump: { value: tri.bump ?? 0 } });
      sh.vertexShader = "varying vec3 vTriP;\nvarying vec3 vTriN;\n" + sh.vertexShader.replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
        vec4 triP = vec4(transformed, 1.0); vec3 triN = objectNormal;
        #ifdef USE_INSTANCING
          triP = instanceMatrix * triP; triN = mat3(instanceMatrix) * triN;
        #endif
        vTriP = (modelMatrix * triP).xyz; vTriN = normalize(mat3(modelMatrix) * triN);`);
      sh.fragmentShader = `uniform sampler2D triMap; uniform float triScale, triAmt, triRough, triBump;
        varying vec3 vTriP; varying vec3 vTriN;
        vec3 triAt(float k) {
          vec3 w = pow(abs(normalize(vTriN)), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec3 p = vTriP * triScale * k;
          return texture2D(triMap, p.yz).rgb * w.x + texture2D(triMap, p.xz).rgb * w.y + texture2D(triMap, p.xy).rgb * w.z;
        }
        vec3 triBend(vec3 pos, vec3 n, vec2 dH) {
          vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, n), r2 = cross(n, sx);
          float det = dot(sx, r1);
          return normalize(abs(det) * n - sign(det) * (dH.x * r1 + dH.y * r2));
        }
        ` + sh.fragmentShader
        .replace("#include <map_fragment>", `#include <map_fragment>
          vec3 triT = triAt(1.0);
          ${tri.macro ? "triT = triT * 0.6 + triAt(" + tri.macro.toFixed(3) + ") * 0.4;" : ""}
          diffuseColor.rgb *= mix(vec3(1.0), 0.5 + triT, triAmt);`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor + (0.5 - triT.g) * triRough, 0.03, 1.0);`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          float triH = dot(triT, vec3(0.3333));
          normal = triBend(-vViewPosition, normal, vec2(dFdx(triH), dFdy(triH)) * triBump);`);
    };
    return m;
  }
  // A physically based material: color is sRGB hex; kind picks the detail texture and its scale.
  function mat(T, color, o = {}) {
    const M = o.clear ? T.MeshPhysicalMaterial : T.MeshStandardMaterial;
    const m = new M({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, envMapIntensity: 0.95, side: o.side || T.FrontSide, vertexColors: !!o.vc });
    if (o.clear) { m.clearcoat = o.clear; m.clearcoatRoughness = 0.08; }
    if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
    if (o.kind) detail(m, { map: TEX[o.kind](T), scale: o.scale ?? 2, amt: o.amt, rough: o.rv, bump: o.bump, macro: o.macro });
    return m;
  }

  // ---------- geometry helpers (same conventions as scene3d.js) ----------
  function merge(T, geos) {
    const parts = geos.map(g => { g = g.index ? g.toNonIndexed() : g; if (!g.attributes.normal) g.computeVertexNormals(); return g; });
    const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    parts.forEach(g => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; });
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.BufferAttribute(pos, 3)); out.setAttribute("normal", new T.BufferAttribute(nor, 3));
    return out;
  }
  const box = (T, w, h, d, x, y, z) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const cyl = (T, r1, r2, h, seg, x, y, z) => { const g = new T.CylinderGeometry(r1, r2, h, seg); g.translate(x, y, z); return g; };
  const mesh = (T, geo, m, cast = true) => { const x = new T.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = true; return x; };

  // ---------- people ----------
  // Workers at the given ground spots: work boots, jeans, fluorescent vest with reflective bands, arms, hard hat.
  function crew(T, spots) {
    const L = { boots: [], jeans: [], shirt: [], vest: [], band: [], skin: [], hat: [] };
    spots.forEach(([x, z, yaw]) => {
      const part = (list, g) => { g.rotateY(yaw); g.translate(x, 0, z); list.push(g); };
      for (const s of [-1, 1]) {
        part(L.boots, box(T, 0.06, 0.035, 0.09, s * 0.042, 0.018, 0.012));
        part(L.jeans, cyl(T, 0.03, 0.026, 0.2, 7, s * 0.042, 0.135, 0));
        const arm = cyl(T, 0.022, 0.02, 0.17, 6, 0, -0.085, 0); arm.rotateZ(s * 0.12); arm.translate(s * 0.115, 0.4, 0); part(L.shirt, arm);
        part(L.skin, new T.SphereGeometry(0.022, 6, 4).translate(s * 0.126, 0.305, 0));
      }
      part(L.jeans, box(T, 0.13, 0.06, 0.08, 0, 0.245, 0));
      const torso = cyl(T, 0.07, 0.062, 0.18, 10, 0, 0.35, 0); torso.scale(1, 1, 0.68); part(L.vest, torso);
      for (const y of [0.3, 0.37]) { const b = cyl(T, 0.072, 0.072, 0.016, 10, 0, y, 0); b.scale(1, 1, 0.69); part(L.band, b); }
      part(L.skin, cyl(T, 0.022, 0.024, 0.03, 6, 0, 0.45, 0));
      part(L.skin, new T.SphereGeometry(0.05, 12, 9).scale(0.9, 1.08, 0.95).translate(0, 0.5, 0));
      part(L.hat, new T.SphereGeometry(0.056, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.52, 0));
      part(L.hat, cyl(T, 0.074, 0.074, 0.008, 16, 0, 0.522, 0.01));
    });
    const g = new T.Group();
    const M = { boots: [0x3b2a1c, 0.8], jeans: [0x2e3b52, 0.9], shirt: [0x6d7a86, 0.85], vest: [0xc9e21e, 0.6], band: [0xd7dadc, 0.25], skin: [0xa87556, 0.6], hat: [0xf4f4f0, 0.25] };
    Object.keys(L).forEach(k => {
      if (!L[k].length) return;
      const m = mat(T, M[k][0], { rough: M[k][1], kind: k === "jeans" || k === "shirt" || k === "vest" ? "paint" : undefined, scale: 30, amt: 0.3, clear: k === "hat" ? 0.4 : 0 });
      if (k === "vest") { m.emissive = new T.Color(0x4a5200); m.emissiveIntensity = 0.35; } // fluorescent dye reads brighter than its albedo
      if (k === "band") m.metalness = 0.6;
      g.add(mesh(T, merge(T, L[k]), m));
    });
    return g;
  }

  // Irregular silhouettes: push each vertex of a foliage or rock shape in or out by noise. Vertices at the same
  // position move together, so the surface stays closed.
  function roughen(T, geo, amp, seed) {
    const g = geo.clone(), p = g.attributes.position, v = new T.Vector3(), c = new T.Vector3(), moved = new Map();
    g.computeBoundingBox(); g.boundingBox.getCenter(c);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = v.x.toFixed(3) + "," + v.y.toFixed(3) + "," + v.z.toFixed(3);
      if (!moved.has(k)) {
        const d = v.clone().sub(c).normalize(), n = vnoise(v.x * 3.1 + 7, v.y * 3.1 + v.z * 2.3, 1e6, seed) - 0.5, n2 = vnoise(v.x * 9 + 1, v.z * 9 + v.y * 5, 1e6, seed + 1) - 0.5;
        moved.set(k, v.clone().addScaledVector(d, amp * (n * 0.7 + n2 * 0.45)));
      }
      const m = moved.get(k); p.setXYZ(i, m.x, m.y, m.z);
    }
    g.computeVertexNormals();
    return g;
  }

  // ---------- the pass over the built scene ----------
  // ctx: { PAL, ground, walls, dem }. Sun, sky, hemisphere light and crews are found in the scene.
  function enhance(T, scene, ctx) {
    const { PAL } = ctx, hex = m => m && m.color && m.color.getHex(), box3 = new T.Box3(), t = new T.Color(), h = {};
    const veg = [], crews = new Set();
    let sun = null, sky = null, hemi = null;
    scene.traverse(o => {
      if (o.isDirectionalLight) sun = o;
      if (o.isHemisphereLight) hemi = o;
      if (o.material && o.material.uniforms && o.material.uniforms.turbidity) sky = o;
      if (o.isInstancedMesh && (o.instanceColor || hex(o.material) === PAL.trunk)) veg.push(o);
      if (o.isMesh && !o.isInstancedMesh && hex(o.material) === 0xf2c230 && o.parent) crews.add(o.parent);
    });

    // ground: realistic colors from slope, height and noise; grass detail at two scales so it doesn't tile
    const g = ctx.ground.geometry, P = g.attributes.position, N = g.attributes.normal, col = g.attributes.color;
    const C = { grass: new T.Color(0x56682f), lush: new T.Color(0x3d5124), dry: new T.Color(0x857c48), clay: new T.Color(0x8a5a3a), mud: new T.Color(0x453f31), forest: new T.Color(0x2f3f20) };
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), slope = 1 - N.getY(i);
      const n1 = fbm(x * 0.05 + 50, z * 0.05 + 50, 1e6, 40, 4), n2 = fbm(x * 0.22, z * 0.22, 1e6, 41, 3);
      t.copy(C.grass).lerp(C.lush, Math.max(0, n1 - 0.45) * 2.2).lerp(C.dry, Math.max(0, 0.42 - n1) * 2.4 + Math.max(0, n2 - 0.7) * 1.5);
      t.lerp(C.forest, Math.max(0, n2 - 0.55) * 0.9);
      t.lerp(C.clay, Math.min(1, Math.max(0, slope - 0.12) * 5));
      if (ctx.dem && y < 0.25) t.lerp(C.mud, 0.7 * (1 - Math.max(0, y) / 0.25));
      col.setXYZ(i, t.r, t.g, t.b);
    }
    col.needsUpdate = true;
    ctx.ground.material = mat(T, 0xffffff, { vc: true, rough: 0.97, kind: "grass", scale: 1.1, amt: 0.55, rv: 0.1, bump: 0.9, macro: 0.19 });
    ctx.walls.material = mat(T, 0xffffff, { vc: true, rough: 1, kind: "soil", scale: 0.9, amt: 0.6, bump: 0.8, side: T.DoubleSide });

    // vegetation: same trees at the same spots, with irregular crowns, leaf and bark detail and deeper summer greens
    const bark = mat(T, 0x5a4636, { rough: 0.95, kind: "bark", scale: 9, amt: 0.8, bump: 0.8 });
    const leaves = mat(T, 0xffffff, { rough: 0.85, kind: "foliage", scale: 3.2, amt: 0.9, rv: 0.2, bump: 1.2 });
    const rock = mat(T, 0xffffff, { rough: 0.85, kind: "rock", scale: 3, amt: 0.8, bump: 0.8 });
    const blades = mat(T, 0xffffff, { rough: 0.9, side: T.DoubleSide });
    const shapes = new Map(); let seed = 100;
    const shape = (geo, amp) => { if (!shapes.has(geo)) shapes.set(geo, roughen(T, geo, amp, seed += 7)); return shapes.get(geo); };
    veg.forEach(im => {
      if (!im.instanceColor) { im.material = bark; return; }
      box3.setFromBufferAttribute(im.geometry.attributes.position);
      const top = box3.max.y, a = im.instanceColor.array;
      t.fromArray(a, 0); t.getHSL(h);
      const isRock = h.s < 0.15, isTuft = top < 0.4;
      if (!isTuft) im.geometry = shape(im.geometry, isRock ? 0.12 : 0.22);
      im.material = isRock ? rock : isTuft ? blades : leaves;
      // deeper, less saturated greens than the stylized palette (rocks keep their gray)
      if (!isRock) for (let i = 0; i < im.count * 3; i += 3) { t.fromArray(a, i); t.getHSL(h); t.setHSL(h.h * 0.97 + 0.004, h.s * 0.72, h.l * (isTuft ? 0.78 : 0.68)); t.toArray(a, i); }
      im.instanceColor.needsUpdate = true;
    });

    // workers: rebuild each crew at the same spots from its head positions
    crews.forEach(cg => {
      const heads = cg.children.find(ch => hex(ch.material) === 0xc99a74);
      if (!heads) return;
      const per = new T.SphereGeometry(0.06, 6, 4).toNonIndexed().attributes.position.count, A = heads.geometry.attributes.position, spots = [];
      for (let s = 0; s + per <= A.count; s += per) { let x = 0, z = 0; for (let k = 0; k < per; k++) { x += A.getX(s + k); z += A.getZ(s + k); } spots.push([x / per, z / per, hash(s, 3, 99) * 6.28]); }
      cg.children.slice().forEach(ch => { ch.visible = false; });
      cg.add(crew(T, spots));
    });

    // light and air: humid Southeast haze, a strong late-morning sun, sky light doing the fill
    if (sky) { const u = sky.material.uniforms; u.turbidity.value = 6.5; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.86; }
    if (sun) { sun.intensity = 3.3; sun.color.setHex(0xfff0dc); }
    if (hemi) hemi.intensity = 0.08;
    scene.fog.color.setHex(0xb9c6cf); scene.fog.density = 0.0042;
  }

  // Color grade after tone mapping: a gentle filmic S-curve, slightly lower saturation, a touch of warmth and a soft
  // vignette. Runs in display space (after gamma), in the canvas itself (no CSS over the canvas).
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, amount: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv); vec3 x = c.rgb;
        vec3 s = x * x * (3.0 - 2.0 * x); x = mix(x, s, 0.22);
        float l = dot(x, vec3(0.2126, 0.7152, 0.0722)); x = mix(vec3(l), x, 0.93);
        x *= vec3(1.02, 1.0, 0.975);
        vec2 d = vUv - 0.5; x *= 1.0 - 0.28 * dot(d, d) * 1.6;
        gl_FragColor = vec4(mix(c.rgb, x, amount), c.a);
      }`,
  };
  // Post settings for this mode: called by scene3d.js's open() right after its gamma pass.
  function post(T, composer, tone, bloom) {
    tone.uniforms.exposure.value = 0.66;
    if (bloom) bloom.strength = 0.06;
    composer.addPass(new T.ShaderPass(GradeShader));
  }

  root.Realism3D = { enhance, post, crew, detail, mat };
})(this);
