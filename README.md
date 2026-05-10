# NEXUS OS Cockpit

## Setup

1. Open `index.html` locally or publish the repository with GitHub Pages.
2. Open `CONFIG` in the UI.
3. Choose a cloud provider: Gemini, OpenAI, or OpenRouter.
4. Paste the matching API key in the provider key field.
5. Save the settings and use the chat directly from the browser.

## Notes

- The GitHub Pages version calls Gemini, OpenAI, or OpenRouter directly from the browser.
- API keys are stored in the browser local storage for the active user.
- Ollama remains a local-only experimental option and is not reliable from an HTTPS GitHub Pages origin.
- `server.js` can still be used for a local Node/Express workflow, but it is no longer required for the hosted browser version.
