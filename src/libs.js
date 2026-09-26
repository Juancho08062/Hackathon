// Nexxo library loader: loads a third-party script on first use, from vendor/ first and the pinned CDN copy second.
// Keeping local copies means the site works offline and on static hosting; the CDN covers single-file copies of index.html.
(function (root) {
  const LIBS = {
    THREE: ["vendor/three.min.js", "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"],
    OrbitControls: ["vendor/OrbitControls.js", "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"],
    // Sky, bloom, tone mapping and FXAA for the realistic 3D mode: one local bundle, or the separate files from the CDN.
    ThreeExtras: ["vendor/three-extras.js", [
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/objects/Sky.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/ACESFilmicToneMappingShader.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/GammaCorrectionShader.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/FXAAShader.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js"
    ]],
    // SSAO and SMAA for the Detailed and Ultra-realistic 3D settings.
    ThreeQuality: ["vendor/three-quality.js", [
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/math/SimplexNoise.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/SSAOShader.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/SSAOPass.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/SMAAShader.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/SMAAPass.js"
    ]],
    XLSX: ["vendor/xlsx.full.min.js", "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"],
    toGeoJSON: ["vendor/togeojson.umd.js", "https://cdn.jsdelivr.net/npm/@tmcw/togeojson@5.8.1/dist/togeojson.umd.js"],
    JSZip: ["vendor/jszip.min.js", "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"],
    shp: ["vendor/shp.min.js", "https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js"],
  };
  const T = () => root.THREE || {};
  const has = name => name === "OrbitControls" ? !!T().OrbitControls
    : name === "ThreeQuality" ? !!(T().SSAOPass && T().SMAAPass)
    : name === "ThreeExtras" ? !!(T().Sky && T().UnrealBloomPass && T().FXAAShader && T().GammaCorrectionShader)
    : !!root[name];
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
      const fromCdn = () => [].concat(cdn).reduce((c, url) => c.then(() => inject(url)), Promise.resolve());
      return pending[name] || (pending[name] = inject(local).catch(fromCdn).then(() => {
        if (!has(name)) throw new Error(name + " loaded but did not register");
      }).catch(err => { delete pending[name]; throw err; }));
    }), Promise.resolve());
  }
  root.Libs = { need, LIBS };
})(this);
