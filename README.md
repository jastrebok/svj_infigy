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
- The line-protocol export includes tags `plug` and `weather_range`, numeric fields `clouds`, `uvi`, `weather_fetchedAt`, `power_total`, and raw power values as `power_house`, `power_photovoltaics`, `power_battery`, `power_grid`.
- The JSON endpoint returns full rows with `ts`, `weather`, `power`, and `plug` in the same format as stored in `logs/data.ndjson`.

Where to edit behavior
----------------------
- Add or update action implementations in `src/services/playwrightActions.ts` and entries in `src/support/actions-config.json`.
- Add or adjust scenarios in `src/support/scenarios-config.json` and document them in `src/support/scenarios-config.md`.

SolaXCloud API integration
--------------------------
`src/services/solaxAPI.ts` — typed client for the SolaXCloud v2 REST API.

Required environment variables (`.env`):

```
SOLAX_API=https://global.solaxcloud.com
SOLAX_API_KEY=<your token>
SOLAX_WIFI_SN=<WiFi serial number printed on the data-logger>
```

When `SOLAX_WIFI_SN` is set the controller polls `POST /api/v2/dataAccess/realtimeInfo/get`
every 120 s and maps the response into the same `power` object used by Playwright:

| UI name          | SolaX field(s)                  |
|------------------|---------------------------------|
| Photovoltaics    | powerdc1 + powerdc2 + powerdc3 + powerdc4 |
| Battery          | batPower                        |
| Battery_status   | soc (%)                         |
| Grid             | feedinpower                     |
| House            | acpower                         |

Extra fields exposed: `inverterStatus` (human-readable string), `yieldToday`, `yieldTotal`, `feedinEnergy`, `consumeEnergy`.

When both SolaX and Playwright succeed in the same cycle, SolaX data takes precedence.

Plug safety
-----------
Several safeguards prevent the controller from accidentally switching the plug:

1. **No write on startup** — `lastActionAt` is initialised to `Date.now()`, so the action
   cooldown blocks any write for the full cooldown window after launch.
2. **Unknown state blocks writes** — if `extractPlugStatus` returns `null` (e.g. navigation
   error), `wouldCauseStateChange` returns `false`, so no write is attempted.
3. **Passive mode has no writes** — the Playwright power read runs regardless of whether the
   controller timer is active, but actual plug writes only happen inside `checkOnce()` which
   requires the timer to be running.
4. **Correct page before read** — `extractPlugStatus` always navigates to `/plug` before
   reading the checkbox value, preventing stale reads from other pages.

Dashboard UI
------------
The frontend (`public/`) has been overhauled:

- **Card layout** — the status area above the graphs is a single `.sc-card` component with:
  - Header: solar-panel icon · "Solar Controller" · last-action timestamp · animated state dot
  - Row 1 (3 col): Active scenario · Matched scenarios · Next refresh (time + countdown badge + date)
  - Row 2 (2 col): Interval (formatted as `60 000 ms (60 s)`) · Action cooldown (same format)
  - Weather strip: large weather emoji · UV index + cloud % + fetch time · UV forecast today/tomorrow

- **Grafana-style charts** — both the power and weather charts support pinch-to-zoom and
  drag-to-pan via `chartjs-plugin-zoom` (requires `hammerjs`). Load order in `index.html`:
  `hammerjs` → `chart.js` → `chartjs-plugin-zoom`. "Reset zoom" buttons restore the default
  12-hour view.

- **7-day history, 12 h initial view** — `fetchAndRenderWeather()` always loads the last
  7 days of data; the chart's initial `min`/`max` is clamped to the last 12 hours.

- **Force action / scenario selector** — moved to the Config tab so they are not visible
  in normal operation.
