# Vendored libraries

Pinned copies of the third-party scripts Seamline loads, so the site works offline and on static hosting. Each one is loaded from here first, with the CDN copy as a fallback (see `src/libs.js`).

| file | library | version | license |
|---|---|---|---|
| `d3.min.js` | [d3](https://d3js.org) | 7.9.0 | ISC |
| `three.min.js` | [three.js](https://threejs.org) | r128 (0.128.0) | MIT |
| `OrbitControls.js` | three.js examples | r128 (0.128.0) | MIT |
| `three-extras.js` | three.js examples: Sky, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass and the Copy, LuminosityHighPass, ACESFilmicToneMapping, GammaCorrection and FXAA shaders, concatenated | r128 (0.128.0) | MIT |
| `xlsx.full.min.js` | [SheetJS Community Edition](https://sheetjs.com) | 0.18.5 | Apache-2.0 |
| `togeojson.umd.js` | [@tmcw/togeojson](https://github.com/placemark/togeojson) | 5.8.1 | BSD-2-Clause |
| `jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT or GPL-3.0 |
| `shp.min.js` | [shpjs](https://github.com/calvinmetcalf/shapefile-js) | 6.2.0 | MIT |

To update one, replace the file and change its version in `src/libs.js` so the CDN fallback matches.
