import { chromium, Browser, BrowserContext, Page } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

let BROWSER_VISIBLE_OVERRIDE: null | boolean = null;
export function setBrowserVisible(visible: boolean) { BROWSER_VISIBLE_OVERRIDE = !!visible; }
export function isBrowserVisible(): null | boolean { return BROWSER_VISIBLE_OVERRIDE; }

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'public', 'screenshots');
async function ensureScreenshotDir() { try { await fs.promises.mkdir(SCREENSHOT_DIR, { recursive: true }); } catch (e) {} }
async function saveScreenshot(page: Page, name: string) {
  try { await ensureScreenshotDir(); const ts = new Date().toISOString().replace(/[:.]/g, '-'); const filename = `${ts}_${name}.png`; await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: true }); } catch (e) { console.warn('Failed to save screenshot', e); }
}

export async function login(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const headlessEnv = process.env.BROWSER_HEADLESS;
  const defaultHeadless = headlessEnv === undefined ? true : headlessEnv !== 'false';
  const headless = BROWSER_VISIBLE_OVERRIDE === null ? defaultHeadless : !BROWSER_VISIBLE_OVERRIDE;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://app.infigy.cz/auth', { waitUntil: 'networkidle' });
  await saveScreenshot(page, 'login-page');
  await page.waitForSelector('input[name="email"]');
  await page.fill('input[name="email"]', process.env.EMAIL || '');
  await page.waitForSelector('input[name="password"]');
  await page.fill('input[name="password"]', process.env.PASSWORD || '');
  await Promise.all([ page.click('button[type="submit"]'), page.waitForNavigation({ waitUntil: 'networkidle' }) ]);
  await saveScreenshot(page, 'post-login');
  try { await page.waitForSelector('a[href^="/portal/enter/"]', { timeout: 5000 }); await page.click('a[href^="/portal/enter/"]'); await page.waitForLoadState('networkidle'); await saveScreenshot(page, 'portal-enter'); } catch (e) {}
  return { browser, context, page };
}

export async function runAction(page: Page): Promise<void> {
  await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' });
  await saveScreenshot(page, 'plug-page');
  const checkboxSelector = 'input[type="checkbox"].MuiSwitch-input';
  try { const isChecked = await page.isChecked(checkboxSelector); if (!isChecked) { await page.check(checkboxSelector); await saveScreenshot(page, 'plug-checked'); } } catch (e) { console.warn('runAction plug checkbox issue', e); }
}

export async function performActionById(actionId: string | undefined, page: Page): Promise<any> {
  const checkboxSelector = 'input[type="checkbox"].MuiSwitch-input';
  try {
    switch (actionId) {
      case 'turn_on_plug':
        await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' }); await saveScreenshot(page, 'plug-page-action-turn-on'); try { if (!await page.isChecked(checkboxSelector)) { await page.check(checkboxSelector); await saveScreenshot(page, 'plug-turned-on'); } } catch (e) { console.warn('turn_on_plug: checkbox not found', e); } return { ok: true };
      case 'turn_off_plug':
        await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' }); await saveScreenshot(page, 'plug-page-action-turn-off'); try { if (await page.isChecked(checkboxSelector)) { await page.uncheck(checkboxSelector); await saveScreenshot(page, 'plug-turned-off'); } } catch (e) { console.warn('turn_off_plug: checkbox not found', e); } return { ok: true };
      case 'toggle_plug':
        await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' }); await saveScreenshot(page, 'plug-page-action-toggle'); try { await page.click(checkboxSelector); await saveScreenshot(page, 'plug-toggled'); } catch (e) { console.warn('toggle_plug: click failed', e); } return { ok: true };
      case 'refresh_power_data':
        try {
          const data = await extractPowerData(page);
          // Also check the /plug page for switch status and any additional power info
          try {
            await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' });
            await saveScreenshot(page, 'plug-page-refresh');
            const plugStatus = await extractPlugStatus(page).catch(() => null);
            const plugPower = await extractPowerData(page).catch(() => null);
            // merge plugPower into data (prefer non-null values from plug page)
            if (plugPower) {
              for (const k of Object.keys(plugPower)) {
                if (plugPower[k] !== null) data[k] = plugPower[k];
              }
            }
            if (plugStatus !== null) data['_plug_status'] = plugStatus;
          } catch (e) {
            // ignore plug page failures but keep primary data
          }
          await saveScreenshot(page, 'refresh-power-data');
          return { ok: true, data };
        } catch (e) { console.warn('refresh_power_data failed', e); return { ok: false, error: String(e) }; }
      case 'take_screenshot': await saveScreenshot(page, 'manual'); return { ok: true };
      default: await runAction(page); return { ok: true };
    }
  } catch (err) { console.warn('performActionById failed', err); return { ok: false, error: String(err) }; }
}

export async function extractPowerData(page: Page): Promise<Record<string, string | null>> {
  const mappings: Record<string, string[]> = {
    'Photovoltaics': ['FVE', 'Photovoltaics'],
    'Battery': ['Baterie', 'Battery'],
    'Grid': ['Síť', 'Grid'],
    'House': ['Dům', 'House']
  };
  await page.waitForLoadState('networkidle');

  const result: Record<string, string | null> = {};

  // 1) If user provided a selector for battery percent, try it first
  const selectorFromEnv = process.env.BATTERY_SELECTOR;
  if (selectorFromEnv) {
    try {
      const el = page.locator(selectorFromEnv);
      if (await el.count() > 0) {
        const txt = (await el.first().textContent()) || '';
        const m = txt.match(/\d+[,.]?\d*\s*%/);
        if (m) result['Battery_status'] = m[0];
      }
    } catch (e) { /* ignore invalid selector */ }
  }

  // 1b) Try the precise heading-based locator provided by ChatGPT (English or Czech)
  if (!result['Battery_status']) {
    try {
      const batteryStatusText = await page
        .locator('div')
        .filter({ has: page.locator('h3', { hasText: 'Battery status' }) })
        .locator('p')
        .first()
        .innerText()
        .catch(() => '');

      const battery_cap = Number(batteryStatusText.match(/\d+/)?.[0] ?? NaN);
      if (!Number.isNaN(battery_cap)) {
        result['Battery_status'] = `${battery_cap}%`;
      }
    } catch (e) { /* ignore */ }
  }

  // 2) quick retrying scan for percent nodes associated with 'battery' (handles home card)
  if (!result['Battery']) {
    try {
      for (let attempt = 0; attempt < 6 && !result['Battery']; attempt++) {
        const percLoc = page.locator('text=/\\d+[,.]?\\d*\\s*%/');
        const pc = await percLoc.count();
        for (let i = 0; i < pc; i++) {
          const el = percLoc.nth(i);
          try {
            const candidate = await el.evaluate((node) => {
              let cur: HTMLElement | null = node.parentElement;
              for (let depth = 0; depth < 6 && cur; depth++) {
                const txt = (cur.textContent || '').toLowerCase();
                if (txt.indexOf('battery') !== -1 || txt.indexOf('baterie') !== -1) {
                  const m = (node.textContent || '').match(/\d+[,.]?\d*\s*%/);
                  return m ? m[0] : null;
                }
                cur = cur.parentElement;
              }
              return null;
            });
            if (candidate) { result['Battery_status'] = candidate as string; break; }
          } catch (e) { }
        }
        if (result['Battery']) break;
        await page.waitForTimeout(250);
      }
    } catch (e) { }
  }

  // 3) Try switching to 'Obecné' tab (legacy) — do this after battery scan so we don't hide the home card
  try {
    const tab = page.locator('text=Obecné');
    if ((await tab.count()) > 0) { await tab.first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); }
    else {
      const btn = page.locator('button:has-text("Obecné")'); if ((await btn.count()) > 0) { await btn.first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); }
    }
  } catch (e) { /* ignore */ }

  // small settle
  try { await page.waitForTimeout(300); } catch (e) {}

  // 4) map known labels to nearby numeric values (percent preferred)
  const findValueForVariant = async (variant: string) => {
    try {
      const loc = page.locator(`text="${variant}"`);
      if (await loc.count() === 0) return null;
      const el = loc.first();
      const val = await el.evaluate((node) => {
        const container = node.closest('div');
        const candidates = container ? Array.from(container.querySelectorAll('p, span, div')) : Array.from(document.querySelectorAll('p, span, div'));
        for (const c of candidates) {
          const t = (c.textContent || '').trim();
          if (/[-+]?\d+[,.]?\d*\s*%/.test(t)) return t;
          if (/[-+]?\d+[,.]?\d*\s*(kW|W)/i.test(t)) return t;
        }
        return null;
      });
      if (val) return val as string;
    } catch (e) { }
    return null;
  };

  for (const key of Object.keys(mappings)) {
    const variants = mappings[key];
    let foundVal: string | null = null;
    for (const v of variants) {
      foundVal = await findValueForVariant(v);
      if (foundVal) break;
    }
    result[key] = foundVal;
  }

  // 5) final fallbacks: percent nodes or numeric nodes associated with labels
  if (!result['Battery']) {
    try {
      const percLoc = page.locator('text=/\\d+[,.]?\\d*\\s*%/');
      const pc = await percLoc.count();
      for (let i = 0; i < pc; i++) {
        const el = percLoc.nth(i);
        try {
          const candidate = await el.evaluate((node) => {
            let cur: HTMLElement | null = node.parentElement;
            for (let depth = 0; depth < 6 && cur; depth++) {
              const txt = (cur.textContent || '').toLowerCase();
              if (txt.indexOf('battery') !== -1 || txt.indexOf('baterie') !== -1) {
                const m = (node.textContent || '').match(/\d+[,.]?\d*\s*%/);
                return m ? m[0] : null;
              }
              cur = cur.parentElement;
            }
            return null;
          });
          if (candidate) { result['Battery_status'] = candidate as string; break; }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // numeric fallback for other keys
  const missing = Object.keys(result).filter(k => result[k] == null);
  if (missing.length > 0) {
    try {
      const numericLoc = page.locator('text=/[-+]?\\d+[,.]?\\d*\\s*(kW|W|%)/i');
      const count = await numericLoc.count();
      for (let i = 0; i < count; i++) {
        try {
          const el = numericLoc.nth(i);
          const valueText = (await el.textContent()) || '';
          const surrounding = await el.evaluate((node) => {
            let cur: HTMLElement | null = node.parentElement;
            for (let depth = 0; depth < 4 && cur; depth++) {
              const txt = (cur.textContent || '').trim();
              if (txt && txt.length > 0) return txt;
              cur = cur.parentElement;
            }
            return (node.textContent || '').trim();
          });
          const s = (surrounding || '').toLowerCase();
          for (const key of missing.slice()) {
            const variants = mappings[key];
            for (const v of variants) {
              if (s.indexOf(v.toLowerCase()) !== -1) {
                result[key] = valueText.trim();
                const idx = missing.indexOf(key); if (idx !== -1) missing.splice(idx, 1);
                break;
              }
            }
          }
          if (missing.length === 0) break;
        } catch (e) { }
      }
    } catch (e) { console.warn('extractPowerData numeric fallback failed', e); }
  }

  // If Battery power (kW) is still missing, try finding numeric power values near any
  // element that mentions 'Battery'/'Baterie' (this captures kW values shown in different cards).
  if (!result['Battery']) {
    try {
      const batteryLabelLoc = page.locator('text=/battery|baterie/i');
      const blCount = await batteryLabelLoc.count();
      for (let i = 0; i < blCount; i++) {
        const el = batteryLabelLoc.nth(i);
        try {
          const powerVal = await el.evaluate((node) => {
            const container = node.closest('div');
            const candidates = container ? Array.from(container.querySelectorAll('p, span, div')) : [];
            for (const c of candidates) {
              const t = (c.textContent || '').trim();
              if (/[-+]?\d+[,.]?\d*\s*(kW|W)/i.test(t)) return t;
            }
            return null;
          });
          if (powerVal) { result['Battery'] = String(powerVal); break; }
        } catch (e) { }
      }
    } catch (e) { }
  }

  // Keep numeric Battery power values (kW) as-is; battery capacity (percent) is handled separately.

  console.log('extractPowerData ->', result);
  return result;
}

export async function extractPlugStatus(page: Page): Promise<string | null> {
  try {
    // Always navigate to the plug page so we read the right switch,
    // regardless of where extractPowerData left the page.
    await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' });

    const selector = 'input[type="checkbox"].MuiSwitch-input';
    const count = await page.locator(selector).count();
    if (count === 0) return null;
    const checked = await page.isChecked(selector);
    return checked ? 'on' : 'off';
  } catch (e) { console.warn('extractPlugStatus failed:', e); return null; }
}

// small CLI helper when run directly
async function run() {
  const { browser, page } = await login();
  try {
    await runAction(page);
  } catch (e) { console.error('Error during runAction:', e); }
  finally { await browser.close(); }
}

if (require.main === module) run().catch(err => console.error('playwright run error', err));

export default { login, runAction, performActionById, extractPowerData, extractPlugStatus, setBrowserVisible, isBrowserVisible };
