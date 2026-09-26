# Seamline: 3-minute demo

Before you start: open the app (`npm start`, then http://localhost:8000, or the GitHub Pages link), click **Overlaps**, basemap **Topo**, 3D off, no pair selected. Have an Anthropic API key already pasted in **Ask**. Keep the internet on (imagery, terrain, assistant).

## 0:00 – The problem (20 s)

> Utilities plan years ahead, each on its own. DESC and Georgia build right across the Savannah River from each other, and nobody lines up their crews, yards or outages. FERC Order 1920 exists because of this. Seamline finds where their plans meet, and more importantly, which of those meetings will actually happen.

*On screen: the map with both utilities along the river.*

## 0:20 – It reads the real plans (30 s)

> We didn't type coordinates in. A pipeline reads both PDFs from the challenge, all 44 DESC projects and 218 Georgia projects, including every Georgia project's detail page, and places each substation from OpenStreetMap. 10,304 pairs checked, 169 within 40 km. It reproduces all six overlaps in your reference table, and measures closest points, not centres, like the spec asks.

*Click **Checks**: show "2 PDFs → 262 official records", the 10 checks, open one (e.g. "Substation matches are in the project's own area") to show the records it caught.*

> Every number traces back to a PDF page and a TEAMS number. The checks caught real problems in the source, like plan pages with a start date after the need date.

## 0:50 – Plans move (45 s)

*Click **Changes**.*

> Here's what nobody else looked at. We compared two editions of each plan. 23 of 30 DESC projects slipped, a year at the median. Georgia moved dates both ways.

*Point at the histograms, then the "opened" list.*

> The last plan updates opened 9 shared windows and closed 3. Your reference overlap OVL_3 only exists because DESC moved Jasper–Okatie 11 months later.

*Click **Overlaps**, open the pair ranked #4 (Jasper – Okatie #2 × McIntosh Unit 12).*

> So Seamline turns that history into a chance. This pair is six months apart on paper, but there's a 68% chance both crews are in the field together, because DESC usually runs late. Pairs are ranked by expected savings, not by the plan's optimism. Of 41 pairs that overlap on paper, 23 probably won't.

## 1:35 – The real place (25 s)

*Click **Satellite**, then **3D**. Scroll in along the blue line.*

> This is the real terrain and imagery: the new 230 kV line with its towers, Plant McIntosh on the Georgia side, 4.3 km away. The side panel shows how each end point was located and the source page.

## 2:00 – What to do about it (30 s)

*Click **Optimize**.*

> Finding overlaps isn't enough; someone has to act. The optimizer finds 8 date moves, none bigger than 6 months, only on projects that haven't started, that raise expected savings from $13.7 million to $16.2 million. One click prints a joint proposal for both planning teams.

*Click **Joint brief** for a second, close it.*

## 2:30 – Ask it (20 s)

*Click **Ask**, click the suggestion "Which three date moves would save the most?" or type "Which overlaps near Augusta are most likely to happen?".*

> Planners can just ask. The assistant uses Claude with tools over the same data, so answers come from the plans, not from guesses, and it flies the map to what it's talking about.

## 2:50 – Close (10 s)

> Seamline: real plans, honest odds, and a concrete schedule both utilities can agree on. Thank you.

## If something breaks

- No imagery or 3D: stay on **Plain**. Everything else works offline.
- Assistant errors: skip the Ask step, show **Optimize** longer.
- Numbers to remember: 262 official records · 10,304 pairs · 169 overlaps · 6 of 6 reference overlaps · 23 of 30 DESC projects slipped · +9 / −3 windows · 68% (Jasper–Okatie × McIntosh 12) · $13.7M → $16.2M with 8 moves.
