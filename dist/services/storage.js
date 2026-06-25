"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendEntry = appendEntry;
exports.prune = prune;
exports.query = query;
exports.getAll = getAll;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const LOGS_DIR = path_1.default.join(__dirname, '..', '..', 'logs');
const DATA_FILE = path_1.default.join(LOGS_DIR, 'data.ndjson');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
async function ensureLogsDir() {
    try {
        await fs_1.default.promises.mkdir(LOGS_DIR, { recursive: true });
    }
    catch (err) {
        // ignore
    }
}
async function appendEntry(entry) {
    try {
        await ensureLogsDir();
        const line = JSON.stringify(entry) + '\n';
        await fs_1.default.promises.appendFile(DATA_FILE, line);
        // prune old entries after append
        await prune();
    }
    catch (err) {
        console.warn('storage.appendEntry error:', err);
    }
}
async function prune() {
    try {
        const exists = await new Promise(resolve => fs_1.default.exists(DATA_FILE, ex => resolve(ex)));
        if (!exists)
            return;
        const data = await fs_1.default.promises.readFile(DATA_FILE, 'utf8');
        const lines = data.split(/\r?\n/).filter(Boolean);
        const now = Date.now();
        const keep = [];
        for (const l of lines) {
            try {
                const obj = JSON.parse(l);
                if (!obj || typeof obj.ts !== 'number')
                    continue;
                if (obj.ts >= now - RETENTION_MS)
                    keep.push(JSON.stringify(obj));
            }
            catch (e) {
                // skip malformed
            }
        }
        await fs_1.default.promises.writeFile(DATA_FILE, keep.join('\n') + (keep.length ? '\n' : ''));
    }
    catch (err) {
        console.warn('storage.prune error:', err);
    }
}
async function query(sinceMs) {
    try {
        const exists = await new Promise(resolve => fs_1.default.exists(DATA_FILE, ex => resolve(ex)));
        if (!exists)
            return [];
        const data = await fs_1.default.promises.readFile(DATA_FILE, 'utf8');
        const lines = data.split(/\r?\n/).filter(Boolean);
        const out = [];
        for (const l of lines) {
            try {
                const obj = JSON.parse(l);
                if (obj && typeof obj.ts === 'number' && obj.ts >= sinceMs)
                    out.push(obj);
            }
            catch (e) {
                // ignore
            }
        }
        return out;
    }
    catch (err) {
        console.warn('storage.query error:', err);
        return [];
    }
}
async function getAll() {
    return query(0);
}
exports.default = { appendEntry, prune, query, getAll };
