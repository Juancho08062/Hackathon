"""Extract the project lists from the two PDFs in the challenge package.

    python3 scripts/extract_official.py DESC_PDF GPC_PDF

DESC_PDF  "2024-2028-2million-and-above-project-descriptions.pdf" (one project per page)
GPC_PDF   "2025 IRP Volume 3 PUBLIC DISCLOSURE.pdf" (Table 2, Georgia ITS 10 Year Plan
          Project List, pages 177-193 of the PDF)

Writes data/official/desc_2024_2028.csv and data/official/gpc_irp2025_table2.csv.
The CSVs are committed, so this only needs to run again if the PDFs change.
Needs pypdf (pip install pypdf).
"""
import csv, pathlib, re, sys
from pypdf import PdfReader

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "official"


def pages(path):
    return [p.extract_text() or "" for p in PdfReader(path).pages]


def clean(s):
    return re.sub(r"\s+", " ", s.replace("–", "-").replace("—", "-")).strip()


def desc_rows(path):
    rows = []
    for n, text in enumerate(pages(path), 1):
        def between(a, b):
            m = re.search(re.escape(a) + r"\s*(.*?)\s*" + re.escape(b), text, re.S)
            return clean(m.group(1)) if m else ""
        m = re.search(r"Planned In-Service Date\s*(\d{1,2})/(\d{1,2})/(\d{2,4})", text)
        mo, d, y = m.groups()
        y = int(y) + (2000 if len(y) == 2 else 0)
        money = [int(x.replace(",", "")) for x in re.findall(r"\$([\d,]+)", text.split("Estimated Project Cost")[1])]
        rows.append(dict(
            item=n, project_id=between("Project ID", "Project Description"),
            name=between("5 Year Budget", "Project ID"),
            description=between("Project Description", "Project Need"),
            need=between("Project Need", "Project Status"),
            status=between("Project Status", "Planned In-Service Date"),
            in_service=f"{y}-{int(mo):02d}-{int(d):02d}",
            cost=money[-1] if money else "", page=n))
    return rows


# Table 2 rows read as: zone, year, TEAMS number, name (wraps over lines), need date,
# sponsor, then five REDACTED cost cells. A few rows have no year column.
GPC_ROW = re.compile(r"(2\d\d) (?:(20\d\d) )?(\d{4,5}) (.+?) (\d{1,2}/\d{1,2}/20\d\d) (GPC|GTC|MEAG|SAV|DU)\s+(?:REDACTED\s*)+")
NOISE = ("CRITICAL ENERGY", "be aware", "contents shall", "notification.", "employees.", "policy,",
         "2024 GA ITS", "PUBLIC DISCLOSURE", "Zone Year", "Number Project", "Project Name", "Sponsor Estimated",
         "Project ", "DU Totals", "A.  Georgia", "Table 2", "2024 ")


def gpc_details(all_pages):
    """Per-project pages after Table 2: start date, description and plan changes, by TEAMS number."""
    out = {}
    for text in all_pages:
        m = re.search(r"Teams # (\d+)\s*Need Date (\d\d)/(\d\d)/(\d{4}) Start Date (\d\d)/(\d\d)/(\d{4})", text)
        if not m:
            continue
        teams, _, _, _, smo, sd, sy = m.groups()
        tail = text.split("parity forecast purposes only", 1)[-1].split("PUBLIC DISCLOSURE")[0]
        parts = [clean(p) for p in re.split(r"\n\s*REDACTED\s*\n", tail)]
        desc = parts[0] if parts else ""
        notes = [clean(l) for l in (parts[1] if len(parts) > 1 else "").split("\n") if l.strip()]
        miles = re.search(r"(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:circuit\s+)?mi(?:les?)?\b", desc, re.I)
        out[teams] = dict(start=f"{sy}-{smo}-{sd}", description=desc, miles=miles.group(1) if miles else "",
                          change_ten_year_plan=notes[0] if notes else "", change_irp=notes[1] if len(notes) > 1 else "")
    return out


def gpc_rows(path, first=177, last=193):
    rows, all_pages = [], pages(path)
    details = gpc_details(all_pages)
    for n in range(first, last + 1):
        lines = [l.strip() for l in all_pages[n - 1].split("\n")]
        text = " ".join(l for l in lines if l and (re.match(r"^2\d\d ", l) or not l.startswith(NOISE)))
        for zone, year, teams, name, need, sponsor in GPC_ROW.findall(text):
            mo, d, y = need.split("/")
            rows.append(dict(teams=teams, zone=zone, year=year or y, name=clean(name), sponsor=sponsor,
                             need_date=f"{y}-{int(mo):02d}-{int(d):02d}", pdf_page=n,
                             **details.get(teams, dict(start="", description="", miles="", change_ten_year_plan="", change_irp=""))))
    return rows


def write(name, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    print(f"{name}: {len(rows)} rows")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    write("desc_2024_2028.csv", desc_rows(sys.argv[1]))
    write("gpc_irp2025_table2.csv", gpc_rows(sys.argv[2]))
