import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { controller } from './stateController';
import { setBrowserVisible, isBrowserVisible } from './playwrightActions';
import { query as queryMetrics } from './storage';

function parseNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.replace(',', '.').match(/[-+]?\d*\.?\d+/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function flattenMetricRow(row: any) {
  if (!row || typeof row !== 'object') return row;
  const flat: Record<string, any> = { ts: row.ts };

  if (typeof row.plug !== 'undefined') flat.plug = row.plug;
  if (typeof flat.plug === 'string') flat.plug = flat.plug.toUpperCase();
  if (row.weather && typeof row.weather === 'object') {
    for (const key of Object.keys(row.weather)) {
      flat[`weather_${key}`] = row.weather[key];
    }
  }
  if (row.power && typeof row.power === 'object') {
    let total = 0;
    for (const key of Object.keys(row.power)) {
      const value = row.power[key];
      const fieldName = `power_${key.replace(/\s+/g, '_').toLowerCase()}`;
      flat[fieldName] = value;
      const numeric = parseNumber(value);
      if (numeric !== null) total += numeric;
    }
    flat.power_total = Number.isFinite(total) ? total : null;
  }

  return flat;
}

function escapeInflux(value: string) {
  return value.replace(/([ ,=])/g, '\\$1');
}

function formatInfluxRow(row: any, measurement = 'solar_metrics') {
  if (!row || typeof row !== 'object') return '';
  const flat = flattenMetricRow(row);
  const tags: Record<string, string> = {};
  const fields: Record<string, string | number | boolean> = {};

  if (typeof flat.plug === 'string') {
    tags.plug = flat.plug;
  }
  if (flat.weather_rangeStartIso) {
    tags.weather_range = String(flat.weather_rangeStartIso);
  }

  if (typeof flat.weather_clouds === 'number') fields.clouds = flat.weather_clouds;
  if (typeof flat.weather_uvi === 'number') fields.uvi = flat.weather_uvi;
  if (typeof flat.weather_fetchedAt === 'number') fields.weather_fetchedAt = flat.weather_fetchedAt;
  if (typeof flat.power_house === 'string') fields.power_house = String(flat.power_house);
  if (typeof flat.power_photovoltaics === 'string') fields.power_photovoltaics = String(flat.power_photovoltaics);
  if (typeof flat.power_battery === 'string') fields.power_battery = String(flat.power_battery);
  if (typeof flat.power_grid === 'string') fields.power_grid = String(flat.power_grid);
  if (typeof flat.power_total === 'number') fields.power_total = flat.power_total;

  const tagPairs = Object.entries(tags).map(([k,v]) => `${escapeInflux(k)}=${escapeInflux(v)}`);
  const fieldPairs = Object.entries(fields).map(([k,v]) => {
    if (typeof v === 'number') return `${escapeInflux(k)}=${v}`;
    return `${escapeInflux(k)}="${escapeInflux(String(v))}"`;
  });

  if (!fieldPairs.length) return '';
  const timestamp = typeof row.ts === 'number' ? `${row.ts * 1000000}` : '';
  return `${escapeInflux(measurement)}${tagPairs.length ? ',' + tagPairs.join(',') : ''} ${fieldPairs.join(',')}${timestamp ? ' ' + timestamp : ''}`;
}

const app = express();
app.use(cors());
app.use(express.json());

// NOTE: Weather fetcher runs inside controller as a single, continuous timer.

// API
app.get('/api/status', (_req, res) => {
  const base = controller.status();
  // Normalize plug value to uppercase ON/OFF for UI consistency
  if (base && typeof base.latestPlug === 'string') base.latestPlug = base.latestPlug.toUpperCase();
  res.json(Object.assign(base, {
    controllerRunning: controller.isRunning(),
    nextFetchAt: controller.getNextWeatherFetchAt(),
    fetchIntervalMs: 120_000,
    currentScenario: controller.getCurrentScenario(),
  }));
});

app.get('/api/scenarios', async (_req, res) => {
  try {
    const cfgPath = path.join(__dirname, '..', 'support', 'scenarios-config.json');
    const exists = await new Promise(resolve => fs.exists(cfgPath, exists => resolve(exists)));
    if (!exists) return res.json({ ok: true, scenarios: [] });
    const raw = await fs.promises.readFile(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    const scenarios = Array.isArray(parsed) ? parsed : [];
    res.json({ ok: true, scenarios });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Save scenarios config (overwrites file) and reloads it into the running controller
app.post('/api/scenarios', async (req, res) => {
  try {
    const scenarios = req.body && req.body.scenarios;
    if (!Array.isArray(scenarios)) return res.status(400).json({ ok: false, error: 'scenarios must be an array' });
    for (const s of scenarios) {
      if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id.trim()) {
        return res.status(400).json({ ok: false, error: 'each scenario requires a non-empty string id' });
      }
      if (typeof s.trigger !== 'string' || typeof s.actionId !== 'string') {
        return res.status(400).json({ ok: false, error: `scenario "${s.id}" requires string "trigger" and "actionId"` });
      }
    }
    const cfgPath = path.join(__dirname, '..', 'support', 'scenarios-config.json');
    await fs.promises.writeFile(cfgPath, JSON.stringify(scenarios, null, 2) + '\n', 'utf8');
    await controller.reloadScenarios();
    void controller.logEvent('config', { target: 'scenarios', count: scenarios.length, ids: scenarios.map((s: any) => s.id) });
    res.json({ ok: true, scenarios });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    const sinceParam = req.query.since;
    let since = Date.now() - (7 * 24 * 60 * 60 * 1000);
    if (sinceParam) {
      const n = Number(sinceParam);
      if (!Number.isNaN(n)) since = n;
    }
    const rows = await queryMetrics(since);
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/metrics/line', async (req, res) => {
  try {
    const sinceParam = req.query.since;
    let since = Date.now() - (7 * 24 * 60 * 60 * 1000);
    if (sinceParam) {
      const n = Number(sinceParam);
      if (!Number.isNaN(n)) since = n;
    }
    const rows = await queryMetrics(since);
    const lines = rows
      .map((row) => formatInfluxRow(row, 'solar_metrics'))
      .filter(Boolean);
    res.type('text/plain').send(lines.join('\n') + (lines.length ? '\n' : ''));
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post('/api/start', (_req, res) => {
  controller.start();
  res.json({ ok: true });
});

app.post('/api/stop', (_req, res) => {
  controller.stop();
  res.json({ ok: true });
});

app.post('/api/force', async (_req, res) => {
  try {
    const actionId = (_req && _req.body && typeof _req.body.actionId === 'string') ? _req.body.actionId : undefined;
    await controller.forceAction(actionId);
    // If the client requested a refresh of power data, also fetch latest weather+power now
    if (actionId === 'refresh_power_data') {
      try {
        await controller.fetchWeatherNow();
      } catch (e) {
        console.warn('fetchWeatherNow after force refresh failed:', e);
      }
      try {
        await controller.refreshPowerFromPlugPage();
      } catch (e) {
        console.warn('refreshPowerFromPlugPage after force refresh failed:', e);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Return available force actions (loaded from saved config)
app.get('/api/actions', async (_req, res) => {
  try {
    const cfgPath = path.join(__dirname, '..', 'support', 'actions-config.json');
    const exists = await new Promise(resolve => fs.exists(cfgPath, exists => resolve(exists)));
    if (!exists) return res.json({ ok: true, actions: [] });
    const raw = await fs.promises.readFile(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    // ensure array
    const actions = Array.isArray(parsed) ? parsed : [];
    res.json({ ok: true, actions });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Save actions config (overwrites file) and reloads it into the running controller
app.post('/api/actions', async (req, res) => {
  try {
    const actions = req.body && req.body.actions;
    if (!Array.isArray(actions)) return res.status(400).json({ ok: false, error: 'actions must be an array' });
    for (const a of actions) {
      if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id.trim()) {
        return res.status(400).json({ ok: false, error: 'each action requires a non-empty string id' });
      }
    }
    const cfgPath = path.join(__dirname, '..', 'support', 'actions-config.json');
    await fs.promises.writeFile(cfgPath, JSON.stringify(actions, null, 2) + '\n', 'utf8');
    await controller.reloadActions();
    void controller.logEvent('config', { target: 'actions', count: actions.length, ids: actions.map((a: any) => a.id) });
    res.json({ ok: true, actions });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Weather endpoint — always fetches latest weather summary on demand
app.get('/api/weather', async (_req, res) => {
  try {
    const w = await controller.fetchWeatherNow();
    res.json({ ok: true, weather: w });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Return last N lines of controller log
app.get('/api/logs', async (_req, res) => {
  try {
    const logsPath = path.join(__dirname, '..', '..', 'logs', 'activity.log');
    const exists = await new Promise(resolve => fs.exists(logsPath, exists => resolve(exists)));
    if (!exists) return res.json({ ok: true, logs: '' });
    const data = await fs.promises.readFile(logsPath, 'utf8');
    // return full file; frontend can limit lines
    res.json({ ok: true, logs: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// List screenshots in public/screenshots
app.get('/api/screenshots', async (_req, res) => {
  try {
    const screenshotsDir = path.join(__dirname, '..', '..', 'public', 'screenshots');
    const exists = await new Promise(resolve => fs.exists(screenshotsDir, exists => resolve(exists)));
    if (!exists) return res.json({ ok: true, files: [] });
    const files = await fs.promises.readdir(screenshotsDir);
    // return only png/jpg and sort by name desc
    const pics = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort().reverse();
    res.json({ ok: true, files: pics });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Delete screenshots older than a given cutoff date (based on file modified time)
app.post('/api/screenshots/clear', async (req, res) => {
  try {
    const beforeMs = req.body && typeof req.body.beforeMs === 'number' ? req.body.beforeMs
      : (req.body && typeof req.body.beforeIso === 'string' ? Date.parse(req.body.beforeIso) : NaN);
    if (!Number.isFinite(beforeMs)) {
      return res.status(400).json({ ok: false, error: 'provide a valid "beforeMs" (epoch ms) or "beforeIso" (date string)' });
    }
    const screenshotsDir = path.join(__dirname, '..', '..', 'public', 'screenshots');
    const exists = await new Promise(resolve => fs.exists(screenshotsDir, exists => resolve(exists)));
    if (!exists) return res.json({ ok: true, deleted: [], count: 0 });
    const files = (await fs.promises.readdir(screenshotsDir)).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    const deleted: string[] = [];
    for (const f of files) {
      const filePath = path.join(screenshotsDir, f);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < beforeMs) {
          await fs.promises.unlink(filePath);
          deleted.push(f);
        }
      } catch (e) {
        console.warn('Failed to inspect/delete screenshot', f, e);
      }
    }
    void controller.logEvent('screenshots_cleared', { count: deleted.length, beforeMs });
    res.json({ ok: true, deleted, count: deleted.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Browser view toggle
app.get('/api/browser-view', (_req, res) => {
  try {
    const v = isBrowserVisible();
    const visible = v === null ? (process.env.BROWSER_HEADLESS === 'false') : v;
    res.json({ ok: true, visible });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post('/api/browser-view', (req, res) => {
  try {
    const enabled = req.body && typeof req.body.visible !== 'undefined' ? !!req.body.visible : null;
    if (enabled === null) return res.status(400).json({ ok: false, error: 'missing visible field' });
    setBrowserVisible(enabled);
    res.json({ ok: true, visible: enabled });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Serve static frontend
const publicDir = path.join(__dirname, '..', '..', 'public');
app.use('/', express.static(publicDir));

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Solar Housekeeper server listening on http://localhost:${port}`);
});

// If started directly, don't auto-start the controller; let user control via UI
// Controller instantiates and starts its internal weather fetcher automatically
