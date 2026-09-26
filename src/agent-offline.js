// Seamline offline assistant: answers the common questions by pattern, with no model, no key and no network.
// It calls the same nine tools the Claude assistant calls (app.js supplies them), so the numbers are identical; only
// the routing and the wording are done here instead of by a model. Two reasons it exists:
//   - Conference Wi-Fi fails exactly when the page is being watched, and the six suggested questions in the Ask panel
//     are all answerable from the tools without a model. Advertising them while they need a key is the worst state.
//   - It is cheaper and instant for questions that are really just a filter worn as a sentence.
// English and Spanish both, answered in the language asked. interpret() returns null when it is not confident: handing
// the question to the model beats answering a different question from the one asked.
(function (root) {
  const ENG = typeof Engine !== "undefined" ? Engine : require("./engine.js");
  const money = v => ENG.fmtMoney(v);

  // ---------- language ----------
  const fold = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Words that are common in one language and effectively absent in the other. Counted, not matched one by one, so a
  // stray loanword does not flip the whole answer.
  const ES_WORDS = "que cual cuales donde cuanto cuantos cuantas como porque cuando entre mismo misma menos antes despues desde hasta mejores proyecto proyectos ahorro ahorrar ahorrarian comparten compartir cerca solapan solape solapes oportunidad oportunidades subestacion cuadrillas terreno fuente los las del para hay esta estan tiene pares obra obras fechas mover cambio cambios datos confiable".split(" ");
  const EN_WORDS = "the what which where how why when between same less before after from until best top project projects save saving share sharing near overlap overlaps opportunity opportunities substation crews land source are is does can pairs work dates move change changes data reliable".split(" ");
  function language(q) {
    const s = String(q || "");
    if (/[¿¡ñ]/i.test(s)) return "es";                       // Spanish-only punctuation settles it outright
    const words = new Set(fold(s).match(/[a-z]+/g) || []);
    const score = list => list.reduce((n, w) => n + (words.has(w) ? 1 : 0), 0);
    return score(ES_WORDS) > score(EN_WORDS) ? "es" : "en";
  }

  // ---------- vocabulary ----------
  const any = (s, words) => words.find(w => s.includes(w)) || null;
  const KM_PER_MILE = 1.609344;
  const CHECKS = ["how reliable", "data quality", "data checks", "trust the data", "validation", "qué tan confiable", "que tan confiable", "calidad del dato", "calidad de los datos", "validacion", "confiar en"];
  const CHANGES = ["what changed", "changed between", "plan change", "plan changes", "moved between", "last two plans", "que cambio", "qué cambió", "cambios del plan", "cambio entre planes", "entre los dos planes", "ultimos dos planes"];
  const MOVES = ["date move", "date moves", "which moves", "reschedule", "shift dates", "optimize", "optimise", "move dates", "fechas mover", "mover fechas", "que fechas", "reprogramar", "optimizar", "correr fechas"];
  const OVERVIEW = ["how many pairs", "pairs checked", "how many projects", "summary", "overview", "total savings", "cuantos pares", "pares revisados", "cuantos proyectos", "resumen", "ahorro total"];
  // The bottom of a ranking is only reachable by reversing it, since a limited number of rows comes back.
  const WORST = ["least", "lowest", "worst", "smallest saving", "fewest", "bottom", "menos ahorro", "el menor", "mas bajo", "peor", "el ultimo del ranking"];
  const LIKELY = ["most likely", "likeliest", "highest chance", "best chance", "probability", "mas probable", "mas probables", "mayor probabilidad", "mas seguro"];
  const SAME_WINDOW = ["same window", "same time", "at the same time", "simultaneous", "misma ventana", "mismo tiempo", "a la vez", "al mismo tiempo", "simultane"];
  // Questions about an extreme. They need a ranking, not a word match, which is why search_projects can sort.
  const BIGGEST = ["biggest", "largest", "most expensive", "priciest", "longest", "highest voltage", "highest kv",
    "mas grande", "el mayor", "mas caro", "mas costoso", "mas largo", "mayor voltaje", "mas alto voltaje"];
  const SMALLEST = ["smallest", "cheapest", "shortest", "lowest voltage", "mas pequeno", "mas barato", "mas corto", "menor voltaje"];
  const EARLIEST = ["earliest", "first to be built", "built first", "soonest", "mas pronto", "primero en construirse", "se construye primero", "mas temprano"];
  const LATEST = ["latest", "last to be built", "furthest out", "mas tarde", "ultimo en construirse", "mas lejano"];
  const REPORT = ["report", "pdf", "printable", "print it", "document", "write it up", "send it",
    "informe", "reporte", "imprimible", "imprimir", "documento", "en pdf", "generar el informe"];
  const COMPARE = ["compare", "versus", " vs ", "difference between", "side by side", "compara", "comparar", "frente a", "diferencia entre", "contra"];
  const EXPLAIN = ["explain", "tell me about", "describe", "detail", "explica", "explicame", "contame", "detalle", "detalles de"];
  // Anchored on a word boundary: a plain substring search for "in the " also fires inside "explain the".
  const NEAR_RE = /\b(?:near|nearby|around|close to|cerca de|alrededor de|en las cercanias de)\s+(.+)$/;
  const OVERLAP_WORDS = ["overlap", "overlaps", "opportunit", "coordinat", "share", "sharing", "pair", "pairs", "top ", "best ", "rank", "closest", "solap", "oportunidad", "coordinar", "compart", "par ", "pares", "mejores", "ranking", "mas cercano", "mas cercanos"];

  // Ids as the data spells them: DESC-11, DESCP-10, IRP-20277, GA-31, EX-01.
  const ID_RE = /\b([A-Z]{2,5})-(\d{1,5})\b/g;
  const PAIR_RE = /\b([A-Z]{2,5}-\d{1,5})\s*\|\s*([A-Z]{2,5}-\d{1,5})\b/;
  const DISTANCE_RE = /(\d+(?:[.,]\d+)?)\s*(km|kms|kilometer|kilometers|kilometre|kilometres|kilometro|kilometros|mi|mile|miles|milla|millas)\b/;
  // English puts the count after the word ("top 5"); Spanish puts it before ("las 3 mejores"). Both mean the same.
  const LIMIT_RE = /\b(?:top|best|first|mejores|primeros|primeras)\s+(\d{1,2})\b|\b(\d{1,2})\s+(?:mejores|primeros|primeras|best)\b/;
  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  // Words that are never part of a place or project name, dropped before a free-text search.
  const FILLER = new Set("a al and around as at be between by can could de del do does el en explain explicame explica contame detalle for from give happen has have how in is it la las like los me most much my near of on or planned please que qual show tell that the to us what whats where which who why with y you your cerca sobre dame muestrame cuales cuanto cuando como donde sus para pair pares par overlap overlaps solape solapes proyecto proyectos project projects".split(" "));

  const ids = q => (String(q || "").toUpperCase().match(ID_RE) || []);
  const content = q => fold(q).replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(w => w.length > 2 && !FILLER.has(w) && !/^\d+$/.test(w));

  function distanceKm(s) {
    const m = s.match(DISTANCE_RE);
    if (!m) return null;
    const v = parseFloat(m[1].replace(",", "."));
    return /^(mi|mile|miles|milla|millas)$/.test(m[2]) ? +(v * KM_PER_MILE).toFixed(3) : v;
  }
  function limitOf(s) {
    const m = s.match(LIMIT_RE);
    if (m) return +(m[1] || m[2]);
    const w = s.match(/\b(?:top|best|first|mejores|primeros|primeras)\s+([a-z]+)\b/);
    return w && WORD_NUM[w[1]] ? WORD_NUM[w[1]] : null;
  }
  // The place or project words after "near", "cerca de" and friends, as typed (so "Augusta" keeps its capital).
  function placeAfter(q) {
    const m = fold(q).match(NEAR_RE);
    if (!m) return null;
    const rest = q.slice(q.length - m[1].length).replace(/[?.!,]+$/, "").trim();
    const words = rest.split(/\s+/).filter(w => !FILLER.has(fold(w)));
    return words.length ? words.slice(0, 4).join(" ") : null;
  }

  // ---------- interpret ----------
  // A tool call for this question, or null to hand off to the model. Specific intents are tested before the general
  // overlap search, because "which date moves would save the most?" also contains the word "save".
  function interpret(question) {
    const q = String(question || "").trim();
    if (!q) return null;
    const s = fold(q);
    const plan = (tool, input, why) => ({ tool, input, matched: why });

    const pair = q.toUpperCase().match(PAIR_RE);
    if (pair) return plan("get_overlap", { key: `${pair[1]}|${pair[2]}` }, "pair key");

    // "Compare A and B" is a question about the relationship between two projects, not about either one.
    const named = ids(q);
    if (named.length >= 2 && any(s, COMPARE)) return plan("compare_projects", { project_ids: named.slice(0, 5) }, ["compare", "two ids"]);

    // A request for a document, before the topic checks: "a report of the longest projects" is a report first.
    if (any(s, REPORT) && !ids(q).length) {
      const input = {};
      if (/longest|length|mas largo|longitud/.test(s)) input.sort = "length_km";
      else if (/voltage|voltaje|kv/.test(s)) input.sort = "kv";
      else if (/date|in service|fecha|servicio/.test(s)) input.sort = "in_service";
      const util = s.match(/\b(desc|dominion|gpc|georgia)\b/);
      if (util) input.utility = /desc|dominion/.test(util[1]) ? "DESC" : "GPC";
      return plan("open_report", input, ["report"]);
    }

    if (any(s, CHECKS)) return plan("get_data_checks", {}, "data quality");
    if (any(s, CHANGES)) return plan("get_plan_changes", {}, "plan changes");
    if (any(s, MOVES)) {
      const input = {};
      const months = s.match(/\b(3|6|12)\s*(months|month|meses|mes)\b/);
      if (months) input.max_shift_months = +months[1];
      // "which three date moves": how many to list, not a tool input
      const n = s.match(/\b(\d+|[a-z]+)\s+(?:date\s+)?(?:moves|shifts|changes|movimientos|cambios|fechas)\b/);
      const count = n && (+n[1] || WORD_NUM[n[1]]);
      if (count) input.show = count;
      return plan("optimize_schedule", input, "schedule moves");
    }

    // "Which is the biggest project" is a ranking. Which measure depends on the word used: cost only covers the utility
    // that publishes costs, so "longest" and "highest voltage" map to measures that cover both.
    const extreme = any(s, BIGGEST) || any(s, SMALLEST) || any(s, EARLIEST) || any(s, LATEST);
    if (extreme && !any(s, OVERLAP_WORDS)) {
      const sort = /longest|mas largo|mas corto|shortest/.test(s) ? "length_km"
        : /voltage|voltaje|kv/.test(s) ? "kv"
        : /earliest|latest|soonest|built first|first to be built|last to be built|furthest out|pronto|tarde|primero|ultimo|temprano|lejano/.test(s) ? "in_service"
        : "cost";
      const asc = !!(any(s, SMALLEST) || any(s, EARLIEST));
      const input = { sort, limit: limitOf(s) || 3 };
      if (asc) input.order = "asc";
      const util = s.match(/\b(desc|dominion|gpc|georgia)\b/);
      if (util) input.utility = /desc|dominion/.test(util[1]) ? "DESC" : "GPC";
      return plan("search_projects", input, [extreme, `sort ${sort}`]);
    }

    const id = ids(q);
    if (id.length && !any(s, OVERLAP_WORDS)) return plan("get_project", { id: id[0] }, "project id");
    // "How many pairs were checked" is an overview question even though it says "pairs"; what would make it a ranking
    // instead is a filter of its own, so the overview route yields when the question names a distance or a count.
    if (any(s, OVERVIEW) && distanceKm(s) == null && !limitOf(s)) return plan("get_overview", {}, "overview");

    // "What's planned near Augusta" is a search, not a ranking — unless the question also asks about overlaps.
    const place = placeAfter(q);
    if (place && !any(s, OVERLAP_WORDS)) return plan("search_projects", { query: place }, "place");

    return interpretOverlaps(q, s, place);
  }

  // The ranked overlap list, if the question carries any usable signal for it.
  function interpretOverlaps(q, s, place) {
    const input = {}, why = [];
    const km = distanceKm(s);
    if (km != null) { input.max_distance_km = km; why.push(`${km} km`); }
    const limit = limitOf(s);
    if (limit) { input.limit = limit; why.push(`limit ${limit}`); }
    if (any(s, LIKELY)) { input.sort = "chance"; why.push("most likely"); }
    if (any(s, WORST)) { input.order = "asc"; input.sort = input.sort || "expected"; why.push("bottom of the ranking"); }
    else if (km != null || /closest|nearest|mas cercano|mas cercanos/.test(s)) { input.sort = "distance"; why.push("closest"); }
    if (any(s, SAME_WINDOW)) { input.same_window_on_paper = true; why.push("same window"); }
    const util = s.match(/\b(desc|dominion|gpc|georgia)\b/);
    if (util) { input.utility = /desc|dominion/.test(util[1]) ? "DESC" : "GPC"; }

    // "Explain the Jasper - Okatie and McIntosh - Purrysburg pair": the leftover words name both projects, and
    // list_overlaps' project_query requires every word to appear in the pair, so it lands on exactly that pair.
    const overlapWord = any(s, OVERLAP_WORDS);
    // Only read leftover words as project names when the question is actually about a pair. Without that guard,
    // "explain FERC Order 1920" turns into a search for projects named "ferc order".
    const named = place ? content(place) : (any(s, EXPLAIN) && overlapWord ? content(q) : []);
    if (named.length >= 2) { input.project_query = named.join(" "); why.push("named projects"); }

    if (overlapWord) why.push(overlapWord.trim());
    // A lone filter is enough; a bare mention of a utility is not — that is too thin to assume a ranking was wanted.
    const hasFilter = ["max_distance_km", "limit", "sort", "same_window_on_paper", "project_query"].some(k => k in input);
    if (!hasFilter && !overlapWord) return null;
    if (!("limit" in input)) input.limit = 5;
    return { tool: "list_overlaps", input, matched: why };
  }

  // ---------- render ----------
  const T = {
    en: {
      none: "No pairs match that. Most planned projects genuinely do not overlap — widen the distance or the dates, or ask about a specific pair.",
      pairs: n => `${n} flagged ${n === 1 ? "pair" : "pairs"}:`,
      chance: "chance of a shared window",
      expected: "expected savings",
      ifHold: "if dates hold",
      ref: "in the challenge's reference table",
      flagged: "flagged as pair",
      reportOpened: by => `Opened the printable project report, ranked by ${by}. Use **Print or save as PDF** in the document to keep it.`,
      noProject: "No project matches that.",
      projects: n => `${n} matching ${n === 1 ? "project" : "projects"}:`,
      inService: "in service",
      cost: "cost",
      costRedacted: "cost not published in the filing",
      confidence: "location confidence",
      overlapsWith: n => `Overlaps with ${n} ${n === 1 ? "project" : "projects"} of the other utility.`,
      checked: (c, f) => `${c.toLocaleString("en-US")} pairs checked, ${f} flagged.`,
      byTier: "By tier:",
      savingsTotal: (e, h) => `Expected savings ${e}; ${h} if every date holds.`,
      asOf: "As of",
      moved: "How the dates moved between plans:",
      opened: n => `${n} shared ${n === 1 ? "window" : "windows"} opened by the latest plan:`,
      closed: n => `${n} shared ${n === 1 ? "window" : "windows"} closed:`,
      noDrift: "No shared window opened or closed between the two plans.",
      movesHead: (b, a) => `Moving a few dates raises expected savings from ${b} to ${a}:`,
      movesShown: (n, all) => `The ${n} that add the most, of ${all} moves:`,
      noMoves: "No date move is worth the threshold, so the schedule is left as planned.",
      checksHead: "Data checks:",
      shareable: "What could be shared:",
      yard: "Best shared yard:",
      window: "Build windows",
      offline: reason => `(Answered without the language model${reason ? `: ${reason}` : ""}.)`,
      can: "Without a model I can answer: the top overlaps, pairs within a distance you name, the most likely ones, pairs in the same build window, what is planned near a place, one project by id, one pair by key, what changed between plans, which date moves pay most, how many pairs were checked, and the data checks.",
    },
    es: {
      none: "Ningún par cumple eso. La mayoría de los proyectos planeados de verdad no se solapan — amplía la distancia o las fechas, o pregunta por un par concreto.",
      pairs: n => `${n} ${n === 1 ? "par marcado" : "pares marcados"}:`,
      chance: "probabilidad de ventana compartida",
      expected: "ahorro esperado",
      ifHold: "si las fechas se mantienen",
      ref: "está en la tabla de referencia del reto",
      flagged: "marcado como par",
      reportOpened: by => `Abrí el informe imprimible de proyectos, ordenado por ${by}. Usá **Print or save as PDF** en el documento para guardarlo.`,
      noProject: "Ningún proyecto coincide con eso.",
      projects: n => `${n} ${n === 1 ? "proyecto coincide" : "proyectos coinciden"}:`,
      inService: "entra en servicio",
      cost: "costo",
      costRedacted: "el filing no publica el costo",
      confidence: "confianza de ubicación",
      overlapsWith: n => `Se solapa con ${n} ${n === 1 ? "proyecto" : "proyectos"} de la otra utility.`,
      checked: (c, f) => `${c.toLocaleString("es-ES")} pares revisados, ${f} marcados.`,
      byTier: "Por nivel:",
      savingsTotal: (e, h) => `Ahorro esperado ${e}; ${h} si todas las fechas se mantienen.`,
      asOf: "Al",
      moved: "Cómo se movieron las fechas entre planes:",
      opened: n => `${n} ${n === 1 ? "ventana compartida que abrió" : "ventanas compartidas que abrieron"} con el plan nuevo:`,
      closed: n => `${n} ${n === 1 ? "ventana compartida que cerró" : "ventanas compartidas que cerraron"}:`,
      noDrift: "Ninguna ventana compartida abrió ni cerró entre los dos planes.",
      movesHead: (b, a) => `Mover algunas fechas sube el ahorro esperado de ${b} a ${a}:`,
      movesShown: (n, all) => `Los ${n} que más suman, de ${all} movimientos:`,
      noMoves: "Ningún movimiento de fecha supera el umbral, así que el cronograma queda como está.",
      checksHead: "Chequeos del dato:",
      shareable: "Qué se podría compartir:",
      yard: "Mejor patio compartido:",
      window: "Ventanas de obra",
      offline: reason => `(Respondido sin el modelo de lenguaje${reason ? `: ${reason}` : ""}.)`,
      can: "Sin modelo puedo responder: los solapes principales, pares a menos de la distancia que digas, los más probables, pares en la misma ventana de obra, qué hay planeado cerca de un lugar, un proyecto por id, un par por su key, qué cambió entre planes, qué movimientos de fecha rinden más, cuántos pares se revisaron, y los chequeos del dato.",
    },
  };
  // Tier labels come from the engine in English; these are the Spanish equivalents of the same five.
  const TIER_ES = { "Touching or crossing": "se tocan o se cruzan", "Under 1.6 km": "a menos de 1,6 km", "Under 8 km": "a menos de 8 km", "Under 40 km": "a menos de 40 km", "Over 40 km": "a más de 40 km" };
  const tier = (label, lang) => lang === "es" ? (TIER_ES[label] || label) : label;
  const pct = v => typeof v === "number" ? `${Math.round(v * 100)}%` : String(v);

  function renderPairs(r, L, lang) {
    const rows = r.rows || [];
    if (!rows.length) return L.none;
    const out = [`**${L.pairs(r.matching_pairs != null ? Math.min(r.matching_pairs, rows.length) : rows.length)}**`, ""];
    rows.forEach((x, i) => {
      out.push(`- **${i + 1}. ${x.key}** — ${x.distance_km} km, ${tier(x.tier, lang)}${x.challenge_reference ? ` · *${L.ref}*` : ""}`);
      out.push(`  - ${x.project_a}`);
      out.push(`  - ${x.project_b}`);
      out.push(`  - ${x.windows_on_paper} · ${L.chance} **${pct(x.chance_of_shared_window)}** · ${L.expected} **${money(x.expected_savings_usd)}** (${money(x.savings_if_dates_hold_usd)} ${L.ifHold})`);
    });
    return out.join("\n");
  }

  function renderProjectLine(p, L) {
    return `**${p.id}** ${p.name} — ${p.utility}, ${p.kv} kV ${p.type}, ${L.inService} ${p.in_service}, ${p.cost_usd ? `${L.cost} ${money(p.cost_usd)}` : L.costRedacted}, ${L.confidence} ${p.location_confidence}`;
  }

  function renderProject(p, L, lang) {
    const out = [renderProjectLine(p, L), ""];
    if (p.description) out.push(p.description, "");
    out.push(`\`${p.construction}\` · ${p.source}`);
    if (p.overlaps) {
      out.push("", `**${L.overlapsWith(p.overlaps)}**`);
      (p.top_overlaps || []).slice(0, 5).forEach(x => out.push(`- **${x.key}** — ${x.distance_km} km, ${tier(x.tier, lang)}, ${L.expected} ${money(x.expected_savings_usd)}`));
    }
    return out.join("\n");
  }

  function renderOverlap(x, L, lang) {
    const out = [`${x.key} — ${x.distance_km} km, ${tier(x.tier, lang)}${x.challenge_reference ? ` (${L.ref})` : ""}`];
    out.push(renderProjectLine(x.project_a, L));
    out.push(renderProjectLine(x.project_b, L));
    out.push(`${L.window}: ${x.windows_on_paper}; ${L.chance} ${pct(x.chance_of_shared_window)}; ${L.expected} ${money(x.expected_savings_usd)}`);
    if ((x.shareable_items || []).length) {
      out.push("", `#### ${L.shareable}`, "", `| ${L.line || "Item"} | ${L.amount || "Saving"} |`, "| --- | --- |");
      x.shareable_items.forEach(it => out.push(`| ${it.item} | **${money(it.saving_usd)}** |`));
      out.push("", ...x.shareable_items.map(it => `- *${it.item}* — ${it.math}`));
    }
    if (x.shared_yard) out.push(`${L.yard} ${x.shared_yard.near} (${x.shared_yard.km_to_sites.join(", ")} km)`);
    return out.join("\n");
  }

  function renderOverview(r, L) {
    const out = [L.checked(r.pairs_checked, r.pairs_flagged)];
    out.push(`${L.byTier} ${Object.entries(r.by_tier || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    out.push(L.savingsTotal(money(r.expected_savings_usd), money(r.savings_if_dates_hold_usd)));
    out.push(`${Object.entries(r.projects || {}).map(([u, n]) => `${u} ${n}`).join(", ")} · ${L.asOf} ${r.as_of}`);
    return out.join("\n");
  }

  function renderChanges(r, L) {
    const out = [L.moved];
    Object.entries(r.how_dates_moved || {}).forEach(([u, v]) => out.push(`  ${u}: ${v.later} later, ${v.earlier} earlier, ${v.unchanged} unchanged (median ${v.median_months} months, ${v.projects_with_history} with history)`));
    const opened = r.windows_opened || [], closed = r.windows_closed || [];
    if (!opened.length && !closed.length) out.push(L.noDrift);
    if (opened.length) { out.push(L.opened(opened.length)); opened.forEach(x => out.push(`  ${x.key} — ${x.pair} (${x.distance_km} km): ${x.moved.join("; ")}`)); }
    if (closed.length) { out.push(L.closed(closed.length)); closed.forEach(x => out.push(`  ${x.key} — ${x.pair} (${x.distance_km} km): ${x.moved.join("; ")}`)); }
    return out.join("\n");
  }

  function renderMoves(r, L, lang, input) {
    let moves = r.moves || [];
    if (!moves.length) return L.noMoves;
    const out = [L.movesHead(money(r.expected_savings_before_usd), money(r.after_usd))];
    const show = input && input.show;
    if (show && show < moves.length) { out.push(L.movesShown(show, moves.length)); moves = moves.slice().sort((a, b) => b.adds_usd - a.adds_usd).slice(0, show); }
    moves.forEach(m => out.push(`  ${m.id} ${m.project} (${m.utility}): ${m.months > 0 ? "+" : ""}${m.months} months, ${m.in_service_from} → ${m.in_service_to}, +${money(m.adds_usd)}${m.strongest_effect ? ` — ${m.strongest_effect}` : ""}`));
    return out.join("\n");
  }

  function renderChecks(r, L) {
    const out = [`${L.checksHead} ${L.asOf} ${r.as_of}`];
    (r.checks || []).forEach(c => out.push(`  [${c.status}] ${c.check}: ${c.result}`));
    return out.join("\n");
  }

  function renderCompare(r, L, lang) {
    const out = [];
    (r.projects || []).forEach(p => out.push(`- ${renderProjectLine(p, L)}`));
    out.push("");
    (r.between || []).forEach(b => {
      out.push(`**${b.projects}** — ${b.distance_km} km, ${tier(b.tier, lang)} · ${b.windows}`);
      out.push(b.flagged_pair
        ? `  - ${L.flagged} \`${b.flagged_pair}\` · ${L.expected} **${money(b.expected_savings_usd)}**`
        : `  - ${b.why_not_flagged}`);
    });
    return out.join("\n");
  }

  const RENDER = {
    open_report: (r, L) => L.reportOpened(r.ranked_by),
    compare_projects: renderCompare,
    list_overlaps: renderPairs,
    get_overlap: renderOverlap,
    get_project: renderProject,
    search_projects: (r, L) => {
      if (!(r.projects || []).length) return L.noProject;
      const out = [`**${L.projects(r.matches)}**`, ""];
      r.projects.forEach(p => out.push(`- ${renderProjectLine(p, L)}`));
      if (r.note) out.push("", `*${r.note}*`);
      return out.join("\n");
    },
    get_overview: renderOverview,
    get_plan_changes: renderChanges,
    optimize_schedule: renderMoves,
    get_data_checks: renderChecks,
  };

  // Deterministic prose for a tool result: the same input always renders the same text.
  function render(tool, result, lang, input) {
    const L = T[lang === "es" ? "es" : "en"], fn = RENDER[tool];
    return fn ? fn(result, L, lang === "es" ? "es" : "en", input) : JSON.stringify(result);
  }
  const note = (lang, reason) => T[lang === "es" ? "es" : "en"].offline(reason);
  const capabilities = lang => T[lang === "es" ? "es" : "en"].can;

  const api = { interpret, render, language, capabilities, note };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SeamOffline = api;
})(this);
