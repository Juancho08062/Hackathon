# Seamline

Seamline compares the planned transmission construction of two neighboring utilities and flags where their work overlaps, so they can share crews, equipment, land and outages.

The built-in example compares **Dominion Energy South Carolina** with **Georgia** (Georgia Power, Georgia Transmission and MEAG) along the Savannah River. You can load any other utility's plan from a file.

## Run it

Open `index.html` in a browser. The page is self-contained except for d3 and fonts, which load from a CDN.

After you change anything in `src/` or `data/`, rebuild:

```
python3 data/build_projects.py   # only if you edited the built-in project list
python3 build.py                 # inlines src/ and data/ into index.html
node tests/engine.test.js        # engine and importer tests
```

## How overlap is defined

- **Geographic (primary).** Two projects overlap if the closest points between them are within 40 km. The measurement uses the lines and points themselves, not their centers. Each overlap gets a tier:
  - Touching or crossing: must coordinate outage timing and crossing structures
  - Under 1.6 km: can share right-of-way, access roads and permits
  - Under 8 km: can share laydown yards and deliveries
  - Under 40 km: can share crews, cranes and contractors
- **Timeline (secondary).** Two projects are in the same build window if their construction periods overlap, plus an optional buffer. Plans usually list only an in-service date, so the start date is estimated from project type, voltage and length unless the file provides one.
- **Ranking.** Pairs are sorted by tier, then same build window first, then distance.
- **Cost and impact.** Each pair gets a rough savings estimate with every assumption listed: shared mobilization, a shared laydown yard, shared right-of-way and permits, and one coordinated outage. The unit costs are in `src/engine.js` (`PER_KM`, `SUB`, `ASSUME`).

## Loading another utility's plans

Click **Add a utility's plans** and drop a file, or paste CSV rows. Supported formats are CSV, TSV, JSON and GeoJSON (Point, LineString, MultiLineString and Polygon).

Column names are matched loosely. For example, `owner` works for `utility`, `voltage` for `kv`, `isd` for `in_service`, and `latitude` for `lat`. The full list is in `ALIASES` in `src/ingest.js`.

| field | required | notes |
|---|---|---|
| name | yes | project name |
| utility | yes* | *or type a utility name in the import panel |
| lat, lon | yes | a line needs `lat2, lon2` too; a GeoJSON geometry replaces all four |
| in_service | yes | `2029`, `2029-06`, `6/1/2029` or `Summer 2029` |
| kv, type, start, cost, description | no | type is `new_line`, `rebuild`, `substation` or `generation`, and is guessed from the name if left out |

After loading, pick any two utilities in the **Compare** dropdowns.

## Code tour

| file | what it does |
|---|---|
| `src/engine.js` | Core logic with no UI: closest-point distance, tiers, build windows, shared resources, cost model and `findOverlaps()` ranking. Runs in the browser and in Node. |
| `src/ingest.js` | Importer: CSV/TSV parser, JSON and GeoJSON readers, column aliasing, date and type normalization. |
| `src/scene3d.js` | 3D view of a selected pair (three.js, loaded on demand): towers, wires, substations and plants for both utilities, the closest-point link, and the shared corridor, laydown yard or staging yard its tier allows. Pixel-art mode renders at 1/3 resolution. |
| `src/app.js` | UI: d3 map with pan and zoom and switchable basemaps (Plain, Streets, Satellite, Terrain), ranked list, pair detail with the cost breakdown, timeline, and the import panel. |
| `src/index.html`, `src/styles.css` | Markup and styling, with light and dark themes. |
| `data/build_projects.py` | The built-in DESC and Georgia projects, with source links, hand-placed coordinates and estimated start dates. Writes `data/projects.json`. |
| `data/basemap.json` | US state outlines and GA/SC counties, from the us-atlas package. |
| `tests/engine.test.js` | Tests for distance, tiers, ranking, the built-in results and the importer. |

## Data sources and caveats

- DESC: [SCRTP 2026–2030 project descriptions ($2M and above)](https://www.scrtp.com/assets/pdfs/home/2026-2030-2million-and-above-project-descriptions.pdf). This list includes costs and exact dates.
- Georgia: [SERTP 2026 preliminary expansion plan](https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf), [2025 SERTP report](https://www.southeasternrtp.com/docs/general/2025/2025%20SERTP%20Preliminary%20Expansion%20Plan%20Report%20(Non-CEII).pdf), and Georgia Power's project pages for Callaway Road–Thomson and Effingham County. These give year-only dates and no costs.
- Public plans name substations but give no coordinates, so the built-in locations are placed by hand. `loc: "low"` marks best guesses, which are drawn dashed on the map. Spot-check project rows against the source PDFs.
- The Thomson–Vogtle 500 kV line has been in service since 2018. It appears as an existing asset for reference, along with DESC's Stevens Creek hydro plant in Martinez, Georgia.
