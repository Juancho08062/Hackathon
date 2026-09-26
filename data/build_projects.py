"""Build projects.json from public plan records.

Sources
- DESC: SCRTP "2026-2030 $2M & Above Project Descriptions"
  https://www.scrtp.com/assets/pdfs/home/2026-2030-2million-and-above-project-descriptions.pdf
- Georgia: SERTP 2026 Q2 "Preliminary Expansion Plan" presentation (Southern BAA, pp.128-162)
  https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf
  and SERTP 2025 Preliminary Expansion Plan Report (Non-CEII)
  https://www.southeasternrtp.com/docs/general/2025/2025%20SERTP%20Preliminary%20Expansion%20Plan%20Report%20(Non-CEII).pdf

Coordinates are APPROXIMATE: public plans name substations, not coordinates, so
endpoints are placed at the named town/plant/substation area by hand.
loc = "med" (named plant/town, within a few miles) or "low" (best guess).
Plans give in-service dates only; construction windows are estimated
(see est_months) and are adjustable in the app.
"""
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
("Urquhart - Toolebeck 115kV: Rebuild","Upgrade 477 ACSR to 1272 ACSR, single-pole double-circuit, ~12.5 mi",115,12.5,"rebuild","2026-08-12",15948620,[(33.435,-81.923),(33.53,-81.80)],"low"),
("Dawson 230kV Sub and Fold-in: Construct and Rebuild","New Dawson 230 kV sub, fold in Canadys lines, rebuild Canadys-Dawson #1/#2",230,None,"substation","2026-10-01",93603207,[(33.06,-80.62),(32.88,-80.30)],"low"),
("Cainhoy - Hamlin 115kV: Rebuild and Construct","Upgrade 954 ACSR to B795; new Cainhoy-Hamlin 115 kV #2",115,None,"new_line","2026-12-02",40858628,[(32.93,-79.83),(32.86,-79.80)],"med"),
("Coit - Gills Creek 115kV: Construct","Convert 33 kV line to 115 kV, ~1.25 mi",115,1.25,"rebuild","2026-12-31",5773202,[(33.99,-80.97),(33.97,-80.95)],"med"),
("Okatie 230-115kV Substation, Jasper-Yemassee #1 Fold-in","Expand Okatie sub, add 230-115 autobank, fold in Jasper-Yemassee 230 kV #1",230,None,"substation","2026-12-31",11630257,[(32.30,-80.93)],"med"),
("Jasper - Okatie 230kV #2: Construct","New 230 kV line, B1272 ACSR, ~6.5 mi",230,6.5,"new_line","2026-12-01",19280474,[(32.30,-81.08),(32.30,-80.93)],"med"),
("Riverport 115kV Tap: Construct","230 kV tap from Okatie to Riverport",230,None,"new_line","2026-12-01",41389047,[(32.30,-80.93),(32.25,-81.05)],"low"),
("Flat Rock 115kV Sub and Tap: Construct","115 kV tap off Belvedere Sw Sta - Graniteville 115 kV #1",115,None,"substation","2026-12-31",3950000,[(33.53,-81.87)],"low"),
("Saluda Hydro - Bush River 115kV #1 & #2 Tie Rebuild","Rebuild tie lines to SPDC 1272",115,None,"rebuild","2026-12-31",20400000,[(34.05,-81.21),(34.03,-81.10)],"med"),
("Church Creek - Faber Place - Charleston: Add 230kV Line","New 230 kV Church Creek-Charleston line, rebuild Church Creek-Faber Place, add transformer",230,None,"new_line","2027-05-01",22788174,[(32.82,-80.07),(32.80,-79.95)],"med"),
("Yemassee - Ritter 230kV #1 & #2: Construct SPDC","Ritter-Yemassee 230 kV #1/#2 SPDC, B1272 ACSR",230,None,"new_line","2027-06-01",39066742,[(32.69,-80.85),(32.73,-80.58)],"med"),
("Fairfax - Yemassee 115kV: Upgrade","Upgrade 336 ACSR portion to 1272 ACSR (generator interconnection)",115,None,"rebuild","2027-09-07",20350000,[(32.96,-81.24),(32.69,-80.85)],"med"),
("St George - Sumter 230kV Tie: Rebuild Line","Rebuild Santee Sub - Duke/Progress tie",230,None,"rebuild","2027-12-31",4569331,[(33.48,-80.49),(33.60,-80.40)],"low"),
("Hooks - Modoc 115/46kV Rebuild","Upgrade 6.5 mi aging conductor to 1272 ACSR, SPDC",115,6.5,"rebuild","2027-12-31",10534285,[(33.72,-82.21),(33.65,-82.13)],"low"),
("Burton - St Helena 115kV: Rebuild Frogmore Section","Steel structures, restring 1272 ACSR",115,None,"rebuild","2027-12-31",18129932,[(32.43,-80.68),(32.39,-80.58)],"med"),
("Wagener 115kV Tap: Construct","115 kV tap off Edmund Sw Sta - Owens Corning 115 kV",115,None,"new_line","2027-12-31",7540000,[(33.65,-81.36)],"med"),
("Cameron Jct - Elloree 46kV Rebuild","Rebuild 7.3 mi",46,7.3,"rebuild","2027-12-31",8075000,[(33.56,-80.71),(33.53,-80.57)],"med"),
("Atomic Road 115/12kV Sub: Construct","New 115-12 kV sub, 28 MVA transformer",115,None,"substation","2028-12-31",3646027,[(33.40,-81.85)],"low"),
("Elloree - Santee City 46kV: Rebuild","Rebuild 8.35 mi",46,8.35,"rebuild","2027-12-31",10294609,[(33.53,-80.57),(33.48,-80.49)],"med"),
("Urquhart - Aiken PSA 46kV: Rebuild","Rebuild 4.5 mi",46,4.5,"rebuild","2027-12-31",3000000,[(33.435,-81.923),(33.47,-81.86)],"low"),
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
("Okatie - McIntosh 115kV Tie: Add Series Reactor","New Deerfield switching station and 9% series reactor on the DESC-Georgia tie",115,None,"substation","2028-12-31",5376418,[(32.30,-80.93),(32.357,-81.169)],"med"),
("CAE Industrial Park - Springdale 115kV: Replace Poles","Replace 28 laminated wood poles",115,None,"rebuild","2028-12-31",4450000,[(33.95,-81.12)],"med"),
("St George - Holly Hill 115kV: Rebuild Structures","Rebuild structures 83-108, 3.4 mi",115,3.4,"rebuild","2028-12-31",8125000,[(33.25,-80.50)],"med"),
("Canadys - Ritter 115kV: Rebuild SPDC","Rebuild as SPDC with 1272 ACSR, 17.5 mi",115,17.5,"rebuild","2029-06-01",38121795,[(33.06,-80.62),(32.73,-80.58)],"med"),
("Wateree - Killian 230kV: Rebuild","Rebuild 35 mi",230,35,"rebuild","2029-12-31",44517719,[(33.83,-80.62),(34.13,-80.95)],"med"),
("Church Creek - Dawson 230kV: Rebuild","Rebuild Dawson - Long Savannah SPSC B1272, ~13.6 mi",230,13.6,"rebuild","2029-12-31",42375000,[(32.88,-80.30),(32.83,-80.10)],"low"),
("Long Savannah 115kV Tap: Construct","Long Savannah 115 kV tap with Church Creek - Dawson rebuild",115,None,"new_line","2029-12-31",5100000,[(32.83,-80.10)],"med"),
("Modoc - McCormick 115/46kV Rebuild","Rebuild Modoc - McCormick as SPDC",115,None,"rebuild","2029-12-31",19800000,[(33.72,-82.21),(33.91,-82.29)],"med"),
("Stevens Creek - Graniteville 115kV: Rebuild","Rebuild 15 mi",115,15,"rebuild","2029-12-31",18200000,[(33.56,-82.05),(33.56,-81.81)],"med"),
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
("Plant McIntosh Unit 12 Combined Cycle","~800 MW gas combined-cycle unit at Plant McIntosh, Rincon (pre-construction, planned 2030)",500,None,"generation",None,"2030-06-01",[(32.357,-81.169)],"med","https://www.gem.wiki/McIntosh_Combined_Cycle_Facility"),
]

# Existing assets shown as a reference layer (not paired).
EXISTING = [
("Thomson - Vogtle 500kV (in service 2018)","GPC",[(33.43,-82.45),(33.14,-81.76)],"https://www.georgiapower.com/about/grid-reliability/grid-improvements/grid-projects/thomson-vogtle.html"),
("Stevens Creek Hydro (DESC-owned, Martinez GA)","DESC",[(33.56,-82.05)],""),
("Plant Vogtle","GPC",[(33.14,-81.76)],""),
("Plant McIntosh","GPC",[(32.357,-81.169)],""),
("Okatie - McIntosh 115kV tie (DESC-Georgia)","DESC",[(32.30,-80.93),(32.357,-81.169)],""),
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
for i, (n, u, co, src) in enumerate(EXISTING, 1):
    out.append(dict(id=f"EX-{i:02d}", utility=u, existing=True, name=n, coords=[list(c) for c in co], source=src))
json.dump(out, open(__file__.replace("build_projects.py", "projects.json"), "w"), indent=1)
print(len(out), "projects")
