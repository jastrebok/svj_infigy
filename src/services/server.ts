import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { controller } from './stateController';
import { setBrowserVisible, isBrowserVisible } from './playwrightActions';

const app = express();
app.use(cors());
app.use(express.json());

// Passive weather poll when controller is not running
const PASSIVE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
let passiveTimer: NodeJS.Timeout | null = null;
let passiveNextFetchAt: number | null = null;

function startPassive() {
  if (passiveTimer) return;
  passiveNextFetchAt = Date.now() + PASSIVE_INTERVAL_MS;
  passiveTimer = setInterval(async () => {
    try {
      await controller.fetchWeatherNow();
    } catch (err) {
      console.warn('Passive fetch failed:', err);
    } finally {
      passiveNextFetchAt = Date.now() + PASSIVE_INTERVAL_MS;
    }
  }, PASSIVE_INTERVAL_MS);
  console.log('Passive weather polling started. intervalMs=', PASSIVE_INTERVAL_MS);
}

function stopPassive() {
  if (!passiveTimer) return;
  clearInterval(passiveTimer);
  passiveTimer = null;
  passiveNextFetchAt = null;
  console.log('Passive weather polling stopped');
}
import { query as queryMetrics } from './storage';

// API
app.get('/api/status', (_req, res) => {
  const base = controller.status();
  res.json(Object.assign(base, {
    controllerRunning: controller.isRunning(),
    passiveNextFetchAt,
    passiveIntervalMs: PASSIVE_INTERVAL_MS,
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
app.post('/api/start', (_req, res) => {
  controller.start();
  // controller is active -> stop passive polling if running
  stopPassive();
  res.json({ ok: true });
});

app.post('/api/stop', (_req, res) => {
  controller.stop();
  // start passive polling when controller stopped
  startPassive();
  res.json({ ok: true });
});

app.post('/api/force', async (_req, res) => {
  try {
    const actionId = (_req && _req.body && typeof _req.body.actionId === 'string') ? _req.body.actionId : undefined;
    await controller.forceAction(actionId);
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
// Start passive polling by default when controller is not running
if (!controller.isRunning()) startPassive();
