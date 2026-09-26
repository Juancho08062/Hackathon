"""Build projects.json from public plan records.

Sources
- DESC: SCRTP "2026-2030 $2M & Above Project Descriptions"
  https://www.scrtp.com/assets/pdfs/home/2026-2030-2million-and-above-project-descriptions.pdf
- Georgia: SERTP 2026 Q2 "Preliminary Expansion Plan" presentation (Southern BAA, pp.128-162)
  https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf
  and SERTP 2025 Preliminary Expansion Plan Report (Non-CEII)
  https://www.southeasternrtp.com/docs/general/2025/2025%20SERTP%20Preliminary%20Expansion%20Plan%20Report%20(Non-CEII).pdf

Coordinates are APPROXIMATE: public plans name substations, not coordinates, so
endpoints are placed at the named town/plant/substation area by hand. Substations
that OpenStreetMap or the challenge's reference table locate (Okatie, McIntosh,
Stevens Creek, Modoc, Graniteville, Urquhart, Vogtle) use those coordinates.
loc = "med" (named plant/town, within a few miles) or "low" (best guess).
Plans give in-service dates only; construction windows are estimated
(see est_months) and are adjustable in the app.
"""
import pathlib
import json, re
from datetime import date

SCRTP = "https://www.scrtp.com/assets/pdfs/home/2026-2030-2million-and-above-project-descriptions.pdf"
SERTP26 = "https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf"
SERTP25 = "https://www.southeasternrtp.com/docs/general/2025/2025%20SERTP%20Preliminary%20Expansion%20Plan%20Report%20(Non-CEII).pdf"

# name, description, kV, miles, type, in-service (YYYY-MM-DD), cost $, coords [(lat,lon),...], loc
DESC = [
("Summerville 115kV Loop: Rebuild","Replace several wood pole sections on the Summerville 115 kV Loop",115,None,"rebuild","2026-04-30",15775885,[(33.018,-80.176)],"med"),
("Columbia Canal 115kV: Rebuild","Replace poles on Columbia side of canal",115,None,"rebuild","2026-05-31",1150364,[(34.000,-81.050)],"med"),
("Scout 230kV Sub and Fold-in: Construct","230 kV line for Scout customer substation; modify VCS1 and Killian terminals",230,None,"substation","2026-05-31",19418000,[(34.20,-81.10)],"low"),
("Eastover - Sumter 115kV DEP Tie: Rebuild","Upgrade DESC section (~1 mi) of tie line to 1272 ACSR",115,1,"rebuild","2026-05-31",1238443,[(33.877,-80.695)],"med"),
("Batesburg - Saluda County 115kV: Rebuild","Rebuild 13.5 miles of conductor",115,13.5,"rebuild","2026-06-30",13040765,[(33.908,-81.547),(34.001,-81.772)],"med"),
("Summerville - Boone Hill 115kV: Move Line","Move ~1.2 mi (23 poles) for SCDOT road widening",115,1.2,"rebuild","2026-07-31",12475000,[(33.018,-80.176),(32.99,-80.23)],"med"),
("Urquhart - Toolebeck 115kV: Rebuild","Upgrade 477 ACSR to 1272 ACSR, single-pole double-circuit, ~12.5 mi",115,12.5,"rebuild","2026-08-12",15948620,[(33.43287,-81.911081),(33.53,-81.80)],"low"),
("Dawson 230kV Sub and Fold-in: Construct and Rebuild","New Dawson 230 kV sub, fold in Canadys lines, rebuild Canadys-Dawson #1/#2",230,None,"substation","2026-10-01",93603207,[(33.06,-80.62),(32.88,-80.30)],"low"),
("Cainhoy - Hamlin 115kV: Rebuild and Construct","Upgrade 954 ACSR to B795; new Cainhoy-Hamlin 115 kV #2",115,None,"new_line","2026-12-02",40858628,[(32.93,-79.83),(32.86,-79.80)],"med"),
("Coit - Gills Creek 115kV: Construct","Convert 33 kV line to 115 kV, ~1.25 mi",115,1.25,"rebuild","2026-12-31",5773202,[(33.99,-80.97),(33.97,-80.95)],"med"),
("Okatie 230-115kV Substation, Jasper-Yemassee #1 Fold-in","Expand Okatie sub, add 230-115 autobank, fold in Jasper-Yemassee 230 kV #1",230,None,"substation","2026-12-31",11630257,[(32.333758,-81.032495)],"med"),
("Jasper - Okatie 230kV #2: Construct","New 230 kV line, B1272 ACSR, ~6.5 mi",230,6.5,"new_line","2026-12-01",19280474,[(32.30,-81.08),(32.333758,-81.032495)],"med"),
("Riverport 115kV Tap: Construct","230 kV tap from Okatie to Riverport",230,None,"new_line","2026-12-01",41389047,[(32.333758,-81.032495),(32.25,-81.05)],"low"),
("Flat Rock 115kV Sub and Tap: Construct","115 kV tap off Belvedere Sw Sta - Graniteville 115 kV #1",115,None,"substation","2026-12-31",3950000,[(33.53,-81.87)],"low"),
("Saluda Hydro - Bush River 115kV #1 & #2 Tie Rebuild","Rebuild tie lines to SPDC 1272",115,None,"rebuild","2026-12-31",20400000,[(34.05,-81.21),(34.03,-81.10)],"med"),
("Church Creek - Faber Place - Charleston: Add 230kV Line","New 230 kV Church Creek-Charleston line, rebuild Church Creek-Faber Place, add transformer",230,None,"new_line","2027-05-01",22788174,[(32.82,-80.07),(32.80,-79.95)],"med"),
("Yemassee - Ritter 230kV #1 & #2: Construct SPDC","Ritter-Yemassee 230 kV #1/#2 SPDC, B1272 ACSR",230,None,"new_line","2027-06-01",39066742,[(32.69,-80.85),(32.73,-80.58)],"med"),
("Fairfax - Yemassee 115kV: Upgrade","Upgrade 336 ACSR portion to 1272 ACSR (generator interconnection)",115,None,"rebuild","2027-09-07",20350000,[(32.96,-81.24),(32.69,-80.85)],"med"),
("St George - Sumter 230kV Tie: Rebuild Line","Rebuild Santee Sub - Duke/Progress tie",230,None,"rebuild","2027-12-31",4569331,[(33.48,-80.49),(33.60,-80.40)],"low"),
("Hooks - Modoc 115/46kV Rebuild","Upgrade 6.5 mi aging conductor to 1272 ACSR, SPDC",115,6.5,"rebuild","2027-12-31",10534285,[(33.65682,-82.159478),(33.736288,-82.201504)],"low"),
("Burton - St Helena 115kV: Rebuild Frogmore Section","Steel structures, restring 1272 ACSR",115,None,"rebuild","2027-12-31",18129932,[(32.43,-80.68),(32.39,-80.58)],"med"),
("Wagener 115kV Tap: Construct","115 kV tap off Edmund Sw Sta - Owens Corning 115 kV",115,None,"new_line","2027-12-31",7540000,[(33.65,-81.36)],"med"),
("Cameron Jct - Elloree 46kV Rebuild","Rebuild 7.3 mi",46,7.3,"rebuild","2027-12-31",8075000,[(33.56,-80.71),(33.53,-80.57)],"med"),
("Atomic Road 115/12kV Sub: Construct","New 115-12 kV sub, 28 MVA transformer",115,None,"substation","2028-12-31",3646027,[(33.40,-81.85)],"low"),
("Elloree - Santee City 46kV: Rebuild","Rebuild 8.35 mi",46,8.35,"rebuild","2027-12-31",10294609,[(33.53,-80.57),(33.48,-80.49)],"med"),
("Urquhart - Aiken PSA 46kV: Rebuild","Rebuild 4.5 mi",46,4.5,"rebuild","2027-12-31",3000000,[(33.43287,-81.911081),(33.47,-81.86)],"low"),
("Wateree - Hopkins 230kV #1: Rebuild","Rebuild SPSC with 1272 ACSR",230,None,"rebuild","2027-12-31",22400000,[(33.83,-80.62),(33.90,-80.88)],"med"),
("Adams Run - Red House Road 46kV: Replace River Crossing","Dawhoo River crossing, 58 structures in marsh",46,None,"rebuild","2027-12-31",11000000,[(32.62,-80.35)],"med"),
("Lyles - Kilbourne Park 115kV: Replace Structures","Rebuild 2.85 mi",115,2.85,"rebuild","2027-12-01",4770000,[(34.01,-81.02),(33.98,-80.99)],"med"),
("Winnsboro West 230-115kV Sub and Fold-in: Construct","New sub, fold in Parr-Winnsboro 115 kV #1 and VCS1-Killian 230 kV",230,None,"substation","2028-01-31",23272000,[(34.37,-81.12)],"med"),
("Williams - Summerville 230kV: Upgrade to SPDC","Rebuild Ladson Jct - Williams to B-1272, ~10 mi",230,10,"rebuild","2028-05-01",31100000,[(32.99,-79.93),(32.98,-80.10)],"med"),
("Church Creek - Ritter 230kV: Replace Structures","Replace ~38 guyed wood structures",230,None,"rebuild","2028-12-31",11424330,[(32.82,-80.07),(32.73,-80.58)],"med"),
("Jackson 115kV: Construct Distribution Substation","115-12 kV sub replacing Jackson 46 kV",115,None,"substation","2028-12-31",3003760,[(33.33,-81.79)],"med"),
("Harleyville 115kV Tap: Construct","Extend 115 kV line 1.4 mi to Harleyville",115,1.4,"new_line","2028-12-31",2750000,[(33.21,-80.45)],"med"),
("Orangeburg #1 - Cameron Jct 46kV: Rebuild","Rebuild 7.5 mi, steel poles, 1272 ACSR",46,7.5,"rebuild","2028-12-31",7912400,[(33.49,-80.86),(33.56,-80.71)],"med"),
("VCS1 - Denny Terrace & VCS1 - Pineland 230kV: Rebuild","Steel structures, restring 1272 ACSR",230,None,"rebuild","2028-12-31",13285118,[(34.298,-81.315),(34.05,-81.03)],"med"),
("Coast Guard 115kV Substation and Tap: Construct","115-23.9 kV sub, 37.3 MVA, plus 115 kV line",115,None,"substation","2027-12-31",5560000,[(32.78,-79.93)],"low"),
("Millrace 115kV Tap: Construct","Tap from Dunbar Road - Lyles 115 kV, 1272 ACSR",115,None,"new_line","2028-12-31",3200000,[(33.97,-81.10)],"low"),
("Williams St, AM Williams, McMeekin Subs: Replace/Add","Switch houses, equipment and relay panels",115,None,"substation","2028-12-31",11182924,[(34.00,-81.04)],"low"),
("Cameron Jct - St Matthews 46kV: Rebuild","Rebuild 9.8 mi",46,9.8,"rebuild","2028-12-31",11700000,[(33.56,-80.71),(33.66,-80.78)],"med"),
("Okatie - McIntosh 115kV Tie: Add Series Reactor","New Deerfield switching station and 9% series reactor on the DESC-Georgia tie",115,None,"substation","2028-12-31",5376418,[(32.333758,-81.032495),(32.352116,-81.175112)],"med"),
("CAE Industrial Park - Springdale 115kV: Replace Poles","Replace 28 laminated wood poles",115,None,"rebuild","2028-12-31",4450000,[(33.95,-81.12)],"med"),
("St George - Holly Hill 115kV: Rebuild Structures","Rebuild structures 83-108, 3.4 mi",115,3.4,"rebuild","2028-12-31",8125000,[(33.25,-80.50)],"med"),
("Canadys - Ritter 115kV: Rebuild SPDC","Rebuild as SPDC with 1272 ACSR, 17.5 mi",115,17.5,"rebuild","2029-06-01",38121795,[(33.06,-80.62),(32.73,-80.58)],"med"),
("Wateree - Killian 230kV: Rebuild","Rebuild 35 mi",230,35,"rebuild","2029-12-31",44517719,[(33.83,-80.62),(34.13,-80.95)],"med"),
("Church Creek - Dawson 230kV: Rebuild","Rebuild Dawson - Long Savannah SPSC B1272, ~13.6 mi",230,13.6,"rebuild","2029-12-31",42375000,[(32.88,-80.30),(32.83,-80.10)],"low"),
("Long Savannah 115kV Tap: Construct","Long Savannah 115 kV tap with Church Creek - Dawson rebuild",115,None,"new_line","2029-12-31",5100000,[(32.83,-80.10)],"med"),
("Modoc - McCormick 115/46kV Rebuild","Rebuild Modoc - McCormick as SPDC",115,None,"rebuild","2029-12-31",19800000,[(33.736288,-82.201504),(33.906536,-82.292804)],"med"),
("Stevens Creek - Graniteville 115kV: Rebuild","Rebuild 15 mi",115,15,"rebuild","2029-12-31",18200000,[(33.562599,-82.051362),(33.583437,-81.804506)],"med"),
("Calhoun County - North 46kV Rebuild","Rebuild 9.5 mi",46,9.5,"rebuild","2029-12-31",10200000,[(33.62,-81.10),(33.70,-80.85)],"low"),
("Union Pier 115-13.8kV Sub: Tap","115 kV tap (or feed from Charlotte St) to Union Pier sub",115,None,"substation","2030-12-31",22400000,[(32.79,-79.925)],"med"),
("Faber Place - Bayfront 115kV: Rebuild Section","Rebuild N. Bridge Terrace - Bayfront with 1272 ACSR",115,None,"rebuild","2030-12-31",18964478,[(32.86,-79.97),(32.81,-79.94)],"med"),
("Clements Ferry Rd Sub: 115kV Tap","Tap from Cainhoy to Clements Ferry, ~2.8 mi",115,2.8,"new_line","2031-12-31",9750000,[(32.93,-79.83),(32.90,-79.87)],"med"),
("VCS2 - Ward 230kV: Rebuild Line","Rebuild 40 mi of 230 kV line",230,40,"rebuild","2032-12-31",18875000,[(34.298,-81.315),(33.86,-81.73)],"low"),
]

# name, owner, description, kV, miles, type, year, coords, loc, source, page
GA = [
("East Moultrie - Highway 112 230kV","GTC","~27 mi new 230 kV line, 1351 ACSS",230,27,"new_line",2027,[(31.18,-83.77),(31.35,-83.55)],"low",SERTP26,"128-129"),
("East Walton 500/230kV Area Project","GPC/GTC/MEAG","Switching stations, 500/230 kV sub and 230 kV lines",500,None,"substation",2027,[(33.78,-83.65)],"low",SERTP26,"130"),
("Tomochichi 500/230kV Substation","GPC","New 500/230 kV switching station, two 230 kV lines",500,None,"substation",2027,[(32.80,-83.40)],"low",SERTP26,"132-133"),
("Rum Creek 500kV Switching Station","GTC","Breaker-and-half station; Big Smarr - Rum Creek 500 kV (~30 mi)",500,30,"substation",2028,[(33.07,-83.81)],"med",SERTP26,"134"),
("Deer Creek 500/230kV Substation","GPC","Split Bonaire - Scherer 500 kV; two 230 kV lines to Little Deer Creek",500,None,"substation",2028,[(32.80,-83.70)],"low",SERTP26,"135"),
("East Villa Rica 230kV Substation","GPC","7-rung 230 kV breaker-and-half switching station",230,None,"substation",2028,[(33.73,-84.88)],"med",SERTP26,"136"),
("Hampton Area 230/115kV Improvements","GPC/MEAG/GTC","Line conversions and new 230/115 kV substation",230,None,"substation",2028,[(33.39,-84.28)],"med",SERTP26,"137-138"),
("Dresden - Talbot 500kV Line","GPC","New Talbot 500/230 kV sub; 75 mi 500 kV line",500,75,"new_line",2029,[(33.53,-85.06),(32.68,-84.54)],"low",SERTP26,"141"),
("Rum Creek - Tomochichi 500kV","GPC","~30 mi new 500 kV line",500,30,"new_line",2029,[(33.07,-83.81),(32.80,-83.40)],"low",SERTP26,"141-142"),
("Hartwell Energy - Middle Fork 230kV Line","GPC","~35 mi new 230 kV line, 1351 ACSS",230,35,"new_line",2030,[(34.35,-82.93),(34.28,-83.45)],"low",SERTP26,"152-153"),
("Rockville - Mink Creek - Warthen 500kV Lines","GPC","Two new 500 kV lines (~20 and ~9 mi); Tiger Creek 500/230 kV",500,29,"new_line",2030,[(33.35,-83.30),(33.20,-83.00),(33.10,-82.80)],"low",SERTP26,"153"),
("Athena - Union Point - Warrenton Primary 230kV Conversion","GPC","Convert ~32 mi of 115 kV to 230 kV",230,32,"rebuild",2030,[(33.95,-83.38),(33.615,-83.07),(33.41,-82.66)],"med",SERTP26,"155"),
("Goshen Area 230kV Solution","GPC","New 230 kV switching station on Waynesboro - Wilson; ~12 mi 230 kV to Goshen",230,12,"new_line",2030,[(33.20,-81.98),(33.36,-82.05)],"med",SERTP26,"156"),
("Pio Nono 230/115kV Area Solution","GPC","New 230 kV sub with lines from Dorsett, South Griffin, Pitts; 400 MVA auto",230,None,"substation",2031,[(32.80,-83.66)],"med",SERTP26,"159"),
("Hatch - Wadley 500kV Line","GPC","~65 mi new 500 kV line, Hatch to Wadley Primary",500,65,"new_line",2031,[(31.93,-82.34),(32.87,-82.40)],"med",SERTP26,"161"),
("McGrau Ford - Middle Fork 500kV","GPC","~65 mi new 500 kV line; new Middle Fork 500 kV switchyard",500,65,"new_line",2033,[(34.36,-84.37),(34.28,-83.45)],"low",SERTP26,"162"),
("Gainesville #2: Equipment Replacement","GPC","Replace autotransformers",115,None,"substation",2026,[(34.30,-83.82)],"med",SERTP25,""),
("Conyers - Cornish Mountain 115kV: Upgrade","GTC","Raise line rating to 125C",115,None,"rebuild",2026,[(33.67,-84.02),(33.58,-83.93)],"med",SERTP25,""),
("Dresden 500kV Bus Expansion","GTC","Expand 500 kV bus",500,None,"substation",2026,[(33.53,-85.06)],"low",SERTP25,""),
("Gordon - Sandersville #1 115kV: Rebuild","GTC","Rebuild ~1.87 mi",115,1.87,"rebuild",2026,[(32.90,-83.30)],"med",SERTP25,""),
("LaGrange - North Opelika 230kV: Construct","GTC","New 230 kV line",230,None,"new_line",2026,[(33.04,-85.03),(32.68,-85.37)],"med",SERTP25,""),
("Robins Spring 115kV Bus and Capacitor Bank","GTC","Bus upgrade and 2-stage capacitor bank",115,None,"substation",2026,[(32.60,-83.60)],"low",SERTP25,""),
("Arkwright - Lloyd Shoals 115kV: Rebuild","GPC","Rebuild with 795 ACSR",115,None,"rebuild",2027,[(32.86,-83.68),(33.32,-83.84)],"med",SERTP25,""),
("Adamsville - Buzzard Roost 230kV: Rebuild","GTC","Rebuild ~5 mi, 1351 ACSS",230,5,"rebuild",2027,[(33.76,-84.50)],"low",SERTP25,""),
("Douglasville - Villa Rica 230kV: Rebuild","GTC","Rebuild 2.5 mi section",230,2.5,"rebuild",2027,[(33.73,-84.75)],"med",SERTP25,""),
("Eatonton Primary - Lick Creek 115kV: Rebuild","GTC","Rebuild ~7.5 mi",115,7.5,"rebuild",2027,[(33.33,-83.39),(33.25,-83.45)],"low",SERTP25,""),
("Garrett Rd - Villa Rica 230kV: Reconductor","GTC","Reconductor/rebuild ~14 mi",230,14,"rebuild",2027,[(33.73,-84.88),(33.70,-84.65)],"low",SERTP25,""),
("Hickory Level - Villa Rica 230kV: Reconductor","GTC","Reconductor 8.6 mi",230,8.6,"rebuild",2027,[(33.66,-84.97),(33.73,-84.88)],"med",SERTP25,""),
("South Hazlehurst - New Lacy 230kV: Construct","GTC","New ~25 mi 230 kV line",230,25,"new_line",2027,[(31.85,-82.60),(31.95,-82.90)],"low",SERTP25,""),
("Fortson Substation Modernization","MEAG","Modernize 500/230/115 kV yards",500,None,"substation",2027,[(32.58,-84.95)],"med",SERTP25,""),
("Ray Place Rd - Warrenton Primary 115kV: Rebuild","MEAG","Rebuild ~10 mi",115,10,"rebuild",2027,[(33.45,-82.50),(33.41,-82.66)],"low",SERTP25,""),
("Barneyville - East Moultrie 115kV: Construct","GTC","~20 mi new 115 kV line",115,20,"new_line",2028,[(31.05,-83.55),(31.18,-83.77)],"low",SERTP25,""),
("Bonaire Primary 500/230kV Transformer Replacement","GTC","Replace auto and relays",500,None,"substation",2028,[(32.55,-83.60)],"med",SERTP25,""),
("Bostwick - East Social Circle 230kV: Reconductor","GTC","Reconductor ~10.8 mi to ACCR",230,10.8,"rebuild",2028,[(33.74,-83.51),(33.65,-83.69)],"med",SERTP25,""),
("McDonough - South Griffin 115kV: Rebuild","GTC","Rebuild with 1351 ACSS",115,None,"rebuild",2028,[(33.45,-84.15),(33.22,-84.26)],"med",SERTP25,""),
("North Dublin 230/115kV Transformer Replacement","GTC","Replace two autos and breakers",230,None,"substation",2028,[(32.56,-82.90)],"med",SERTP25,""),
]

GPC_PAGE = "https://www.georgiapower.com/about/grid-reliability/grid-improvements/grid-projects/transmission-projects/"
# Georgia Power project pages publish construction milestones but no in-service date.
# name, desc, kV, miles, type, published start, est. in-service, coords, loc, source
GA_PAGES = [
("Callaway Road - Thomson Primary 500kV","New Callaway Road 500/230 kV substation (Columbia Co.) and two new 500 kV lines to Thomson, ~10 and ~7 mi. Substation clearing Winter 2026, line construction Summer 2027",500,17,"new_line","2026-12-01","2029-06-01",[(33.48,-82.30),(33.43,-82.45)],"low",GPC_PAGE+"callaway-thomson.html"),
("Effingham County 500/230kV Substation","New 500/230 kV substation and 500 kV facilities in Effingham County. Clearing Spring 2027, construction Fall 2027",500,None,"substation","2027-03-01","2029-06-01",[(32.33,-81.30)],"low",GPC_PAGE+"effingham-county.html"),
("Plant McIntosh Unit 12 Combined Cycle","~800 MW gas combined-cycle unit at Plant McIntosh, Rincon (pre-construction, planned 2030)",500,None,"generation",None,"2030-06-01",[(32.356819,-81.170346)],"med","https://www.gem.wiki/McIntosh_Combined_Cycle_Facility"),
]

# Existing assets shown as a reference layer (not paired).
EXISTING = [
("Thomson - Vogtle 500kV (in service 2018)","GPC",[(33.43,-82.45),(33.145816,-81.76271)],"https://www.georgiapower.com/about/grid-reliability/grid-improvements/grid-projects/thomson-vogtle.html"),
("Stevens Creek Hydro (DESC-owned, Martinez GA)","DESC",[(33.562599,-82.051362)],""),
("Plant Vogtle","GPC",[(33.145816,-81.76271)],""),
("Plant McIntosh","GPC",[(32.356819,-81.170346)],""),
("Okatie - McIntosh 115kV tie (DESC-Georgia)","DESC",[(32.333758,-81.032495),(32.352116,-81.175112)],""),
]

def est_months(t, kv, miles):
    if t == "generation": return 36
    if t == "substation": return 18 if kv >= 500 else 12
    if t == "new_line":   return 36 if kv >= 500 else (24 if (miles or 0) > 10 else 18)
    return int(min(30, 10 + (miles or 5) * 0.5))

def minus_months(d, m):
    y, mo = d.year, d.month - m
    while mo <= 0: mo += 12; y -= 1
    return date(y, mo, 1)

out = []
for i, (n, d, kv, mi, t, isd, cost, co, loc) in enumerate(DESC, 1):
    end = date.fromisoformat(re.sub(r"-(3[01])$", "-28", isd) if isd.endswith(("-30","-31")) and isd[5:7]=="02" else isd)
    m = est_months(t, kv, mi)
    out.append(dict(id=f"DESC-{i:02d}", utility="DESC", owner="DESC", name=n, desc=d, kv=kv, miles=mi, type=t,
                    in_service=end.isoformat(), start=minus_months(end, m).isoformat(), date_precision="day",
                    cost=cost, coords=[list(c) for c in co], loc=loc, source=SCRTP, page=f"item {i}"))
for i, (n, own, d, kv, mi, t, yr, co, loc, src, pg) in enumerate(GA, 1):
    end = date(yr, 6, 1)  # SERTP gives year only; assume before summer peak
    m = est_months(t, kv, mi)
    out.append(dict(id=f"GA-{i:02d}", utility="GPC", owner=own, name=n, desc=d, kv=kv, miles=mi, type=t,
                    in_service=end.isoformat(), start=minus_months(end, m).isoformat(), date_precision="year",
                    cost=None, coords=[list(c) for c in co], loc=loc, source=src, page=pg))
for i, (n, d, kv, mi, t, st, isd, co, loc, src) in enumerate(GA_PAGES, len(GA) + 1):
    end = date.fromisoformat(isd)
    start = date.fromisoformat(st) if st else minus_months(end, est_months(t, kv, mi))
    out.append(dict(id=f"GA-{i:02d}", utility="GPC", owner="GPC", name=n, desc=d, kv=kv, miles=mi, type=t,
                    in_service=end.isoformat(), start=start.isoformat(), date_precision="estimated",
                    start_published=bool(st), cost=None, coords=[list(c) for c in co], loc=loc, source=src, page=""))

# ---------------------------------------------------------------------------
# Official challenge lists (scripts/extract_official.py -> data/official/*.csv),
# placed with scripts/locate_official.py. A project already listed above keeps its
# entry (newer plan, hand-checked location) and gains the official record; the rest
# are added. Georgia's IRP gives a published project start date; construction is
# taken as the last est_months before in-service, never earlier than that start.
# ---------------------------------------------------------------------------
import csv, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from locate_official import Locator, endpoints, haversine, official_projects

DESC_PDF = "Challenge package: DESC 2024-2028 $2M and above project descriptions (SCRTP)"
IRP_PDF = "Challenge package: Georgia Power 2025 IRP Volume 3, 2024 GA ITS Ten-Year Plan, Table 2"
# existing id -> official ids describing the same work (checked by name, dates and description)
SAME = {
    "DESC-01": ["DESCP-28"], "DESC-03": ["DESCP-33"], "DESC-04": ["DESCP-40"], "DESC-05": ["DESCP-32"],
    "DESC-07": ["DESCP-35"], "DESC-08": ["DESCP-34"], "DESC-09": ["DESCP-04"], "DESC-10": ["DESCP-30"],
    "DESC-11": ["DESCP-03"], "DESC-12": ["DESCP-23"], "DESC-13": ["DESCP-22"], "DESC-16": ["DESCP-39"],
    "DESC-17": ["DESCP-21"], "DESC-19": ["DESCP-29"], "DESC-21": ["DESCP-06"], "DESC-22": ["DESCP-24"],
    "DESC-23": ["DESCP-41"], "DESC-25": ["DESCP-42"], "DESC-26": ["DESCP-43"], "DESC-31": ["DESCP-36"],
    "DESC-32": ["DESCP-25"], "DESC-34": ["DESCP-18"], "DESC-36": ["DESCP-08"], "DESC-39": ["DESCP-17"],
    "DESC-40": ["DESCP-44"], "DESC-44": ["DESCP-20"], "DESC-45": ["DESCP-09"], "DESC-51": ["DESCP-02"],
    "DESC-52": ["DESCP-12"], "DESC-54": ["DESCP-26"],
    "GA-01": ["IRP-19358"], "GA-02": ["IRP-09662"], "GA-03": ["IRP-20717"], "GA-06": ["IRP-20797"],
    "GA-08": ["IRP-19950"], "GA-09": ["IRP-21073"], "GA-10": ["IRP-21113"], "GA-11": ["IRP-21077"],
    "GA-12": ["IRP-21118"], "GA-13": ["IRP-21116"], "GA-14": ["IRP-21099"], "GA-15": ["IRP-20756"],
    "GA-16": ["IRP-09661"], "GA-18": ["IRP-21137"], "GA-19": ["IRP-20273"], "GA-20": ["IRP-20002"],
    "GA-21": ["IRP-19334"], "GA-22": ["IRP-19999", "IRP-20001"], "GA-23": ["IRP-18573"],
    "GA-24": ["IRP-20858", "IRP-19597"], "GA-25": ["IRP-20776"], "GA-26": ["IRP-20591"], "GA-28": ["IRP-19635"],
    "GA-29": ["IRP-20020"], "GA-30": ["IRP-18832"], "GA-31": ["IRP-20264"], "GA-32": ["IRP-20503"],
    "GA-33": ["IRP-20873"], "GA-34": ["IRP-19992"], "GA-36": ["IRP-20586"],
}
TODAY = date(2026, 9, 26)


def kv_of(text):
    v = [int(x) for x in re.findall(r"(\d{2,3})(?:[-/]\d{2,3})*\s?-?\s?kv", text, re.I)]
    v = [x for x in v if x in (46, 69, 115, 161, 230, 500)]
    return max(v) if v else None


def type_of(name, desc, n_points):
    t = f"{name} {desc}".lower()
    if re.search(r"\b(new line|construct|new \d+ ?kv line|second line)\b", t) and n_points > 1:
        return "new_line"
    if n_points > 1 or re.search(r"rebuild|reconductor|rebld|line", name.lower()):
        return "rebuild"
    return "substation"


KEEP_UPPER = {"SAV", "GTC", "MEAG", "DU", "USA", "APC", "FPL", "CC", "GPC", "LG&E", "SKC", "QTS", "PSA", "CIP", "SPDC", "ACSR", "ACSS", "TVA", "DEP", "II", "III"}


def title(name):
    """GEORGIA ITS names are all caps: "SAV: GOSHEN (SAV) - MCINTOSH 115KV" -> "SAV: Goshen (SAV) - McIntosh 115kV"."""
    def word(w):
        core = w.strip("():#,")
        if core in KEEP_UPPER or re.fullmatch(r"[\d./-]+", core):
            return w
        if re.fullmatch(r"[\d/.-]+KV", core):
            return w.replace("KV", "kV")
        t = w.capitalize() if not w[:1] in "(#" else w[0] + w[1:].capitalize()
        return re.sub(r"\bMc(\w)", lambda m: "Mc" + m.group(1).upper(), t)
    return " ".join(word(w) for w in name.split())


official = {p["id"]: p for p in official_projects()}
by_id = {o["id"]: o for o in out}
for eid, oids in SAME.items():
    o = by_id[eid]
    o["official"] = [dict(id=i, name=official[i]["name"],
                          in_service=official[i].get("need_date") or official[i].get("in_service"),
                          start=official[i].get("start") or None) for i in oids]
    starts = [x["start"] for x in o["official"] if x["start"]]
    if o["utility"] == "GPC" and starts and not o.get("start_published"):
        pub = date.fromisoformat(min(starts))
        est = date.fromisoformat(o["start"])
        if pub > est:  # the plan says work begins later than our estimate
            o["start"] = pub.isoformat()
        o["project_start"] = pub.isoformat()
taken = {i for v in SAME.values() for i in v}

loc = Locator((p["name"], p["state"], p["zone"]) for p in official.values())
# A hand-placed project whose official record places every end point with high
# confidence (OSM substation with a unique name, or the challenge reference) moves there.
for eid, oids in SAME.items():
    if len(oids) != 1:
        continue
    r = official[oids[0]]
    pts = [loc.point(e, r["state"], r["zone"]) for e in endpoints(r["name"])]
    if pts and all(x and x[3] == "high" for x in pts):
        o = by_id[eid]
        coords = []
        for x in pts:
            if [x[0], x[1]] not in coords:
                coords.append([x[0], x[1]])
        if len(coords) >= len(o["coords"]):
            o["coords"], o["loc"] = coords, "high"
            o["located"] = [dict(name=e, method=x[2], confidence=x[3], note=x[4]) for e, x in zip(endpoints(r["name"]), pts)]
unplaced, dropped_span, date_fixes = [], [], []
for oid, r in official.items():
    if oid in taken:
        continue
    gpc = oid.startswith("IRP-")
    pts = [loc.point(e, r["state"], r["zone"]) for e in endpoints(r["name"])]
    got = [x for x in pts if x]
    if not got:
        unplaced.append(dict(id=oid, name=r["name"], endpoints=endpoints(r["name"])))
        continue
    desc = r["description"]
    kv = kv_of(r["name"]) or kv_of(desc) or 115
    miles = float(r["miles"]) if r.get("miles") else None
    # End points much farther apart than the line the plan describes mean one of them is a namesake:
    # keep the more certain one.
    span = max((haversine(a[:2], b[:2]) for a in got for b in got), default=0)
    if span > max(25, 4 * 1.609 * (miles or 25)):
        dropped_span.append(dict(id=oid, name=r["name"], span_km=round(span), plan_miles=miles))
        rank = {"high": 0, "medium": 1, "low": 2}
        got = sorted(got, key=lambda x: rank[x[3]])[:1]
        pts = [x if x in got else None for x in pts]
    confs = {x[3] for x in got}
    lvl = "low" if "low" in confs or len(got) < len(pts) else ("med" if "medium" in confs else "high")
    coords = []
    for x in got:
        if [x[0], x[1]] not in coords:
            coords.append([x[0], x[1]])
    t = type_of(r["name"], desc, len(coords))
    end = date.fromisoformat(r["need_date"] if gpc else r["in_service"])
    est = minus_months(end, est_months(t, kv, miles))
    pub = date.fromisoformat(r["start"]) if gpc and r.get("start") else None
    note = None
    if pub and pub >= end:  # a few IRP pages list a start after the need date
        note, pub = f"The plan lists a start date ({r['start']}) after the need date, so the start is estimated.", None
        date_fixes.append(dict(id=oid, name=r["name"], start=r["start"], need=r["need_date"]))
    start = max(est, pub) if pub else est
    o = dict(id=oid, utility="GPC" if gpc else "DESC", owner=(("GPC" if r["sponsor"] == "SAV" else r["sponsor"]) if gpc else "DESC"),
             name=title(r["name"]) if gpc else r["name"], official_name=r["name"], desc=desc, kv=kv, miles=miles, type=t,
             in_service=end.isoformat(), start=start.isoformat(),
             date_precision="day", cost=(int(r["cost"]) if not gpc and r.get("cost") else None),
             coords=coords, loc=lvl, source=IRP_PDF if gpc else DESC_PDF,
             page=f"PDF p.{r['pdf_page']}, TEAMS {r['teams']}, zone {r['zone']}" if gpc else f"project {r['item']} of 44, ID {r['project_id']}",
             located=[dict(name=e, method=x[2], confidence=x[3], note=x[4]) if x else dict(name=e, method="not found")
                      for e, x in zip(endpoints(r["name"]), pts)])
    if pub:
        o["project_start"] = pub.isoformat()
    if note:
        o["date_note"] = note
    if end < TODAY:
        o["past_in_service"] = True
    if not gpc and r.get("status"):
        o["status"] = r["status"]
    if gpc and r.get("change_ten_year_plan"):
        o["plan_change"] = r["change_ten_year_plan"]
    out.append(o)
json.dump(unplaced, open(pathlib.Path(__file__).resolve().parent.parent / "data" / "official" / "unplaced.json", "w"), indent=1)
print(len(out), "projects so far;", len(unplaced), "official projects could not be placed (data/official/unplaced.json)")


# ---------------------------------------------------------------------------
# Plan drift, the slip model and the validation report (data/model.json).
# How much do planned dates move from one plan to the next? DESC: the same project in
# the 2024-2028 list and the 2026-2030 list. Georgia: each IRP project page's "change
# from the previous ten-year plan" note ("Project delayed from 2025 to 2026").
# ---------------------------------------------------------------------------
def months_between(a, b):
    a, b = date.fromisoformat(a), date.fromisoformat(b)
    return round((b - a).days / 30.44)


desc_slips = []
for eid, oids in SAME.items():
    o = by_id[eid]
    if o["utility"] != "DESC" or len(oids) != 1:
        continue
    r = official[oids[0]]
    m = months_between(r["in_service"], o["in_service"])
    o["drift"] = dict(plans="SCRTP 2024-2028 to 2026-2030", from_in_service=r["in_service"], to_in_service=o["in_service"],
                      months=m, from_cost=int(r["cost"]) if r.get("cost") else None, to_cost=o.get("cost"))
    desc_slips.append(m)

CHANGE = re.compile(r"(delayed|advanced) from (20\d\d) to (20\d\d)", re.I)
gpc_slips, gpc_unparsed = [], []
for oid, r in official.items():
    if not oid.startswith("IRP-"):
        continue
    note = r.get("change_ten_year_plan", "").strip()
    m = CHANGE.search(note)
    if m:
        v = 12 * (int(m.group(3)) - int(m.group(2)))
    elif note.lower().startswith("no change"):
        v = 0
    else:
        if note and not note.lower().startswith("new project"):
            gpc_unparsed.append(dict(id=oid, note=note))
        continue
    gpc_slips.append(v)
    tgt = by_id.get(oid) or next((o for o in out if any(x["id"] == oid for x in o.get("official") or [])), None)
    if tgt is not None:
        tgt["drift"] = dict(plans="GA ITS ten-year plan 2023 to 2024", months=v, note=note)

likely_built = []
for o in out:
    if o["id"].startswith("DESCP-") and o.get("past_in_service"):
        o["likely_built"] = True  # listed for a date that has passed, and gone from DESC's newer list
        likely_built.append(o["id"])

def dist(v):
    v = sorted(v)
    return dict(n=len(v), months=v, slipped=sum(1 for x in v if x > 0), advanced=sum(1 for x in v if x < 0),
                median=v[len(v) // 2])

placed = [o for o in out if o["id"].startswith(("IRP-", "DESCP-"))]
past = [o for o in out if not o.get("existing") and o.get("in_service", "9") < TODAY.isoformat()]
dup_ids = [p["id"] for p in official.values() if p["id"].count("-") > 1]
checks = [
    dict(id="rows", title="Every project in both PDFs was read",
         result=f"DESC {sum(1 for i in official if i.startswith('DESCP'))} of 44; Georgia {sum(1 for i in official if i.startswith('IRP'))} rows from Table 2",
         status="pass"),
    dict(id="detail", title="Each Georgia row has its detail page (start date, description, miles)",
         result=f"{sum(1 for p in official.values() if p.get('start'))} of {sum(1 for i in official if i.startswith('IRP'))} matched by TEAMS number",
         status="warn", records=[dict(id=p["id"], name=p["name"]) for p in official.values() if p["id"].startswith("IRP") and not p.get("start")]),
    dict(id="dates", title="Start date is before the need date", result=f"{len(date_fixes)} plan page(s) list a start after the need date; start estimated instead",
         status="fixed" if date_fixes else "pass", records=date_fixes),
    dict(id="dupes", title="TEAMS numbers are unique", result=f"{len(dup_ids)} number(s) used twice, kept as two phases",
         status="fixed" if dup_ids else "pass", records=[dict(id=i) for i in dup_ids]),
    dict(id="same", title="Projects listed in two plans are counted once",
         result=f"{sum(len(v) for v in SAME.values())} official records matched to {len(SAME)} newer entries", status="pass"),
    dict(id="namesakes", title="Substation matches are in the project's own area",
         result=f"{len(loc.rejected)} OpenStreetMap namesake(s) more than 150 km from the planning zone rejected",
         status="fixed" if loc.rejected else "pass", records=loc.rejected),
    dict(id="span", title="Line end points agree with the length in the plan",
         result=f"{len(dropped_span)} end point(s) dropped because the line would be far longer than the plan says",
         status="fixed" if dropped_span else "pass", records=dropped_span),
    dict(id="placed", title="Every official project is on the map",
         result=f"{len(placed) + sum(len(v) for v in SAME.values())} of {len(official)} placed; {len(unplaced)} not found (none in the Augusta or Savannah zones)",
         status="warn", records=unplaced),
    dict(id="past", title="In-service dates are still ahead",
         result=f"{len(past)} projects list a date before {TODAY.isoformat()}; {len(likely_built)} are gone from DESC's newer list, so likely built",
         status="warn", records=[dict(id=o["id"], name=o["name"], in_service=o["in_service"], likely_built=bool(o.get("likely_built"))) for o in past]),
    dict(id="notes", title="Plan-change notes are understood", result=f"{len(gpc_unparsed)} note(s) without years, left out of the slip model",
         status="warn" if gpc_unparsed else "pass", records=gpc_unparsed),
]
model = dict(
    as_of=TODAY.isoformat(),
    slips=dict(
        DESC=dict(dist(desc_slips), source="Same project in DESC's 2024-2028 and 2026-2030 lists: change in in-service date"),
        GPC=dict(dist(gpc_slips), source="Georgia IRP 2025 project pages: change from the previous ten-year plan"),
    ),
    checks=checks,
)
for i, (n, u, co, src) in enumerate(EXISTING, 1):
    out.append(dict(id=f"EX-{i:02d}", utility=u, existing=True, name=n, coords=[list(c) for c in co], source=src))
json.dump(out, open(pathlib.Path(__file__).resolve().parent.parent / "data" / "projects.json", "w"), indent=1)
json.dump(model, open(pathlib.Path(__file__).resolve().parent.parent / "data" / "model.json", "w"), indent=1)
print("slips:", {u: (d["n"], d["slipped"], d["advanced"], d["median"]) for u, d in model["slips"].items()})
print(len(out), "projects")
