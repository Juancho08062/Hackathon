"""Existing transmission lines (115 kV and up) in Georgia and South Carolina from OpenStreetMap, for the map's
background grid layer.

    python3 scripts/fetch_grid.py                 # query the Overpass API
    python3 scripts/fetch_grid.py raw1.json ...   # or simplify Overpass JSON saved earlier

Writes data/grid.json: a GeoJSON FeatureCollection of LineStrings with kv (the highest voltage on the line) and
operator, simplified (Douglas-Peucker, about 60 m) and rounded to 4 decimals so it stays small. The app loads it
on demand and draws it coloured by voltage, like Open Infrastructure Map. Data © OpenStreetMap contributors, ODbL.
"""
import json, pathlib, sys, time, urllib.parse, urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "grid.json"
HALVES = ["30.3,-85.7,35.3,-82.1", "30.3,-82.1,35.3,-78.5"]  # one query for both states times out, so two halves
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
TOL = 0.0006  # degrees, about 60 m


def query(bbox):
    q = f'[out:json][timeout:160];way["power"="line"]["voltage"~"(115000|161000|230000|500000)"]({bbox});out geom tags;'
    for attempt in range(3):
        for url in MIRRORS:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "seamline-shellhacks/1.0"})
            try:
                return json.load(urllib.request.urlopen(req, timeout=180))["elements"]
            except Exception as e:  # noqa: BLE001 - try the next mirror
                print("overpass:", url, e, file=sys.stderr)
        time.sleep(5)
    raise SystemExit("Overpass did not answer; try again later")


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = (dx * dx + dy * dy) ** 0.5 or 1e-12
    far, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / n
        if d > far:
            far, idx = d, i
    if far <= tol:
        return [a, b]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def kv_of(v):
    vals = [int(x) for x in str(v).replace(",", ";").split(";") if x.strip().isdigit()]
    return max(vals) // 1000 if vals else None


def main():
    if len(sys.argv) > 1:
        elements = [e for f in sys.argv[1:] for e in json.load(open(f))["elements"]]
    else:
        elements = [e for b in HALVES for e in query(b)]
    seen, feats = set(), []
    for e in elements:
        if e["id"] in seen or "geometry" not in e:
            continue
        seen.add(e["id"])
        kv = kv_of(e.get("tags", {}).get("voltage"))
        if not kv or kv < 115:
            continue
        pts = simplify([(g["lon"], g["lat"]) for g in e["geometry"]], TOL)
        coords = []
        for x, y in pts:
            c = [round(x, 4), round(y, 4)]
            if not coords or c != coords[-1]:
                coords.append(c)
        if len(coords) < 2:
            continue
        op = e.get("tags", {}).get("operator", "")
        feats.append({"type": "Feature", "properties": {"kv": kv, "op": op[:40]}, "geometry": {"type": "LineString", "coordinates": coords}})
    feats.sort(key=lambda f: f["properties"]["kv"])  # higher voltages drawn last, on top
    json.dump({"type": "FeatureCollection", "attribution": "© OpenStreetMap contributors (ODbL)", "features": feats}, open(OUT, "w"), separators=(",", ":"))
    from collections import Counter
    print(len(feats), "lines", dict(Counter(f["properties"]["kv"] for f in feats)), OUT.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
