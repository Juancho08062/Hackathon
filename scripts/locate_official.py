"""Place project end points on the map from their names.

    python3 scripts/locate_official.py            # report, using the cached OpenStreetMap extract
    python3 scripts/locate_official.py --fetch    # refresh the extract from the Overpass API first

Follows the challenge's "Finding Real Project Locations" guide:
1. Pull every named power substation, power plant and town in Georgia and South
   Carolina from OpenStreetMap (Overpass API), cached in data/official/osm_places.json.
2. Split each project name into its end points ("EVANS PRIMARY - THURMOND DAM (USA) #5
   115KV REBUILD" -> Evans Primary, Thurmond Dam) and match each one to a substation or
   plant of the same name, in the utility's own state first. When a name exists in
   several places, the copy nearest the project's planning zone wins (zone centres come
   from the names that match only once).
3. Confirm: MANUAL below holds places checked by hand against the utility PDFs and the
   challenge's reference table, and they override OpenStreetMap. A name that only
   matches a town is kept as low confidence; a name with no match is left out.

build_projects.py uses Locator; this script's own output, data/official/locations.csv,
is a report of every end point and how it was placed, for spot checks.
"""
import csv, json, math, pathlib, re, statistics, sys, urllib.parse, urllib.request
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OFF = ROOT / "data" / "official"
BBOX = (30.3, -85.7, 35.3, -78.5)
REF = "reference"
FAR_KM = 150  # planning zones span roughly 100-200 km  # coordinates from the challenge's Projects_Overlaps.xlsx

# Places checked by hand: normalized name, or "name@zone" when the name repeats elsewhere.
# (lat, lon, method, note[, confidence]); confidence defaults to high
MANUAL = {
    "okatie": (32.333758, -81.032495, REF, "Projects_Overlaps.xlsx"),
    "jasper": (32.35912, -81.1246, REF, "Projects_Overlaps.xlsx"),
    "bluffton": (32.235027, -80.853384, REF, "Projects_Overlaps.xlsx"),
    "stevens creek": (33.562599, -82.051362, REF, "Projects_Overlaps.xlsx"),
    "queensboro": (32.722793, -79.967332, REF, "Projects_Overlaps.xlsx"),
    "thurmond": (33.660127, -82.195931, REF, "Projects_Overlaps.xlsx"),
    "evans": (33.543994, -82.168648, REF, "Projects_Overlaps.xlsx"),
    "mcintosh": (32.352116, -81.175112, REF, "Projects_Overlaps.xlsx"),
    "goshen@219": (32.248701, -81.209472, REF, "Projects_Overlaps.xlsx: Goshen (SAV)"),
    "mitchell": (31.447121, -84.133843, REF, "Projects_Overlaps.xlsx"),
    "north tifton": (31.478089, -83.54913, REF, "Projects_Overlaps.xlsx"),
    "jesup": (31.603106, -81.924947, REF, "Projects_Overlaps.xlsx"),
    "ludowici": (31.721597, -81.743703, REF, "Projects_Overlaps.xlsx"),
    # Purrysburg: DESC 230 kV point in Jasper County SC, across the river from Plant McIntosh. Not in OSM.
    "purrysburg": (32.318, -81.117, "manual", "Purrysburg, Jasper County SC"),
    # Georgia end points near the river that OSM does not name; placed at the area the
    # IRP description names, so drawn as approximate ("low").
    "fenwick street": (33.4655, -81.9690, "manual", "downtown Augusta GA", "low"),
    "sand bar ferry": (33.4300, -81.9330, "manual", "Sand Bar Ferry Rd, east Augusta GA", "low"),
    "rice hope": (32.1700, -81.1750, "manual", "Rice Hope, Port Wentworth GA", "low"),
    "little ogeechee": (31.9950, -81.2250, "manual", "Little Ogeechee River, south Savannah GA", "low"),
    "big ogeechee": (32.1000, -81.3800, "manual", "Big Ogeechee area, Bryan County GA", "low"),
    "hyundai motors savannah": (32.1400, -81.4000, "manual", "Hyundai Metaplant, Ellabell GA", "low"),
    # Summerville: DESC transmission substation in Summerville SC (OSM's only match is a wastewater plant)
    "summerville": (33.018, -80.176, "manual", "Summerville SC, DESC substation area"),
    # Hooks: DESC substation on the Hooks - Thurmond tie and Hooks - Modoc line, McCormick County SC.
    "hooks": (33.65682, -82.159478, "manual", "Clarks Hill SC, at the GPC-SCE&G tie point OSM tags as w1074904615"),
}

UNITS = r"\d+(?:\s?[.\-/]\s?\d+)*\s?-?\s?kv\b"
QUALIFIER = r"\((?:usa|apc|fpl|sav|gtc|meag|desc|dep|sepa|cc|[a-z]?\d+)\)"
GENERIC = (r"\b(sub(station)?s?|switching|sw|sta(tion)?|primary|pri|transmission|tap|jct|junction|plant|"
           r"steam|hydro|dam|generating|facility|customer|distribution|dist|the)\b")
WORK = re.compile(r"\b(line|lines|rebuild|rebld|reconductor|new|upgrade|replace|replacement|construct|add|install|"
                  r"installation|conversion|convert|reactors?|capacitor|cap|bank|transformers?|xfmr|autobanks?|"
                  r"relay|relays|breaker|bus|series|project|area|solution|strategic|improvements?|modernization|"
                  r"rating|increase|removal|switch|terminal|uprate|partial|second|2nd|expansion|network|spdc|"
                  r"move|equipment|needs|loop|fold|dual|stage|static|var|statcom|system|limiting|element|"
                  r"tie|modification|parallel|buses|low side|upgrades?|panel|panels|protective|relaying|and structures?|structures?)\b", re.I)


def norm(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(QUALIFIER, " ", s)
    s = re.sub(r"\([^)]*\)?", " ", s)
    s = re.sub(r"#\s?\d+", " ", s)
    s = re.sub(r"^st\.? ", "saint ", s)
    s = re.sub(r"\brd\b", "road", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(GENERIC, " ", s)
    return re.sub(r"\s+", " ", s).strip()


def endpoints(name):
    """The named end points in a project name, in order."""
    s = re.sub(r"^((SAV|GTC|MEAG|DU|GPC|GRID|CC)\s*[:\-]\s*)+", "", name.strip(), flags=re.I)
    s = re.split(r"[:,]| & | and (?=[A-Z])| from ", s)[0]
    s = re.sub(UNITS, " ", s, flags=re.I)
    s = re.sub(r"\bAKA\b.*", "", s)
    out = []
    for p in re.split(r"\s*[-–/]\s*", s):
        m = WORK.search(p)
        p = re.sub(r"\s+", " ", re.sub(r"#\s?\d+", "", p[:m.start()] if m else p)).strip(" ,&#")
        if len(norm(p)) > 1 and re.search("[a-z]", norm(p)):
            out.append(p)
    return out


def haversine(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def in_poly(pt, geom):
    lat, lon = pt
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    inside = False
    for poly in polys:
        ring = poly[0]
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside


MIRRORS = ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter")


def overpass(q):
    # Overpass rejects requests without a User-Agent (406) and times out under load, so try each mirror twice.
    err = None
    for url in MIRRORS * 2:
        req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(),
                                     headers={"User-Agent": "nexxo-shellhacks/1.0"})
        try:
            return json.load(urllib.request.urlopen(req, timeout=180))["elements"]
        except Exception as e:  # noqa: BLE001 - any mirror failure means try the next one
            err = e
            print("overpass:", url, e, file=sys.stderr)
    raise err


def fetch():
    b = ",".join(map(str, BBOX))
    power = overpass(f'[out:json][timeout:170];nwr["power"~"^(substation|plant)$"]["name"]({b});out center tags;')
    towns = overpass(f'[out:json][timeout:170];node["place"~"^(city|town|village)$"]["name"]({b});out;')
    rows = []
    for e in power + towns:
        t = e.get("tags", {})
        lat, lon = (e["lat"], e["lon"]) if "lat" in e else (e["center"]["lat"], e["center"]["lon"])
        rows.append(dict(osm=f'{e["type"][0]}{e["id"]}', name=t["name"], kind=t.get("power") or "town",
                         operator=t.get("operator", ""), lat=round(lat, 6), lon=round(lon, 6)))
    rows.sort(key=lambda r: r["osm"])
    json.dump(rows, open(OFF / "osm_places.json", "w"), indent=0)
    print(len(rows), "OSM places cached")


def official_projects():
    """Rows of both official lists as dicts with id, state, zone, name."""
    out = []
    for r in csv.DictReader(open(OFF / "desc_2024_2028.csv")):
        out.append(dict(r, id=f"DESCP-{int(r['item']):02d}", state="South Carolina", zone="desc"))
    seen = set()
    for r in csv.DictReader(open(OFF / "gpc_irp2025_table2.csv")):
        pid = f"IRP-{r['teams']}" if r["teams"] not in seen else f"IRP-{r['teams']}-{r['year']}"  # one TEAMS number, two phases
        seen.add(r["teams"])
        out.append(dict(r, id=pid, state="Georgia", zone=r["zone"]))
    return out


class Locator:
    def __init__(self, projects):
        """projects: iterable of (name, state, zone) used to learn where each zone is."""
        states = {s["n"]: s["g"] for s in json.load(open(ROOT / "data" / "basemap.json"))["states"]}
        self.index, self.power = {}, []
        for p in json.load(open(OFF / "osm_places.json")):
            k = norm(p["name"])
            if not k or re.search(r"solar|wind|battery storage|wastewater|treatment", p["name"], re.I):
                continue  # namesakes that are never a transmission substation
            p["state"] = next((n for n in ("Georgia", "South Carolina") if in_poly((p["lat"], p["lon"]), states[n])), None)
            self.index.setdefault(k, []).append(p)
            if p["kind"] != "town" and p["state"]:
                self.power.append((k, p))
        self.centre, self.rejected = {}, []
        pts = {}
        for name, state, zone in projects:
            for e in endpoints(name):
                c = self._manual(norm(e), zone) or self._candidates(norm(e), state)
                if isinstance(c, tuple) or len(c) == 1:
                    lat, lon = (c[0], c[1]) if isinstance(c, tuple) else (c[0]["lat"], c[0]["lon"])
                    pts.setdefault(zone, []).append((lat, lon))
        self.centre = {z: (statistics.median(a for a, _ in v), statistics.median(b for _, b in v))
                       for z, v in pts.items() if len(v) >= 2 and z != "desc"}  # DESC lists no zones

    def _manual(self, k, zone):
        return MANUAL.get(f"{k}@{zone}") or MANUAL.get(k)

    def _candidates(self, k, state):
        c = [p for p in self.index.get(k, []) if p["kind"] != "town" and p["state"]]
        home = [p for p in c if p["state"] == state]
        if not home:  # "Killian" also matches "Killian Road Substation", in the utility's own state only
            home = [p for pk, p in self.power if p["state"] == state and (pk.startswith(k + " ") or pk.endswith(" " + k))]
        return home or c

    def point(self, endpoint, state, zone):
        """(lat, lon, method, confidence, note) for one end point, or None."""
        k = norm(endpoint)
        m = self._manual(k, zone)
        if m:
            return (m[0], m[1], m[2], m[4] if len(m) > 4 else "high", m[3])
        near = [self.centre[zone]] if zone in self.centre else []

        def dist(p):
            return min((haversine((p["lat"], p["lon"]), c) for c in near), default=0)
        # A match far from the rest of its planning zone is a namesake, not the project.
        allc = sorted(self._candidates(k, state), key=dist)
        # Without a zone centre to check against (DESC lists no zones), a match in the other state is a namesake:
        # DESC's "Dawson" is not the Dawson substation in southwest Georgia.
        c = [p for p in allc if dist(p) <= FAR_KM and (near or p["state"] == state)]
        if allc and not c:
            self.rejected.append(dict(endpoint=endpoint, zone=zone, candidate=allc[0]["name"], km=round(dist(allc[0]))))
        if c:
            p = c[0]
            conf = "high" if len(c) == 1 and norm(p["name"]) == k else "medium"
            if p["state"] != state or (near and dist(p) > 80):
                conf = "low"
            note = f"{p['name']} ({p['osm']})" + (f"; {len(c)} candidates, nearest the zone" if len(c) > 1 else "")
            return (p["lat"], p["lon"], f"osm_{p['kind']}", conf, note)
        towns = [p for p in sorted(self.index.get(k, []), key=dist) if p["kind"] == "town" and p["state"] == state and dist(p) <= FAR_KM]
        if towns:
            p = towns[0]
            return (p["lat"], p["lon"], "town", "low", f"town of {p['name']} ({p['osm']})")
        return None


def main():
    if "--fetch" in sys.argv:
        fetch()
    projects = official_projects()
    loc = Locator((p["name"], p["state"], p["zone"]) for p in projects)
    rows, missing, seen = [], [], set()
    for p in projects:
        for e in endpoints(p["name"]):
            key = (norm(e), p["zone"])
            if key in seen:
                continue
            seen.add(key)
            r = loc.point(e, p["state"], p["zone"])
            if r:
                rows.append(dict(key=key[0], zone=p["zone"], name=e, lat=r[0], lon=r[1], method=r[2], confidence=r[3], note=r[4]))
            else:
                missing.append(e)
    with open(OFF / "locations.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    print(len(rows), "end points located:", dict(Counter(f"{r['method']}/{r['confidence']}" for r in rows)))
    print(len(missing), "not found:", "; ".join(sorted(missing)))


if __name__ == "__main__":
    main()
