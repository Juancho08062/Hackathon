# Seamline

Seamline compares the planned transmission construction of two neighboring utilities and flags where their work overlaps, so they can share crews, equipment, land and outages.

The built-in example compares **Dominion Energy South Carolina** with **Georgia** (Georgia Power, Georgia Transmission and MEAG) along the Savannah River. You can load any other utility's plan from the files utilities actually publish: Excel project lists, CSV, KML/KMZ, shapefiles and GeoJSON.

![Overview: ranked coordination opportunities next to the map](docs/screenshots/overview.png)

## Quick start

Open `index.html` in a browser. That's it: everything it needs is in this folder.

To serve it locally instead (some browsers limit local files):

```
npm start            # python3 -m http.server 8000, then open http://localhost:8000
```

## Features

- **Overlap finder.** Measures the distance between the closest points of every pair of projects (lines, substations, plants), flags pairs within 40 km, and tiers them by what the utilities could share.
- **Ranked list.** Tier first, then pairs built in the same window, then distance. Filter by tier, search, and copy the list as CSV.
- **Cost and impact estimate.** A rough savings figure for each pair, with every assumption listed.
- **Map** with pan and zoom and four styles: Plain, Streets, Satellite and Terrain.
- **Timeline** of each flagged project's estimated construction window.
- **3D view** of any pair: lattice towers, conductors, substations, plants, crews and the shared right-of-way or yard its tier allows. Pixel-art mode is lighter on slow laptops.
- **Import** any utility's plan and compare any two utilities.

![3D view of a pair that can share a crew staging yard](docs/screenshots/3d-view.png)

## How overlap is defined

- **Geographic (primary).** Two projects overlap if the closest points between them are within 40 km. The measurement uses the lines and points themselves, not their centers. Each overlap gets a tier:
  - Touching or crossing: must coordinate outage timing and crossing structures
  - Under 1.6 km: can share right-of-way, access roads and permits
  - Under 8 km: can share laydown yards and deliveries
  - Under 40 km: can share crews, cranes and contractors
- **Timeline (secondary).** Two projects are in the same build window if their construction periods overlap, plus an optional buffer. Plans usually list only an in-service date, so the start date is estimated from project type, voltage and length unless the file provides one.
- **Cost and impact.** Each pair gets a rough savings estimate: shared mobilization, a shared laydown yard, shared right-of-way and permits, and one coordinated outage. The unit costs are in `src/engine.js` (`PER_KM`, `SUB`, `ASSUME`).

## Loading a utility's plans

Click **Add a utility's plans** and drop one or more files, or paste CSV rows.

| format | typical source | notes |
|---|---|---|
| Excel `.xlsx`, `.xlsm`, `.xls`, `.ods` | RTO and regional plan project lists (SERTP, MISO MTEP, PJM RTEP) | Every sheet is read. Title and note rows above the header are skipped. |
| CSV, TSV | Data portals, spreadsheet exports | Comma or tab separated. |
| KML, KMZ | Google Earth exports, utility project maps | Attributes come from ExtendedData or from the HTML table ArcGIS puts in each description. |
| Shapefile | GIS departments, HIFLD | Drop the `.zip`, or pick the `.shp`, `.dbf` and `.prj` together. Coordinates are reprojected to latitude and longitude using the `.prj`. |
| GeoJSON, JSON | Web maps, APIs | Point, LineString, MultiLineString, Polygon, MultiPolygon and GeometryCollection. |
| GPX | GPS field surveys | Tracks and waypoints. |

Column names are matched loosely. For example, `owner` or `Transmission Owner` works for utility, `Voltage (kV)` for kV, `ISD` or `Expected In-Service` for the in-service date, and `latitude` for lat. Shapefile field names cut to 10 characters, like `IN_SERVICE`, work too. The full list is `ALIASES` in `src/ingest.js`.

| field | required | notes |
|---|---|---|
| name | yes | project name |
| utility | no | taken from a utility column, the name typed in the import panel, or the file name, in that order |
| location | yes | `lat, lon` for a substation; add `lat2, lon2` for a line. GIS files carry their own geometry. |
| in_service | yes | `2029`, `2029-06`, `6/1/2029` or `Summer 2029` |
| kv, type, start, cost, description | no | type is `new_line`, `rebuild`, `substation` or `generation`, and is guessed from the name if left out |

The [`samples/`](samples) folder has the same five fictional projects in every format: `sample-plan.xlsx`, `.csv`, `.geojson`, `.kml`, `.kmz` and `sample-plan-shapefile.zip`. Load any of them to see the import work.

Most published plan lists name substations but give no coordinates, and PDF-only plans need their table copied into Excel first. Adding coordinates is the one manual step.

![Import panel after loading the Excel sample](docs/screenshots/import.png)

## Project layout

```
index.html              the built app; open or deploy this (generated, don't edit)
src/
  index.html            page markup with placeholders the build fills in
  styles.css            styling, light and dark themes
  engine.js             core logic, no UI: distances, tiers, build windows, cost model, ranking
  ingest.js             turns rows or GeoJSON into projects: column aliases, dates, types, header detection
  formats.js            file readers: Excel, KML/KMZ/GPX, shapefiles, zips
  libs.js               loads third-party libraries on first use from vendor/, with a CDN fallback
  scene3d.js            the 3D view (three.js)
  app.js                the UI: map, list, detail, timeline, import panel
data/
  projects.json         built-in DESC and Georgia projects (generated by scripts/build_projects.py)
  basemap.json          US state outlines and GA/SC counties
scripts/
  build.py              inlines src/ and data/ into index.html
  build_projects.py     the built-in project list, with sources and hand-placed coordinates
samples/                sample plans in every supported format
tests/                  engine, importer and sample-file tests
vendor/                 pinned copies of d3, three.js, SheetJS, togeojson, JSZip and shpjs (see vendor/README.md)
docs/screenshots/       images used in this README
```

## Development

Requires Python 3 and Node 18 or newer.

```
npm install              # installs the linter only; the app itself has no dependencies to install
npm run build            # rebuild index.html after changing src/ or data/
npm run build:data       # also regenerate data/projects.json from scripts/build_projects.py
npm test                 # engine, importer and sample-file tests
npm run lint             # ESLint
npm run check            # lint, test, and confirm index.html is up to date
```

CI runs lint, tests and the index.html check on every push and pull request (`.github/workflows/ci.yml`).

## Deploying

Seamline is a static site: `index.html` plus the `vendor/` folder. Any static host works, and there is no build step to run on the host because `index.html` is committed already built.

- **GitHub Pages:** in the repository's Settings, open Pages, set Source to "Deploy from a branch", pick `main` and `/ (root)`, and save. The site appears at `https://<user>.github.io/<repo>/`. On a free GitHub plan the repository has to be public for Pages to work.
- **Netlify, Vercel, Cloudflare Pages or S3:** publish the repository root.

Satellite, Streets and Terrain map tiles come from Esri and OpenStreetMap and need an internet connection. The Plain map, the 3D view and every importer work offline.

## Data sources and caveats

- DESC: [SCRTP 2026–2030 project descriptions ($2M and above)](https://www.scrtp.com/assets/pdfs/home/2026-2030-2million-and-above-project-descriptions.pdf). This list includes costs and exact dates.
- Georgia: [SERTP 2026 preliminary expansion plan](https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf), [2025 SERTP report](https://www.southeasternrtp.com/docs/general/2025/2025%20SERTP%20Preliminary%20Expansion%20Plan%20Report%20(Non-CEII).pdf), and Georgia Power's project pages for Callaway Road–Thomson and Effingham County. These give year-only dates and no costs.
- Public plans name substations but give no coordinates, so the built-in locations are placed by hand. `loc: "low"` marks best guesses, which are drawn dashed on the map. Spot-check project rows against the source PDFs.
- The Thomson–Vogtle 500 kV line has been in service since 2018. It appears as an existing asset for reference, along with DESC's Stevens Creek hydro plant in Martinez, Georgia.
- The files in `samples/` are fictional.
