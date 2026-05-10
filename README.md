# NEXUS OS Cockpit

## Setup

1. Install dependencies:
   npm install
2. Create an environment file:
   copy .env.example .env
3. Fill `GEMINI_API_KEY` and/or `OPENAI_API_KEY` in `.env`
4. Start the server:
   npm start
5. Open `http://localhost:3000`

## Notes

- The frontend now calls `/api/chat` instead of calling AI providers directly.
- API keys stay on the server in environment variables.
- Supported providers: Ollama (local), Gemini, OpenAI, OpenRouter.
- Local mode uses Ollama at `OLLAMA_BASE_URL` and defaults to the `llama3.2:latest` model.
