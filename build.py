"""Inline data into src/app.html -> index.html (standalone page)."""
import json, pathlib
root = pathlib.Path(__file__).parent
html = (root / "src/app.html").read_text()
html = html.replace("/*BASEMAP*/null", (root / "data/basemap.json").read_text())
html = html.replace("/*PROJECTS*/[]", json.dumps(json.load(open(root / "data/projects.json")), separators=(",", ":")))
(root / "index.html").write_text(html)
print("wrote index.html", len(html) // 1024, "KB")
