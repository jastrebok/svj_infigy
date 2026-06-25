Project: SVJ Infigy
===================

Overview
--------
This project automates interactions with a solar/power portal using Playwright and a simple controller that periodically fetches weather/power data and performs configured actions.

Key folders and files
---------------------
- `src/services/stateController.ts`: main controller that manages login, periodic checks, and action dispatch.
- `src/services/playwrightActions.ts`: Playwright-based action handlers (login, actions, extractors).
- `src/support/actions-config.json`: available action definitions and handlers.
- `src/support/scenarios-config.json`: scenario definitions (Day Operation, Night Operation).
- `src/support/scenarios-config.md`: documentation for the scenarios config.
- `src/services/weatherAPI.ts`: fetches weather data used for decision-making.
- `src/services/storage.ts`: appends time-series entries to `logs/data.ndjson`.

Scenarios
---------
Scenarios provide a place to declaratively specify how the controller should behave under different conditions. The controller loads `src/support/scenarios-config.json` at startup and evaluates each scenario's `trigger` expression on each action opportunity. The first enabled scenario whose trigger evaluates to true will have its `actionId` executed (via the existing action handlers). If no scenario matches, the controller falls back to the default action flow.

Trigger language
----------------
Triggers are boolean expressions using a small set of variables:

- `uvi`, `clouds` — numbers derived from the latest weather fetch
- `isDay`, `isNight` — booleans computed from the weather hourly/day data
- `power_total` — numeric sum of any numeric power readings extracted from the portal (or `null`)
- `power` — raw object of power readings

Example scenarios are included in `src/support/scenarios-config.json` for `Day Operation` and `Night Operation`.

Security
--------
Scenario triggers are evaluated using dynamic function construction with controlled input variables. Treat scenario config as trusted; do not load untrusted remote configs.

Running
-------
Install dependencies and run the service (example):

```bash
npm ci
node dist/src/services/stateController.js
```

Development
-----------
- Source TypeScript is in `src/`.
- Build with `npm run build` (project uses `tsconfig.json`).

Container / Podman
------------------
- A `Containerfile` is included for Podman builds.
- Build the image with:

```bash
npm run container:build
```
- Run the container with:

```bash
npm run container:run
```
- The app listens on port `3000` and serves the UI from the container.

Grafana / InfluxDB
------------------
- The backend exposes the same JSON time-series entries used by the UI at `/api/metrics`.
- A line-protocol export endpoint is available at `/api/metrics/line`.
- The `since` query parameter is epoch milliseconds, for example:

```bash
http://localhost:3000/api/metrics/line?since=1690000000000
```

- Example import: request the last 24 hours of data from the backend and push into Influx.
- The line-protocol export includes tags `plug` and `weather_range`, numeric fields `clouds`, `uvi`, `weather_fetchedAt`, `power_total`, and raw power values as `power_dum`, `power_fve`, `power_baterie`, `power_sit`.
- The JSON endpoint returns full rows with `ts`, `weather`, `power`, and `plug` in the same format as stored in `logs/data.ndjson`.

Where to edit behavior
----------------------
- Add or update action implementations in `src/services/playwrightActions.ts` and entries in `src/support/actions-config.json`.
- Add or adjust scenarios in `src/support/scenarios-config.json` and document them in `src/support/scenarios-config.md`.
