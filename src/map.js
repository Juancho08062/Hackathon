// Nexxo map: MapLibre GL with a plain offline basemap (state and county outlines from data/basemap.json), raster
// basemaps (light streets, satellite, topographic) and a 3D mode that drapes everything over real terrain (AWS
// Terrarium elevation tiles) and raises a tower every few hundred metres along each planned line.
// The app hands it plain lists (projects, links, rings, yards) already styled; this file only turns them into layers.
(function (root) {
  // Honour prefers-reduced-motion for the camera too: the CSS rule only covers transitions, and a 900 ms pitching,
  // panning map fires on every row click. scene3d.js already checks this; the map did not.
  const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dur = ms => REDUCED ? 0 : ms;
  const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  const RASTERS = {
    satellite: { label: "Satellite", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], attr: "Imagery © Esri, Maxar, Earthstar Geographics", max: 19 },
    topo: { label: "Topo", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"], attr: "© Esri, HERE, Garmin, USGS", max: 19 },
  };
  // Relief is drawn here from the elevation tiles: colour by height (hypsometric tint) under a hillshade.
  const BASEMAPS = Object.assign({ plain: { label: "Plain" }, relief: { label: "Relief" } }, RASTERS);
  // Elevation colours for the Southeast (m): coastal plain greens, the Fall Line and Piedmont tans, mountains browns.
  const RELIEF = ["interpolate", ["linear"], ["elevation"], -10, "#C9DEE8", 0, "#D8E8D2", 30, "#CFE2C0", 80, "#DDE3B7", 150, "#E6DDAF", 250, "#DDC89E", 400, "#CDB08A", 700, "#B8977A", 1100, "#A58E80", 1800, "#E8E4E0"];
  const SKY = { "sky-color": "#9CC3E0", "horizon-color": "#DDE8EE", "fog-color": "#E6EDF1", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.25, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 12, 0.2] };
  // Typical structure heights by voltage (m), drawn 2.5× taller than life, on a slim base, so they read from a
  // few kilometres up; the spacing (about 450 m) is to scale.
  const TOWER_M = kv => (kv >= 500 ? 55 : kv >= 230 ? 40 : kv >= 115 ? 28 : 18) * 2.5;
  const PLACES = [["Augusta", 33.47, -81.97], ["Savannah", 32.08, -81.09], ["Atlanta", 33.75, -84.39], ["Columbia", 34.0, -81.03], ["Charleston", 32.78, -79.93],
    ["Macon", 32.84, -83.63], ["Thomson", 33.47, -82.5], ["Beaufort", 32.43, -80.67], ["Aiken", 33.56, -81.72], ["Hardeeville", 32.28, -81.08], ["Waynesboro", 33.09, -82.02]];

  const ll = c => [c[1], c[0]];
  const fc = features => ({ type: "FeatureCollection", features });
  const circle = (c, km, n = 72) => {
    const [lat, lon] = c, out = [];
    for (let i = 0; i <= n; i++) {
      const a = 2 * Math.PI * i / n;
      out.push([lon + km * Math.cos(a) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + km * Math.sin(a) / 110.57]);
    }
    return { type: "Polygon", coordinates: [out] };
  };
  const square = (lon, lat, m) => {
    const dx = m / 2 / (111320 * Math.cos(lat * Math.PI / 180)), dy = m / 2 / 110570;
    return { type: "Polygon", coordinates: [[[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]]] };
  };

  // A distance in miles and km, and the great-circle distance between two [lat, lon] points.
  const miKm = d => { const f = v => v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString(); return `${f(d / 1.609344)} mi · ${f(d)} km`; };
  const gcKm = ([a, b], [c, d]) => { const r = Math.PI / 180, h = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  // HTML labels (no font server needed): one per call, reused while the same list is shown.
  const tag = (cls, text, at) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; return new root.maplibregl.Marker({ element: d, offset: [0, -12] }).setLngLat(ll(at)).addTo(map); };

  let gapMarkers = [], gapKey = "", measuring = false, mpts = [], mMarkers = [], mRead = null;
  let map = null, cbs = {}, is3d = false, basemap = "plain", placeMarkers = [], lastData = null, tileErrors = 0, colors = {};

  function style(base) {
    const sources = {
      states: { type: "geojson", data: fc(base.states.map(s => ({ type: "Feature", properties: { n: s.n }, geometry: s.g }))) },
      counties: { type: "geojson", data: fc(base.counties.map(s => ({ type: "Feature", properties: {}, geometry: s.g }))) },
      dem: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium", attribution: "Elevation: Mapzen Terrain Tiles on AWS (USGS 3DEP)" },
      shade: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium" },
    };
    for (const [k, r] of Object.entries(RASTERS)) sources["r-" + k] = { type: "raster", tiles: r.tiles, tileSize: 256, maxzoom: r.max, attribution: r.attr };
    // today's grid from OpenStreetMap (data/grid.json, loaded on demand; missing when the page is opened as a file)
    sources.grid = { type: "geojson", data: "data/grid.json", attribution: "Grid © OpenStreetMap contributors" };
    for (const k of ["measure", "seam", "existing", "yardring", "spokes", "links", "projects", "points", "towers", "rings", "yards", "sparks"]) sources[k] = { type: "geojson", data: fc([]) };
    const vis = v => ({ visibility: v ? "visible" : "none" });
    return {
      version: 8, sources,
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#E9EEF1" } },
        ...Object.keys(RASTERS).map(k => ({ id: "r-" + k, type: "raster", source: "r-" + k, layout: vis(false), paint: { "raster-fade-duration": 150 } })),
        { id: "states-fill", type: "fill", source: "states", paint: { "fill-color": "#F4F4F1" } },
        { id: "counties", type: "line", source: "counties", paint: { "line-color": "#E2E4E0", "line-width": 0.6 } },
        { id: "states-line", type: "line", source: "states", paint: { "line-color": "#AEB6BC", "line-width": 1 } },
        { id: "relief", type: "color-relief", source: "shade", layout: vis(false), paint: { "color-relief-color": RELIEF, "color-relief-opacity": 1 } },
        { id: "hillshade", type: "hillshade", source: "shade", layout: vis(false), paint: { "hillshade-method": "multidirectional", "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#3F4A52", "hillshade-highlight-color": "#FFFFFF" } },
        // existing lines by voltage, kept quiet under the plans: grey 115, violet 161, magenta 230, teal 500 kV
        { id: "grid", type: "line", source: "grid", layout: { "line-join": "round" }, paint: {
          "line-color": ["step", ["get", "kv"], "#8E9AA6", 161, "#8E7CB8", 230, "#A05BA8", 500, "#0097A7"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, ["step", ["get", "kv"], 0.5, 230, 0.8, 500, 1.2], 12, ["step", ["get", "kv"], 1.2, 230, 1.8, 500, 2.6]],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.35, 11, 0.6] } },
        { id: "seam", type: "line", source: "seam", paint: { "line-color": "#8FB6CC", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.5, 11, 6], "line-opacity": 0.9 } },
        { id: "yardring-fill", type: "fill", source: "yardring", paint: { "fill-color": "#8A5A1E", "fill-opacity": 0.025 } },
        { id: "yardring", type: "line", source: "yardring", paint: { "line-color": "#8A5A1E", "line-width": 1.2, "line-dasharray": [3, 2] } },
        { id: "existing", type: "line", source: "existing", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#9AA3AB", "line-width": 1.6, "line-opacity": 0.8 } },
        { id: "existing-pt", type: "circle", source: "existing", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#FFFFFF", "circle-stroke-color": "#7C8790", "circle-stroke-width": 1.5 } },
        { id: "spokes", type: "line", source: "spokes", paint: { "line-color": "#57606A", "line-width": 1, "line-dasharray": [1, 2] } },
        { id: "links", type: "line", source: "links", paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": ["get", "opacity"], "line-dasharray": [2, 2] } },
        { id: "casing", type: "line", source: "projects", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "casing"], "line-width": ["+", ["get", "width"], 2.5], "line-opacity": ["get", "opacity"] } },
        { id: "proj", type: "line", source: "projects", filter: ["!", ["get", "dash"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": ["get", "opacity"] } },
        { id: "proj-dash", type: "line", source: "projects", filter: ["get", "dash"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": ["get", "opacity"], "line-dasharray": [2.2, 1.4] } },
        { id: "towers", type: "fill-extrusion", source: "towers", layout: vis(false), paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92 } },
        { id: "points", type: "circle", source: "points", paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "fill"], "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2, "circle-opacity": ["get", "opacity"], "circle-stroke-opacity": ["get", "opacity"] } },
        { id: "rings", type: "circle", source: "rings", paint: { "circle-radius": ["get", "r"], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "color"], "circle-stroke-width": ["get", "w"], "circle-stroke-opacity": ["get", "opacity"] } },
        { id: "sparks", type: "circle", source: "sparks", paint: { "circle-radius": 12, "circle-color": ["get", "color"], "circle-opacity": 0.22, "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } },
        { id: "measure-halo", type: "line", source: "measure", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#FFFFFF", "line-width": 5 } },
        { id: "measure-line", type: "line", source: "measure", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#B0183D", "line-width": 2.5, "line-dasharray": [2, 1.5] } },
        { id: "measure-pt", type: "circle", source: "measure", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#FFFFFF", "circle-stroke-color": "#B0183D", "circle-stroke-width": 2 } },
        { id: "yards", type: "circle", source: "yards", paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "fill"], "circle-stroke-color": "#57606A", "circle-stroke-width": 1.5 } },
      ],
    };
  }

  function init(el, base, callbacks) {
    cbs = callbacks || {};
    map = new root.maplibregl.Map({
      container: el, style: style(base), center: [-81.6, 33.0], zoom: 6.4, minZoom: 4, maxZoom: 16, maxPitch: 75,
      attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: true, fadeDuration: 0,
    });
    // Corner controls like a web map, bottom right: recenter and a distance ruler, then zoom and compass, then scale
    // bars in miles and km.
    const btn = (title, svg, fn) => { const b = document.createElement("button"); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = svg; b.onclick = fn; return b; };
    const tools = document.createElement("div"); tools.className = "maplibregl-ctrl maplibregl-ctrl-group seam-tools";
    tools.append(
      btn("Recenter the map", '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>', () => cbs.recenter && cbs.recenter()),
      btn("Measure a distance: click points on the map, Esc to finish", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16.5 16.5 3 21 7.5 7.5 21Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 12.5l2 2M10 9.5l1.5 1.5M13 6.5l2 2" stroke="currentColor" stroke-width="2"/></svg>', () => setMeasure(!measuring)));
    tools.lastChild.id = "mRuler";
    // (the first control added sits lowest in the corner)
    map.addControl(new root.maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-right");
    map.addControl(new root.maplibregl.ScaleControl({ maxWidth: 90, unit: "imperial" }), "bottom-right");
    map.addControl(new root.maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl({ onAdd: () => tools, onRemove: () => tools.remove() }, "bottom-right");
    mRead = document.createElement("div"); mRead.className = "mread"; mRead.hidden = true; el.appendChild(mRead);
    addEventListener("keydown", e => { if (e.key === "Escape" && measuring) setMeasure(false); });
    // pair gap labels: the open pair always, every listed pair once zoomed in
    const zoomed = () => el.classList.toggle("gaps-all", map.getZoom() >= 9);
    map.on("zoom", zoomed); zoomed();
    map.on("error", e => { if (e && e.sourceId && e.sourceId.startsWith("r-") && ++tileErrors === 4 && cbs.tilesFailed) cbs.tilesFailed(basemap); });
    const hit = ["grid", "links", "proj", "proj-dash", "casing", "points", "rings", "sparks", "yards", "existing", "existing-pt"];
    // A second click or tap on the same route within a moment opens its details; a double-click on a route does not
    // also zoom the map, while one on empty map still does.
    let lastTap = null;
    const featAt = pt => { const f = map.queryRenderedFeatures(pt, { layers: hit.filter(l => map.getLayer(l)) })[0]; return f && f.layer.id !== "grid" ? { layer: f.layer.id, id: f.properties.id } : null; };
    // the first click already selects the pair and starts the map moving, so the second is matched by time, not by
    // what is under it now
    const recent = () => lastTap && performance.now() - lastTap.t < 450;
    map.on("dblclick", e => { if (!measuring && (recent() || featAt(e.point))) e.preventDefault(); });
    map.on("click", e => {
      if (measuring) { mpts.push([e.lngLat.lat, e.lngLat.lng]); return drawMeasure(); }
      if (recent()) { const h = lastTap.hit; lastTap = null; if (cbs.dblclick) cbs.dblclick(h); return; }
      const h = featAt(e.point);
      if (cbs.click) cbs.click(h);
      lastTap = h ? { hit: h, t: performance.now() } : null;
    });
    map.on("mousemove", e => {
      if (measuring) return;
      const f = map.queryRenderedFeatures(e.point, { layers: hit.filter(l => map.getLayer(l)) })[0];
      map.getCanvas().style.cursor = f && f.layer.id !== "grid" ? "pointer" : "";
      if (cbs.hover) cbs.hover(f ? { layer: f.layer.id, id: f.properties.id, kv: f.properties.kv, op: f.properties.op } : null, e.originalEvent);
    });
    map.on("mouseout", () => cbs.hover && cbs.hover(null));
    // "style.load" fires once the layers exist; "load" would also wait for every basemap tile to arrive.
    return new Promise(res => { const go = () => { placeLabels(); res(map); }; if (map.isStyleLoaded()) go(); else map.once("style.load", go); });
  }

  // Distance ruler: each leg and the running total, in miles and km.
  function drawMeasure() {
    mMarkers.forEach(m => m.remove()); mMarkers = [];
    const f = mpts.map(p => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: ll(p) } }));
    if (mpts.length > 1) f.unshift({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: mpts.map(ll) } });
    map.getSource("measure").setData(fc(f));
    let tot = 0;
    for (let i = 1; i < mpts.length; i++) {
      const d = gcKm(mpts[i - 1], mpts[i]); tot += d;
      mMarkers.push(tag("ml-gap ml-leg", miKm(d), [(mpts[i - 1][0] + mpts[i][0]) / 2, (mpts[i - 1][1] + mpts[i][1]) / 2]));
    }
    mRead.innerHTML = !mpts.length ? "Click a point on the map to start measuring" : mpts.length < 2 ? "Click another point to measure" : `Total <b>${miKm(tot)}</b> · click to add a point, Esc to finish`;
  }
  function setMeasure(on) {
    measuring = on; mpts = [];
    document.getElementById("mRuler").setAttribute("aria-pressed", on);
    map.getCanvas().style.cursor = on ? "crosshair" : "";
    mRead.hidden = !on;
    drawMeasure();
  }

  // City names as HTML markers: they need no font server, so they work on the offline Plain map too.
  function placeLabels() {
    placeMarkers.forEach(m => m.remove());
    placeMarkers = [];
    if (basemap !== "plain" && basemap !== "relief") return;
    for (const [n, lat, lon] of PLACES) {
      const d = document.createElement("div"); d.className = "ml-place"; d.textContent = n;
      placeMarkers.push(new root.maplibregl.Marker({ element: d, anchor: "left", offset: [4, 0] }).setLngLat([lon, lat]).addTo(map));
    }
  }

  function setBasemap(name) {
    if (!map || !BASEMAPS[name]) return;
    basemap = name; tileErrors = 0;
    for (const k of Object.keys(RASTERS)) map.setLayoutProperty("r-" + k, "visibility", k === name ? "visible" : "none");
    const raster = !!RASTERS[name];
    map.setLayoutProperty("states-fill", "visibility", name === "plain" ? "visible" : "none");
    map.setLayoutProperty("counties", "visibility", raster ? "none" : "visible");
    map.setLayoutProperty("relief", "visibility", name === "relief" ? "visible" : "none");
    shade();
    map.setPaintProperty("states-line", "line-color", name === "satellite" ? "rgba(255,255,255,.7)" : colors.stateLine || "#AEB6BC");
    map.setPaintProperty("seam", "line-opacity", raster ? 0.55 : 0.9);
    placeLabels();
  }

  function set3D(on) {
    if (!map) return;
    is3d = on;
    // The Southeast is low (sea level to a few hundred metres), so relief is exaggerated 3× to be seen.
    try { map.setTerrain(on ? { source: "dem", exaggeration: 3 } : null); } catch (err) { return void map.once("style.load", () => set3D(is3d)); }
    try { map.setSky(on ? SKY : null); } catch (err) { /* sky is decoration only */ }
    shade();
    map.setLayoutProperty("towers", "visibility", on ? "visible" : "none");
    // tilt only once a fly-to in progress has landed, so the tilt doesn't cut it short
    const tilt = () => map.easeTo(on ? { pitch: 62, bearing: map.getBearing() || -18, duration: dur(900) } : { pitch: 0, bearing: 0, duration: dur(700) });
    if (map.isMoving()) map.once("moveend", tilt); else tilt();
    if (lastData) towers(lastData.projects);
  }

  // Hillshade: always on the Relief map and in 3D; lighter over imagery so it doesn't muddy the photo.
  function shade() {
    const on = basemap === "relief" || is3d;
    map.setLayoutProperty("hillshade", "visibility", on ? "visible" : "none");
    map.setPaintProperty("hillshade", "hillshade-exaggeration", RASTERS[basemap] ? 0.3 : 0.55);
  }

  // Theme colours for the basemap layers (light or dark).
  function setTheme(c) {
    colors = c;
    if (!map) return;
    map.setPaintProperty("bg", "background-color", c.water);
    map.setPaintProperty("states-fill", "fill-color", c.land);
    map.setPaintProperty("counties", "line-color", c.county);
    map.setPaintProperty("states-line", "line-color", basemap === "satellite" ? "rgba(255,255,255,.7)" : c.stateLine);
    map.setPaintProperty("seam", "line-color", c.river);
    document.documentElement.style.setProperty("--ml-place", c.place);
  }

  let towerKey = null;
  function towers(projects) {
    const src = map.getSource("towers");
    if (!src) return;
    // thousands of extrusions: rebuilt only when what is drawn changes, not on every hover
    const key = is3d ? projects.filter(p => p.opacity >= 0.3).map(p => p.id + p.color + (p.kv || "")).join("|") : "";
    if (key === towerKey) return;
    towerKey = key;
    if (!is3d) return src.setData(fc([]));
    const out = [];
    for (const p of projects) {
      if (p.opacity < 0.3) continue;
      const h = TOWER_M(p.kv || 115);
      if (p.parts.some(c => c.length > 1)) {
        for (const part of p.parts) for (let i = 1; i < part.length; i++) {
          const [a, b] = [part[i - 1], part[i]];
          const km = Math.hypot((b[0] - a[0]) * 110.57, (b[1] - a[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180));
          const n = Math.max(1, Math.round(km / 0.45));
          for (let k = 0; k <= n; k++) {
            const lat = a[0] + (b[0] - a[0]) * k / n, lon = a[1] + (b[1] - a[1]) * k / n;
            out.push({ type: "Feature", properties: { color: p.color, h }, geometry: square(lon, lat, 24) });
          }
        }
      } else {
        const [lat, lon] = p.parts[0][0];
        out.push({ type: "Feature", properties: { color: p.color, h: 30 }, geometry: square(lon, lat, 260) });
      }
    }
    src.setData(fc(out));
  }

  // data: { projects, existing, links, rings, sparks, yards, yardRing, spokes, seam }
  function update(d) {
    if (!map || !map.getSource("projects")) return;
    lastData = d;
    const lines = [], pts = [];
    for (const p of d.projects) {
      const parts = p.parts.filter(c => c.length > 1);
      if (parts.length) lines.push({ type: "Feature", properties: { id: p.id, color: p.color, casing: p.casing, width: p.width, opacity: p.opacity, dash: !!p.dash }, geometry: { type: "MultiLineString", coordinates: parts.map(c => c.map(ll)) } });
      else pts.push({ type: "Feature", properties: { id: p.id, color: p.color, fill: p.dash ? "#FFFFFF" : p.color, r: p.r || 5, opacity: p.opacity }, geometry: { type: "Point", coordinates: ll(p.parts[0][0]) } });
    }
    map.getSource("projects").setData(fc(lines));
    map.getSource("points").setData(fc(pts));
    map.getSource("existing").setData(fc((d.existing || []).map(e => ({ type: "Feature", properties: { id: e.id }, geometry: e.parts.some(c => c.length > 1) ? { type: "LineString", coordinates: e.parts.find(c => c.length > 1).map(ll) } : { type: "Point", coordinates: ll(e.parts[0][0]) } }))));
    const gl = (d.links || []).filter(l => l.label && l.opacity > 0.3), gk = gl.map(l => l.id + (l.focus ? "*" : "")).join("|");
    if (gk !== gapKey) { // rebuilt only when the listed pairs or the open pair change, not on every hover
      gapKey = gk; gapMarkers.forEach(m => m.remove());
      gapMarkers = gl.map(l => tag("ml-gap" + (l.focus ? " on" : ""), l.label, [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]));
    }
    map.getSource("links").setData(fc((d.links || []).map(l => ({ type: "Feature", properties: { id: l.id, color: l.color, width: l.width, opacity: l.opacity }, geometry: { type: "LineString", coordinates: [ll(l.a), ll(l.b)] } }))));
    map.getSource("rings").setData(fc((d.rings || []).map(r => ({ type: "Feature", properties: { id: r.id, color: r.color, r: r.r, w: r.w, opacity: r.opacity }, geometry: { type: "Point", coordinates: ll(r.at) } }))));
    map.getSource("sparks").setData(fc((d.sparks || []).map(r => ({ type: "Feature", properties: { id: r.id, color: r.color }, geometry: { type: "Point", coordinates: ll(r.at) } }))));
    map.getSource("yards").setData(fc((d.yards || []).map(y => ({ type: "Feature", properties: { id: y.id, r: y.r, fill: y.fill }, geometry: { type: "Point", coordinates: ll(y.at) } }))));
    map.getSource("yardring").setData(fc(d.yardRing ? [{ type: "Feature", properties: {}, geometry: circle(d.yardRing.at, d.yardRing.km) }] : []));
    map.getSource("spokes").setData(fc((d.spokes || []).map(s => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [ll(s[0]), ll(s[1])] } }))));
    if (d.seam) map.getSource("seam").setData(fc([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: d.seam } }]));
    map.setLayoutProperty("existing", "visibility", d.showExisting === false ? "none" : "visible");
    map.setLayoutProperty("existing-pt", "visibility", d.showExisting === false ? "none" : "visible");
    towers(d.projects);
  }

  // pts: [[lat, lon], ...]; padKm adds room around them.
  function fit(pts, opts = {}) {
    if (!map || !pts.length) return;
    let s = 90, n = -90, w = 180, e = -180;
    for (const [lat, lon] of pts) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon); }
    const pad = (opts.padKm || 0) / 111;
    map.fitBounds([[w - pad, s - pad], [e + pad, n + pad]], { padding: opts.padding ?? 40, duration: dur(opts.duration ?? 900), maxZoom: opts.maxZoom ?? 12.5, pitch: is3d ? 62 : 0, bearing: is3d ? map.getBearing() : 0 });
  }

  // The project under a screen point (client pixels), for the drop-in figure: the nearest line or substation within
  // `radius` pixels, and the map coordinates of that point.
  function pick(clientX, clientY, radius = 22) {
    if (!map) return null;
    const r = map.getCanvas().getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
    const box = [[x - radius, y - radius], [x + radius, y + radius]];
    const f = map.queryRenderedFeatures(box, { layers: ["proj", "proj-dash", "points"].filter(l => map.getLayer(l)) })
      .filter(g => g.properties.opacity == null || g.properties.opacity > 0.25)[0];
    const ll = map.unproject([x, y]);
    return { id: f ? f.properties.id : null, at: [ll.lat, ll.lng] };
  }

  const setGrid = on => map && map.getLayer("grid") && map.setLayoutProperty("grid", "visibility", on ? "visible" : "none");

  root.SeamMap = { setGrid, pick, BASEMAPS, init, update, fit, setBasemap, set3D, setTheme, resize: () => map && map.resize(), get3D: () => is3d, getBasemap: () => basemap, raw: () => map };
})(this);
