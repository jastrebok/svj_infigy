"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const stateController_1 = require("./stateController");
const playwrightActions_1 = require("./playwrightActions");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Passive weather poll when controller is not running
const PASSIVE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
let passiveTimer = null;
let passiveNextFetchAt = null;
function startPassive() {
    if (passiveTimer)
        return;
    passiveNextFetchAt = Date.now() + PASSIVE_INTERVAL_MS;
    passiveTimer = setInterval(async () => {
        try {
            await stateController_1.controller.fetchWeatherNow();
        }
        catch (err) {
            console.warn('Passive fetch failed:', err);
        }
        finally {
            passiveNextFetchAt = Date.now() + PASSIVE_INTERVAL_MS;
        }
    }, PASSIVE_INTERVAL_MS);
    console.log('Passive weather polling started. intervalMs=', PASSIVE_INTERVAL_MS);
}
function stopPassive() {
    if (!passiveTimer)
        return;
    clearInterval(passiveTimer);
    passiveTimer = null;
    passiveNextFetchAt = null;
    console.log('Passive weather polling stopped');
}
const storage_1 = require("./storage");
// API
app.get('/api/status', (_req, res) => {
    const base = stateController_1.controller.status();
    res.json(Object.assign(base, {
        controllerRunning: stateController_1.controller.isRunning(),
        passiveNextFetchAt,
        passiveIntervalMs: PASSIVE_INTERVAL_MS,
        currentScenario: stateController_1.controller.getCurrentScenario(),
    }));
});
app.get('/api/scenarios', async (_req, res) => {
    try {
        const cfgPath = path_1.default.join(__dirname, '..', 'support', 'scenarios-config.json');
        const exists = await new Promise(resolve => fs_1.default.exists(cfgPath, exists => resolve(exists)));
        if (!exists)
            return res.json({ ok: true, scenarios: [] });
        const raw = await fs_1.default.promises.readFile(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        const scenarios = Array.isArray(parsed) ? parsed : [];
        res.json({ ok: true, scenarios });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
app.get('/api/metrics', async (req, res) => {
    try {
        const sinceParam = req.query.since;
        let since = Date.now() - (7 * 24 * 60 * 60 * 1000);
        if (sinceParam) {
            const n = Number(sinceParam);
            if (!Number.isNaN(n))
                since = n;
        }
        const rows = await (0, storage_1.query)(since);
        res.json({ ok: true, rows });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
app.post('/api/start', (_req, res) => {
    stateController_1.controller.start();
    // controller is active -> stop passive polling if running
    stopPassive();
    res.json({ ok: true });
});
app.post('/api/stop', (_req, res) => {
    stateController_1.controller.stop();
    // start passive polling when controller stopped
    startPassive();
    res.json({ ok: true });
});
app.post('/api/force', async (_req, res) => {
    try {
        const actionId = (_req && _req.body && typeof _req.body.actionId === 'string') ? _req.body.actionId : undefined;
        await stateController_1.controller.forceAction(actionId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
// Return available force actions (loaded from saved config)
app.get('/api/actions', async (_req, res) => {
    try {
        const cfgPath = path_1.default.join(__dirname, '..', 'support', 'actions-config.json');
        const exists = await new Promise(resolve => fs_1.default.exists(cfgPath, exists => resolve(exists)));
        if (!exists)
            return res.json({ ok: true, actions: [] });
        const raw = await fs_1.default.promises.readFile(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        // ensure array
        const actions = Array.isArray(parsed) ? parsed : [];
        res.json({ ok: true, actions });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
// Weather endpoint — always fetches latest weather summary on demand
app.get('/api/weather', async (_req, res) => {
    try {
        const w = await stateController_1.controller.fetchWeatherNow();
        res.json({ ok: true, weather: w });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
// Return last N lines of controller log
app.get('/api/logs', async (_req, res) => {
    try {
        const logsPath = path_1.default.join(__dirname, '..', '..', 'logs', 'activity.log');
        const exists = await new Promise(resolve => fs_1.default.exists(logsPath, exists => resolve(exists)));
        if (!exists)
            return res.json({ ok: true, logs: '' });
        const data = await fs_1.default.promises.readFile(logsPath, 'utf8');
        // return full file; frontend can limit lines
        res.json({ ok: true, logs: data });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
// List screenshots in public/screenshots
app.get('/api/screenshots', async (_req, res) => {
    try {
        const screenshotsDir = path_1.default.join(__dirname, '..', '..', 'public', 'screenshots');
        const exists = await new Promise(resolve => fs_1.default.exists(screenshotsDir, exists => resolve(exists)));
        if (!exists)
            return res.json({ ok: true, files: [] });
        const files = await fs_1.default.promises.readdir(screenshotsDir);
        // return only png/jpg and sort by name desc
        const pics = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort().reverse();
        res.json({ ok: true, files: pics });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
// Browser view toggle
app.get('/api/browser-view', (_req, res) => {
    try {
        const v = (0, playwrightActions_1.isBrowserVisible)();
        const visible = v === null ? (process.env.BROWSER_HEADLESS === 'false') : v;
        res.json({ ok: true, visible });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
app.post('/api/browser-view', (req, res) => {
    try {
        const enabled = req.body && typeof req.body.visible !== 'undefined' ? !!req.body.visible : null;
        if (enabled === null)
            return res.status(400).json({ ok: false, error: 'missing visible field' });
        (0, playwrightActions_1.setBrowserVisible)(enabled);
        res.json({ ok: true, visible: enabled });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});
// Serve static frontend
const publicDir = path_1.default.join(__dirname, '..', '..', 'public');
app.use('/', express_1.default.static(publicDir));
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
    console.log(`Solar Housekeeper server listening on http://localhost:${port}`);
});
// If started directly, don't auto-start the controller; let user control via UI
// Start passive polling by default when controller is not running
if (!stateController_1.controller.isRunning())
    startPassive();
