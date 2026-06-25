"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBrowserVisible = setBrowserVisible;
exports.isBrowserVisible = isBrowserVisible;
exports.login = login;
exports.runAction = runAction;
exports.performActionById = performActionById;
exports.extractPowerData = extractPowerData;
exports.extractPlugStatus = extractPlugStatus;
const playwright_1 = require("playwright");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
// runtime override for browser visibility. If null, fall back to env BROWSER_HEADLESS
let BROWSER_VISIBLE_OVERRIDE = null;
function setBrowserVisible(visible) {
    BROWSER_VISIBLE_OVERRIDE = !!visible;
}
function isBrowserVisible() {
    return BROWSER_VISIBLE_OVERRIDE;
}
const SCREENSHOT_DIR = path_1.default.join(__dirname, '..', '..', 'public', 'screenshots');
async function ensureScreenshotDir() {
    try {
        await fs_1.default.promises.mkdir(SCREENSHOT_DIR, { recursive: true });
    }
    catch (err) {
        // ignore
    }
}
async function saveScreenshot(page, name) {
    try {
        await ensureScreenshotDir();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${ts}_${name}.png`;
        const dest = path_1.default.join(SCREENSHOT_DIR, filename);
        await page.screenshot({ path: dest, fullPage: true });
        console.log('Saved screenshot', dest);
    }
    catch (err) {
        console.warn('Failed to save screenshot', err);
    }
}
async function login() {
    const headlessEnv = process.env.BROWSER_HEADLESS;
    const defaultHeadless = headlessEnv === undefined ? true : headlessEnv !== 'false';
    const headless = BROWSER_VISIBLE_OVERRIDE === null ? defaultHeadless : !BROWSER_VISIBLE_OVERRIDE;
    const browser = await playwright_1.chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    // Login screen
    await page.goto('https://app.infigy.cz/auth', { waitUntil: 'networkidle' });
    await saveScreenshot(page, 'login-page');
    await page.waitForSelector('input[name="email"]');
    await page.fill('input[name="email"]', process.env.EMAIL || '');
    await page.waitForSelector('input[name="password"]');
    await page.fill('input[name="password"]', process.env.PASSWORD || '');
    // Submit and wait for navigation
    await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle' }),
    ]);
    await saveScreenshot(page, 'post-login');
    console.log('✅ Logged in successfully!');
    // Open portal if available
    try {
        await page.waitForSelector('a[href^="/portal/enter/"]', { timeout: 5000 });
        await page.click('a[href^="/portal/enter/"]');
        await page.waitForLoadState('networkidle');
        await saveScreenshot(page, 'portal-enter');
    }
    catch (err) {
        // link may not always be present; continue
    }
    return { browser, context, page };
}
async function runAction(page) {
    // Navigate to plug screen
    await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' });
    await saveScreenshot(page, 'plug-page');
    const checkboxSelector = 'input[type="checkbox"].MuiSwitch-input';
    let isChecked = false;
    try {
        isChecked = await page.isChecked(checkboxSelector);
    }
    catch (err) {
        console.warn('Checkbox selector not found or not a checkbox:', err);
    }
    if (!isChecked) {
        try {
            await page.check(checkboxSelector);
            await saveScreenshot(page, 'plug-checked');
        }
        catch (err) {
            console.warn('Failed to check the plug checkbox:', err);
        }
    }
}
async function performActionById(actionId, page) {
    const checkboxSelector = 'input[type="checkbox"].MuiSwitch-input';
    switch (actionId) {
        case 'turn_on_plug':
            try {
                await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' });
                await saveScreenshot(page, 'plug-page-action-turn-on');
                try {
                    const checked = await page.isChecked(checkboxSelector);
                    if (!checked) {
                        await page.check(checkboxSelector);
                        await saveScreenshot(page, 'plug-turned-on');
                    }
                }
                catch (e) {
                    console.warn('turn_on_plug: checkbox not found', e);
                }
            }
            catch (e) {
                console.warn('turn_on_plug failed', e);
            }
            return { ok: true };
        case 'turn_off_plug':
            try {
                await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' });
                await saveScreenshot(page, 'plug-page-action-turn-off');
                try {
                    const checked = await page.isChecked(checkboxSelector);
                    if (checked) {
                        await page.uncheck(checkboxSelector);
                        await saveScreenshot(page, 'plug-turned-off');
                    }
                }
                catch (e) {
                    console.warn('turn_off_plug: checkbox not found', e);
                }
            }
            catch (e) {
                console.warn('turn_off_plug failed', e);
            }
            return { ok: true };
        case 'toggle_plug':
            try {
                await page.goto('https://app.infigy.cz/plug', { waitUntil: 'networkidle' });
                await saveScreenshot(page, 'plug-page-action-toggle');
                try {
                    await page.click(checkboxSelector);
                    await saveScreenshot(page, 'plug-toggled');
                }
                catch (e) {
                    console.warn('toggle_plug: click failed', e);
                }
            }
            catch (e) {
                console.warn('toggle_plug failed', e);
            }
            return { ok: true };
        case 'refresh_power_data':
            try {
                const data = await extractPowerData(page);
                await saveScreenshot(page, 'refresh-power-data');
                return { ok: true, data };
            }
            catch (e) {
                console.warn('refresh_power_data failed', e);
                return { ok: false, error: String(e) };
            }
        case 'take_screenshot':
            try {
                await saveScreenshot(page, 'manual');
                return { ok: true };
            }
            catch (e) {
                console.warn('take_screenshot failed', e);
                return { ok: false, error: String(e) };
            }
        default:
            // fallback: run existing runAction behavior
            try {
                await runAction(page);
                return { ok: true };
            }
            catch (e) {
                console.warn('default action failed', e);
                return { ok: false, error: String(e) };
            }
    }
}
async function extractPowerData(page) {
    // map internal keys to possible visible label variants (support multiple languages)
    const mappings = {
        'FVE': ['FVE', 'Photovoltaics'],
        'Baterie': ['Baterie', 'Battery'],
        'Síť': ['Síť', 'Grid'],
        'Dům': ['Dům', 'House']
    };
    await page.waitForLoadState('networkidle');
    // Ensure we're on the correct tab — power values are under the "Obecné" tab
    try {
        const tab = page.locator('text=Obecné');
        if ((await tab.count()) > 0) {
            await tab.first().click();
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(500); // let UI settle
        }
        else {
            // fallback: try button with that label
            const btn = page.locator('button:has-text("Obecné")');
            if ((await btn.count()) > 0) {
                await btn.first().click();
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(500);
            }
        }
    }
    catch (err) {
        console.warn('Could not switch to Obecné tab:', err);
    }
    // wait briefly for expected labels (best-effort)
    try {
        await page.waitForTimeout(300);
    }
    catch (e) { }
    // use Playwright locators and element.evaluate to avoid serializing complex functions
    const result = {};
    const findValueForVariant = async (variant) => {
        try {
            const loc = page.locator(`text="${variant}"`);
            if (await loc.count() === 0)
                return null;
            const el = loc.first();
            const val = await el.evaluate((node) => {
                const container = node.closest('div');
                const candidates = container ? Array.from(container.querySelectorAll('span, p, div')) : Array.from(document.querySelectorAll('span, p, div'));
                for (const c of candidates) {
                    const t = (c.textContent || '').trim();
                    if (/[-+]?\d+[,.]?\d*\s*(kW|W)/i.test(t))
                        return t;
                }
                return null;
            });
            if (val)
                return val;
        }
        catch (err) {
            // ignore
        }
        return null;
    };
    for (const key of Object.keys(mappings)) {
        const variants = mappings[key];
        let foundVal = null;
        for (const v of variants) {
            foundVal = await findValueForVariant(v);
            if (foundVal)
                break;
        }
        result[key] = foundVal;
    }
    // Fallback: if some keys (e.g. FVE) are still null, try scanning numeric power values
    const missing = Object.keys(result).filter(k => result[k] == null);
    if (missing.length > 0) {
        try {
            const numericLoc = page.locator('text=/[-+]?\\d+[,.]?\\d*\\s*(kW|W)/i');
            const count = await numericLoc.count();
            for (let i = 0; i < count; i++) {
                try {
                    const el = numericLoc.nth(i);
                    const valueText = (await el.textContent()) || '';
                    // get surrounding text (ancestor container text) to find a label
                    const surrounding = await el.evaluate((node) => {
                        let cur = node.parentElement;
                        for (let depth = 0; depth < 4 && cur; depth++) {
                            const txt = (cur.textContent || '').trim();
                            if (txt && txt.length > 0)
                                return txt;
                            cur = cur.parentElement;
                        }
                        return (node.textContent || '').trim();
                    });
                    const s = (surrounding || '').toLowerCase();
                    for (const key of missing) {
                        const variants = mappings[key];
                        for (const v of variants) {
                            if (s.indexOf(v.toLowerCase()) !== -1) {
                                result[key] = valueText.trim();
                                // remove assigned from missing
                                const idx = missing.indexOf(key);
                                if (idx !== -1)
                                    missing.splice(idx, 1);
                                break;
                            }
                        }
                        if (result[key])
                            break;
                    }
                    if (missing.length === 0)
                        break;
                }
                catch (e) {
                    // continue
                }
            }
        }
        catch (e) {
            // ignore fallback errors
            console.warn('extractPowerData fallback failed:', e);
        }
    }
    console.log('extractPowerData ->', result);
    return result;
}
async function extractPlugStatus(page) {
    try {
        const selector = 'input[type="checkbox"].MuiSwitch-input';
        const count = await page.locator(selector).count();
        if (count === 0)
            return null;
        // isChecked returns boolean; convert to human-readable
        const checked = await page.isChecked(selector);
        return checked ? 'on' : 'off';
    }
    catch (err) {
        console.warn('extractPlugStatus failed:', err);
        return null;
    }
}
async function run() {
    const { browser, page } = await login();
    try {
        await runAction(page);
    }
    catch (err) {
        console.error('Error during runAction:', err);
    }
    finally {
        await browser.close();
    }
}
run().catch(error => {
    console.error('Error running Playwright test:', error);
});
