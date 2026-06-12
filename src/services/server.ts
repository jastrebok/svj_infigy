import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { controller } from './stateController';
import { setBrowserVisible, isBrowserVisible } from './playwrightActions';

const app = express();
app.use(cors());
app.use(express.json());

// API
app.get('/api/status', (_req, res) => {
  res.json(controller.status());
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
    await controller.forceAction();
    res.json({ ok: true });
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
