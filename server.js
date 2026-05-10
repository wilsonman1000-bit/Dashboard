import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = __dirname;
const DEFAULT_OLLAMA_MODEL = 'llama3.2:latest';

const PROVIDERS = {
  ollama: {
    keyEnv: null,
    defaultModel: DEFAULT_OLLAMA_MODEL,
  },
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  openrouter: {
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'openrouter/auto',
  },
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
  },
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, providers: Object.keys(PROVIDERS) });
});

app.post('/api/chat', async (req, res) => {
  const provider = String(req.body?.provider || 'ollama').toLowerCase();
  const model = String(req.body?.model || PROVIDERS[provider]?.defaultModel || '');
  const systemPrompt = String(req.body?.systemPrompt || '');
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const userMessage = String(req.body?.message || '').trim();

  if (!PROVIDERS[provider]) {
    return res.status(400).json({ error: `Provider non supporte: ${provider}` });
  }

  if (!userMessage) {
    return res.status(400).json({ error: 'Message utilisateur requis.' });
  }

  const apiKey = PROVIDERS[provider].keyEnv
    ? process.env[PROVIDERS[provider].keyEnv]
    : null;
  if (PROVIDERS[provider].keyEnv && !apiKey) {
    return res.status(500).json({
      error: `Cle API manquante pour ${provider}. Configure ${PROVIDERS[provider].keyEnv} dans .env.`,
    });
  }

  try {
    let reply;
    if (provider === 'ollama') {
      reply = await callOllama({ model, systemPrompt, history, userMessage });
    } else if (provider === 'openai') {
      reply = await callOpenAI({ apiKey, model, systemPrompt, history, userMessage });
    } else if (provider === 'openrouter') {
      reply = await callOpenRouter({ apiKey, model, systemPrompt, history, userMessage });
    } else {
      reply = await callGemini({ apiKey, model, systemPrompt, history, userMessage });
    }

    return res.json({ reply });
  } catch (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({ error: error.message || 'Erreur serveur IA.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`NEXUS server listening on http://localhost:${port}`);
});

async function callOllama({ model, systemPrompt, history, userMessage }) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const endpoint = new URL('/api/chat', baseUrl);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || PROVIDERS.ollama.defaultModel,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        ...normalizeOpenAIHistory(history),
        { role: 'user', content: userMessage },
      ],
      options: {
        temperature: 0.72,
        num_predict: 900,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw createHttpError(response.status, error.error || error.message || `Ollama HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.message?.content || '(pas de reponse)';
}

async function callOpenAI({ apiKey, model, systemPrompt, history, userMessage }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || PROVIDERS.openai.defaultModel,
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
    throw createHttpError(response.status, error.error?.message || `OpenAI HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(pas de reponse)';
}

async function callOpenRouter({ apiKey, model, systemPrompt, history, userMessage }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || `http://localhost:${port}`,
      'X-Title': process.env.OPENROUTER_TITLE || 'NEXUS OS Cockpit',
    },
    body: JSON.stringify({
      model: model || PROVIDERS.openrouter.defaultModel,
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
    throw createHttpError(response.status, error.error?.message || `OpenRouter HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(pas de reponse)';
}

async function callGemini({ apiKey, model, systemPrompt, history, userMessage }) {
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model || PROVIDERS.gemini.defaultModel}:generateContent`);
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
    throw createHttpError(response.status, error.error?.message || `Gemini HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!reply) {
    throw createHttpError(502, 'Gemini a renvoye une reponse vide.');
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

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
