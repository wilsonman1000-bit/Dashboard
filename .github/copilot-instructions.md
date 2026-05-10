# Agent Guardrails

- Do not create a new project, workspace scaffold, starter app, or repository structure unless the user explicitly asks for it.
- Do not create or run VS Code tasks, add `tasks.json`, or start setup workflows unless the user explicitly requests that behavior.
- Do not generate extra files, folders, configs, or boilerplate "based on the discussion" alone. Only create files that are directly required by an explicit user request.
- If the request is ambiguous, ask a short clarifying question before creating anything structural.
- Default to analyzing, explaining, or editing existing files in place instead of scaffolding new ones.