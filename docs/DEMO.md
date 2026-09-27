# Nexxo: 3-minute demo

Before you start: serve the app (`npm start`, then http://localhost:8000, or the GitHub Pages link; the existing-grid layer needs it served, not opened from disk). Open http://localhost:8000 with nothing after it, so the page starts on the intro (a link with `#…` skips it). Inside the app: **Overlaps** in the left rail, basemap **Relief**, **Grid** on, 3D off, no pair selected. An Anthropic API key in **Geo** is optional: the suggested questions are answered without one. Keep the internet on (imagery, terrain, open-ended questions). Practise the walker drag once so you know where the orange figure is (right edge of the map, just above the locate and ruler buttons).

## 0:00 – The problem (20 s)

> Utilities plan years ahead, each on its own. DESC and Georgia build right across the Savannah River from each other, and nobody lines up their crews, yards or outages. FERC Order 1920 exists because of this. Nexxo finds where their plans meet, and more importantly, which of those meetings will actually happen.

*On screen: the intro page (open the bare address, without a `#`). Say the problem over it, then click **Open the map**. The thin grey lines underneath are today's grid, 10,092 real lines from OpenStreetMap; the bold ones are the plans.*

## 0:20 – It reads the real plans (25 s)

> We didn't type coordinates in. A pipeline reads both PDFs from the challenge, 44 DESC projects and 218 Georgia projects, including every Georgia project's detail page, and places each substation from OpenStreetMap. 10,304 pairs checked, 169 within 40 km, and it reproduces all six overlaps in your reference table, measured between closest points like the spec asks.

*Click **Checks**: point at "2 PDFs → 262 official records" and the 10 checks; open one to show the records it caught.*

> Every number traces back to a PDF page and a TEAMS number.

## 0:45 – Plans move (40 s)

*Click **Changes**.*

> Here's what nobody else looked at. We compared two editions of each plan: 23 of 30 DESC projects slipped, a year at the median. The last updates opened 9 shared windows and closed 3. Your reference overlap OVL_3 only exists because DESC moved Jasper–Okatie 11 months later.

*Click **Overlaps** in the rail, open the pair ranked #4 (Jasper – Okatie #2 × McIntosh Unit 12). The map flies to it.*

> So Nexxo turns that history into a chance. This pair is six months apart on paper, but there's a 68% chance both crews are in the field together, because DESC usually runs late. Pairs are ranked by expected savings, not by the plan's optimism.

*Scroll to **What they can share**.*

> And every pair is priced item by item, with the math on screen: one laydown yard instead of two, combined deliveries, one crew mobilization. For pair #6, 0.6 km apart, that includes 11 acres of right-of-way they don't have to buy twice. Every unit cost is editable.

## 1:25 – Walk the site (35 s)

*With the pair still open, drag the orange figure from the right edge of the map and drop it on the blue Jasper–Okatie line. (Keep the pair open: from the full-region view the lines are too thin to hit and the figure lands on whatever is nearest.)*

> Like Street View: drop the walker on any project and you're standing on the site.

*In the 3D view click once, hold **W** to walk toward the towers and move the mouse to look at the plant and the shared yard (Esc frees the mouse).*

> Towers, the other utility's work, the shared yard where one crew could stage both jobs. Distances on the ground are to scale.

*Close the 3D view. Click **Satellite**, then **3D** on the map.*

> And this is the real place: satellite imagery over real terrain, the new line's towers, Plant McIntosh 4.3 km away across the river.

## 2:00 – What to do about it (25 s)

*Click **Plan** in the rail (the schedule optimizer).*

> Finding overlaps isn't enough. The optimizer finds 8 date moves, none over 6 months, only on projects that haven't started, that raise expected savings from $13.6 million to $16.1 million, and prints a joint proposal for both planning teams.

*Click **Joint brief** to show the printable proposal, close it, then **More → Share this view**.*

> And any view is a link: a planner pastes it into an email and the other utility opens exactly this.

## 2:25 – Ask Geo (25 s)

*Click **Geo** in the left rail, click the suggestion "Which three date moves would save the most?" or type "Which overlaps near Augusta are most likely to happen?". If time allows, type "Why is DESCP-10 not paired with IRP-19523?".*

> Planners can just ask, in English or Spanish. With a key it's Claude with fourteen tools over the same data; without one, or if the network drops, the common questions are still answered straight from the plans, and it says so. It flies the map to what it's talking about, opens the printable briefs, and it can tell you why a pair is *not* on the list: this one is 40.4 km apart, just past the screen.

## 2:50 – Close (10 s)

> Nexxo: real plans, honest odds, a site you can walk, and a schedule both utilities can agree on. Thank you.

## If something breaks

- No imagery, terrain or grid: switch to **Plain**. Everything else works offline.
- Walker lands in the wrong place: press **Walk** to switch to the orbit view, or close and drop it again.
- Assistant errors: it falls back to answering without the model on its own; stick to the suggested questions. If even that fails, skip Geo and spend the time on Plan.
- Walker lands on the wrong pair: close the 3D view, open pair #4 from Overlaps first, then drop the figure on the blue line.
- Numbers to remember: 262 official records · 10,304 pairs · 169 overlaps · 6 of 6 reference overlaps · 23 of 30 DESC projects slipped · +9 / −3 windows · 68% (Jasper–Okatie × McIntosh 12) · $13.6M → $16.1M with 8 moves · 10,092 existing lines.
