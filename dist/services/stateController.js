"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.solarHousekeeper = exports.controller = exports.SolarHousekeeper = exports.State = void 0;
const playwrightActions_1 = require("./playwrightActions");
const storage_1 = require("./storage");
const weatherAPI_1 = require("./weatherAPI");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
var State;
(function (State) {
    State["Idle"] = "idle";
    State["LoggedIn"] = "logged_in";
    State["Ready"] = "ready";
    State["Busy"] = "busy";
    State["Error"] = "error";
})(State || (exports.State = State = {}));
class SolarHousekeeper {
    state = State.Idle;
    intervalMs;
    actionCooldownMs;
    timer = null;
    lastActionAt = 0;
    latestWeather = null;
    latestHourly = null;
    latestNightRanges = null;
    latestPower = null;
    latestPlug = null;
    scenarios = [];
    lastSelectedScenario = null;
    page = null;
    browser = null;
    logsDir = path_1.default.join(__dirname, '..', '..', 'logs');
    logFile = path_1.default.join(this.logsDir, 'activity.log');
    async appendLog(line) {
        try {
            await fs_1.default.promises.mkdir(this.logsDir, { recursive: true });
            await fs_1.default.promises.appendFile(this.logFile, line + '\n');
        }
        catch (err) {
            console.warn('Failed to write log:', err);
        }
    }
    constructor(opts = {}) {
        this.intervalMs = opts.intervalMs ?? 30_000; // default 30s
        this.actionCooldownMs = opts.actionCooldownMs ?? 60_000; // default 60s
        void this.loadScenarios().catch(err => console.warn('loadScenarios failed:', err));
    }
    async loadScenarios() {
        try {
            const cfgPath = path_1.default.join(__dirname, '..', 'support', 'scenarios-config.json');
            const raw = await fs_1.default.promises.readFile(cfgPath, 'utf-8');
            const parsed = JSON.parse(raw);
            this.scenarios = Array.isArray(parsed) ? parsed.filter(s => s && typeof s.trigger === 'string') : [];
            console.log('Loaded scenarios:', this.scenarios.map(s => s.id));
        }
        catch (err) {
            console.warn('Could not load scenarios config:', err);
            this.scenarios = [];
        }
    }
    computePowerTotal() {
        if (!this.latestPower)
            return null;
        let sum = 0;
        let found = false;
        for (const k of Object.keys(this.latestPower)) {
            const v = this.latestPower[k];
            if (v == null)
                continue;
            const n = Number(String(v).replace(/[^0-9.-]+/g, ''));
            if (!Number.isNaN(n)) {
                sum += n;
                found = true;
            }
        }
        return found ? sum : null;
    }
    evaluateCondition(expr) {
        try {
            const uvi = this.latestWeather?.uvi ?? null;
            const clouds = this.latestWeather?.clouds ?? null;
            const power_total = this.computePowerTotal();
            const now = this.now();
            let isNight = false;
            if (this.latestNightRanges) {
                isNight = this.latestNightRanges.some(r => now >= r.startMs && now <= r.endMs);
            }
            const isDay = !isNight;
            const power = this.latestPower ?? {};
            const fn = new Function('uvi', 'clouds', 'isDay', 'isNight', 'power_total', 'power', `return (${expr});`);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const res = fn(uvi, clouds, isDay, isNight, power_total, power);
            return Boolean(res);
        }
        catch (err) {
            console.warn('Error evaluating scenario expression:', expr, err);
            return false;
        }
    }
    async runScenarioActionOrDefault() {
        if (!this.page)
            return;
        this.lastSelectedScenario = null;
        try {
            for (const s of this.scenarios) {
                if (!s.enabled)
                    continue;
                if (s.trigger && this.evaluateCondition(s.trigger)) {
                    console.log('Scenario matched:', s.id, '->', s.actionId);
                    this.lastSelectedScenario = s;
                    await (0, playwrightActions_1.performActionById)(s.actionId, this.page);
                    return;
                }
            }
        }
        catch (err) {
            console.warn('Error running scenario action:', err);
        }
        this.lastSelectedScenario = null;
        // fallback to default action
        await (0, playwrightActions_1.runAction)(this.page);
    }
    getState() {
        return this.state;
    }
    status() {
        return {
            state: this.state,
            lastActionAt: this.lastActionAt,
            intervalMs: this.intervalMs,
            actionCooldownMs: this.actionCooldownMs,
            latestWeather: this.latestWeather,
            latestPower: this.latestPower,
            running: !!this.timer,
            latestPlug: this.latestPlug,
        };
    }
    isRunning() {
        return !!this.timer;
    }
    setState(s) {
        this.state = s;
        console.log(new Date().toISOString(), 'state ->', s);
        void this.appendLog(`${new Date().toISOString()} state -> ${s}`);
    }
    now() {
        return Date.now();
    }
    async checkOnce() {
        console.log(new Date().toISOString(), 'checkOnce', { state: this.state });
        try {
            // refresh latest weather on each check (best-effort)
            void this.fetchLatestWeather().catch(err => console.warn('fetchLatestWeather failed:', err));
            if (this.state === State.Idle) {
                this.setState(State.Busy);
                const { browser, page } = await (0, playwrightActions_1.login)();
                this.browser = browser;
                this.page = page;
                this.setState(State.LoggedIn);
                // after login we're ready to perform actions
                this.setState(State.Ready);
                return;
            }
            if (this.state === State.Ready && this.page) {
                const sinceLast = this.now() - this.lastActionAt;
                if (sinceLast >= this.actionCooldownMs) {
                    this.setState(State.Busy);
                    await this.runScenarioActionOrDefault();
                    this.lastActionAt = this.now();
                    this.setState(State.Ready);
                }
                else {
                    console.log('Skipping action; cooldown', { sinceLast, actionCooldownMs: this.actionCooldownMs });
                }
                return;
            }
            // If logged in but no page (unexpected), reset
            if ((this.state === State.LoggedIn || this.state === State.Busy) && !this.page) {
                console.warn('No page available while logged in; resetting to Idle');
                await this.reset();
            }
        }
        catch (err) {
            console.error('StateController check error:', err);
            this.setState(State.Error);
            // try to clean up and reset so future checks can recover
            await this.reset();
        }
    }
    start() {
        if (this.timer) {
            console.warn('Solar Housekeeper already running');
            return;
        }
        console.log('Solar Housekeeper starting. intervalMs=', this.intervalMs);
        // run first check immediately
        void this.checkOnce();
        this.timer = setInterval(() => {
            void this.checkOnce();
        }, this.intervalMs);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        void this.reset();
        console.log('Solar Housekeeper stopped');
    }
    async forceAction(actionId) {
        if (!this.page) {
            console.warn('No page to run action on; will try to login first');
            await this.checkOnce();
        }
        if (this.page) {
            this.setState(State.Busy);
            try {
                if (typeof actionId === 'string' && actionId.length > 0) {
                    await (0, playwrightActions_1.performActionById)(actionId, this.page);
                }
                else {
                    await (0, playwrightActions_1.runAction)(this.page);
                }
            }
            catch (err) {
                console.error('forceAction error:', err);
                this.setState(State.Error);
            }
            finally {
                this.lastActionAt = this.now();
                this.setState(State.Ready);
            }
        }
    }
    // Public method to fetch weather on-demand and return the latest summary
    async fetchWeatherNow() {
        await this.fetchLatestWeather();
        return { summary: this.latestWeather, hourly: this.latestHourly, nightRanges: this.latestNightRanges, power: this.latestPower };
    }
    getScenarios() {
        return this.scenarios.slice();
    }
    getCurrentScenario() {
        return this.lastSelectedScenario ? { id: this.lastSelectedScenario.id, label: this.lastSelectedScenario.label, actionId: this.lastSelectedScenario.actionId } : null;
    }
    async fetchLatestWeather() {
        try {
            const lat = process.env.WEATHER_LAT ? parseFloat(process.env.WEATHER_LAT) : 50.76;
            const lon = process.env.WEATHER_LON ? parseFloat(process.env.WEATHER_LON) : 15.056;
            const w = await (0, weatherAPI_1.fetchWeather)(lat, lon);
            const nowMs = this.now();
            // show next 72 hours (3 days)
            const endMs = nowMs + 72 * 60 * 60 * 1000;
            const rangeStartIso = new Date(nowMs).toISOString();
            const rangeEndIso = new Date(endMs).toISOString();
            const hourlyInRange = (w.hourly || []).filter(h => {
                const t = h.dt * 1000;
                return t >= nowMs && t <= endMs;
            });
            let clouds;
            if (hourlyInRange.length > 0) {
                const sum = hourlyInRange.reduce((acc, h) => acc + (h.clouds ?? 0), 0);
                clouds = Math.round(sum / hourlyInRange.length);
            }
            else if (w.hourly && w.hourly.length) {
                clouds = w.hourly[0].clouds;
            }
            // prefer hourly uvi values in range, fallback to current
            let uvi;
            const hourlyUvi = hourlyInRange.map(h => h.uvi).filter(x => typeof x === 'number');
            if (hourlyUvi.length > 0) {
                uvi = Math.max(...hourlyUvi);
            }
            else if (w.current && typeof w.current.uvi === 'number') {
                uvi = w.current.uvi;
            }
            // determine day/night for each hourly entry using daily sunrise/sunset
            const daily = w.daily || [];
            const hourlyWithDay = hourlyInRange.map(h => {
                const t = h.dt;
                const found = daily.find(d => t >= d.sunrise && t <= d.sunset);
                const isDay = found !== undefined;
                return { dt: h.dt, clouds: h.clouds, uvi: h.uvi, isDay };
            });
            // compute contiguous night ranges (in ms)
            const nightRanges = [];
            let curStart = null;
            for (const h of hourlyWithDay) {
                const tMs = h.dt * 1000;
                if (h.isDay === false) {
                    if (curStart === null)
                        curStart = tMs;
                }
                else {
                    if (curStart !== null) {
                        nightRanges.push({ startMs: curStart, endMs: tMs });
                        curStart = null;
                    }
                }
            }
            if (curStart !== null) {
                // end at last hour + 1h
                nightRanges.push({ startMs: curStart, endMs: (hourlyWithDay[hourlyWithDay.length - 1].dt * 1000) + 60 * 60 * 1000 });
            }
            this.latestHourly = hourlyWithDay;
            this.latestNightRanges = nightRanges;
            this.latestWeather = { clouds, uvi, fetchedAt: nowMs, rangeStartIso, rangeEndIso };
            // try to extract power data from portal using Playwright
            try {
                if (this.page) {
                    this.latestPower = await (0, playwrightActions_1.extractPowerData)(this.page);
                    try {
                        this.latestPlug = await (0, playwrightActions_1.extractPlugStatus)(this.page);
                    }
                    catch (e) {
                        console.warn('extractPlugStatus failed:', e);
                    }
                    void this.appendLog(JSON.stringify({ ts: nowMs, kind: 'power', power: this.latestPower }));
                }
                else {
                    // ephemeral login to grab power info
                    try {
                        const { browser, page } = await (0, playwrightActions_1.login)();
                        try {
                            this.latestPower = await (0, playwrightActions_1.extractPowerData)(page);
                            try {
                                this.latestPlug = await (0, playwrightActions_1.extractPlugStatus)(page);
                            }
                            catch (e) {
                                console.warn('extractPlugStatus ephemeral failed:', e);
                            }
                            void this.appendLog(JSON.stringify({ ts: nowMs, kind: 'power', power: this.latestPower }));
                        }
                        finally {
                            await browser.close();
                        }
                    }
                    catch (err) {
                        console.warn('extractPowerData ephemeral failed:', err);
                    }
                }
            }
            catch (err) {
                console.warn('Error extracting power data:', err);
            }
            // append a sample to time-series storage (weather + power + plug)
            try {
                await (0, storage_1.appendEntry)({
                    ts: nowMs,
                    weather: this.latestWeather,
                    power: this.latestPower,
                    plug: this.latestPlug,
                });
            }
            catch (e) {
                console.warn('Failed to append timeseries sample:', e);
            }
        }
        catch (err) {
            console.warn('Error fetching latest weather:', err);
        }
    }
    async reset() {
        try {
            if (this.browser) {
                await this.browser.close();
            }
        }
        catch (err) {
            console.warn('Error closing browser during reset:', err);
        }
        this.browser = null;
        this.page = null;
        this.lastActionAt = 0;
        this.setState(State.Idle);
    }
}
exports.SolarHousekeeper = SolarHousekeeper;
exports.controller = new SolarHousekeeper();
exports.solarHousekeeper = exports.controller;
if (require.main === module) {
    // If launched directly, start the Solar Housekeeper
    exports.controller.start();
}
