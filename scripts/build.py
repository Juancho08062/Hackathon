"""Build the standalone app: inline styles, scripts and data from src/ and data/ into index.html."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = lambda p: (root / "src" / p).read_text()
html = src("index.html")
for key, text in {
    "/*STYLES*/": src("styles.css"),
    "/*ENGINE*/": src("engine.js"),
    "/*INGEST*/": src("ingest.js"),
    "/*LIBS*/": src("libs.js"),
    "/*FORMATS*/": src("formats.js"),
    "/*SCENE3D*/": src("scene3d.js"),
    "/*MAP*/": src("map.js"),
    "/*AGENT*/": src("agent.js"),
    "/*AGENT_OFFLINE*/": src("agent-offline.js"),
    "/*APP*/": src("app.js"),
    "/*BASEMAP*/null": (root / "data/basemap.json").read_text(),
    "/*PROJECTS*/[]": json.dumps(json.load(open(root / "data/projects.json")), separators=(",", ":")),
    "/*MODEL*/null": json.dumps(json.load(open(root / "data/model.json")), separators=(",", ":")),
}.items():
    assert key in html, key
    html = html.replace(key, text, 1)
(root / "index.html").write_text(html)
print("wrote index.html", len(html) // 1024, "KB")
