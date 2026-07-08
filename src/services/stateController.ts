import { login, runAction, extractPowerData, extractPlugStatus, performActionById } from './playwrightActions';
import { appendEntry } from './storage';
import { fetchWeather } from './weatherAPI';
import { getSolaxPowerData } from './solaxAPI';
import fs from 'fs';
import path from 'path';
import type { Page, Browser } from 'playwright';

export enum State {
  Idle = 'idle',
  LoggedIn = 'logged_in',
  Ready = 'ready',
  Busy = 'busy',
  Error = 'error',
}

type ControllerOptions = {
  intervalMs?: number;
  actionCooldownMs?: number;
};

type Scenario = {
  id: string;
  label?: string;
  description?: string;
  trigger: string;
  actionId: string;
  enabled?: boolean;
};

type Action = {
  id: string;
  label?: string;
  description?: string;
  enabled?: boolean;
};

export class SolarHousekeeper {
  private state: State = State.Idle;
  private intervalMs: number;
  private actionCooldownMs: number;
  private timer: NodeJS.Timeout | null = null;
  private weatherTimer: NodeJS.Timeout | null = null;
  private nextWeatherFetchAt: number | null = null;
  private lastActionAt = Date.now(); // initialised to now so no action fires until actionCooldownMs after startup
  private latestWeather: { clouds?: number; uvi?: number; forecast_uv_median_today?: number; forecast_uv_median_tomorrow?: number; battery_cap?: number; fetchedAt: number; rangeStartIso?: string; rangeEndIso?: string } | null = null;
  private latestHourly: { dt: number; clouds?: number; uvi?: number; isDay?: boolean }[] | null = null;
  private latestNightRanges: { startMs: number; endMs: number }[] | null = null;
  private latestPower: Record<string, string | null> | null = null;
  private latestPlug: string | null = null;
  private scenarios: Scenario[] = [];
  private actions: Action[] = [];
  private lastSelectedScenario: Scenario | null = null;
  private page: Page | null = null;
  private browser: Browser | null = null;
  private logsDir = path.join(__dirname, '..', '..', 'logs');
  private logFile = path.join(this.logsDir, 'activity.log');

  private formatTimeGMT1(timestamp: number): string {
    const date = new Date(timestamp);
    // Format with Europe/Prague timezone (GMT+1 winter / GMT+2 summer)
    return date.toLocaleString('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  private async appendLog(line: string) {
    try {
      await fs.promises.mkdir(this.logsDir, { recursive: true });
      await fs.promises.appendFile(this.logFile, line + '\n');
    } catch (err) {
      console.warn('Failed to write log:', err);
    }
  }

  constructor(opts: ControllerOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 2_000; // default 2s for responsiveness
    this.actionCooldownMs = opts.actionCooldownMs ?? 60_000; // default 60s
    void this.loadScenarios().catch(err => console.warn('loadScenarios failed:', err));
    void this.loadActions().catch(err => console.warn('loadActions failed:', err));
    // Start weather fetcher immediately (continues independent of controller state)
    this.startWeatherFetcher();
  }

  private async loadScenarios() {
    try {
      const cfgPath = path.join(__dirname, '..', 'support', 'scenarios-config.json');
      console.log('Loading scenarios from:', cfgPath);
      const raw = await fs.promises.readFile(cfgPath, 'utf-8');
      console.log('Raw file content:', raw.substring(0, 300));
      const parsed = JSON.parse(raw) as Scenario[];
      this.scenarios = Array.isArray(parsed) ? parsed.filter(s => s && typeof s.trigger === 'string') : [];
      console.log('Loaded scenarios:', this.scenarios.map(s => s.id));
    } catch (err) {
      console.warn('Could not load scenarios config:', err);
      this.scenarios = [];
    }
  }

  private async loadActions() {
    try {
      const cfgPath = path.join(__dirname, '..', 'support', 'actions-config.json');
      const raw = await fs.promises.readFile(cfgPath, 'utf-8');
      const parsed = JSON.parse(raw) as Action[];
      this.actions = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('Could not load actions config:', err);
      this.actions = [];
    }
  }

  private startWeatherFetcher() {
    // Fetch weather immediately
    void this.fetchLatestWeather().catch(err => console.warn('fetchLatestWeather failed:', err));
    
    // Then fetch every 120 seconds (independent of controller state)
    this.nextWeatherFetchAt = Date.now() + 120_000;
    this.weatherTimer = setInterval(() => {
      void this.fetchLatestWeather().catch(err => console.warn('fetchLatestWeather failed:', err));
      this.nextWeatherFetchAt = Date.now() + 120_000;
    }, 120_000); // 120s
  }

  private stopWeatherFetcher() {
    if (this.weatherTimer) {
      clearInterval(this.weatherTimer);
      this.weatherTimer = null;
      this.nextWeatherFetchAt = null;
    }
  }

  getNextWeatherFetchAt() {
    return this.nextWeatherFetchAt;
  }

  private getActionLabel(actionId: string): string {
    const action = this.actions.find(a => a.id === actionId);
    return action?.label || actionId;
  }

  private wouldCauseStateChange(actionId: string): boolean {
    // If plug state is not yet known, refuse to write — wait for a confirmed read
    if (this.latestPlug === null && (actionId === 'turn_on_plug' || actionId === 'turn_off_plug')) {
      console.log('wouldCauseStateChange: plug state unknown, skipping', actionId);
      return false;
    }
    // turn_on_plug should only run if plug is currently off
    if (actionId === 'turn_on_plug' && this.latestPlug === 'on') {
      return false; // already on, no change
    }
    // turn_off_plug should only run if plug is currently on
    if (actionId === 'turn_off_plug' && this.latestPlug === 'off') {
      return false; // already off, no change
    }
    return true; // will cause a change
  }

  private computePowerTotal(): number | null {
    if (!this.latestPower) return null;
    let sum = 0;
    let found = false;
    for (const k of Object.keys(this.latestPower)) {
      const v = this.latestPower[k];
      if (v == null) continue;
      const n = Number(String(v).replace(/[^0-9.-]+/g, ''));
      if (!Number.isNaN(n)) {
        sum += n;
        found = true;
      }
    }
    return found ? sum : null;
  }

  private evaluateCondition(expr: string): boolean {
    try {
      const uvi = this.latestWeather?.uvi ?? null;
      const clouds = this.latestWeather?.clouds ?? null;
      const forecast_uv_median_today = this.latestWeather?.forecast_uv_median_today ?? null;
      const forecast_uv_median_tomorrow = this.latestWeather?.forecast_uv_median_tomorrow ?? null;
      const battery_cap = this.latestWeather?.battery_cap ?? null;
      const power_total = this.computePowerTotal();
      const now = this.now();
      let isNight = false;
      if (this.latestNightRanges) {
        isNight = this.latestNightRanges.some(r => now >= r.startMs && now <= r.endMs);
      }
      const isDay = !isNight;
      const power = this.latestPower ?? {};
      const fn = new Function('uvi', 'clouds', 'forecast_uv_median_today', 'forecast_uv_median_tomorrow', 'battery_cap', 'isDay', 'isNight', 'power_total', 'power', `return (${expr});`);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const res = fn(uvi, clouds, forecast_uv_median_today, forecast_uv_median_tomorrow, battery_cap, isDay, isNight, power_total, power);
      return Boolean(res);
    } catch (err) {
      console.warn('Error evaluating scenario expression:', expr, err);
      return false;
    }
  }

  private async runScenarioActionOrDefault() {
    if (!this.page) return;
    this.lastSelectedScenario = null;
    try {
      for (const s of this.scenarios) {
        if (!s.enabled) continue;
        if (s.trigger && this.evaluateCondition(s.trigger)) {
          console.log('Scenario matched:', s.id, '->', s.actionId);

          // Mark the scenario as selected so UI shows it even if we skip execution
          this.lastSelectedScenario = s;

          // Check if this action would cause a state change
          if (!this.wouldCauseStateChange(s.actionId)) {
            console.log('Skipping action; already in target state:', { actionId: s.actionId, currentPlug: this.latestPlug });
            const nowSkip = Date.now();
            const actionLabelSkip = this.getActionLabel(s.actionId);
            void this.appendLog(JSON.stringify({
              kind: 'action',
              ts: nowSkip,
              timeStr: this.formatTimeGMT1(nowSkip),
              scenarioId: s.id,
              scenarioLabel: s.label || s.id,
              actionId: s.actionId,
              actionLabel: actionLabelSkip,
              status: 'skipped',
              reason: 'already_in_target_state'
            }));
            return;
          }

          await performActionById(s.actionId, this.page);
          // Log the action to activity log with action label
          const actionLabel = this.getActionLabel(s.actionId);
          const now = Date.now();
          void this.appendLog(JSON.stringify({
            kind: 'action',
            ts: now,
            timeStr: this.formatTimeGMT1(now),
            scenarioId: s.id,
            scenarioLabel: s.label || s.id,
            actionId: s.actionId,
            actionLabel: actionLabel,
            status: 'executed'
          }));
          return;
        }
      }
    } catch (err) {
      console.warn('Error running scenario action:', err);
    }
    this.lastSelectedScenario = null;
    // fallback to default action
    await runAction(this.page);
  }

  getState() {
    return this.state;
  }

  status() {
    // compute which scenarios currently match (best-effort)
    const matched = this.scenarios.map(s => ({ id: s.id, label: s.label, matched: !!(s.trigger && this.evaluateCondition(s.trigger)) }));
    return {
      state: this.state,
      lastActionAt: this.lastActionAt,
      intervalMs: this.intervalMs,
      actionCooldownMs: this.actionCooldownMs,
      latestWeather: this.latestWeather,
      latestPower: this.latestPower,
      running: !!this.timer,
      latestPlug: this.latestPlug,
      matchedScenarios: matched,
    };
  }

  isRunning() {
    return !!this.timer;
  }

  private setState(s: State) {
    if (this.state !== s) {
      this.state = s;
      const now = Date.now();
      console.log(this.formatTimeGMT1(now), 'state ->', s);
      void this.appendLog(`${this.formatTimeGMT1(now)} state -> ${s}`);
    }
  }

  private now() {
    return Date.now();
  }

  async checkOnce() {
    console.log(this.formatTimeGMT1(Date.now()), 'checkOnce', { state: this.state });

    try {
      // Weather is fetched passively every 120s, so no need to fetch here
      // This keeps the passive cycle clean and uninterrupted

      if (this.state === State.Idle) {
        this.setState(State.Busy);
        const { browser, page } = await login();
        this.browser = browser as Browser;
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
        } else {
          console.log('Skipping action; cooldown', { sinceLast, actionCooldownMs: this.actionCooldownMs });
        }
        return;
      }

      // If logged in but no page (unexpected), reset
      if ((this.state === State.LoggedIn || this.state === State.Busy) && !this.page) {
        console.warn('No page available while logged in; resetting to Idle');
        await this.reset();
      }
    } catch (err) {
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
    // Note: weather fetcher continues independently
  }

  async forceAction(actionId?: string) {
    // If we don't have a persistent page, try an ephemeral login to perform the action
    if (!this.page) {
      try {
        console.log('No page available; attempting ephemeral login to perform forced action');
        const { browser, page } = await login();
        try {
          this.setState(State.Busy);
          if (typeof actionId === 'string' && actionId.length > 0) {
            await performActionById(actionId, page);
            const nowF = Date.now();
            void this.appendLog(JSON.stringify({ kind: 'action', ts: nowF, timeStr: this.formatTimeGMT1(nowF), scenarioId: null, scenarioLabel: null, actionId: actionId, actionLabel: this.getActionLabel(actionId), status: 'executed', manual: true }));
          } else {
            await runAction(page);
            const nowD = Date.now();
            void this.appendLog(JSON.stringify({ kind: 'action', ts: nowD, timeStr: this.formatTimeGMT1(nowD), scenarioId: null, scenarioLabel: null, actionId: 'default', actionLabel: 'default', status: 'executed', manual: false }));
          }

          // update power/plug state after action using the ephemeral page
          try {
            const pwr = await extractPowerData(page);
            const plug = await extractPlugStatus(page).catch(() => null);
            if (pwr) this.latestPower = pwr;
            if (plug) this.latestPlug = plug;
            // also refresh weather object from any Battery_status found
            try {
              const statusStr = this.latestPower?.['Battery_status'];
              if (statusStr && typeof statusStr === 'string') {
                const m = String(statusStr).match(/(\d+[,.]?\d*)\s*%/);
                if (m) {
                  const num = Number(m[1].replace(',', '.'));
                  if (!Number.isNaN(num)) {
                    const weather = this.latestWeather ?? ({ fetchedAt: Date.now() } as any);
                    weather.battery_cap = num;
                    this.latestWeather = weather;
                  }
                }
              }
            } catch (e) { }
          } catch (e) { console.warn('ephemeral extract after action failed:', e); }

          // ensure we also fetch latest weather info
          try { await this.fetchLatestWeather(); } catch (e) { console.warn('fetchLatestWeather after ephemeral action failed:', e); }
        } finally {
          try { await browser.close(); } catch (e) { /* ignore */ }
        }
        // done with ephemeral path
        this.lastActionAt = this.now();
        this.setState(State.Ready);
        return;
      } catch (err) {
        console.warn('Ephemeral login/action failed, falling back to persistent login:', err);
        // fall through to persistent login attempt
      }
    }

    // If we have (or now obtained) a persistent page, use it
    if (!this.page) {
      console.warn('No page to run action on; will try to login first');
      await this.checkOnce();
    }

    if (this.page) {
      this.setState(State.Busy);
      try {
        if (typeof actionId === 'string' && actionId.length > 0) {
          await performActionById(actionId, this.page);
          // Log the forced action to activity log (structured)
          const nowF = Date.now();
          void this.appendLog(JSON.stringify({ kind: 'action', ts: nowF, timeStr: this.formatTimeGMT1(nowF), scenarioId: null, scenarioLabel: null, actionId: actionId, actionLabel: this.getActionLabel(actionId), status: 'executed', manual: true }));
          try { await this.fetchLatestWeather(); } catch (e) { console.warn('fetchLatestWeather after forced action failed:', e); }
        } else {
          await runAction(this.page);
          const nowD = Date.now();
          void this.appendLog(JSON.stringify({
            kind: 'action',
            ts: nowD,
            timeStr: this.formatTimeGMT1(nowD),
            scenarioId: null,
            scenarioLabel: null,
            actionId: 'default',
            actionLabel: 'default',
            status: 'executed',
            manual: false
          }));
          // refresh after default action as well
          try { await this.fetchLatestWeather(); } catch (e) { console.warn('fetchLatestWeather after default action failed:', e); }
        }
      } catch (err) {
        console.error('forceAction error:', err);
        this.setState(State.Error);
      } finally {
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

  // Public method to perform an ephemeral login and read the /plug page
  // Updates `latestPower`, `latestPlug`, and `latestWeather` based on extractor results.
  async refreshPowerFromPlugPage() {
    try {
      const { browser, page } = await login();
      try {
        // navigate explicitly to plug page for reliable switch status
        try { await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' }); } catch (e) { /* ignore */ }
        const pwr = await extractPowerData(page).catch(() => null);
        const plug = await extractPlugStatus(page).catch(() => null);
        if (pwr) this.latestPower = pwr;
        if (plug) this.latestPlug = plug;
        // If extractor returned a battery percent (e.g. "98%"), set battery_cap
        try {
          const statusStr = this.latestPower?.['Battery_status'] ?? null;
          if (statusStr && typeof statusStr === 'string') {
            const m = String(statusStr).match(/(\d+[,.]?\d*)\s*%/);
            if (m) {
              const num = Number(m[1].replace(',', '.'));
              if (!Number.isNaN(num)) {
                const weather = this.latestWeather ?? ({ fetchedAt: Date.now() } as any);
                weather.battery_cap = num;
                this.latestWeather = weather;
              }
            }
          }
        } catch (e) { /* ignore */ }
      } finally {
        try { await browser.close(); } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.warn('refreshPowerFromPlugPage failed:', err);
    }
  }

  getScenarios() {
    return this.scenarios.slice();
  }

  getCurrentScenario() {
    return this.lastSelectedScenario ? { id: this.lastSelectedScenario.id, label: this.lastSelectedScenario.label, actionId: this.lastSelectedScenario.actionId } : null;
  }

  private async fetchLatestWeather() {
    try {
      const lat = process.env.WEATHER_LAT ? parseFloat(process.env.WEATHER_LAT) : 50.76;
      const lon = process.env.WEATHER_LON ? parseFloat(process.env.WEATHER_LON) : 15.056;
      const w = await fetchWeather(lat, lon);
      const nowMs = this.now();
      // show next 72 hours (3 days)
      const endMs = nowMs + 72 * 60 * 60 * 1000;
      const rangeStartIso = new Date(nowMs).toISOString();
      const rangeEndIso = new Date(endMs).toISOString();

      const hourlyInRange = (w.hourly || []).filter(h => {
        const t = h.dt * 1000;
        return t >= nowMs && t <= endMs;
      });

      let clouds: number | undefined;
      if (hourlyInRange.length > 0) {
        const sum = hourlyInRange.reduce((acc, h) => acc + (h.clouds ?? 0), 0);
        clouds = Math.round(sum / hourlyInRange.length);
      } else if (w.hourly && w.hourly.length) {
        clouds = w.hourly[0].clouds;
      }

      // prefer current UVI value if available, otherwise use hourly forecast
      let uvi: number | undefined;
      if (w.current && typeof w.current.uvi === 'number') {
        uvi = w.current.uvi;
      } else {
        const hourlyUvi = hourlyInRange.map(h => h.uvi).filter(x => typeof x === 'number') as number[];
        if (hourlyUvi.length > 0) {
          uvi = hourlyUvi[0];
        }
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
      const nightRanges: { startMs: number; endMs: number }[] = [];
      let curStart: number | null = null;
      for (const h of hourlyWithDay) {
        const tMs = h.dt * 1000;
        if (h.isDay === false) {
          if (curStart === null) curStart = tMs;
        } else {
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

      // Calculate UV forecast medians for today and tomorrow
      // Note: median is more robust to outliers than mean
      const now = new Date(nowMs);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const dayAfterTomorrowStart = new Date(tomorrowStart);
      dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 1);

      const todayHours = hourlyWithDay.filter(h => {
        const hDate = new Date(h.dt * 1000);
        return hDate >= todayStart && hDate < tomorrowStart && h.isDay;
      });
      const tomorrowHours = hourlyWithDay.filter(h => {
        const hDate = new Date(h.dt * 1000);
        return hDate >= tomorrowStart && hDate < dayAfterTomorrowStart && h.isDay;
      });

      // Helper function to calculate median
      const calcMedian = (values: (number | undefined)[]) => {
        const nums = values.filter(v => typeof v === 'number') as number[];
        if (nums.length === 0) return undefined;
        const sorted = nums.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };

      let forecast_uv_median_today: number | undefined;
      if (todayHours.length > 0) {
        const uvValues = todayHours.map(h => h.uvi);
        const median = calcMedian(uvValues);
        if (median !== undefined) {
          forecast_uv_median_today = parseFloat(median.toFixed(1));
        }
      }

      let forecast_uv_median_tomorrow: number | undefined;
      if (tomorrowHours.length > 0) {
        const uvValues = tomorrowHours.map(h => h.uvi);
        const median = calcMedian(uvValues);
        if (median !== undefined) {
          forecast_uv_median_tomorrow = parseFloat(median.toFixed(1));
        }
      }

      // Extract battery capacity percentage from power data only if explicitly provided as percent.
      // Do NOT interpret Battery power (kW) as capacity.
      let battery_cap: number | undefined;

      this.latestHourly = hourlyWithDay;
      this.latestNightRanges = nightRanges;
      this.latestWeather = { clouds, uvi, forecast_uv_median_today, forecast_uv_median_tomorrow, battery_cap, fetchedAt: nowMs, rangeStartIso, rangeEndIso };

      // --- SolaX API: fetch inverter power data (primary source) ---
      let solaxFetched = false;
      if (process.env.SOLAX_WIFI_SN) {
        try {
          const { power: solaxPower, battery_cap: solaxBatteryCap } = await getSolaxPowerData();
          this.latestPower = solaxPower;
          if (solaxBatteryCap !== null) {
            this.latestWeather.battery_cap = solaxBatteryCap;
          }
          solaxFetched = true;
          console.log('SolaX power data fetched:', solaxPower);
        } catch (err) {
          console.warn('SolaX API fetch failed, falling back to Playwright:', err);
        }
      }

      // try to extract power data from portal using Playwright (fallback if SolaX not available)
      if (!solaxFetched) {
      try {
        if (this.page) {
          this.latestPower = await extractPowerData(this.page);
          // If extracted power data is all nulls, session/page might be stale — try ephemeral login fallback
          const hasAny = this.latestPower && Object.values(this.latestPower).some(v => v !== null);
          if (!hasAny) {
            console.warn('extractPowerData from existing page returned all nulls; attempting ephemeral login fallback');
            try {
              const { browser, page } = await login();
              try {
                const fallbackPower = await extractPowerData(page);
                const fallbackPlug = await extractPlugStatus(page).catch(() => null);
                // only override if fallback returned any values
                const fallbackHasAny = fallbackPower && Object.values(fallbackPower).some(v => v !== null);
                if (fallbackHasAny) {
                  this.latestPower = fallbackPower;
                  this.latestPlug = fallbackPlug;
                }
              } finally {
                await browser.close();
              }
            } catch (err) {
              console.warn('extractPowerData ephemeral fallback failed:', err);
            }
          } else {
            try {
              this.latestPlug = await extractPlugStatus(this.page);
            } catch (e) {
              console.warn('extractPlugStatus failed:', e);
            }
          }
        } else {
          // ephemeral login to grab power info
          try {
            const { browser, page } = await login();
            try {
              this.latestPower = await extractPowerData(page);
              try {
                this.latestPlug = await extractPlugStatus(page);
              } catch (e) {
                console.warn('extractPlugStatus ephemeral failed:', e);
              }
            } finally {
              await browser.close();
            }
          } catch (err) {
            console.warn('extractPowerData ephemeral failed:', err);
          }
        }
      } catch (err) {
        console.warn('Error extracting power data:', err);
      }
      } // end !solaxFetched

      // Plug status is only available via Playwright (infigy web app).
      // Read it every cycle regardless of whether the controller is started.
      // Uses the persistent page when running, otherwise a short-lived ephemeral
      // session — read-only, no write actions performed.
      try {
        if (this.page) {
          this.latestPlug = await extractPlugStatus(this.page);
          console.log('Plug status:', this.latestPlug);
        } else {
          const { browser: eplBrowser, page: eplPage } = await login();
          try {
            this.latestPlug = await extractPlugStatus(eplPage);
            console.log('Plug status (ephemeral):', this.latestPlug);
          } finally {
            await eplBrowser.close();
          }
        }
      } catch (e) {
        console.warn('extractPlugStatus failed:', e);
        this.latestPlug = null;
      }

      // If extractor returned a battery percent (e.g. "98%"), prefer that for battery_cap
      try {
        // Prefer explicit battery status percent returned by the extractor under 'Battery_status'
        const statusStr = this.latestPower?.['Battery_status'] ?? null;
        if (statusStr && typeof statusStr === 'string') {
          const m = String(statusStr).match(/(\d+[,.]?\d*)\s*%/);
          if (m) {
            const num = Number(m[1].replace(',', '.'));
            if (!Number.isNaN(num)) {
              const weather = this.latestWeather ?? ({ fetchedAt: nowMs } as any);
              weather.battery_cap = num;
              this.latestWeather = weather;
            }
          }
        }
      } catch (e) {
        // ignore
      }

      // append a sample to time-series storage (weather + power + plug)
      try {
        await appendEntry({
          ts: nowMs,
          weather: this.latestWeather,
          power: this.latestPower,
          plug: this.latestPlug,
        });
      } catch (e) {
        console.warn('Failed to append timeseries sample:', e);
      }
    } catch (err) {
      console.warn('Error fetching latest weather:', err);
    }
  }

  private async reset() {
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch (err) {
      console.warn('Error closing browser during reset:', err);
    }
    this.browser = null;
    this.page = null;
    this.lastActionAt = 0;
    this.setState(State.Idle);
  }
}

export const controller = new SolarHousekeeper();
export const solarHousekeeper = controller;

if (require.main === module) {
  // If launched directly, start the Solar Housekeeper
  controller.start();
}
