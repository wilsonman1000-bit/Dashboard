'use strict';
/* ═══════════════════════════════════════════════════════════════
   NEXUS AI CONTEXT ROUTER  v2
   Pipeline : classify → extract → retrieve → validate → answer

   COUCHES :
   1. DataRegistry          — source de vérité centrale normalisée
   2. Parseurs par domaine  — parsePlanningIntent / parseFeatureIntent / …
   3. classifyIntent()      — dispatch vers le bon parseur
   4. extractDateEntities() — jamais de fallback dangereux
   5. retrieve*()           — lecture depuis le registre
   6. validateResult()      — garde-fous structurels
   7. buildDynamicContextSpec() — spec finale
   ═══════════════════════════════════════════════════════════════ */

(() => {

  // ── Constantes ───────────────────────────────────────────────

  const FRENCH_MONTHS = {
    janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3,
    mai: 4, juin: 5, juillet: 6, aout: 7, août: 7,
    septembre: 8, octobre: 9, novembre: 10, decembre: 11, décembre: 11,
  };

  // ── Utilitaires ──────────────────────────────────────────────

  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fromDateKey(k) { return new Date(`${k}T12:00:00`); }

  function addDays(date, n) {
    const d = new Date(date); d.setDate(d.getDate() + n); return d;
  }

  function buildDateRange(start, end) {
    const dates = [];
    if (isNaN(start) || isNaN(end) || start > end) return dates;
    let cur = new Date(start);
    while (cur <= end) { dates.push(toDateKey(cur)); cur = addDays(cur, 1); }
    return dates;
  }

  function activePanelName() {
    const p = document.querySelector('.panel.active');
    return p?.id?.replace(/^panel-/, '') || 'home';
  }

  // ════════════════════════════════════════════════════════════
  // 1. DATA REGISTRY
  //    Couche de normalisation centrale. Tout le retrieval lit ici.
  // ════════════════════════════════════════════════════════════

  function buildDataRegistry(source) {
    const raw       = source || {};
    const projects  = Array.isArray(raw.projects)  ? raw.projects  : [];
    const tasks     = Array.isArray(raw.tasks)      ? raw.tasks     : [];
    const features  = Object.values(raw.featureCatalog || {}).filter(Boolean);
    const decks     = Array.isArray(raw.homeDecks)  ? raw.homeDecks.filter(Boolean) : [];
    const documents = Array.isArray(raw.documents)  ? raw.documents : [];
    const planningEntries = raw.planningEntries || {};

    // Vues dérivées — calculées une seule fois
    const projectsById  = new Map(projects.map(p => [p.id, p]));
    const featureById   = new Map(features.map(f => [f.id, f]));
    const activeTasks   = tasks.filter(t => !t.done);
    const tasksByProject = new Map();
    for (const t of tasks) {
      if (!tasksByProject.has(t.projectId)) tasksByProject.set(t.projectId, []);
      tasksByProject.get(t.projectId).push(t);
    }
    const planningKeys = Object.keys(planningEntries)
      .filter(k => String(planningEntries[k]).trim())
      .sort();

    const selectedProject = typeof raw.getSelectedTaskProject === 'function' ? raw.getSelectedTaskProject() : null;
    const activeDocument  = typeof raw.getActiveDocument      === 'function' ? raw.getActiveDocument()      : null;

    return {
      // Collections brutes
      projects, tasks, features, decks, documents, planningEntries,
      // Vues dérivées
      projectsById, featureById, activeTasks, tasksByProject, planningKeys,
      // État UI
      selectedProject, activeDocument,
      selectedPlanningDate: raw.selectedPlanningDate || null,
      planningCursor:       raw.planningCursor       || null,
      activePanel: activePanelName(),
      // Réglages (lecture seule)
      settings: { provider: raw.provider || null, model: raw.model || null, pilot: raw.pilot || null },
    };
  }

  // ════════════════════════════════════════════════════════════
  // 2. PARSEURS D'INTENTION PAR DOMAINE
  //    Chaque parseur est responsable d'un seul domaine.
  //    Retourne { domain, subtype, confidence } ou null.
  // ════════════════════════════════════════════════════════════

  function parsePlanningIntent(n) {
    if (
      /\b(entre|du|from)\b.*\b\d{1,2}\b.*\b(et|au|a)\b.*\b\d{1,2}\b/.test(n) ||
      /\b(semaine|weekend|fin de semaine|debut de semaine|cette semaine)\b/.test(n) ||
      /\b(tout le mois|mois de|fin de|debut de|premiers? jours?|derniers? jours?|ce mois)\b/.test(n)
    ) return { domain: 'planning', subtype: 'range', confidence: 'high' };

    if (
      /\b\d{1,2}\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/.test(n) ||
      /\b(aujourd hui|demain|hier)\b/.test(n) ||
      /\b20\d{2}-\d{2}-\d{2}\b/.test(n)
    ) return { domain: 'planning', subtype: 'day', confidence: 'high' };

    if (/\b(planning|agenda|calendrier|prevu|programme|qu est ce qui est prevu|qu y a t il)\b/.test(n))
      return { domain: 'planning', subtype: 'query', confidence: 'low' };

    return null;
  }

  function parseFeatureIntent(n) {
    if (
      /\b(fonctionnalite|fonctionnalites|module|modules|panneau|panneaux|feature|features|capacite|capacites)\b/.test(n) ||
      (
        /\b(quels?|quelles?|liste|montre|affiche|sais faire|peux faire|connais)\b/.test(n) &&
        /\b(fonction|module|page|panel|deck|disponible|cockpit)\b/.test(n)
      )
    ) return { domain: 'feature', subtype: 'lookup', confidence: 'high' };

    if (
      /\b(sert|servir|a quoi|quoi sert|comment fonctionne|qu est ce que)\b/.test(n) &&
      /\b(chat|dashboard|planning|calendrier|documents?|journal|personnalite|config|briefing|marche|market|actions|log)\b/.test(n)
    ) return { domain: 'feature', subtype: 'describe', confidence: 'high' };

    return null;
  }

  function parseDeckIntent(n) {
    if (
      /\b(deck|decks|page|pages|ecran|ecrans|vue|vues|accueil|actualites|reglages)\b/.test(n) &&
      /\b(quels?|quelles?|liste|montre|affiche|disponible|existe|sert|quoi|cest|combien|ya)\b/.test(n)
    ) return { domain: 'deck', subtype: 'lookup', confidence: 'high' };
    return null;
  }

  function parseProjectIntent(n) {
    if (/\bcombien\b/.test(n) && /\b(projet|projets|tache|taches)\b/.test(n))
      return { domain: 'project', subtype: 'count', confidence: 'high' };
    if (/\b(liste|montre|affiche|quels?|quelles?)\b/.test(n) && /\b(projet|projets)\b/.test(n))
      return { domain: 'project', subtype: 'list', confidence: 'high' };
    if (/\b(tache|taches|todo|todos?)\b/.test(n))
      return { domain: 'project', subtype: 'tasks', confidence: 'high' };
    if (/\b(projet|projets|workflow|dashboard|priorite|priorites)\b/.test(n))
      return { domain: 'project', subtype: 'query', confidence: 'low' };
    return null;
  }

  function parseDocumentIntent(n) {
    if (/\b(note|notes|document|documents|cahier|memo|spec|specs)\b/.test(n))
      return { domain: 'document', subtype: 'lookup', confidence: 'high' };
    return null;
  }

  function parseInventoryIntent(n) {
    if (
      /\b(qu est ce que tu sais|que sais tu|qu est ce que tu connais|quelles donnees|montre moi tout|inventaire|tout ce que tu (sais|connais)|quelles capacites|quest ce que tu vois)\b/.test(n) ||
      (/\b(sais|connais|vois|accede|accedes)\b/.test(n) && /\b(tout|quoi|quelles|quels|inventaire|toutes)\b/.test(n))
    ) return { domain: 'inventory', subtype: 'all', confidence: 'high' };
    return null;
  }

  // ════════════════════════════════════════════════════════════
  // 3. CLASSIFIEUR
  //    Priorité : inventory > planning > feature > deck > project > document > global
  // ════════════════════════════════════════════════════════════

  const INTENT_PARSERS = [
    parseInventoryIntent,
    parsePlanningIntent,
    parseFeatureIntent,
    parseDeckIntent,
    parseProjectIntent,
    parseDocumentIntent,
  ];

  function classifyIntent(message) {
    const n = norm(message);
    for (const parser of INTENT_PARSERS) {
      const result = parser(n);
      if (result) return result;
    }
    return { domain: 'global', subtype: 'context', confidence: 'low' };
  }

  // ════════════════════════════════════════════════════════════
  // 4. EXTRACTION D'ENTITÉS
  //    Règle absolue : une requête range ratée → parse_error, jamais single-date.
  // ════════════════════════════════════════════════════════════

  function contextYear(registry) {
    if (registry.selectedPlanningDate) {
      const d = fromDateKey(registry.selectedPlanningDate);
      if (!isNaN(d)) return d.getFullYear();
    }
    if (registry.planningCursor) {
      const d = new Date(registry.planningCursor);
      if (!isNaN(d)) return d.getFullYear();
    }
    return new Date().getFullYear();
  }

  function contextMonth(registry) {
    if (registry.selectedPlanningDate) {
      const d = fromDateKey(registry.selectedPlanningDate);
      if (!isNaN(d)) return { month: d.getMonth(), year: d.getFullYear() };
    }
    const now = new Date();
    return { month: now.getMonth(), year: now.getFullYear() };
  }

  function extractSingleDate(n, defaultYear) {
    const iso = n.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) return new Date(`${iso[1]}T12:00:00`);

    const dm = n.match(/\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (dm) {
      return new Date(Number(dm[3]) || defaultYear, FRENCH_MONTHS[dm[2]], Number(dm[1]), 12);
    }

    const today = new Date(); today.setHours(12, 0, 0, 0);
    if (/\baujourd hui\b/.test(n)) return today;
    if (/\bdemain\b/.test(n))      return addDays(today, 1);
    if (/\bhier\b/.test(n))        return addDays(today, -1);
    return null;
  }

  function extractRangeDates(n, defaultYear, registry) {
    // "du X au Y mois [année]"
    const duAu = n.match(/\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (duAu) {
      const m = FRENCH_MONTHS[duAu[3]], y = Number(duAu[4]) || defaultYear;
      return { start: new Date(y, m, Number(duAu[1]), 12), end: new Date(y, m, Number(duAu[2]), 12) };
    }

    // "entre le X [mois] [année] et le Y mois [année]"
    const entre = n.match(/\bentre\s+le\s+(\d{1,2})(?:\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre))?(?:\s+(20\d{2}))?\s+et\s+le\s+(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (entre) {
      const em = FRENCH_MONTHS[entre[5]], ey = Number(entre[6]) || defaultYear;
      const sm = entre[2] ? FRENCH_MONTHS[entre[2]] : em, sy = Number(entre[3]) || ey;
      return { start: new Date(sy, sm, Number(entre[1]), 12), end: new Date(ey, em, Number(entre[4]), 12) };
    }

    // "X mois [année] au Y mois [année]"
    const auRange = n.match(/\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\s+(?:au|a)\s+(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (auRange) {
      const sm = FRENCH_MONTHS[auRange[2]], sy = Number(auRange[3]) || defaultYear;
      const em = FRENCH_MONTHS[auRange[5]], ey = Number(auRange[6]) || defaultYear;
      return { start: new Date(sy, sm, Number(auRange[1]), 12), end: new Date(ey, em, Number(auRange[4]), 12) };
    }

    // "les N derniers jours de mois"
    const lastN = n.match(/\bles\s+(\d{1,2})\s+derniers?\s+jours?\s+(?:de|du\s+mois\s+de)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (lastN) {
      const m = FRENCH_MONTHS[lastN[2]], y = Number(lastN[3]) || defaultYear;
      const end = new Date(y, m + 1, 0, 12);
      return { start: addDays(end, -(Number(lastN[1]) - 1)), end };
    }

    // "les N premiers jours de mois"
    const firstN = n.match(/\bles\s+(\d{1,2})\s+premiers?\s+jours?\s+(?:de|du\s+mois\s+de)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (firstN) {
      const m = FRENCH_MONTHS[firstN[2]], y = Number(firstN[3]) || defaultYear;
      const start = new Date(y, m, 1, 12);
      return { start, end: addDays(start, Number(firstN[1]) - 1) };
    }

    // "tout le mois de / mois de X"
    const wholeMonth = n.match(/\b(?:tout\s+le\s+mois\s+de|mois\s+de)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (wholeMonth) {
      const m = FRENCH_MONTHS[wholeMonth[1]], y = Number(wholeMonth[2]) || defaultYear;
      return { start: new Date(y, m, 1, 12), end: new Date(y, m + 1, 0, 12) };
    }

    // "fin de [mois de] X" ou "fin de mois" (sans nom → mois contexte)
    const endOfMonthNamed = n.match(/\bfin\s+(?:de\s+)?(?:mois\s+de\s+)?(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (endOfMonthNamed) {
      const m = FRENCH_MONTHS[endOfMonthNamed[1]], y = Number(endOfMonthNamed[2]) || defaultYear;
      return { start: new Date(y, m, 21, 12), end: new Date(y, m + 1, 0, 12) };
    }
    if (/\bfin\s+(?:du\s+)?mois\b/.test(n) || /\bfin\s+de\s+mois\b/.test(n)) {
      const { month, year } = contextMonth(registry);
      return { start: new Date(year, month, 21, 12), end: new Date(year, month + 1, 0, 12) };
    }

    // "début de [mois de] X" ou "début de mois" (sans nom → mois contexte)
    const startOfMonthNamed = n.match(/\bdebut\s+(?:de\s+)?(?:mois\s+de\s+)?(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (startOfMonthNamed) {
      const m = FRENCH_MONTHS[startOfMonthNamed[1]], y = Number(startOfMonthNamed[2]) || defaultYear;
      return { start: new Date(y, m, 1, 12), end: new Date(y, m, 10, 12) };
    }
    if (/\bdebut\s+(?:du\s+)?mois\b/.test(n) || /\bdebut\s+de\s+mois\b/.test(n)) {
      const { month, year } = contextMonth(registry);
      return { start: new Date(year, month, 1, 12), end: new Date(year, month, 10, 12) };
    }

    // "semaine du N mois"
    const weekOf = n.match(/\bsemaine\s+(?:du\s+)?(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?\b/);
    if (weekOf) {
      const m = FRENCH_MONTHS[weekOf[2]], y = Number(weekOf[3]) || defaultYear;
      const pivot = new Date(y, m, Number(weekOf[1]), 12);
      const dow   = (pivot.getDay() + 6) % 7;
      const start = addDays(pivot, -dow);
      return { start, end: addDays(start, 6) };
    }

    // "cette semaine"
    if (/\bcette semaine\b/.test(n)) {
      const today = new Date(); today.setHours(12, 0, 0, 0);
      const dow   = (today.getDay() + 6) % 7;
      const start = addDays(today, -dow);
      return { start, end: addDays(start, 6) };
    }

    // "ce mois(-ci)"
    if (/\bce mois\b/.test(n)) {
      const { month, year } = contextMonth(registry);
      return { start: new Date(year, month, 1, 12), end: new Date(year, month + 1, 0, 12) };
    }

    return null;
  }

  function extractDateEntities(message, intent, registry) {
    const n  = norm(message);
    const yr = contextYear(registry);

    if (intent.subtype === 'range') {
      // ── Règle absolue : range raté → parse_error, JAMAIS single-date ──
      const range = extractRangeDates(n, yr, registry);
      if (!range)
        return { kind: 'parse_error', reason: 'range_intent_but_no_bounds', rawMessage: message };
      if (isNaN(range.start) || isNaN(range.end))
        return { kind: 'parse_error', reason: 'invalid_dates', rawMessage: message };
      if (range.start > range.end)
        return { kind: 'parse_error', reason: 'start_after_end', rawMessage: message };
      const dates = buildDateRange(range.start, range.end);
      return { kind: 'range', startKey: toDateKey(range.start), endKey: toDateKey(range.end), dates };
    }

    const single = extractSingleDate(n, yr);
    if (single && !isNaN(single)) return { kind: 'day', dateKey: toDateKey(single) };
    if (registry.selectedPlanningDate) return { kind: 'day', dateKey: registry.selectedPlanningDate, fromContext: true };
    return { kind: 'parse_error', reason: 'no_date_found', rawMessage: message };
  }

  // ════════════════════════════════════════════════════════════
  // 5. RETRIEVAL — toutes les lectures depuis le DataRegistry
  // ════════════════════════════════════════════════════════════

  function retrievePlanning(entities, registry) {
    if (entities.kind === 'parse_error')
      return { key: 'planning-error', data: { reason: entities.reason, rawMessage: entities.rawMessage }, body: null };

    if (entities.kind === 'range') {
      const entries = entities.dates.map(dateKey => ({
        dateKey, entry: String(registry.planningEntries[dateKey] || '').trim(),
      }));
      return {
        key: 'planning-range', title: 'CONTEXTE CIBLE — PLANNING PLAGE',
        data: { startKey: entities.startKey, endKey: entities.endKey, entries },
        body: [
          `- Début : ${entities.startKey}`, `- Fin   : ${entities.endKey}`,
          `- Jours : ${entities.dates.length}`, '- Agenda :',
          ...entries.map(e => `  - ${e.dateKey} : ${e.entry || '(vide)'}`),
        ].join('\n'),
      };
    }

    const entry = String(registry.planningEntries[entities.dateKey] || '').trim();
    return {
      key: 'planning', title: 'CONTEXTE CIBLE — PLANNING',
      data: { dateKey: entities.dateKey, entry, fromContext: entities.fromContext || false },
      body: [`- Jour : ${entities.dateKey}`, `- Agenda : ${entry || '(aucune entrée)'}`].join('\n'),
    };
  }

  function retrieveProject(intent, message, registry) {
    const n          = norm(message);
    const activeOnly = /\b(en cours|actif|actifs|active|actives)\b/.test(n);
    const wantsPortfolioView =
      /\b(mes projets|projets actuels|projets en cours|tous les projets|ensemble de mes projets|portfolio projets?)\b/.test(n) ||
      (/\bprojets\b/.test(n) && /\b(analyse|organise|organisation|optimale|optimiser|priori(?:te|tes)|classe|ordonne|structure)\b/.test(n));

    if (intent.subtype === 'count') {
      const list = activeOnly ? registry.projects.filter(p => p.status === 'active') : registry.projects;
      return {
        key: 'project-count', title: 'CONTEXTE CIBLE — COMPTE PROJETS',
        data: { count: list.length, activeOnly },
        body: `- Projets ${activeOnly ? 'actifs' : 'total'} : ${list.length}`,
      };
    }

    if (intent.subtype === 'list') {
      const list = activeOnly ? registry.projects.filter(p => p.status === 'active') : registry.projects;
      return {
        key: 'project-list', title: 'CONTEXTE CIBLE — LISTE PROJETS',
        data: { projects: list, activeOnly },
        body: list.length ? list.map(p => `- ${p.name} (${p.status}, priorité ${p.priority})`).join('\n') : '- Aucun projet.',
      };
    }

    const exactMatch = registry.projects.find(p => n.includes(norm(p.name)));
    const canUseSelectedProject = !wantsPortfolioView && !/\bprojets\b/.test(n);
    const project    = exactMatch || (canUseSelectedProject ? registry.selectedProject : null);
    if (project) {
      const tasks = registry.tasksByProject.get(project.id) || [];
      return {
        key: 'project', title: 'CONTEXTE CIBLE — PROJET',
        data: { project, tasks },
        body: [
          `- Projet : ${project.name}`, `- Statut : ${project.status}`,
          `- Priorité : ${project.priority}`, `- Description : ${project.description || 'Aucune'}`,
          '- Tâches :',
          ...tasks.map(t => `  ${t.done ? '[✓]' : '[ ]'} ${t.text}`),
        ].join('\n'),
      };
    }

    const active = registry.projects.filter(p => p.status === 'active');
    const projects = activeOnly ? active : registry.projects;
    return {
      key: 'project-summary', title: 'CONTEXTE CIBLE — PROJETS',
      data: {
        projects,
        activeOnly,
        portfolioView: wantsPortfolioView,
        projectCards: projects.map(p => ({
          project: p,
          openTasks: (registry.tasksByProject.get(p.id) || []).filter(t => !t.done),
          doneTasks: (registry.tasksByProject.get(p.id) || []).filter(t => t.done),
        })),
      },
      body: projects.length
        ? projects.map(p => {
            const projectTasks = registry.tasksByProject.get(p.id) || [];
            const openTasks = projectTasks.filter(t => !t.done);
            return [
              `- Projet : ${p.name}`,
              `  Statut : ${p.status}`,
              `  Priorité : ${p.priority}`,
              `  Description : ${p.description || 'Aucune'}`,
              `  Tâches ouvertes : ${openTasks.length}`,
              ...(openTasks.length
                ? openTasks.map(t => `    - ${t.text}`)
                : ['    - Aucune tâche ouverte']),
            ].join('\n');
          }).join('\n')
        : '- Aucun projet actif.',
    };
  }

  function retrieveDocument(message, registry) {
    const n   = norm(message);
    const doc = registry.documents.find(d => n.includes(norm(d.title))) || registry.activeDocument || null;
    if (!doc) return null;
    return {
      key: 'document', title: 'CONTEXTE CIBLE — DOCUMENT',
      data: { document: doc },
      body: [`- Titre : ${doc.title}`, `- Contenu : ${String(doc.content || '').trim() || '(vide)'}`].join('\n'),
    };
  }

  function retrieveFeature(intent, message, registry) {
    const n = norm(message);
    if (/\bcombien\b/.test(n))
      return {
        key: 'feature-count', title: 'CONTEXTE CIBLE — CATALOGUE FEATURES',
        data: { count: registry.features.length },
        body: `- Fonctionnalités : ${registry.features.length}`,
      };

    const STOP = new Set([
      'de','des','du','le','la','les','un','une','mon','ma','mes','ton','ta','tes','ce','cette','ces',
      'quel','quelle','quels','quelles','quoi','qui','que','pour','avec','dans','sur','est','sont',
      'sert','servir','cest','a','quoi','ya','info','infos','montre','affiche','liste',
      'module','modules','page','pages','panel','panels','panneau','panneaux','feature','features',
      'fonction','fonctions','fonctionnalite','fonctionnalites','systeme','cockpit','nexus',
      'peux','peut','faire','connais','connait','disponible','disponibles',
    ]);
    const terms = n.split(' ').filter(t => t.length >= 3 && !STOP.has(t));

    const haystack = f => {
      const dl = registry.decks
        .filter(d => d.quadrants?.some(q => q.featureId === f.id))
        .map(d => [d.title, d.kicker, d.description].filter(Boolean).join(' '));
      return norm([
        f.id, f.title, f.description, f.kicker, f.featureType, f.kind,
        f.variantKind, f.preview, f.action?.type, f.action?.target, f.action?.promptType, ...dl,
      ].filter(Boolean).join(' '));
    };

    const matches = terms.length ? registry.features.filter(f => terms.every(t => haystack(f).includes(t))) : [];

    if (matches.length === 1) {
      const f     = matches[0];
      const decks = registry.decks.filter(d => d.quadrants?.some(q => q.featureId === f.id));
      return {
        key: 'feature', title: 'CONTEXTE CIBLE — FEATURE', data: { feature: f, decks },
        body: [
          `- Identifiant : ${f.id}`, `- Titre : ${f.title}`,
          `- Type : ${f.featureType || f.kind || 'non défini'}`, `- Description : ${f.description || 'Aucune'}`,
          `- Action : ${f.action?.type || 'aucune'}${f.action?.target ? ` → ${f.action.target}` : ''}${f.action?.promptType ? ` (${f.action.promptType})` : ''}`,
          `- Decks : ${decks.length ? decks.map(d => d.title).join(', ') : 'Aucun'}`,
        ].join('\n'),
      };
    }

    if (matches.length > 1)
      return {
        key: 'feature-search', title: 'CONTEXTE CIBLE — RECHERCHE FEATURES', data: { matches },
        body: matches.map(f => `- ${f.title} (${f.featureType || f.kind || '?'}) : ${f.description || 'Aucune description'}`).join('\n'),
      };

    return {
      key: 'feature-list', title: 'CONTEXTE CIBLE — LISTE FEATURES', data: { features: registry.features },
      body: registry.features.map(f => `- ${f.title} (${f.featureType || f.kind || '?'}) : ${f.description || 'Aucune description'}`).join('\n'),
    };
  }

  function retrieveDeck(message, registry) {
    const n = norm(message);
    if (/\bcombien\b/.test(n))
      return {
        key: 'deck-count', title: 'CONTEXTE CIBLE — COMPTE DECKS',
        data: { count: registry.decks.length }, body: `- Pages/decks : ${registry.decks.length}`,
      };

    const STOP = new Set([
      'de','des','du','le','la','les','un','une','quels','quelles','quel','quelle',
      'page','pages','deck','decks','ecran','ecrans','vue','vues','disponible','disponibles',
      'liste','affiche','montre','est','sont','ya','quoi','sert','cest',
    ]);
    const terms = n.split(' ').filter(t => t.length >= 2 && !STOP.has(t));

    const haystack = d => norm([
      d.indexLabel, d.title, d.kicker, d.description,
      ...(d.quadrants || []).flatMap(q => [q.featureId, q.title, q.kicker, q.description]),
    ].filter(Boolean).join(' '));

    const matches = terms.length ? registry.decks.filter(d => terms.every(t => haystack(d).includes(t))) : [];

    if (matches.length === 1) {
      const d = matches[0];
      return {
        key: 'deck', title: 'CONTEXTE CIBLE — DECK', data: { deck: d },
        body: [
          `- Index : ${d.indexLabel || 'N/A'}`, `- Titre : ${d.title || 'Sans titre'}`,
          `- Label : ${d.kicker || 'Sans label'}`, `- Description : ${d.description || 'Aucune'}`,
          '- Modules :',
          ...(d.quadrants?.length
            ? d.quadrants.map(q => `  - ${q.title || q.featureId || 'Module'} (id: ${q.featureId || '?'})`)
            : ['  - Aucun module.']),
        ].join('\n'),
      };
    }

    return {
      key: 'deck-list', title: 'CONTEXTE CIBLE — LISTE DECKS', data: { decks: registry.decks },
      body: registry.decks.map(d => `- ${d.indexLabel || '--'} · ${d.title || 'Sans titre'} (${d.kicker || 'Sans label'})`).join('\n'),
    };
  }

  function retrieveGlobal(registry) {
    const openCount = registry.activeTasks.length;
    return {
      key: 'global', title: 'CONTEXTE MINIMAL COCKPIT',
      data: {
        activePanel: registry.activePanel, selectedProject: registry.selectedProject,
        selectedPlanningDate: registry.selectedPlanningDate, activeDocument: registry.activeDocument,
        featureCount: registry.features.length, deckCount: registry.decks.length,
        projectCount: registry.projects.length, openTaskCount: openCount,
      },
      body: [
        `- Page active : ${registry.activePanel}`,
        `- Projet sélectionné : ${registry.selectedProject?.name || 'Aucun'}`,
        `- Jour sélectionné : ${registry.selectedPlanningDate || 'Aucun'}`,
        `- Note ouverte : ${registry.activeDocument?.title || 'Aucune'}`,
        `- Fonctionnalités : ${registry.features.length}`,
        `- Decks : ${registry.decks.length}`,
        `- Projets : ${registry.projects.length}`,
        `- Tâches ouvertes : ${openCount}`,
      ].join('\n'),
    };
  }

  // ── Mode inventaire (lookup global) ─────────────────────────
  // Retourne un inventaire structuré de tout ce que le système peut consulter.

  function retrieveInventory(registry) {
    const openCount      = registry.activeTasks.length;
    const activeProjects = registry.projects.filter(p => p.status === 'active');
    const planningRange  = registry.planningKeys.length
      ? `${registry.planningKeys[0]} → ${registry.planningKeys[registry.planningKeys.length - 1]} (${registry.planningKeys.length} jours avec contenu)`
      : 'Aucun';

    return {
      key: 'inventory', title: 'INVENTAIRE DU COCKPIT',
      data: {
        planningKeys: registry.planningKeys, projects: registry.projects,
        activeTasks: registry.activeTasks, documents: registry.documents,
        features: registry.features, decks: registry.decks,
      },
      body: [
        '┌─ PLANNING',
        `│  Entrées avec contenu : ${registry.planningKeys.length}`,
        `│  Plage : ${planningRange}`,
        '├─ PROJETS',
        `│  Total : ${registry.projects.length}  /  En cours : ${activeProjects.length}`,
        activeProjects.length
          ? `│  En cours : ${activeProjects.map(p => p.name).join(', ')}`
          : '│  (Aucun projet actif)',
        '├─ TÂCHES',
        `│  Total : ${registry.tasks.length}  /  Ouvertes : ${openCount}`,
        '├─ DOCUMENTS',
        `│  Total : ${registry.documents.length}`,
        registry.documents.length
          ? `│  Titres : ${registry.documents.map(d => d.title).join(', ')}`
          : '│  (Aucun document)',
        '├─ FONCTIONNALITÉS',
        `│  Total : ${registry.features.length}`,
        registry.features.length
          ? `│  ${registry.features.map(f => f.title).join(', ')}`
          : '│  (Aucune)',
        '└─ PAGES / DECKS',
        `   Total : ${registry.decks.length}`,
        registry.decks.length
          ? `   ${registry.decks.map(d => `${d.indexLabel || '--'} ${d.title || 'Sans titre'}`).join(', ')}`
          : '   (Aucun)',
      ].join('\n'),
    };
  }

  // ════════════════════════════════════════════════════════════
  // 6. VALIDATION — blocage des fallbacks dangereux
  // ════════════════════════════════════════════════════════════

  const PARSE_ERROR_MESSAGES = {
    range_intent_but_no_bounds: 'Je n\'ai pas pu identifier les deux bornes de la plage. Essaie : "entre le 20 et le 30 mai", "du 1 au 15 juin", "fin de mai" ou "cette semaine".',
    start_after_end:            'La date de début est après la date de fin.',
    invalid_dates:              'Les dates extraites ne sont pas valides.',
    no_date_found:              'Je n\'ai trouvé aucune date dans ta demande.',
  };

  function validateResult(intent, section) {
    if (intent.domain === 'planning' && section.key === 'planning-error') {
      const msg = PARSE_ERROR_MESSAGES[section.data?.reason] || 'Je n\'ai pas compris la date ou plage demandée.';
      return { ok: false, errorMessage: msg };
    }
    return { ok: true };
  }

  // ════════════════════════════════════════════════════════════
  // MODE RAISONNEMENT
  //    L'IA reçoit les données récupérées et en fait une synthèse.
  //    Déclenché par : "qu'est-ce qui est prévu", "résume", "analyse"…
  //    → mode = 'reason', bypass getLocalReadReply → toujours vers le LLM
  // ════════════════════════════════════════════════════════════

  function hasReasoningIntent(n) {
    return /(qu est ce qui est prevu|qu y a t il de prevu|resume|resumez|analyse|analysez|synthese|bilan|dis moi ce qu il y a|qu est ce qu il y a|fais le point|qu est ce que j ai|qu ai je de prevu|qu est ce que ca donne|decris|recapitule|recapitulez)/.test(n);
  }

  function hasExplicitActionIntent(message) {
    return /(ajoute|ajouter|cree|crée|créer|supprime|supprimer|efface|effacer|ouvre|ouvrir|lance|lancer|marque|modifier|modifie|change|déplace|deplace|planifie|planifier|complete|complète|termine|navigue|bascule)/i.test(message);
  }

  function hasSuggestionIntent(message) {
    return /(conseille|conseilles|suggest|suggere|suggère|organise|organiser|priorise|prioriser|comment faire|comment organiser|aide moi|aide-moi)/i.test(message);
  }

  function detectInteractionMode(message, intent) {
    if (hasExplicitActionIntent(message)) return 'action';
    if (hasReasoningIntent(norm(message)) && intent.domain !== 'global') return 'reason';
    if (
      intent.domain !== 'global' ||
      /\b(quel|quelle|quelles|quoi|liste|affiche|montre|resume|rappelle|contenu|contient|combien|sais faire|peux faire|connais|disponible|sert)\b/.test(norm(message))
    ) return 'read';
    if (hasSuggestionIntent(message)) return 'suggestion';
    return 'conversation';
  }

  function buildModeInstructions(mode, sourceKey) {
    const src = sourceKey || 'global';
    if (mode === 'action') return [
      `MODE : ACTION`, `SOURCE : ${src}`,
      '- Déclenche une action uniquement si la demande est explicite.',
      '- N\'invente jamais une action absente de la liste disponible.',
    ].join('\n');
    if (mode === 'reason') return [
      `MODE : RAISONNEMENT SUR DONNÉES RÉCUPÉRÉES`, `SOURCE AUTORITAIRE : ${src}`,
      '- Raisonne UNIQUEMENT sur la source fournie ci-dessous.',
      '- Ne dépasse jamais la source pour inventer des faits.',
      '- Synthétise, résume ou réponds à la question posée.',
      '- Si la source est vide ou incomplète, indique-le explicitement.',
      '- Interdit : émettre un bloc [ACTION:...].',
    ].join('\n');
    if (mode === 'suggestion') return [
      `MODE : SUGGESTION`, `SOURCE : ${src}`,
      '- Réponds à partir de la source autoritaire.',
      '- Interdiction de créer, modifier ou naviguer.',
      '- Interdit : émettre un bloc [ACTION:...].',
    ].join('\n');
    if (mode === 'read') return [
      `MODE : LECTURE`, `SOURCE AUTORITAIRE : ${src}`,
      '- Utilise uniquement la source autoritaire comme vérité.',
      '- N\'utilise pas l\'historique comme source de vérité métier.',
      '- Si la source est vide, dis qu\'il n\'y a rien d\'enregistré.',
      '- N\'interprète pas une note ou un agenda comme une tâche ou un projet.',
      '- Interdit : émettre un bloc [ACTION:...].',
    ].join('\n');
    return [
      `MODE : CONVERSATION`, `SOURCE : ${src}`,
      '- Utilise en priorité la source ci-dessous.',
      '- N\'invente jamais de faits absents de la source.',
    ].join('\n');
  }

  // ════════════════════════════════════════════════════════════
  // 7. POINT D'ENTRÉE PRINCIPAL
  // ════════════════════════════════════════════════════════════

  function buildDynamicContextSpec(message, source) {
    const registry = buildDataRegistry(source);
    const intent   = classifyIntent(message);

    let section;

    if (intent.domain === 'inventory') {
      section = retrieveInventory(registry);
    } else if (intent.domain === 'planning') {
      const entities   = extractDateEntities(message, intent, registry);
      section          = retrievePlanning(entities, registry);
      const validation = validateResult(intent, section);
      if (!validation.ok) {
        return {
          mode: 'read', allowActions: false, historyMode: 'none',
          primarySource: 'planning-error',
          primaryData:   { errorMessage: validation.errorMessage },
          contextText:   `MODE : LECTURE\n\nErreur d'extraction : ${validation.errorMessage}`,
          _parseError:   true,
          _errorMessage: validation.errorMessage,
        };
      }
    } else if (intent.domain === 'project') {
      section = retrieveProject(intent, message, registry);
    } else if (intent.domain === 'document') {
      section = retrieveDocument(message, registry) || retrieveGlobal(registry);
    } else if (intent.domain === 'feature') {
      section = retrieveFeature(intent, message, registry);
    } else if (intent.domain === 'deck') {
      section = retrieveDeck(message, registry);
    } else {
      section = retrieveGlobal(registry);
    }

    const mode         = detectInteractionMode(message, intent);
    const allowActions = mode === 'action';
    const historyMode  = (mode === 'read' || mode === 'reason') ? 'none' : mode === 'suggestion' ? 'light' : 'full';
    const instructions = buildModeInstructions(mode, section.key);
    const contextText  = `${instructions}\n\n${section.title || 'CONTEXTE'}\n${section.body || ''}`;

    return { mode, allowActions, historyMode, primarySource: section.key, primaryData: section.data || null, contextText };
  }

  globalThis.NEXUS_AI_CONTEXT_ROUTER = { buildDynamicContextSpec };

})();