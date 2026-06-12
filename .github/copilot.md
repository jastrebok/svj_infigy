# Project instructions

This project is a Node.js/TypeScript solar-control app.

Use this structure:

- `src/backend` for API routes and server code
- `src/workers` for PM2/background jobs
- `src/services` for solar providers and Playwright automation
- `src/support` for shared config, env, helpers
- `public` for the web UI
- `logs` and `screenshots` for runtime output

Rules:

- Do not run Playwright directly inside API routes.
- API routes should create jobs/commands.
- Workers should execute commands and save logs/screenshots.
- Each solar integration should implement a common provider interface.
- Prefer TypeScript types for all service status, actions, and log entries.
- Keep secrets in `.env`, never commit them.
- run headless diagnostic of the front end when possible