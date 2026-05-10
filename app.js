/* ══════════════════════════════════════════════════════════════
   NEXUS OS — app.js
   Personal Cockpit with AI Chat (OpenAI), Real-Time Data,
   Project Management, and AI-triggered UI Actions
   ══════════════════════════════════════════════════════════════ */
'use strict';

const DEFAULT_PERSONALITY = {
  interfaceName: 'NEXUS',
  address: 'pilote',
  tone: 'direct',
  detailLevel: 'normal',
  responseMode: 'operationnel',
  style: 'cockpit',
  proactivity: 'equilibree',
  confirmation: 'actions sensibles',
  language: 'francais',
  technicalRigour: 'stricte',
};

const API_KEY_STORAGE_PREFIX = 'nexus_api_key_';
const DEFAULT_OLLAMA_MODEL = 'llama3.2:latest';
const HOME_DECK_STORAGE_KEY = 'nexus_home_decks';
const SELECTED_TASK_PROJECT_STORAGE_KEY = 'nexus_selected_task_project';
const PLANNING_STORAGE_KEY = 'nexus_planning_entries';
const DOCUMENT_STORAGE_KEY = 'nexus_documents';
const FEATURE_CATALOG = globalThis.NEXUS_FEATURE_CATALOG || {};

const HOME_SLOT_CLASSES = ['quad-chat', 'quad-dashboard', 'quad-realtime', 'quad-actions'];

const PROVIDER_DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  openrouter: 'openrouter/auto',
  openai: 'gpt-4o-mini',
};

const HOME_DECKS = [
  {
    indexLabel: '01',
    title: 'Accueil',
    kicker: 'PAGE COCKPIT',
    showSystemStats: false,
    description: 'Le centre devient le titre du deck actif. Les quatre cadrans gardent la meme grammaire visuelle mais changent selon la page.',
    quadrants: [
      { featureId: 'chat' },
      { featureId: 'projectsDashboard' },
      { featureId: 'personalityProfile' },
      { featureId: 'actionsLog' },
    ],
  },
  {
    indexLabel: '02',
    title: 'Actualites',
    kicker: 'PAGE VEILLE',
    showSystemStats: false,
    description: 'Deck consacre au briefing. Les cadrans servent de raccourcis vers des syntheses IA et vers les modules qui alimentent la veille.',
    quadrants: [
      { featureId: 'marketBrief' },
      { featureId: 'projectReview' },
      { featureId: 'dailyPlan' },
      { featureId: 'actionsLog' },
    ],
  },
  {
    indexLabel: '03',
    title: 'Config',
    kicker: 'PAGE REGLAGES',
    showSystemStats: true,
    description: 'Deck dedie au calibrage du cockpit. Chaque cadran redirige vers un point de configuration ou de verification du systeme.',
    quadrants: [
      { featureId: 'systemSettings' },
      { featureId: 'personalityProfile' },
      { featureId: 'dashboardControl' },
      { featureId: 'chatConsole' },
    ],
  },
];

const INITIAL_HOME_DECKS = loadHomeDecks();

// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════
const S = {
  provider:  localStorage.getItem('nexus_provider') || 'gemini',
  model:     localStorage.getItem('nexus_model')    || 'gemini-2.0-flash',
  pilot:     localStorage.getItem('nexus_pilot')    || 'PILOTE',
  homeDecks: INITIAL_HOME_DECKS,
  activeDeck: clampDeckIndex(localStorage.getItem('nexus_active_deck') || 0, INITIAL_HOME_DECKS),
  deckConfigDraft: null,
  editingDeckIndex: 0,
  editingProjectId: null,
  speechOn:  localStorage.getItem('nexus_speech_on') === '1',
  personality: loadPersonality(),
  projects:  JSON.parse(localStorage.getItem('nexus_projects') || '[]'),
  tasks:     loadTasks(),
  selectedTaskProjectId: loadSelectedTaskProjectId(),
  planningEntries: loadPlanningEntries(),
  planningCursor: startOfMonth(new Date()),
  selectedPlanningDate: null,
  documents: loadDocuments(),
  activeDocumentId: null,
  history:   [],   // OpenAI message history (last N turns)
  startTime: null,
  _toastTimer: null,
  _voice: null,
};

const MODEL_OPTIONS = {
  ollama: [
    { value: 'llama3.2:latest', label: 'Local Llama 3.2' },
    { value: 'mistral', label: 'Local Mistral' },
    { value: 'mistral-nemo', label: 'Local Mistral Nemo' },
    { value: 'qwen2.5:7b', label: 'Local Qwen 2.5 7B' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  openrouter: [
    { value: 'openrouter/auto', label: 'OpenRouter Auto' },
    { value: 'google/gemini-2.0-flash-001', label: 'OpenRouter Gemini 2.0 Flash' },
    { value: 'openai/gpt-4o-mini', label: 'OpenRouter GPT-4o Mini' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
};

normalizeAIState();

// ═══════════════════════════════════════════════════════════════
//  BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════════
function bootSystem() {
  const btn        = document.getElementById('btn-on');
  const statusEl   = document.getElementById('boot-status');
  const loadingEl  = document.getElementById('boot-loading');
  const fillEl     = document.getElementById('loading-fill');
  const textEl     = document.getElementById('loading-text');

  btn.style.display = 'none';
  loadingEl.classList.add('visible');

  const steps = [
    { text: 'CHARGEMENT DU NOYAU SYSTÈME...', pct: 12 },
    { text: 'INITIALISATION MODULES IA...',  pct: 28 },
    { text: 'CONNEXION AUX FLUX DE DONNÉES...', pct: 46 },
    { text: 'CALIBRATION INTERFACE HUD...',  pct: 62 },
    { text: 'CHARGEMENT DES PROFILS...',     pct: 78 },
    { text: 'VÉRIFICATION PROTOCOLES...',    pct: 91 },
    { text: 'DÉMARRAGE EN COURS...',         pct: 100 },
  ];

  let i = 0;
  statusEl.textContent = 'INITIALISATION EN COURS';

  const runStep = () => {
    if (i >= steps.length) { setTimeout(launchCockpit, 450); return; }
    const step = steps[i++];
    textEl.textContent  = step.text;
    fillEl.style.width  = step.pct + '%';
    setTimeout(runStep, 320 + Math.random() * 180);
  };
  setTimeout(runStep, 300);
}

function launchCockpit() {
  const boot    = document.getElementById('boot-screen');
  const cockpit = document.getElementById('cockpit');

  boot.classList.add('fade-out');
  cockpit.classList.remove('hidden');
  setTimeout(() => { boot.style.display = 'none'; }, 800);

  S.startTime = Date.now();
  initCockpit();
}

// ═══════════════════════════════════════════════════════════════
//  COCKPIT INIT
// ═══════════════════════════════════════════════════════════════
function initCockpit() {
  updateClock();
  setInterval(updateClock, 1000);

  renderHomeDeck();
  renderProjects();
  renderTasks();
  updateStats();
  renderPersonality();
  renderPlanningPanel();
  renderDocumentPanel();

  syncModelSelectors();
  initSpeechSynthesis();
  refreshSpeechUI();

  // Update AI status bar
  refreshAIStatus();

  // Greet
  const name = S.pilot.toUpperCase();
  const greeting = `BONJOUR, ${name}. NEXUS OS EN LIGNE.`;
  showToast(greeting, 'success', 3500);
  logAction('system', 'sys', 'NEXUS OS initialisé. Tous systèmes opérationnels.');

  closePanel();
}

// ═══════════════════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const hms = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('time-display').textContent = hms;

  const DAYS   = ['DIM','LUN','MAR','MER','JEU','VEN','SAM'];
  const MONTHS = ['JAN','FÉV','MAR','AVR','MAI','JUN','JUL','AOÛ','SEP','OCT','NOV','DÉC'];
  document.getElementById('date-display').textContent =
    `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  // Uptime
  if (S.startTime) {
    const sec = Math.floor((Date.now() - S.startTime) / 1000);
    const uptime = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    document.getElementById('stat-uptime').textContent = uptime;
    setText('home-core-uptime', uptime);
  }
}

// ═══════════════════════════════════════════════════════════════
//  PANEL SWITCHING
// ═══════════════════════════════════════════════════════════════
function switchPanel(name) {
  const main = document.getElementById('cockpit-main');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
  if (main) main.classList.add('panel-mode');
}

function closePanel() {
  const main = document.getElementById('cockpit-main');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  if (main) main.classList.remove('panel-mode');
}

function clampDeckIndex(value, source) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(getDeckCount(source) - 1, Math.max(0, Math.trunc(n)));
}

function setActiveDeck(index) {
  const next = clampDeckIndex(index);
  if (next === S.activeDeck) return;
  S.activeDeck = next;
  localStorage.setItem('nexus_active_deck', String(next));
  renderHomeDeck();
}

function shiftDeck(delta) {
  const next = (S.activeDeck + delta + S.homeDecks.length) % S.homeDecks.length;
  setActiveDeck(next);
}

function renderHomeDeck() {
  const home = document.getElementById('cockpit-home');
  if (!home) return;

  const deck = S.homeDecks[S.activeDeck] || S.homeDecks[0];
  const coreStats = deck.showSystemStats ? `
        <div class="home-core-grid">
          <div class="core-stat">
            <span>Provider actif</span>
            <strong id="home-core-provider">${esc(S.provider.toUpperCase())}</strong>
          </div>
          <div class="core-stat">
            <span>Modele actif</span>
            <strong id="home-core-model">${esc(S.model)}</strong>
          </div>
          <div class="core-stat">
            <span>Uptime</span>
            <strong id="home-core-uptime">${esc(getUptimeLabel())}</strong>
          </div>
          <div class="core-stat">
            <span>Etat systeme</span>
            <strong id="home-core-status">${esc(getSystemStatusLabel())}</strong>
          </div>
        </div>` : '';

  home.innerHTML = deck.quadrants.map((card, index) => `
    <button class="home-quadrant ${HOME_SLOT_CLASSES[index] || ''}" type="button" onclick="runHomeCardAction(${index})">
      <div class="home-quadrant-content">
        <span class="quad-kicker">${esc(card.kicker)}</span>
        <strong>${esc(card.title)}</strong>
        <p>${esc(card.description)}</p>
        <div class="quad-preview">
          ${getHomePreviewLines(card.preview).map(line => `<span>${esc(line)}</span>`).join('')}
        </div>
      </div>
    </button>`).join('') + `
    <section class="home-core ${deck.showSystemStats ? 'home-core-dense' : ''}" id="home-core">
      <div class="home-core-inner">
        <span class="home-core-kicker">${esc(deck.kicker)}</span>
        <div class="home-core-title-block">
          <span class="home-core-title-index">${esc(deck.indexLabel)}</span>
          <h1>${esc(deck.title.toUpperCase())}</h1>
        </div>
        <p>${esc(deck.description)}</p>
        <div class="home-deck-controls">
          <button class="deck-nav-btn" type="button" onclick="shiftDeck(-1)" aria-label="Deck precedent">◀</button>
          <div class="home-deck-strip">
            ${S.homeDecks.map((item, index) => `
              <button class="deck-chip ${index === S.activeDeck ? 'active' : ''}" type="button" onclick="setActiveDeck(${index})">${item.indexLabel}</button>
            `).join('')}
          </div>
          <button class="deck-nav-btn" type="button" onclick="shiftDeck(1)" aria-label="Deck suivant">▶</button>
        </div>
        ${coreStats}
        <div class="home-deck-hint">Alt+1 a Alt+${S.homeDecks.length} pour changer de deck rapidement.</div>
      </div>
    </section>`;
}

function getHomePreviewLines(kind) {
  const activeProjects = S.projects.filter(project => project.status === 'active').length;
  const openTasks = S.tasks.filter(task => !task.done).length;
  const doneTasks = S.tasks.filter(task => task.done).length;

  if (kind === 'ai') {
    return [`Provider: ${S.provider}`, `Modele: ${S.model}`];
  }
  if (kind === 'projects') {
    return [`${activeProjects} projets actifs`, `${openTasks} taches ouvertes`];
  }
  if (kind === 'personality') {
    return [
      `Ton ${prettyPersonalityValue(S.personality.tone)}`,
      `Mode ${prettyPersonalityValue(S.personality.responseMode)}`,
    ];
  }
  if (kind === 'actions') {
    return [getLastActionLabel(), `${doneTasks} taches terminees`];
  }
  if (kind === 'market') {
    return ['Veille crypto + bourse', `${activeProjects} projets a recouper`];
  }
  if (kind === 'plan') {
    return [`${openTasks} taches a ordonner`, 'Prompt de planification'];
  }
  if (kind === 'planning') {
    return [formatPlanningMonthLabel(S.planningCursor), `${countPlanningEntriesInMonth(S.planningCursor)} jours notes`];
  }
  if (kind === 'document') {
    return [`${S.documents.length} notes actives`, getLatestDocumentLabel()];
  }
  if (kind === 'config') {
    return [`Pilote: ${S.pilot}`, `${S.provider.toUpperCase()} / ${S.model}`];
  }
  if (kind === 'status') {
    return [getSystemStatusLabel(), `${openTasks} taches ouvertes`];
  }
  if (kind === 'voice') {
    return [S.speechOn ? 'Audio actif' : 'Audio inactif', `Deck ${S.homeDecks[S.activeDeck].indexLabel}`];
  }
  return ['Module disponible', 'Clique pour ouvrir'];
}

function getLastActionLabel() {
  const label = document.getElementById('last-action')?.textContent || 'Derniere action: aucune';
  return label.replace(/^Derniere action:\s*/i, '') || 'Aucune action';
}

function getSystemStatusLabel() {
  return document.getElementById('system-status-text')?.textContent || 'SYSTEME ACTIF';
}

function getUptimeLabel() {
  if (!S.startTime) return '00:00';
  const sec = Math.floor((Date.now() - S.startTime) / 1000);
  const min = String(Math.floor(sec / 60)).padStart(2, '0');
  const rem = String(sec % 60).padStart(2, '0');
  return `${min}:${rem}`;
}

function runHomeCardAction(index) {
  const deck = S.homeDecks[S.activeDeck] || S.homeDecks[0];
  const card = deck.quadrants[index];
  if (!card?.action) return;

  if (card.action.type === 'panel') {
    switchPanel(card.action.target);
    return;
  }
  if (card.action.type === 'settings') {
    openSettings();
    return;
  }
  if (card.action.type === 'quickPrompt') {
    quickPrompt(card.action.promptType);
    switchPanel('chat');
  }
}

// ═══════════════════════════════════════════════════════════════
//  AI CHAT
// ═══════════════════════════════════════════════════════════════
function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function quickPrompt(type) {
  const prompts = {
    status:   'Donne-moi un résumé complet du statut de mon cockpit, mes projets et mes tâches.',
    projects: 'Analyse mes projets actuels et propose-moi une organisation optimale avec des priorités.',
    market:   'Analyse les tendances actuelles des marchés crypto et boursiers. Quelles sont tes recommandations ?',
    plan:     'Génère-moi un plan de journée structuré basé sur mes projets et tâches en cours.',
  };
  const input = document.getElementById('chat-input');
  input.value = prompts[type] || '';
  input.focus();
}

function updateAIModel(val) {
  const changed = S.model !== val;
  S.model = val;
  localStorage.setItem('nexus_model', val);
  if (changed) resetChatContext(`Modèle actif: ${val}`);
  refreshAIStatus();
}

function updateAIProvider(val) {
  const changed = S.provider !== val;
  S.provider = val;
  localStorage.setItem('nexus_provider', val);
  ensureValidModel();
  syncModelSelectors();
  refreshApiKeyUI();
  if (changed) resetChatContext(`Provider actif: ${S.provider}`);
  refreshAIStatus();
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  appendMessage('user', text);

  const smallTalkReply = getLocalSmallTalkReply(text);
  if (smallTalkReply) {
    S.history.push({ role: 'user', content: text });
    S.history.push({ role: 'assistant', content: smallTalkReply });
    if (S.history.length > 30) S.history = S.history.slice(-30);
    appendMessage('system', smallTalkReply);
    return;
  }

  const typingId = appendTyping();

  try {
    const policy = buildAIContextPolicy(text);
    const localReply = getLocalReadReply(policy);
    const { reply } = localReply
      ? { reply: localReply, policy }
      : await callAI(text, policy);
    removeTyping(typingId);
    appendMessage('system', reply);
    parseAndExecuteActions(reply, policy);
  } catch (err) {
    removeTyping(typingId);
    appendMessage('error', `Erreur API : ${err.message}`);
  }
}

function getApiKeyStorageKey(provider = S.provider) {
  return `${API_KEY_STORAGE_PREFIX}${provider}`;
}

function getProviderApiKey(provider = S.provider) {
  return localStorage.getItem(getApiKeyStorageKey(provider)) || '';
}

function setProviderApiKey(provider, apiKey) {
  const key = getApiKeyStorageKey(provider);
  const normalized = String(apiKey || '').trim();
  if (normalized) {
    localStorage.setItem(key, normalized);
  } else {
    localStorage.removeItem(key);
  }
}

function isDirectBrowserProvider(provider = S.provider) {
  return provider === 'gemini' || provider === 'openai' || provider === 'openrouter';
}

function refreshApiKeyUI() {
  const input = document.getElementById('provider-api-key');
  const hint = document.getElementById('provider-api-key-hint');
  const architecture = document.getElementById('architecture-summary');
  if (input) {
    input.value = getProviderApiKey(S.provider);
    input.placeholder = `Clé API ${S.provider.toUpperCase()}`;
    input.disabled = !isDirectBrowserProvider(S.provider);
  }
  if (hint) {
    if (isDirectBrowserProvider(S.provider)) {
      hint.textContent = `La clé ${S.provider.toUpperCase()} est stockée dans ce navigateur et utilisée pour des appels directs au provider cloud.`;
    } else {
      hint.textContent = 'Ollama local n est pas disponible de façon fiable depuis GitHub Pages en HTTPS. Utilise un provider cloud pour la version hébergée.';
    }
  }
  if (architecture) {
    architecture.value = isDirectBrowserProvider(S.provider)
      ? 'GitHub Pages + appels directs navigateur vers le provider cloud'
      : 'Mode local expérimental depuis GitHub Pages';
  }
}

function saveCurrentProviderApiKey() {
  const input = document.getElementById('provider-api-key');
  if (!input) return;
  setProviderApiKey(S.provider, input.value);
}

/* Build system prompt with current context */
function buildAIContextPolicy(userMsg = '') {
  return globalThis.NEXUS_AI_CONTEXT_ROUTER?.buildDynamicContextSpec(userMsg, {
    projects: S.projects,
    tasks: S.tasks,
    planningEntries: S.planningEntries,
    documents: S.documents,
    featureCatalog: FEATURE_CATALOG,
    homeDecks: S.homeDecks,
    selectedPlanningDate: S.selectedPlanningDate,
    planningCursor: S.planningCursor,
    getSelectedTaskProject,
    getActiveDocument,
  }) || {
    mode: 'conversation',
    allowActions: true,
    historyMode: 'full',
    primarySource: 'global',
    contextText: 'MODE D\'INTERACTION : CONVERSATION\n\nCONTEXTE MINIMAL COCKPIT\n- Aucun contexte ciblé disponible.',
  };
}

function buildSystemPrompt(userMsg = '', policy = buildAIContextPolicy(userMsg)) {
  const personalityCtx = formatPersonalityForPrompt();

  return `Tu es ${S.personality.interfaceName}, l'assistant IA personnel de ${S.pilot}.
Sois précis, direct, futuriste. Réponds en français sauf si demandé autrement.
Réponds d'abord à la dernière demande de l'utilisateur, sans préambule ni auto-présentation, sauf si l'utilisateur demande explicitement qui tu es, quelle est ta configuration, ou un état du système.
N'ajoute pas de résumé des projets, tâches, personnalité, actions disponibles ou exemples d'actions sauf si l'utilisateur le demande.
Pour une demande simple comme "dis bonjour" ou "comment vas-tu", réponds simplement et naturellement, en une ou deux phrases maximum.

RÈGLE DE VÉRITÉ TECHNIQUE :
- N'invente jamais ton architecture, ton provider, ton modèle, ni tes capacités réelles.
- Si l'utilisateur demande quel modèle, quel provider, quelle API, ou pourquoi la réponse est lente, réponds factuellement avec la configuration réelle du cockpit.
- Tu peux garder le nom produit NEXUS, mais tu ne dois pas prétendre être une architecture fictive ou propriétaire si ce n'est pas vrai.
- Si le provider actif est Ollama, dis explicitement que le cockpit utilise Ollama en local.
- Si le provider actif est OpenRouter, dis explicitement que le cockpit utilise OpenRouter.
- Si le provider actif est Gemini, dis explicitement que le cockpit utilise Gemini.
- Si le provider actif est OpenAI, dis explicitement que le cockpit utilise OpenAI.
- Quand une source autoritaire est fournie dans ce prompt, considère que tu as accès aux données réelles du cockpit pour cette demande.
- Ne dis jamais que tu n'as pas accès aux projets, tâches, documents, planning ou données du cockpit si ces données sont présentes dans la source autoritaire ci-dessous.
- N'explique jamais que tu es un modèle généraliste sans accès aux données quand le contexte ciblé contient déjà ces données.

RÈGLE DE COMMUNICATION ABSOLUE :
- Ne jamais écrire de syntaxe technique brute dans ta réponse visible : pas de blocs JSON, pas de crochets [ACTION:...], pas de noms de types d'action, pas de paramètres techniques.
- Ne jamais lister ni décrire les actions disponibles, les types d'actions, ni la syntaxe des commandes dans tes réponses.
- Ne jamais écrire de messages d'alerte système, de diagnostic, ni de résumés d'état technique non sollicités.
- Réponds uniquement avec des mots naturels en français, comme dans une vraie conversation.

CONTEXTE ACTUEL :
- Date/heure : ${new Date().toLocaleString('fr-FR')}
- Provider IA actif : ${S.provider}
- Modèle IA actif : ${S.model}
- Personnalité active :
${personalityCtx}

${policy.contextText}
${policy.allowActions ? `
ACTIONS SILENCIEUSES — Tu peux déclencher des actions en insérant discrètement dans ta réponse des blocs invisibles pour l'utilisateur, de la forme [ACTION:{...}]. Ces blocs ne doivent jamais apparaître dans la partie lisible de ton message.

Types d'actions :
- add_project  : {"type":"add_project","name":"Nom","description":"desc","priority":"high|medium|low","status":"active|paused|done"}
- add_task     : {"type":"add_task","text":"texte"}
- alert        : {"type":"alert","message":"Texte","level":"info|success|danger|gold"}
- set_status   : {"type":"set_status","text":"TEXTE"}
- update_personality : {"type":"update_personality","updates":{"address":"pilote|commandant|prenom|neutre","tone":"direct|calme|analytique|conversationnel","detailLevel":"court|normal|detaille","responseMode":"operationnel|pedagogique|technique","style":"cockpit|sobre|neutre","proactivity":"faible|equilibree|forte","confirmation":"toujours|actions sensibles|jamais"}}
- complete_all_tasks : {"type":"complete_all_tasks"}
- clear_projects     : {"type":"clear_projects"}
- switch_panel       : {"type":"switch_panel","panel":"chat|dashboard|personality|actions"}

Quand l'utilisateur demande explicitement de changer la personnalité, le ton, la longueur, le mode de réponse, l'appellation, la proactivité ou la confirmation, utilise update_personality avec uniquement les champs réellement demandés.
Ne modifie jamais technicalRigour, language, interfaceName, provider, modèle, quotas, limites, ni les règles de vérité technique.
` : `
INTERDICTION ABSOLUE : tu n'as pas le droit d'émettre le moindre bloc [ACTION:...] dans ce mode.
`}
RÈGLE DE MODE :
- Si le mode est LECTURE, réponds uniquement depuis la source autoritaire et ne rien transformer en projet, tâche, document, navigation ou alerte.
- Si la source autoritaire ne contient rien, dis simplement qu'il n'y a rien d'enregistré.
`;
}

async function callAI(userMsg) {
  const policy = arguments[1] || buildAIContextPolicy(userMsg);
  const apiKey = getProviderApiKey(S.provider);
  if (!isDirectBrowserProvider(S.provider)) {
    throw new Error('Ce provider n est pas disponible sur GitHub Pages. Choisis Gemini, OpenAI ou OpenRouter.');
  }
  if (!apiKey) {
    throw new Error(`Clé API ${S.provider.toUpperCase()} manquante. Ouvre CONFIG et renseigne-la.`);
  }

  const rawReply = await callDirectProvider({
    provider: S.provider,
    apiKey,
    model: S.model,
    systemPrompt: buildSystemPrompt(userMsg, policy),
    history: getAIHistory(policy),
    userMessage: userMsg,
  });
  const reply = policy.allowActions
    ? rawReply
    : stripActionBlocks(rawReply) || 'Je n ai pas de réponse textuelle fiable à partir de cette lecture ciblée.';

  // Store conversation history
  S.history.push({ role: 'user',      content: userMsg });
  S.history.push({ role: 'assistant', content: reply });
  if (S.history.length > 30) S.history = S.history.slice(-30);

  return { reply, policy };
}

async function callDirectProvider({ provider, apiKey, model, systemPrompt, history, userMessage }) {
  if (provider === 'openai') {
    return callBrowserOpenAI({ apiKey, model, systemPrompt, history, userMessage });
  }
  if (provider === 'openrouter') {
    return callBrowserOpenRouter({ apiKey, model, systemPrompt, history, userMessage });
  }
  if (provider === 'gemini') {
    return callBrowserGemini({ apiKey, model, systemPrompt, history, userMessage });
  }
  throw new Error(`Provider non supporté dans le navigateur : ${provider}`);
}

async function callBrowserOpenAI({ apiKey, model, systemPrompt, history, userMessage }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULT_MODELS.openai,
      messages: [
        { role: 'system', content: systemPrompt },
        ...normalizeOpenAIHistory(history),
        { role: 'user', content: userMessage },
      ],
      max_tokens: 900,
      temperature: 0.72,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenAI HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(pas de réponse)';
}

async function callBrowserOpenRouter({ apiKey, model, systemPrompt, history, userMessage }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.href,
      'X-Title': 'NEXUS OS Cockpit',
    },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULT_MODELS.openrouter,
      messages: [
        { role: 'system', content: systemPrompt },
        ...normalizeOpenAIHistory(history),
        { role: 'user', content: userMessage },
      ],
      max_tokens: 900,
      temperature: 0.72,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenRouter HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(pas de réponse)';
}

async function callBrowserGemini({ apiKey, model, systemPrompt, history, userMessage }) {
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model || PROVIDER_DEFAULT_MODELS.gemini}:generateContent`);
  endpoint.searchParams.set('key', apiKey);

  const contents = [];
  if (systemPrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: `INSTRUCTIONS SYSTEME:\n${systemPrompt}` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Instructions systeme recues.' }],
    });
  }

  for (const item of normalizeGeminiHistory(history)) {
    contents.push(item);
  }

  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.72,
        maxOutputTokens: 900,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!reply) {
    throw new Error('Gemini a renvoyé une réponse vide.');
  }

  return reply;
}

function normalizeOpenAIHistory(history) {
  return history
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content,
    }));
}

function normalizeGeminiHistory(history) {
  return history
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    }));
}

function getLocalReadReply(policy) {
  // mode 'reason' doit toujours aller au LLM — jamais de réponse locale
  if (!policy || (policy.mode !== 'read' && policy.mode !== 'reason')) return null;
  if (policy.mode === 'reason') return null;

  // — Erreur d'extraction de plage planning (ne jamais inventer une réponse)
  if (policy.primarySource === 'planning-error' || policy._parseError) {
    return policy._errorMessage || policy.primaryData?.errorMessage || 'Je n\'ai pas compris la demande de planning.';
  }

  // — Inventaire global
  if (policy.primarySource === 'inventory') {
    const d = policy.primaryData || {};
    const planningRange = Array.isArray(d.planningKeys) && d.planningKeys.length
      ? `${d.planningKeys[0]} → ${d.planningKeys[d.planningKeys.length - 1]} (${d.planningKeys.length} jours avec contenu)`
      : 'Aucun';
    const activeProjects = Array.isArray(d.projects) ? d.projects.filter(p => p.status === 'active') : [];
    const openCount      = Array.isArray(d.activeTasks) ? d.activeTasks.length : 0;
    const lines = [
      'Voici ce que je peux consulter dans ton cockpit :',
      '',
      `📅 Planning — ${Array.isArray(d.planningKeys) ? d.planningKeys.length : 0} jours renseignés (${planningRange})`,
      `📁 Projets — ${Array.isArray(d.projects) ? d.projects.length : 0} au total, ${activeProjects.length} en cours${activeProjects.length ? ` : ${activeProjects.map(p => p.name).join(', ')}` : ''}`,
      `✅ Tâches — ${openCount} ouvertes`,
      `📝 Documents — ${Array.isArray(d.documents) ? d.documents.length : 0}${Array.isArray(d.documents) && d.documents.length ? ` : ${d.documents.map(doc => doc.title).join(', ')}` : ''}`,
      `🧩 Fonctionnalités — ${Array.isArray(d.features) ? d.features.length : 0}${Array.isArray(d.features) && d.features.length ? ` : ${d.features.map(f => f.title).join(', ')}` : ''}`,
      `🖥️ Pages/Decks — ${Array.isArray(d.decks) ? d.decks.length : 0}${Array.isArray(d.decks) && d.decks.length ? ` : ${d.decks.map(dk => dk.title || dk.indexLabel).join(', ')}` : ''}`,
    ];
    return lines.join('\n');
  }

  // — Planning : jour unique
  if (policy.primarySource === 'planning') {
    const dateKey = policy.primaryData?.dateKey;
    const entry   = String(policy.primaryData?.entry || '').trim();
    if (!dateKey) return 'Je ne trouve pas de jour précis dans ton calendrier.';
    const label   = formatDateKeyForUser(dateKey);
    const ctx     = policy.primaryData?.fromContext ? ' (jour sélectionné dans le planning)' : '';
    if (!entry) return `Il n'y a rien d'enregistré dans ton calendrier pour le ${label}${ctx}.`;
    return `Le ${label}${ctx}, ton calendrier indique : ${entry}`;
  }

  // — Planning : plage
  if (policy.primarySource === 'planning-range') {
    const entries  = Array.isArray(policy.primaryData?.entries) ? policy.primaryData.entries : [];
    const startKey = policy.primaryData?.startKey;
    const endKey   = policy.primaryData?.endKey;
    if (!startKey || !endKey) return 'Je ne trouve pas de plage précise dans ton calendrier.';
    const withContent = entries.filter(e => String(e.entry || '').trim());
    const start = formatDateKeyForUser(startKey);
    const end   = formatDateKeyForUser(endKey);
    if (!withContent.length) return `Il n'y a rien d'enregistré dans ton calendrier entre le ${start} et le ${end} (${entries.length} jour${entries.length !== 1 ? 's' : ''} consultés).`;
    return [
      `Voici ce qui est enregistré entre le ${start} et le ${end} :`,
      ...withContent.map(e => `- ${formatDateKeyForUser(e.dateKey)} : ${e.entry}`),
    ].join('\n');
  }

  // — Projet : détail
  if (policy.primarySource === 'project') {
    const project = policy.primaryData?.project;
    const tasks   = Array.isArray(policy.primaryData?.tasks) ? policy.primaryData.tasks : [];
    if (!project) return 'Je ne trouve pas le projet demandé.';
    if (!tasks.length) return `Le projet ${project.name} n'a aucune tâche pour le moment.`;
    return [`Pour le projet ${project.name}, voici les tâches :`, ...tasks.map(t => `- ${t.done ? '[✓]' : '[ ]'} ${t.text}`)].join('\n');
  }

  // — Projet : compte
  if (policy.primarySource === 'project-count') {
    const count = Number(policy.primaryData?.count || 0);
    return policy.primaryData?.activeOnly
      ? `Il y a actuellement ${count} projet${count !== 1 ? 's' : ''} en cours.`
      : `Tu as actuellement ${count} projet${count !== 1 ? 's' : ''}.`;
  }

  // — Projet : liste
  if (policy.primarySource === 'project-list') {
    const projects = Array.isArray(policy.primaryData?.projects) ? policy.primaryData.projects : [];
    if (!projects.length) return policy.primaryData?.activeOnly ? 'Aucun projet en cours.' : 'Aucun projet.';
    return [
      policy.primaryData?.activeOnly ? 'Projets en cours :' : 'Liste des projets :',
      ...projects.map(p => `- ${p.name} (${p.status}, priorité ${p.priority})`),
    ].join('\n');
  }

  // — Projet : résumé actifs
  if (policy.primarySource === 'project-summary') {
    const projects = Array.isArray(policy.primaryData?.projects) ? policy.primaryData.projects : [];
    if (!projects.length) return 'Il n\'y a aucun projet actif pour le moment.';
    return ['Projets actifs :', ...projects.map(p => `- ${p.name} (${p.priority})`)].join('\n');
  }

  // — Document
  if (policy.primarySource === 'document') {
    const doc = policy.primaryData?.document;
    if (!doc) return 'Je ne trouve pas la note demandée.';
    return String(doc.content || '').trim()
      ? `Dans la note "${doc.title}", il y a : ${String(doc.content).trim()}`
      : `La note "${doc.title}" est vide.`;
  }

  // — Feature : compte
  if (policy.primarySource === 'feature-count') {
    const count = Number(policy.primaryData?.count || 0);
    return `Le cockpit expose actuellement ${count} fonctionnalité${count !== 1 ? 's' : ''} dans son catalogue.`;
  }

  // — Feature : détail
  if (policy.primarySource === 'feature') {
    const f     = policy.primaryData?.feature;
    const decks = Array.isArray(policy.primaryData?.decks) ? policy.primaryData.decks : [];
    if (!f) return 'Je ne trouve pas la fonctionnalité demandée.';
    const action = f.action?.type
      ? `Son action principale est "${f.action.type}"${f.action.target ? ` vers "${f.action.target}"` : ''}${f.action.promptType ? ` (prompt : ${f.action.promptType})` : ''}.`
      : 'Aucune action associée.';
    const deckInfo = decks.length ? ` Elle apparaît dans les decks : ${decks.map(d => d.title).join(', ')}.` : '';
    return `${f.title} : ${f.description || 'Aucune description'}. ${action}${deckInfo}`.trim();
  }

  // — Feature : plusieurs résultats
  if (policy.primarySource === 'feature-search') {
    const matches = Array.isArray(policy.primaryData?.matches) ? policy.primaryData.matches : [];
    if (!matches.length) return 'Je ne trouve aucune fonctionnalité correspondant à cette recherche.';
    return ['Fonctionnalités correspondantes :', ...matches.map(f => `- ${f.title} (${f.featureType || f.kind || '?'}) : ${f.description || 'Aucune description'}`)].join('\n');
  }

  // — Feature : liste complète
  if (policy.primarySource === 'feature-list') {
    const features = Array.isArray(policy.primaryData?.features) ? policy.primaryData.features : [];
    if (!features.length) return 'Aucune fonctionnalité cataloguée.';
    return ['Fonctionnalités du cockpit :', ...features.map(f => `- ${f.title} (${f.featureType || f.kind || '?'}) : ${f.description || 'Aucune description'}`)].join('\n');
  }

  // — Deck : compte
  if (policy.primarySource === 'deck-count') {
    const count = Number(policy.primaryData?.count || 0);
    return `Le cockpit a ${count} page${count !== 1 ? 's' : ''} ou deck${count !== 1 ? 's' : ''} configuré${count !== 1 ? 's' : ''}.`;
  }

  // — Deck : détail
  if (policy.primarySource === 'deck') {
    const d = policy.primaryData?.deck;
    if (!d) return 'Je ne trouve pas la page demandée.';
    const mods = Array.isArray(d.quadrants) ? d.quadrants : [];
    return [
      `${d.title || 'Cette page'} — deck ${d.indexLabel || '--'}${d.kicker ? ` (${d.kicker})` : ''}.`,
      d.description || 'Aucune description.',
      mods.length ? `Modules : ${mods.map(q => q.title || q.featureId || 'Module').join(', ')}.` : 'Aucun module configuré.',
    ].join(' ');
  }

  // — Deck : liste
  if (policy.primarySource === 'deck-list') {
    const decks = Array.isArray(policy.primaryData?.decks) ? policy.primaryData.decks : [];
    if (!decks.length) return 'Aucune page configurée.';
    return ['Pages / decks disponibles :', ...decks.map(d => `- ${d.indexLabel || '--'} · ${d.title || 'Sans titre'}${d.kicker ? ` (${d.kicker})` : ''}`)].join('\n');
  }

  // — Global
  if (policy.primarySource === 'global') {
    const d = policy.primaryData || {};
    return `Page active : ${d.activePanel || 'home'} — ${d.featureCount || 0} fonctionnalités, ${d.deckCount || 0} decks, ${d.projectCount || 0} projets, ${d.openTaskCount || 0} tâches ouvertes.`;
  }

  return null;
}

function formatDateKeyForUser(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* Render a message bubble */
function appendMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const now = nowHHMMSS();

  // Strip [ACTION:...] blocks from display
  const display = stripActionBlocks(text);

  const icons = { system: '◈', user: '◆', error: '⚠' };
  const names = { system: 'NEXUS IA', user: S.pilot.toUpperCase(), error: 'ERREUR' };

  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.innerHTML = `
    <span class="msg-icon">${icons[role] || '◈'}</span>
    <div class="msg-content">
      <div class="msg-header">${esc(names[role] || 'NEXUS')} <span class="msg-time">${now}</span></div>
      <div class="msg-text">${esc(display)}</div>
    </div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;

  if (role === 'system') {
    speakText(display);
  }
}

function appendTyping() {
  const container = document.getElementById('chat-messages');
  const id = 'typing-' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'message system';
  el.innerHTML = `
    <span class="msg-icon">◈</span>
    <div class="msg-content">
      <div class="msg-header">NEXUS IA <span class="msg-time">...</span></div>
      <div class="msg-text">
        <div class="typing-indicator"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════════
//  AI ACTIONS
// ═══════════════════════════════════════════════════════════════

/* Robust JSON extraction from [ACTION:{...}] blocks */
function parseAndExecuteActions(text, policy = { allowActions: true }) {
  if (!policy.allowActions) {
    if (text.includes('[ACTION:')) {
      logAction('alert', 'alt', `Actions IA bloquées — mode ${policy.mode || 'lecture'}`);
    }
    return;
  }

  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('[ACTION:', i);
    if (start === -1) break;
    const jsonStart = start + 8; // length of '[ACTION:'
    let depth = 0, j = jsonStart;
    while (j < text.length) {
      if      (text[j] === '{') depth++;
      else if (text[j] === '}') { depth--; if (depth === 0) { j++; break; } }
      j++;
    }
    if (text[j] === ']') {
      const jsonStr = text.slice(jsonStart, j);
      try { executeAction(JSON.parse(jsonStr), { source: 'chat' }); } catch (_) { /* ignore malformed */ }
    }
    i = j + 1;
  }
}

function stripActionBlocks(text) {
  return String(text || '').replace(/\[ACTION:\{[^\[\]]*\}\]/g, '').trim();
}

function getAIHistory(policy) {
  if (policy.historyMode === 'none') return [];

  const size = policy.historyMode === 'light' ? 4 : 14;
  return S.history.slice(-size).map(entry => ({
    ...entry,
    content: entry.role === 'assistant' ? stripActionBlocks(entry.content) : entry.content,
  })).filter(entry => String(entry.content || '').trim());
}

function executeAction(action, options = {}) {
  const t = action.type;
  const fromChat = options.source === 'chat';

  if (t === 'add_project') {
    const p = {
      id:          Date.now(),
      name:        action.name        || 'Nouveau Projet',
      description: action.description || '',
      priority:    action.priority    || 'medium',
      status:      action.status      || 'active',
    };
    S.projects.push(p);
    saveProjects();
    renderProjects();
    updateStats();
    logAction('action', 'act', `Projet créé par IA : "${p.name}"`);
    if (!fromChat) showToast(`PROJET CRÉÉ : ${p.name.toUpperCase()}`, 'success');
    document.getElementById('last-action').textContent = `Dernière action: Projet créé — ${p.name}`;
  }

  else if (t === 'add_task') {
    const projectId = getEffectiveTaskProjectId(action.projectId);
    if (!projectId) {
      logAction('alert', 'alt', 'Création de tâche ignorée : aucun projet sélectionné');
      return;
    }

    const task = { id: Date.now(), text: action.text || 'Tâche', done: false, projectId };
    S.tasks.push(task);
    saveTasks();
    renderTasks();
    updateStats();
    logAction('action', 'act', `Tâche ajoutée par IA : "${task.text}"`);
    document.getElementById('last-action').textContent = `Dernière action: Tâche ajoutée`;
  }

  else if (t === 'alert') {
    if (!fromChat) showToast(action.message, action.level || 'info', 4000);
    logAction('alert', 'alt', action.message);
  }

  else if (t === 'set_status') {
    const el = document.getElementById('system-status-text');
    if (el) el.textContent = action.text;
    setText('home-core-status', action.text);
    logAction('action', 'act', `Statut modifié : ${action.text}`);
  }

  else if (t === 'update_personality') {
    const next = applyPersonalityUpdates(action.updates || {});
    renderPersonality();
    logAction('action', 'act', `Personnalité mise à jour : ${summarizePersonalityUpdate(next)}`);
  }

  else if (t === 'complete_all_tasks') {
    S.tasks.forEach(tk => { tk.done = true; });
    saveTasks();
    renderTasks();
    updateStats();
    logAction('action', 'act', 'Toutes les tâches marquées terminées');
    if (!fromChat) showToast('TOUTES LES TÂCHES TERMINÉES', 'success');
  }

  else if (t === 'clear_projects') {
    S.projects = [];
    S.tasks = [];
    setSelectedTaskProject(null);
    saveProjects();
    saveTasks();
    renderProjects();
    renderTasks();
    updateStats();
    logAction('action', 'act', 'Liste des projets effacée');
  }

  else if (t === 'switch_panel') {
    switchPanel(action.panel);
    logAction('action', 'act', `Navigation vers : ${action.panel}`);
  }
}

function logAction(type, label, msg) {
  const log = document.getElementById('actions-log');
  if (!log) return;
  const el = document.createElement('div');
  el.className = `log-entry ${type}`;
  el.innerHTML = `
    <span class="log-time">${nowHHMMSS()}</span>
    <span class="log-type ${label}">${label.toUpperCase()}</span>
    <span class="log-msg">${esc(msg)}</span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  renderHomeDeck();
}

function clearActionsLog() {
  document.getElementById('actions-log').innerHTML = '';
  logAction('system', 'sys', 'Journal effacé.');
}

// ═══════════════════════════════════════════════════════════════
//  PROJECTS
// ═══════════════════════════════════════════════════════════════
function openProjectModal(projectId = null) {
  const project = projectId == null ? null : S.projects.find(item => item.id === projectId);
  S.editingProjectId = project?.id ?? null;

  document.getElementById('project-modal-title').textContent = project ? 'MODIFIER PROJET' : '+ NOUVEAU PROJET';
  document.getElementById('project-save-btn').textContent = project ? 'ENREGISTRER' : 'CRÉER';
  document.getElementById('proj-name').value = project?.name || '';
  document.getElementById('proj-desc').value = project?.description || '';
  document.getElementById('proj-priority').value = project?.priority || 'medium';
  document.getElementById('proj-status').value = project?.status || 'active';
  document.getElementById('project-modal').style.display = 'flex';
  document.getElementById('proj-name').focus();
}
function closeProjectModal() {
  S.editingProjectId = null;
  document.getElementById('project-modal').style.display = 'none';
  document.getElementById('project-modal-title').textContent = '+ NOUVEAU PROJET';
  document.getElementById('project-save-btn').textContent = 'CRÉER';
  document.getElementById('proj-name').value    = '';
  document.getElementById('proj-desc').value    = '';
  document.getElementById('proj-priority').value = 'medium';
  document.getElementById('proj-status').value = 'active';
}
function saveProject() {
  const name = document.getElementById('proj-name').value.trim();
  if (!name) return;
  const projectData = {
    name,
    description: document.getElementById('proj-desc').value.trim(),
    priority:    document.getElementById('proj-priority').value,
    status:      document.getElementById('proj-status').value,
  };
  const editingIndex = S.projects.findIndex(project => project.id === S.editingProjectId);
  const isEditing = editingIndex !== -1;
  const p = isEditing
    ? { ...S.projects[editingIndex], ...projectData }
    : { id: Date.now(), ...projectData };

  if (isEditing) {
    S.projects[editingIndex] = p;
  } else {
    S.projects.push(p);
  }

  saveProjects();
  renderProjects();
  renderTasks();
  updateStats();
  closeProjectModal();
  logAction('action', 'usr', isEditing ? `Projet modifié : "${p.name}"` : `Projet créé : "${p.name}"`);
  showToast(isEditing ? `PROJET MIS A JOUR : ${p.name.toUpperCase()}` : `PROJET CRÉÉ : ${p.name.toUpperCase()}`, 'success');
}
function deleteProject(id) {
  S.projects = S.projects.filter(p => p.id !== id);
  S.tasks = S.tasks.filter(task => task.projectId !== id);
  if (S.selectedTaskProjectId === id) {
    setSelectedTaskProject(null);
  }
  saveProjects();
  saveTasks();
  renderProjects();
  renderTasks();
  updateStats();
}
function saveProjects() { localStorage.setItem('nexus_projects', JSON.stringify(S.projects)); }

function renderProjects() {
  const el = document.getElementById('projects-list');
  if (!el) return;
  syncTaskProjectSelector();
  if (!S.projects.length) {
    el.innerHTML = '<div class="empty-state">AUCUN PROJET — CLIQUEZ SUR + PROJET</div>';
    return;
  }
  const STATUS = { active: 'badge-active', paused: 'badge-paused', done: 'badge-done' };
  const LABEL  = { active: 'ACTIF', paused: 'PAUSE', done: 'TERMINÉ' };
  el.innerHTML = S.projects.map(p => `
    <div class="project-item ${p.id === S.selectedTaskProjectId ? 'selected' : ''}" role="button" tabindex="0" onclick="selectProjectCard(${p.id})" oncontextmenu="openProjectContextMenu(event, ${p.id})" onkeydown="handleProjectCardKeydown(event, ${p.id})">
      <div class="project-priority-bar priority-${p.priority}"></div>
      <div class="project-info">
        <div class="project-name">${esc(p.name)}</div>
        ${p.description ? `<div class="project-desc">${esc(p.description)}</div>` : ''}
      </div>
      <span class="proj-badge ${STATUS[p.status] || ''}">${LABEL[p.status] || p.status}</span>
      <button class="del-btn" onclick="event.stopPropagation(); deleteProject(${p.id})" title="Supprimer">✕</button>
    </div>`).join('');
}

function selectProjectCard(projectId) {
  setSelectedTaskProject(projectId);
  renderProjects();
  renderTasks();
}

function openProjectContextMenu(event, projectId) {
  event.preventDefault();
  event.stopPropagation();
  openProjectModal(projectId);
}

function handleProjectCardKeydown(event, projectId) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectProjectCard(projectId);
    return;
  }

  if (event.key === 'ContextMenu') {
    event.preventDefault();
    openProjectModal(projectId);
  }
}

// ═══════════════════════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════════════════════
function addTask() {
  const projectId = getEffectiveTaskProjectId();
  const input = document.getElementById('task-input');
  const text  = input.value.trim();
  if (!projectId) {
    showToast('SÉLECTIONNE UN PROJET AVANT D\'AJOUTER UNE TÂCHE', 'info', 2200, false);
    return;
  }
  if (!text) return;
  S.tasks.push({ id: Date.now(), text, done: false, projectId });
  saveTasks();
  renderTasks();
  updateStats();
  input.value = '';
}
function toggleTask(id) {
  const t = S.tasks.find(t => t.id === id);
  if (t) { t.done = !t.done; saveTasks(); renderTasks(); updateStats(); }
}

function renameTask(id) {
  const task = S.tasks.find(item => item.id === id);
  if (!task) return;

  const nextText = window.prompt('Modifier le nom de la tâche', task.text);
  if (nextText == null) return;

  const trimmed = String(nextText).trim();
  if (!trimmed || trimmed === task.text) return;

  task.text = trimmed;
  saveTasks();
  renderTasks();
  updateStats();
  logAction('action', 'usr', `Tâche modifiée : "${task.text}"`);
  showToast(`TÂCHE MISE A JOUR : ${task.text.toUpperCase()}`, 'success', 1800, false);
}

function openTaskContextMenu(event, id) {
  event.preventDefault();
  event.stopPropagation();
  renameTask(id);
}

function handleTaskItemKeydown(event, id) {
  if (event.key === 'ContextMenu') {
    event.preventDefault();
    renameTask(id);
  }
}

function deleteTask(id) {
  S.tasks = S.tasks.filter(t => t.id !== id);
  saveTasks(); renderTasks(); updateStats();
}
function saveTasks() { localStorage.setItem('nexus_tasks', JSON.stringify(S.tasks)); }

function renderTasks() {
  syncTaskProjectSelector();
  const el = document.getElementById('tasks-list');
  const input = document.getElementById('task-input');
  const addButton = document.getElementById('task-add-btn');
  const selectedProject = getSelectedTaskProject();
  const tasks = getSelectedProjectTasks();

  if (input) {
    input.disabled = !selectedProject;
    input.placeholder = selectedProject ? 'Nouvelle tâche de projet...' : 'Sélectionne un projet pour afficher ses tâches';
    if (!selectedProject) input.value = '';
  }
  if (addButton) addButton.disabled = !selectedProject;
  if (!el) return;

  if (!selectedProject) {
    el.innerHTML = '<div class="empty-state">AUCUN PROJET SÉLECTIONNÉ — CHOISIS UN PROJET POUR VOIR SES TÂCHES</div>';
    return;
  }
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state">AUCUNE TÂCHE POUR CE PROJET</div>';
    return;
  }
  el.innerHTML = tasks.map(t => `
    <div class="task-item ${t.done ? 'done' : ''}" role="button" tabindex="0" oncontextmenu="openTaskContextMenu(event, ${t.id})" onkeydown="handleTaskItemKeydown(event, ${t.id})">
      <div class="task-check ${t.done ? 'checked' : ''}" onclick="event.stopPropagation(); toggleTask(${t.id})"></div>
      <span class="task-text">${esc(t.text)}</span>
      <button class="del-btn" onclick="event.stopPropagation(); deleteTask(${t.id})" title="Supprimer">✕</button>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
//  PLANNING
// ═══════════════════════════════════════════════════════════════
function renderPlanningPanel() {
  const host = document.getElementById('planning-panel');
  if (!host) return;

  const monthStart = startOfMonth(S.planningCursor || new Date());
  const monthDays = buildCalendarDays(monthStart);
  const selectedDate = S.selectedPlanningDate;

  host.innerHTML = `
    <div class="planning-shell">
      <div class="planning-toolbar">
        <div class="planning-month-label">${esc(formatPlanningMonthLabel(monthStart).toUpperCase())}</div>
        <div class="planning-month-hint">Calendrier mensuel complet. Clique sur un jour pour le zoomer sans masquer la vue d'ensemble.</div>
      </div>
      <div class="calendar-grid">
        ${['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'].map(day => `<div class="calendar-head">${day}</div>`).join('')}
        ${monthDays.map(day => {
          if (!day) return '<div class="calendar-day-empty"></div>';
          const entry = S.planningEntries[day.key] || '';
          const preview = entry.trim() ? entry.trim().split('\n').slice(0, 2).join('\n') : 'Aucun agenda saisi';
          const classes = ['calendar-day'];
          if (day.isToday) classes.push('today');
          if (selectedDate === day.key) classes.push('selected');
          return `
            <button class="${classes.join(' ')}" type="button" data-date-key="${day.key}" onclick="openPlanningDay('${day.key}')">
              <span class="calendar-day-number">${day.label}</span>
              <span class="calendar-day-preview" data-date-preview="${day.key}">${esc(preview)}</span>
            </button>`;
        }).join('')}
      </div>
      ${selectedDate ? renderPlanningDayOverlay(selectedDate) : ''}
    </div>`;
}

function renderPlanningDayOverlay(dateKey) {
  const entry = S.planningEntries[dateKey] || '';
  return `
    <div class="planning-day-overlay">
      <div class="planning-day-card">
        <h3>${esc(formatPlanningDateLabel(dateKey).toUpperCase())}</h3>
        <div class="planning-day-meta">Le calendrier reste visible en fond. Modifie l agenda du jour ici.</div>
        <textarea id="planning-day-editor" oninput="updatePlanningEntry(this.value)" placeholder="Agenda du jour, rendez-vous, rappels...">${escTextArea(entry)}</textarea>
        <div class="planning-overlay-actions">
          <button class="panel-close-btn" type="button" onclick="closePlanningDay()">FERMER</button>
        </div>
      </div>
    </div>`;
}

function openPlanningDay(dateKey) {
  S.selectedPlanningDate = dateKey;
  renderPlanningPanel();
}

function closePlanningDay() {
  S.selectedPlanningDate = null;
  renderPlanningPanel();
}

function updatePlanningEntry(value) {
  if (!S.selectedPlanningDate) return;
  const text = String(value || '');
  if (text.trim()) {
    S.planningEntries[S.selectedPlanningDate] = text;
  } else {
    delete S.planningEntries[S.selectedPlanningDate];
  }
  savePlanningEntries();
  updatePlanningDayPreview(S.selectedPlanningDate, text);
  renderHomeDeck();
}

function updatePlanningDayPreview(dateKey, value) {
  const previewEl = document.querySelector(`[data-date-preview="${dateKey}"]`);
  if (!previewEl) return;

  const text = String(value || '').trim();
  previewEl.textContent = text ? text.split('\n').slice(0, 2).join('\n') : 'Aucun agenda saisi';
}

function shiftPlanningMonth(delta) {
  const cursor = new Date(S.planningCursor || new Date());
  cursor.setMonth(cursor.getMonth() + Number(delta || 0));
  S.planningCursor = startOfMonth(cursor);
  S.selectedPlanningDate = null;
  renderPlanningPanel();
}

function goToCurrentPlanningMonth() {
  S.planningCursor = startOfMonth(new Date());
  S.selectedPlanningDate = todayKey();
  renderPlanningPanel();
}

// ═══════════════════════════════════════════════════════════════
//  DOCUMENTS
// ═══════════════════════════════════════════════════════════════
function renderDocumentPanel() {
  const host = document.getElementById('document-panel');
  if (!host) return;

  host.innerHTML = `
    <div class="document-shell">
      <div class="document-toolbar">
        <div class="planning-month-label">NOTES / DOCUMENTS</div>
        <div class="planning-month-hint">Chaque carte laisse voir le debut de la note. Clique pour l ouvrir en grand et ecrire dedans.</div>
      </div>
      <div class="document-grid">
        ${S.documents.map(document => `
          <button class="document-note-card" type="button" data-document-id="${document.id}" onclick="openDocumentNote(${document.id})">
            <div class="document-note-title" data-document-title="${document.id}">${esc(document.title)}</div>
            <div class="document-note-preview" data-document-preview="${document.id}">${esc(getDocumentCardLabel(document))}</div>
            <div class="document-note-stamp">${esc(formatDocumentStamp(document.updatedAt))}</div>
          </button>`).join('')}
      </div>
      ${S.activeDocumentId ? renderDocumentEditorOverlay() : ''}
    </div>`;
}

function renderDocumentEditorOverlay() {
  const document = getActiveDocument();
  if (!document) return '';

  return `
    <div class="document-editor-overlay">
      <div class="document-editor-card">
        <input type="text" id="document-title-editor" value="${escAttr(document.title)}" maxlength="60" oninput="updateActiveDocumentTitle(this.value)">
        <div class="document-editor-help">Note agrandie. Ecris librement dedans, avec retour a la ligne normal dans l editeur multiligne.</div>
        <textarea id="document-content-editor" oninput="updateActiveDocumentContent(this.value)" placeholder="Commence a ecrire ici...">${escTextArea(document.content)}</textarea>
        <div class="document-editor-actions">
          <button class="action-btn red" type="button" onclick="deleteActiveDocument()">SUPPRIMER</button>
          <button class="panel-close-btn" type="button" onclick="closeDocumentNote()">FERMER</button>
        </div>
      </div>
    </div>`;
}

function createDocumentNote() {
  const note = {
    id: Date.now(),
    title: `Note ${String(S.documents.length + 1).padStart(2, '0')}`,
    content: '',
    updatedAt: new Date().toISOString(),
  };
  S.documents.unshift(note);
  S.activeDocumentId = note.id;
  saveDocuments();
  renderDocumentPanel();
  renderHomeDeck();
}

function openDocumentNote(id) {
  S.activeDocumentId = id;
  renderDocumentPanel();
}

function closeDocumentNote() {
  S.activeDocumentId = null;
  renderDocumentPanel();
}

function updateActiveDocumentTitle(value) {
  const document = getActiveDocument();
  if (!document) return;
  document.title = sanitizeDocumentTitle(value);
  document.updatedAt = new Date().toISOString();
  saveDocuments();
  syncDocumentCard(document);
  renderHomeDeck();
}

function updateActiveDocumentContent(value) {
  const document = getActiveDocument();
  if (!document) return;
  document.content = String(value || '');
  document.updatedAt = new Date().toISOString();
  saveDocuments();
  syncDocumentCard(document);
  renderHomeDeck();
}

function deleteActiveDocument() {
  const document = getActiveDocument();
  if (!document) return;
  S.documents = S.documents.filter(item => item.id !== document.id);
  S.activeDocumentId = null;
  saveDocuments();
  renderDocumentPanel();
  renderHomeDeck();
}

function getActiveDocument() {
  return S.documents.find(document => document.id === S.activeDocumentId) || null;
}

function getDocumentPreview(content) {
  const text = String(content || '').trim();
  if (!text) return 'Note vide. Clique pour commencer a ecrire.';
  return text.split('\n').slice(0, 5).join('\n');
}

function getDocumentCardLabel(document) {
  const title = sanitizeDocumentTitle(document?.title);
  return title || 'Note sans titre';
}

function syncDocumentCard(document) {
  const titleEl = document.querySelector(`[data-document-title="${document.id}"]`);
  const previewEl = document.querySelector(`[data-document-preview="${document.id}"]`);
  const stampEl = document.querySelector(`[data-document-id="${document.id}"] .document-note-stamp`);

  if (titleEl) titleEl.textContent = sanitizeDocumentTitle(document.title);
  if (previewEl) previewEl.textContent = getDocumentCardLabel(document);
  if (stampEl) stampEl.textContent = formatDocumentStamp(document.updatedAt);
}

function sanitizeDocumentTitle(value) {
  const text = String(value || '').trim();
  return text || 'Note sans titre';
}

function getLatestDocumentLabel() {
  if (!S.documents.length) return 'Aucune note';
  return S.documents[0].title;
}

function syncTaskProjectSelector() {
  const select = document.getElementById('task-project-select');
  if (!select) return;

  const hasSelectedProject = !!getSelectedTaskProject();
  select.innerHTML = `
    <option value="">Choisir un projet</option>
    ${S.projects.map(project => `<option value="${project.id}">${esc(project.name)}</option>`).join('')}`;
  select.value = hasSelectedProject ? String(S.selectedTaskProjectId) : '';
  select.disabled = !S.projects.length;
}

function selectTaskProject(projectId) {
  setSelectedTaskProject(projectId);
  renderTasks();
}

function setSelectedTaskProject(projectId) {
  S.selectedTaskProjectId = normalizeProjectId(projectId);
  if (S.selectedTaskProjectId == null) {
    localStorage.removeItem(SELECTED_TASK_PROJECT_STORAGE_KEY);
  } else {
    localStorage.setItem(SELECTED_TASK_PROJECT_STORAGE_KEY, String(S.selectedTaskProjectId));
  }
}

function getSelectedTaskProject() {
  return getProjectById(S.selectedTaskProjectId);
}

function getSelectedProjectTasks() {
  if (!getSelectedTaskProject()) return [];
  return S.tasks.filter(task => task.projectId === S.selectedTaskProjectId);
}

function getProjectById(projectId) {
  return S.projects.find(project => project.id === projectId) || null;
}

function getEffectiveTaskProjectId(projectId = S.selectedTaskProjectId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  return getProjectById(normalizedProjectId)?.id ?? null;
}

// ═══════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════
function updateStats() {
  const activeProjects = S.projects.filter(p => p.status === 'active').length;
  const linkedTasks = S.tasks.filter(task => getProjectById(task.projectId));
  const openTasks = linkedTasks.filter(t => !t.done).length;
  const doneTasks = linkedTasks.filter(t => t.done).length;

  document.getElementById('stat-projects').textContent = activeProjects;
  document.getElementById('stat-tasks').textContent = openTasks;
  document.getElementById('stat-done').textContent = doneTasks;
  renderHomeDeck();
}

// ═══════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════
function openSettings() {
  document.getElementById('pilot-name').value = S.pilot;
  document.getElementById('provider-select-settings').value = S.provider;
  syncModelSelectors();
  refreshApiKeyUI();
  document.getElementById('settings-modal').style.display = 'flex';
}

function openDeckConfigModal(deckIndex = S.activeDeck) {
  S.deckConfigDraft = cloneHomeDecks(S.homeDecks);
  S.editingDeckIndex = clampDeckIndex(deckIndex, S.deckConfigDraft);
  renderDeckConfigEditor();
  document.getElementById('deck-config-modal').style.display = 'flex';
}

function closeDeckConfigModal() {
  S.deckConfigDraft = null;
  document.getElementById('deck-config-modal').style.display = 'none';
}

function switchDeckConfigEditor(nextIndex) {
  persistDeckConfigDraft();
  S.editingDeckIndex = clampDeckIndex(nextIndex, S.deckConfigDraft);
  renderDeckConfigEditor();
}

function renderDeckConfigEditor() {
  const select = document.getElementById('deck-config-select');
  const host = document.getElementById('deck-config-form');
  if (!select || !host || !S.deckConfigDraft) return;

  select.innerHTML = S.deckConfigDraft
    .map((deck, index) => `<option value="${index}">${esc(deck.indexLabel)} - ${esc(deck.title)}</option>`)
    .join('');
  select.value = String(S.editingDeckIndex);

  const deck = S.deckConfigDraft[S.editingDeckIndex];
  host.innerHTML = `
    <section class="deck-config-card">
      <span class="deck-config-subtitle">GESTION DES PAGES</span>
      <div class="panel-header-actions">
        <button class="btn-save" type="button" onclick="addDeckConfigPage()">AJOUTER UNE PAGE</button>
        <button class="btn-cancel" type="button" onclick="removeDeckConfigPage()" ${S.deckConfigDraft.length <= 1 ? 'disabled' : ''}>SUPPRIMER CETTE PAGE</button>
      </div>
      <small>La nouvelle page reprend une structure de 4 cadrans configurable. La suppression retire la page actuellement selectionnee.</small>
    </section>
    <section class="deck-config-card">
      <span class="deck-config-subtitle">PAGE</span>
      <div class="setting-grid">
        <div class="setting-group">
          <label>LABEL COURT</label>
          <input type="text" id="deck-indexLabel" value="${escAttr(deck.indexLabel)}" maxlength="8">
        </div>
        <div class="setting-group">
          <label>TITRE CENTRAL</label>
          <input type="text" id="deck-title" value="${escAttr(deck.title)}" maxlength="40">
        </div>
      </div>
      <div class="setting-grid">
        <div class="setting-group">
          <label>SURTITRE</label>
          <input type="text" id="deck-kicker" value="${escAttr(deck.kicker)}" maxlength="40">
        </div>
        <div class="setting-group">
          <label>DESCRIPTION</label>
          <textarea id="deck-description">${escTextArea(deck.description)}</textarea>
        </div>
      </div>
    </section>
    ${deck.quadrants.map((quadrant, index) => `
      <section class="deck-config-card">
        <h3>CADRAN ${index + 1}</h3>
        <div class="setting-group">
          <label>FEATURE</label>
          <select id="quadrant-${index}-featureId" onchange="handleQuadrantFeatureChange(${index}, this.value)">
            ${getFeatureCatalogOptionsHtml(quadrant.featureId)}
          </select>
          <small>${esc(getFeatureCatalogSummary(quadrant.featureId))}</small>
        </div>
        <div class="setting-grid">
          <div class="setting-group">
            <label>LABEL HAUT</label>
            <input type="text" id="quadrant-${index}-kicker" value="${escAttr(quadrant.kicker)}" maxlength="40">
          </div>
          <div class="setting-group">
            <label>TITRE</label>
            <input type="text" id="quadrant-${index}-title" value="${escAttr(quadrant.title)}" maxlength="60">
          </div>
        </div>
        <div class="setting-group">
          <label>DESCRIPTION</label>
          <textarea id="quadrant-${index}-description">${escTextArea(quadrant.description)}</textarea>
        </div>
      </section>
    `).join('')}`;
}

function addDeckConfigPage() {
  if (!S.deckConfigDraft) return;

  persistDeckConfigDraft();
  const nextIndex = S.deckConfigDraft.length;
  S.deckConfigDraft.push(createDefaultDeck(nextIndex));
  S.editingDeckIndex = nextIndex;
  renderDeckConfigEditor();
}

function removeDeckConfigPage() {
  if (!S.deckConfigDraft) return;
  if (S.deckConfigDraft.length <= 1) {
    showToast('AU MOINS UNE PAGE EST REQUISE', 'error', 2200, false);
    return;
  }

  persistDeckConfigDraft();
  const deck = S.deckConfigDraft[S.editingDeckIndex];
  const targetLabel = deck?.title || `PAGE ${S.editingDeckIndex + 1}`;
  if (!window.confirm(`Supprimer la page "${targetLabel}" ?`)) return;

  S.deckConfigDraft.splice(S.editingDeckIndex, 1);
  S.editingDeckIndex = clampDeckIndex(S.editingDeckIndex, S.deckConfigDraft);
  renderDeckConfigEditor();
}

function persistDeckConfigDraft() {
  if (!S.deckConfigDraft) return;

  const draft = S.deckConfigDraft[S.editingDeckIndex];
  if (!draft) return;

  draft.indexLabel = readConfiguredField('deck-indexLabel', draft.indexLabel);
  draft.title = readConfiguredField('deck-title', draft.title);
  draft.kicker = readConfiguredField('deck-kicker', draft.kicker);
  draft.description = readConfiguredField('deck-description', draft.description);

  draft.quadrants = draft.quadrants.map((quadrant, index) => ({
    ...quadrant,
    ...resolveConfiguredQuadrant(index, quadrant),
  }));
}

function handleQuadrantFeatureChange(index, featureId) {
  persistDeckConfigDraft();
  const deck = S.deckConfigDraft?.[S.editingDeckIndex];
  const feature = getFeatureDefinition(featureId);
  if (!deck || !feature || !deck.quadrants[index]) return;

  deck.quadrants[index] = {
    ...deck.quadrants[index],
    featureId,
    preview: feature.preview,
    action: feature.action,
    kicker: feature.kicker,
    title: feature.title,
    description: feature.description,
  };

  renderDeckConfigEditor();
}

function saveDeckConfig() {
  persistDeckConfigDraft();
  S.homeDecks = cloneHomeDecks(S.deckConfigDraft);
  S.activeDeck = clampDeckIndex(S.activeDeck, S.homeDecks);
  S.editingDeckIndex = clampDeckIndex(S.editingDeckIndex, S.homeDecks);
  localStorage.setItem('nexus_active_deck', String(S.activeDeck));
  localStorage.setItem(HOME_DECK_STORAGE_KEY, JSON.stringify(S.homeDecks));
  renderHomeDeck();
  S.deckConfigDraft = cloneHomeDecks(S.homeDecks);
  renderDeckConfigEditor();
  showToast('PAGES ET CADRANS MIS A JOUR', 'success', 2200, false);
  logAction('system', 'sys', 'Configuration des pages mise a jour');
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}
function saveSettings() {
  const previousProvider = S.provider;
  const previousModel = S.model;
  S.pilot  = document.getElementById('pilot-name').value.trim() || 'PILOTE';
  S.provider = document.getElementById('provider-select-settings').value;
  S.model  = document.getElementById('model-select-settings').value;
  saveCurrentProviderApiKey();

  localStorage.setItem('nexus_pilot',   S.pilot);
  localStorage.setItem('nexus_provider', S.provider);
  localStorage.setItem('nexus_model',   S.model);

  ensureValidModel();
  syncModelSelectors();

  if (previousProvider !== S.provider || previousModel !== S.model) {
    resetChatContext(`Configuration IA: ${S.provider} / ${S.model}`);
  }

  refreshAIStatus();
  closeSettings();
  showToast('CONFIGURATION SAUVEGARDÉE', 'success');
  logAction('system', 'sys', `Paramètres mis à jour — modèle : ${S.model}`);
}

function refreshAIStatus() {
  const el = document.getElementById('ai-status');
  if (!el) return;
  const transport = isDirectBrowserProvider(S.provider) ? 'VIA NAVIGATEUR' : 'LOCAL NON GARANTI';
  el.textContent = `IA: ${S.provider.toUpperCase()} — ${S.model} — ${transport}`;
  el.style.color = 'var(--green)';
  setText('pers-provider', S.provider);
  setText('pers-model', S.model);
  setText('home-core-provider', S.provider.toUpperCase());
  setText('home-core-model', S.model);
  setText('home-core-status', document.getElementById('system-status-text')?.textContent || 'SYSTEME ACTIF');
  renderHomeDeck();
}

// ═══════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
function showToast(msg, level = 'info', duration = 3200, speak = true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast show ${level}`;
  if (speak) speakText(msg);
  if (S._toastTimer) clearTimeout(S._toastTimer);
  S._toastTimer = setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => { el.className = 'toast'; }, 280);
  }, duration);
}

// ═══════════════════════════════════════════════════════════════
//  HEX BACKGROUND CANVAS
// ═══════════════════════════════════════════════════════════════
function drawHexGrid() {
  const canvas = document.getElementById('hex-canvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const size = 26;
  const colW = size * 1.5;
  const rowH = Math.sqrt(3) * size;

  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth   = 0.4;

  for (let col = -1; col < canvas.width / colW + 2; col++) {
    for (let row = -1; row < canvas.height / rowH + 2; row++) {
      const x = col * colW;
      const y = row * rowH + (col % 2 === 0 ? 0 : rowH / 2);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a  = (Math.PI / 3) * k - Math.PI / 6;
        const px = x + size * Math.cos(a);
        const py = y + size * Math.sin(a);
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  NETWORK
// ═══════════════════════════════════════════════════════════════
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function fmtPrice(p) {
  if (p >= 10000) return p.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (p >= 1000)  return p.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (p >= 1)     return p.toFixed(2);
  return p.toFixed(4);
}

function nowHHMMSS() {
  const n = new Date();
  const p = v => String(v).padStart(2, '0');
  return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return esc(str).replace(/'/g, '&#39;');
}

function escTextArea(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readConfiguredField(id, fallback) {
  const value = document.getElementById(id)?.value ?? '';
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

function readConfiguredSelectValue(id, fallback) {
  const value = document.getElementById(id)?.value ?? '';
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

function getFeatureDefinition(featureId) {
  return FEATURE_CATALOG[featureId] || null;
}

function getFeatureCatalogOptionsHtml(selectedFeatureId) {
  const groups = new Map();

  Object.values(FEATURE_CATALOG).forEach(feature => {
    const label = formatFeatureTypeLabel(feature.featureType || 'other');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(feature);
  });

  return Array.from(groups.entries())
    .map(([label, features]) => `
      <optgroup label="${escAttr(label)}">
        ${features.map(feature => `<option value="${escAttr(feature.id)}" ${feature.id === selectedFeatureId ? 'selected' : ''}>${esc(getFeatureDisplayName(feature))}</option>`).join('')}
      </optgroup>
    `)
    .join('');
}

function getFeatureDisplayName(feature) {
  const suffix = feature.variantOf ? ` (${feature.id})` : '';
  return `${feature.title}${suffix}`;
}

function getFeatureCatalogSummary(featureId) {
  const feature = getFeatureDefinition(featureId);
  if (!feature) return 'Feature inconnue';

  const base = `Type: ${formatFeatureTypeLabel(feature.featureType || 'other')}`;
  if (!feature.variantOf) return `${base} · Feature racine`;

  const parent = getFeatureDefinition(feature.variantOf);
  const parentLabel = parent?.title || feature.variantOf;
  return `${base} · Variante de ${parentLabel}`;
}

function formatFeatureTypeLabel(featureType) {
  const labels = {
    iaChat: 'IA CHAT',
    workflow: 'WORKFLOW',
    planning: 'PLANNING',
    document: 'DOCUMENT',
    systemProfile: 'PERSONNALITE',
    activityLog: 'JOURNAL',
    settings: 'CONFIG',
    other: 'AUTRES',
  };
  return labels[featureType] || String(featureType || 'AUTRES').toUpperCase();
}

function inferLegacyFeatureId(quadrant) {
  if (!quadrant?.action) return null;

  if (quadrant.action.type === 'settings') return 'systemSettings';

  if (quadrant.action.type === 'quickPrompt') {
    if (quadrant.action.promptType === 'market') return 'marketBrief';
    if (quadrant.action.promptType === 'projects') return 'projectReview';
    if (quadrant.action.promptType === 'plan') return 'dailyPlan';
  }

  if (quadrant.action.type === 'panel') {
    if (quadrant.action.target === 'actions') return 'actionsLog';
    if (quadrant.action.target === 'personality') return 'personalityProfile';
    if (quadrant.action.target === 'planning') return 'planningCalendar';
    if (quadrant.action.target === 'document') return 'documentNotebook';
    if (quadrant.action.target === 'dashboard') {
      return quadrant.preview === 'status' ? 'dashboardControl' : 'projectsDashboard';
    }
    if (quadrant.action.target === 'chat') {
      return quadrant.preview === 'voice' ? 'chatConsole' : 'chat';
    }
  }

  return null;
}

function resolveFeatureId(rawQuadrant, fallbackQuadrant) {
  const explicitId = rawQuadrant?.featureId || fallbackQuadrant?.featureId;
  if (explicitId && getFeatureDefinition(explicitId)) return explicitId;

  return inferLegacyFeatureId(rawQuadrant)
    || inferLegacyFeatureId(fallbackQuadrant)
    || 'chat';
}

function resolveFeatureQuadrant(rawQuadrant, fallbackQuadrant) {
  const featureId = resolveFeatureId(rawQuadrant, fallbackQuadrant);
  const feature = getFeatureDefinition(featureId) || {};

  return {
    featureId,
    preview: feature.preview,
    action: feature.action,
    kicker: normalizeDeckText(rawQuadrant?.kicker, feature.kicker || fallbackQuadrant?.kicker || 'MODULE'),
    title: normalizeDeckText(rawQuadrant?.title, feature.title || fallbackQuadrant?.title || 'Module'),
    description: normalizeDeckText(rawQuadrant?.description, feature.description || fallbackQuadrant?.description || ''),
  };
}

function resolveConfiguredQuadrant(index, quadrant) {
  const featureId = readConfiguredSelectValue(`quadrant-${index}-featureId`, quadrant.featureId || 'chat');
  const feature = getFeatureDefinition(featureId) || getFeatureDefinition(quadrant.featureId) || {};

  return {
    featureId,
    preview: feature.preview || quadrant.preview,
    action: feature.action || quadrant.action,
    kicker: readConfiguredField(`quadrant-${index}-kicker`, quadrant.kicker),
    title: readConfiguredField(`quadrant-${index}-title`, quadrant.title),
    description: readConfiguredField(`quadrant-${index}-description`, quadrant.description),
  };
}

function createDefaultDeck(deckIndex) {
  return normalizeHomeDeck({
    indexLabel: formatDeckIndexLabel(deckIndex),
    title: `Page ${formatDeckIndexLabel(deckIndex)}`,
    kicker: 'PAGE PERSONNALISEE',
    showSystemStats: false,
    description: 'Nouvelle page configurable. Choisis un titre central et assigne une feature a chaque cadran.',
    quadrants: getDefaultDeckTemplate(deckIndex).quadrants.map(quadrant => ({
      featureId: quadrant.featureId,
    })),
  }, deckIndex);
}

function cloneHomeDecks(source) {
  return normalizeHomeDecks(source);
}

function loadHomeDecks() {
  const raw = JSON.parse(localStorage.getItem(HOME_DECK_STORAGE_KEY) || 'null');
  return normalizeHomeDecks(raw);
}

function normalizeHomeDecks(source) {
  const decks = Array.isArray(source) && source.length ? source : HOME_DECKS;
  return decks.map((deck, deckIndex) => normalizeHomeDeck(deck, deckIndex));
}

function normalizeHomeDeck(rawDeck, deckIndex) {
  const fallbackDeck = getDefaultDeckTemplate(deckIndex);

  return {
    ...fallbackDeck,
    indexLabel: normalizeDeckText(rawDeck?.indexLabel, fallbackDeck.indexLabel),
    title: normalizeDeckText(rawDeck?.title, fallbackDeck.title),
    kicker: normalizeDeckText(rawDeck?.kicker, fallbackDeck.kicker),
    description: normalizeDeckText(rawDeck?.description, fallbackDeck.description),
    showSystemStats: typeof rawDeck?.showSystemStats === 'boolean' ? rawDeck.showSystemStats : fallbackDeck.showSystemStats,
    quadrants: Array.from({ length: 4 }, (_, quadrantIndex) => {
      const rawQuadrant = Array.isArray(rawDeck?.quadrants) ? rawDeck.quadrants[quadrantIndex] || {} : {};
      const fallbackQuadrant = fallbackDeck.quadrants[quadrantIndex] || getDefaultDeckTemplate(0).quadrants[quadrantIndex];
      return resolveFeatureQuadrant(rawQuadrant, fallbackQuadrant);
    }),
  };
}

function getDefaultDeckTemplate(deckIndex) {
  const templateDeck = HOME_DECKS[deckIndex] || HOME_DECKS[deckIndex % HOME_DECKS.length] || HOME_DECKS[0];
  const isExtraDeck = deckIndex >= HOME_DECKS.length;

  return {
    ...templateDeck,
    indexLabel: formatDeckIndexLabel(deckIndex),
    title: isExtraDeck ? `Page ${formatDeckIndexLabel(deckIndex)}` : templateDeck.title,
    kicker: isExtraDeck ? 'PAGE PERSONNALISEE' : templateDeck.kicker,
    showSystemStats: isExtraDeck ? false : templateDeck.showSystemStats,
    description: isExtraDeck
      ? 'Nouvelle page configurable. Choisis un titre central et assigne une feature a chaque cadran.'
      : templateDeck.description,
    quadrants: Array.from({ length: 4 }, (_, quadrantIndex) => {
      const templateQuadrant = templateDeck.quadrants[quadrantIndex] || HOME_DECKS[0].quadrants[quadrantIndex] || { featureId: 'chat' };
      return resolveFeatureQuadrant(templateQuadrant, templateQuadrant);
    }),
  };
}

function formatDeckIndexLabel(deckIndex) {
  return String(deckIndex + 1).padStart(2, '0');
}

function getDeckCount(source) {
  if (Array.isArray(source) && source.length) return source.length;
  if (typeof S !== 'undefined' && Array.isArray(S.homeDecks) && S.homeDecks.length) return S.homeDecks.length;
  return Math.max(HOME_DECKS.length, 1);
}

function normalizeDeckText(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeAIState() {
  if (!MODEL_OPTIONS[S.provider]) {
    S.provider = 'gemini';
  }
  if (S.provider === 'ollama' && (S.model === 'mistral' || S.model === 'llama3.2:3b')) {
    S.model = DEFAULT_OLLAMA_MODEL;
    localStorage.setItem('nexus_model', S.model);
  }
  ensureValidModel();
}

function ensureValidModel() {
  const models = MODEL_OPTIONS[S.provider] || [];
  const hasCurrentModel = models.some(model => model.value === S.model);
  if (!hasCurrentModel) {
    S.model = models[0]?.value || '';
  }
}

function syncModelSelectors() {
  renderModelSelect('ai-model', S.provider, S.model);
  renderModelSelect('model-select-settings', S.provider, S.model);

  const providerSelect = document.getElementById('provider-select-settings');
  if (providerSelect) providerSelect.value = S.provider;
}

function renderModelSelect(id, provider, selectedValue) {
  const select = document.getElementById(id);
  if (!select) return;

  const options = MODEL_OPTIONS[provider] || [];
  select.innerHTML = options
    .map(option => `<option value="${option.value}">${option.label}</option>`)
    .join('');
  select.value = selectedValue;
}

function getLocalSmallTalkReply(text) {
  const normalized = normalizeSmallTalkText(text);
  const address = getPersonalityAddressLabel();

  if (/^(salut|bonjour|hello|hey|coucou)$/.test(normalized)) {
    return `Bonjour ${address}.`;
  }

  if (/^(dis bonjour|dit bonjour)$/.test(normalized)) {
    return `Bonjour ${address}.`;
  }

  if (/^(comment vas tu|comment tu vas|ca va|ca va toi|tu vas bien)$/.test(normalized)) {
    return `Je vais bien, ${address}. Prêt a aider.`;
  }

  return null;
}

function normalizeSmallTalkText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPersonalityAddressLabel() {
  if (S.personality.address === 'commandant') return 'Commandant';
  if (S.personality.address === 'prenom') return S.pilot;
  if (S.personality.address === 'neutre') return S.pilot;
  return 'Pilote';
}

function resetChatContext(reason) {
  S.history = [];
  logAction('system', 'sys', `Contexte chat réinitialisé — ${reason}`);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function loadPersonality() {
  const raw = JSON.parse(localStorage.getItem('nexus_personality') || 'null');
  return normalizePersonality({ ...DEFAULT_PERSONALITY, ...(raw || {}) });
}

function loadTasks() {
  const raw = JSON.parse(localStorage.getItem('nexus_tasks') || '[]');
  return Array.isArray(raw)
    ? raw.map(normalizeTask).filter(Boolean)
    : [];
}

function loadPlanningEntries() {
  const raw = JSON.parse(localStorage.getItem(PLANNING_STORAGE_KEY) || '{}');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function savePlanningEntries() {
  localStorage.setItem(PLANNING_STORAGE_KEY, JSON.stringify(S.planningEntries));
}

function loadDocuments() {
  const raw = JSON.parse(localStorage.getItem(DOCUMENT_STORAGE_KEY) || 'null');
  if (Array.isArray(raw) && raw.length) {
    return raw.map(normalizeDocument).filter(Boolean);
  }

  return [
    normalizeDocument({
      id: Date.now(),
      title: 'NOTE 01',
      content: 'Début de carnet documentaire. Clique sur une note pour l ouvrir et écrire dedans.',
      updatedAt: new Date().toISOString(),
    }),
    normalizeDocument({
      id: Date.now() + 1,
      title: 'NOTE 02',
      content: 'Tu peux t en servir pour specs, mémoire projet, idées ou brouillons.',
      updatedAt: new Date().toISOString(),
    }),
  ].filter(Boolean);
}

function normalizeDocument(document) {
  if (!document || typeof document !== 'object') return null;

  return {
    id: Number.isFinite(Number(document.id)) ? Number(document.id) : Date.now(),
    title: String(document.title || 'Note sans titre').trim() || 'Note sans titre',
    content: String(document.content || ''),
    updatedAt: String(document.updatedAt || new Date().toISOString()),
  };
}

function saveDocuments() {
  localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify(S.documents));
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object') return null;

  return {
    id: Number.isFinite(Number(task.id)) ? Number(task.id) : Date.now(),
    text: String(task.text || '').trim(),
    done: Boolean(task.done),
    projectId: normalizeProjectId(task.projectId),
  };
}

function loadSelectedTaskProjectId() {
  return normalizeProjectId(localStorage.getItem(SELECTED_TASK_PROJECT_STORAGE_KEY));
}

function normalizeProjectId(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildCalendarDays(monthStart) {
  const start = startOfMonth(monthStart);
  const totalDays = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const leading = (start.getDay() + 6) % 7;
  const days = Array.from({ length: leading }, () => null);
  const today = todayKey();

  for (let day = 1; day <= totalDays; day += 1) {
    const current = new Date(start.getFullYear(), start.getMonth(), day);
    days.push({
      key: toDateKey(current),
      label: String(day).padStart(2, '0'),
      isToday: toDateKey(current) === today,
    });
  }

  return days;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayKey() {
  return toDateKey(new Date());
}

function formatPlanningMonthLabel(date) {
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function formatPlanningDateLabel(dateKey) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function countPlanningEntriesInMonth(date) {
  const prefix = toDateKey(startOfMonth(date)).slice(0, 7);
  return Object.keys(S.planningEntries).filter(key => key.startsWith(prefix) && String(S.planningEntries[key] || '').trim()).length;
}

function formatDocumentStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'mise a jour';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function normalizePersonality(personality) {
  return {
    ...DEFAULT_PERSONALITY,
    ...personality,
    address: normalizeChoice(personality.address, ['pilote', 'commandant', 'prenom', 'neutre'], DEFAULT_PERSONALITY.address),
    tone: normalizeChoice(personality.tone, ['direct', 'calme', 'analytique', 'conversationnel'], DEFAULT_PERSONALITY.tone),
    detailLevel: normalizeChoice(personality.detailLevel, ['court', 'normal', 'detaille'], DEFAULT_PERSONALITY.detailLevel),
    responseMode: normalizeChoice(personality.responseMode, ['operationnel', 'pedagogique', 'technique'], DEFAULT_PERSONALITY.responseMode),
    style: normalizeChoice(personality.style, ['cockpit', 'sobre', 'neutre'], DEFAULT_PERSONALITY.style),
    proactivity: normalizeChoice(personality.proactivity, ['faible', 'equilibree', 'forte'], DEFAULT_PERSONALITY.proactivity),
    confirmation: normalizeChoice(personality.confirmation, ['toujours', 'actions sensibles', 'jamais'], DEFAULT_PERSONALITY.confirmation),
  };
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = String(value || '').toLowerCase().trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

function savePersonality() {
  localStorage.setItem('nexus_personality', JSON.stringify(S.personality));
}

function renderPersonality() {
  const p = S.personality;
  setText('pers-interfaceName', p.interfaceName);
  setText('pers-address', prettyPersonalityValue(p.address));
  setText('pers-tone', prettyPersonalityValue(p.tone));
  setText('pers-detailLevel', prettyPersonalityValue(p.detailLevel));
  setText('pers-responseMode', prettyPersonalityValue(p.responseMode));
  setText('pers-style', prettyPersonalityValue(p.style));
  setText('pers-proactivity', prettyPersonalityValue(p.proactivity));
  setText('pers-confirmation', prettyPersonalityValue(p.confirmation));
  setText('pers-language', prettyPersonalityValue(p.language));
  setText('pers-technicalRigour', prettyPersonalityValue(p.technicalRigour));
  renderHomeDeck();
}

function prettyPersonalityValue(value) {
  const labels = {
    pilote: 'Pilote',
    commandant: 'Commandant',
    prenom: 'Prénom',
    neutre: 'Neutre',
    direct: 'Direct',
    calme: 'Calme',
    analytique: 'Analytique',
    conversationnel: 'Conversationnel',
    court: 'Court',
    normal: 'Normal',
    detaille: 'Détaillé',
    operationnel: 'Opérationnel',
    pedagogique: 'Pédagogique',
    technique: 'Technique',
    cockpit: 'Cockpit',
    sobre: 'Sobre',
    equilibree: 'Équilibrée',
    faible: 'Faible',
    forte: 'Forte',
    francais: 'Français',
    stricte: 'Stricte',
  };
  return labels[value] || value;
}

function formatPersonalityForPrompt() {
  return [
    `- Interface : ${S.personality.interfaceName}`,
    `- Appellation utilisateur : ${S.personality.address}`,
    `- Ton : ${S.personality.tone}`,
    `- Niveau de détail : ${S.personality.detailLevel}`,
    `- Mode de réponse : ${S.personality.responseMode}`,
    `- Style : ${S.personality.style}`,
    `- Proactivité : ${S.personality.proactivity}`,
    `- Confirmation : ${S.personality.confirmation}`,
    `- Langue : ${S.personality.language}`,
    `- Rigueur technique : ${S.personality.technicalRigour}`,
  ].join('\n');
}

function applyPersonalityUpdates(updates) {
  const allowed = {};
  const keys = ['address', 'tone', 'detailLevel', 'responseMode', 'style', 'proactivity', 'confirmation'];
  keys.forEach(key => {
    if (updates[key] != null) allowed[key] = updates[key];
  });

  S.personality = normalizePersonality({
    ...S.personality,
    ...allowed,
  });
  savePersonality();
  return allowed;
}

function summarizePersonalityUpdate(updates) {
  const entries = Object.entries(updates);
  if (!entries.length) return 'aucun changement valide';
  return entries
    .map(([key, value]) => `${key}=${prettyPersonalityValue(value)}`)
    .join(', ');
}

function initSpeechSynthesis() {
  if (!('speechSynthesis' in window)) return;

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    const ranked = voices
      .map(voice => ({ voice, score: scoreVoice(voice) }))
      .sort((a, b) => b.score - a.score);

    S._voice = ranked[0]?.voice || voices[0];
  };

  pickVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickVoice, { once: true });
}

function toggleSpeech() {
  S.speechOn = !S.speechOn;
  localStorage.setItem('nexus_speech_on', S.speechOn ? '1' : '0');

  if (!S.speechOn && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  refreshSpeechUI();
  showToast(S.speechOn ? 'LECTURE AUDIO ACTIVE' : 'LECTURE AUDIO DÉSACTIVÉE', 'info', 1800);
}

function refreshSpeechUI() {
  const button = document.getElementById('tts-toggle');
  if (!button) return;

  const supported = 'speechSynthesis' in window;
  button.disabled = !supported;
  button.textContent = !supported
    ? 'AUDIO INDISPONIBLE'
    : S.speechOn ? 'AUDIO ON' : 'AUDIO OFF';
  button.classList.toggle('active', supported && S.speechOn);
}

function speakText(text) {
  if (!S.speechOn || !text || !('speechSynthesis' in window)) return;

  const cleaned = normalizeSpeechText(text);
  if (!cleaned) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = S._voice?.lang || 'fr-FR';
  utterance.voice = S._voice || null;
  utterance.rate = .94;
  utterance.pitch = .96;
  utterance.volume = 1;

  window.speechSynthesis.speak(utterance);
}

function scoreVoice(voice) {
  const lang = (voice.lang || '').toLowerCase();
  const name = (voice.name || '').toLowerCase();
  let score = 0;

  if (lang === 'fr-fr') score += 8;
  else if (lang.startsWith('fr')) score += 6;

  if (voice.localService) score += 3;
  if (voice.default) score += 2;

  if (/hortense|denise|audrey|aurélie|aurelie|marie|brigitte|thomas|remy|rémy|paul/.test(name)) {
    score += 4;
  }

  if (/natural|premium|enhanced|neural|online/.test(name)) {
    score += 2;
  }

  if (/english|united states|uk|german|spanish/.test(name)) {
    score -= 6;
  }

  return score;
}

function normalizeSpeechText(text) {
  return String(text)
    .replace(/\[ACTION:\{[^\]]*\}\]/g, ' ')
    .replace(/NEXUS/gi, 'Nexus')
    .replace(/OpenRouter/gi, 'Open Router')
    .replace(/OpenAI/gi, 'Open A I')
    .replace(/Ollama/gi, 'Ollama')
    .replace(/GPT-4o-mini/gi, 'G P T 4 o mini')
    .replace(/GPT-4o/gi, 'G P T 4 o')
    .replace(/gemini-2\.5-pro/gi, 'Gemini 2.5 Pro')
    .replace(/gemini-2\.5-flash/gi, 'Gemini 2.5 Flash')
    .replace(/gemini-2\.0-flash/gi, 'Gemini 2 point 0 Flash')
    .replace(/MB\/s/gi, 'méga octets par seconde')
    .replace(/UTC/gi, 'U T C')
    .replace(/[◈◉◎◆▶✓✕⚙]/g, ' ')
    .replace(/[.,;:!?()\[\]{}"'`´“”‘’«»\\/_+=*#@$%^&|~<>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  drawHexGrid();
  window.addEventListener('resize', drawHexGrid);
  document.addEventListener('keydown', handleDeckHotkeys);

  // Close modals on backdrop click
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.getElementById('deck-config-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDeckConfigModal();
  });
  document.getElementById('project-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeProjectModal();
  });
});

function handleDeckHotkeys(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;

  const activeTag = event.target?.tagName || '';
  if (/input|textarea|select/i.test(activeTag)) return;

  const key = Number(event.key);
  if (!Number.isInteger(key) || key < 1 || key > S.homeDecks.length) return;

  event.preventDefault();
  setActiveDeck(key - 1);
}
