# Seamline: utility construction overlap finder

Compares planned transmission projects from two neighboring utilities
(Dominion Energy South Carolina and the Georgia system: Georgia Power, GTC, MEAG)
and flags cross-utility pairs that are physically close and/or scheduled at the same time.

- `index.html`: the standalone app (open in a browser; loads d3 from cdnjs).
- `src/app.html`: app source (map, ranked list, timeline, CSV upload, CSV copy).
- `data/build_projects.py` -> `data/projects.json`: 90 real projects from public plans, with sources.
- `data/basemap.json`: GA/SC county and state outlines (from the us-atlas npm package).
- `build.py`: inlines data into `index.html`. Run `python3 data/build_projects.py && python3 build.py`.

Method (challenge spec): distance = closest points between project geometries in km; flagged within 40 km and tiered (touching, <1.6 km, <8 km, <40 km). Ranked by tier, then same build window, then distance. Rough savings per pair shown with assumptions.
Timing = overlap of estimated construction windows (start estimated from in-service date,
type, voltage, length), with an adjustable buffer. Score blends proximity and timing, with a
bonus for shareable resources (same voltage class crews, same work type, same conductor).

Caveats: coordinates are hand-placed at named substations/towns (loc=low means best guess);
Georgia SERTP in-service dates are year-only (assumed June 1); Georgia Power project pages give construction milestones but no in-service date (estimated). Existing assets (Thomson-Vogtle 500 kV, Stevens Creek Hydro in Martinez GA, Vogtle, McIntosh, Okatie-McIntosh tie) are a reference layer. Project lists were extracted from
the source PDFs and should be spot-checked against them before the demo.
