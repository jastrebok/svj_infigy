import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const DATA_FILE = path.join(LOGS_DIR, 'data.ndjson');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function ensureLogsDir() {
  try {
    await fs.promises.mkdir(LOGS_DIR, { recursive: true });
  } catch (err) {
    // ignore
  }
}

export async function appendEntry(entry: Record<string, any>) {
  try {
    await ensureLogsDir();
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(DATA_FILE, line);
    // prune old entries after append
    await prune();
  } catch (err) {
    console.warn('storage.appendEntry error:', err);
  }
}

export async function prune() {
  try {
    const exists = await new Promise<boolean>(resolve => fs.exists(DATA_FILE, ex => resolve(ex)));
    if (!exists) return;
    const data = await fs.promises.readFile(DATA_FILE, 'utf8');
    const lines = data.split(/\r?\n/).filter(Boolean);
    const now = Date.now();
    const keep = [] as string[];
    for (const l of lines) {
      try {
        const obj = JSON.parse(l);
        if (!obj || typeof obj.ts !== 'number') continue;
        if (obj.ts >= now - RETENTION_MS) keep.push(JSON.stringify(obj));
      } catch (e) {
        // skip malformed
      }
    }
    await fs.promises.writeFile(DATA_FILE, keep.join('\n') + (keep.length ? '\n' : ''));
  } catch (err) {
    console.warn('storage.prune error:', err);
  }
}

export async function query(sinceMs: number) {
  try {
    const exists = await new Promise<boolean>(resolve => fs.exists(DATA_FILE, ex => resolve(ex)));
    if (!exists) return [];
    const data = await fs.promises.readFile(DATA_FILE, 'utf8');
    const lines = data.split(/\r?\n/).filter(Boolean);
    const out: Record<string, any>[] = [];
    for (const l of lines) {
      try {
        const obj = JSON.parse(l);
        if (obj && typeof obj.ts === 'number' && obj.ts >= sinceMs) {
          // normalize legacy power keys (Czech) to English equivalents so historical data remains usable
          if (obj.power && typeof obj.power === 'object') {
            const keyMap: Record<string, string> = {
              'Dům': 'House',
              'FVE': 'Photovoltaics',
              'Baterie': 'Battery',
              'Síť': 'Grid',
              'Zásuvka': 'Plug',
              'Zasuvka': 'Plug'
            };
            const norm: Record<string, any> = {};
            for (const srcKey of Object.keys(obj.power)) {
              const mapped = keyMap[srcKey];
              if (mapped && typeof obj.power[srcKey] !== 'undefined') {
                // only add mapped key if not already present
                if (typeof obj.power[mapped] === 'undefined') {
                  norm[mapped] = obj.power[srcKey];
                }
              }
            }
            if (Object.keys(norm).length > 0) {
              obj.power = Object.assign({}, obj.power, norm);
            }
          }
          out.push(obj);
        }
      } catch (e) {
        // ignore
      }
    }
    return out;
  } catch (err) {
    console.warn('storage.query error:', err);
    return [];
  }
}

export async function getAll() {
  return query(0);
}

export default { appendEntry, prune, query, getAll };
