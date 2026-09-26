// Seamline library loader: loads a third-party script on first use, from vendor/ first and the pinned CDN copy second.
// Keeping local copies means the site works offline and on static hosting; the CDN covers single-file copies of index.html.
(function (root) {
  const LIBS = {
    THREE: ["vendor/three.min.js", "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"],
    OrbitControls: ["vendor/OrbitControls.js", "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"],
    XLSX: ["vendor/xlsx.full.min.js", "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"],
    toGeoJSON: ["vendor/togeojson.umd.js", "https://cdn.jsdelivr.net/npm/@tmcw/togeojson@5.8.1/dist/togeojson.umd.js"],
    JSZip: ["vendor/jszip.min.js", "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"],
    shp: ["vendor/shp.min.js", "https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js"],
  };
  const has = name => name === "OrbitControls" ? !!(root.THREE && root.THREE.OrbitControls) : !!root[name];
  const inject = src => new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src;
    s.onload = res; s.onerror = () => { s.remove(); rej(new Error("couldn't load " + src)); };
    document.head.appendChild(s);
  });
  const pending = {};
  // Load libraries in order (OrbitControls needs THREE). Resolves when every one is available.
  function need(...names) {
    return names.reduce((chain, name) => chain.then(() => {
      if (has(name)) return;
      if (!LIBS[name]) throw new Error("unknown library " + name);
      const [local, cdn] = LIBS[name];
      return pending[name] || (pending[name] = inject(local).catch(() => inject(cdn)).then(() => {
        if (!has(name)) throw new Error(name + " loaded but did not register");
      }).catch(err => { delete pending[name]; throw err; }));
    }), Promise.resolve());
  }
  root.Libs = { need, LIBS };
})(this);
