import { login, runAction, extractPowerData, extractPlugStatus, performActionById } from './playwrightActions';
import { appendEntry } from './storage';
import { fetchWeather } from './weatherAPI';
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

export class SolarHousekeeper {
  private state: State = State.Idle;
  private intervalMs: number;
  private actionCooldownMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastActionAt = 0;
  private latestWeather: { clouds?: number; uvi?: number; fetchedAt: number; rangeStartIso?: string; rangeEndIso?: string } | null = null;
  private latestHourly: { dt: number; clouds?: number; uvi?: number; isDay?: boolean }[] | null = null;
  private latestNightRanges: { startMs: number; endMs: number }[] | null = null;
  private latestPower: Record<string, string | null> | null = null;
  private latestPlug: string | null = null;
  private page: Page | null = null;
  private browser: Browser | null = null;
  private logsDir = path.join(__dirname, '..', '..', 'logs');
  private logFile = path.join(this.logsDir, 'activity.log');

  private async appendLog(line: string) {
    try {
      await fs.promises.mkdir(this.logsDir, { recursive: true });
      await fs.promises.appendFile(this.logFile, line + '\n');
    } catch (err) {
      console.warn('Failed to write log:', err);
    }
  }

  constructor(opts: ControllerOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 30_000; // default 30s
    this.actionCooldownMs = opts.actionCooldownMs ?? 60_000; // default 60s
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

  private setState(s: State) {
    this.state = s;
    console.log(new Date().toISOString(), 'state ->', s);
    void this.appendLog(`${new Date().toISOString()} state -> ${s}`);
  }

  private now() {
    return Date.now();
  }

  async checkOnce() {
    console.log(new Date().toISOString(), 'checkOnce', { state: this.state });

    try {
      // refresh latest weather on each check (best-effort)
      void this.fetchLatestWeather().catch(err => console.warn('fetchLatestWeather failed:', err));

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
          await runAction(this.page);
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
  }

  async forceAction(actionId?: string) {
    if (!this.page) {
      console.warn('No page to run action on; will try to login first');
      await this.checkOnce();
    }

    if (this.page) {
      this.setState(State.Busy);
      try {
        if (typeof actionId === 'string' && actionId.length > 0) {
          await performActionById(actionId, this.page);
        } else {
          await runAction(this.page);
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

      // prefer hourly uvi values in range, fallback to current
      let uvi: number | undefined;
      const hourlyUvi = hourlyInRange.map(h => h.uvi).filter(x => typeof x === 'number') as number[];
      if (hourlyUvi.length > 0) {
        uvi = Math.max(...hourlyUvi);
      } else if (w.current && typeof w.current.uvi === 'number') {
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

      this.latestHourly = hourlyWithDay;
      this.latestNightRanges = nightRanges;
      this.latestWeather = { clouds, uvi, fetchedAt: nowMs, rangeStartIso, rangeEndIso };

      // try to extract power data from portal using Playwright
      try {
        if (this.page) {
          this.latestPower = await extractPowerData(this.page);
          try {
            this.latestPlug = await extractPlugStatus(this.page);
          } catch (e) {
            console.warn('extractPlugStatus failed:', e);
          }
          void this.appendLog(JSON.stringify({ ts: nowMs, kind: 'power', power: this.latestPower }));
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
              void this.appendLog(JSON.stringify({ ts: nowMs, kind: 'power', power: this.latestPower }));
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
