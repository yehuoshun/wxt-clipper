/**
 * Unified logger for WXT Clipper.
 *
 * - Level-based filtering (debug / info / warn / error)
 * - Persists to chrome.storage.local as a rotating ring buffer
 * - Works in background, content script, and popup contexts
 * - Auto-tags with source module name + timestamp
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  t: string;        // ISO timestamp
  l: LogLevel;      // level
  m: string;        // module
  msg: string;      // message
  data?: unknown;   // optional extra payload
}

const STORAGE_KEY = '__clipper_logs';
const MAX_ENTRIES = 500;

// Resolve effective log level from storage (default: info)
let _effectiveLevel: LogLevel = 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[_effectiveLevel];
}

async function loadLevel(): Promise<void> {
  try {
    const stored = await browser.storage.local.get('logLevel');
    if (stored.logLevel) _effectiveLevel = stored.logLevel as LogLevel;
  } catch {
    // storage not available (e.g. content script before WXT init)
  }
}

function getTimestamp(): string {
  return new Date().toISOString();
}

async function persist(entry: LogEntry): Promise<void> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const logs: LogEntry[] = stored[STORAGE_KEY] || [];
    logs.push(entry);
    // Trim oldest entries when exceeding limit
    if (logs.length > MAX_ENTRIES) {
      logs.splice(0, logs.length - MAX_ENTRIES);
    }
    await browser.storage.local.set({ [STORAGE_KEY]: logs });
  } catch {
    // storage unavailable — silently drop
  }
}

function createLogger(module: string) {
  async function log(level: LogLevel, msg: string, data?: unknown): Promise<void> {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      t: getTimestamp(),
      l: level,
      m: module,
      msg,
      data,
    };

    // Console output
    const prefix = `[WebClipper][${module}]`;
    switch (level) {
      case 'debug': console.debug(prefix, msg, data ?? ''); break;
      case 'info':  console.info(prefix, msg, data ?? ''); break;
      case 'warn':  console.warn(prefix, msg, data ?? ''); break;
      case 'error': console.error(prefix, msg, data ?? ''); break;
    }

    // Persist to storage (fire-and-forget)
    persist(entry).catch(() => {});
  }

  return {
    debug: (msg: string, data?: unknown) => log('debug', msg, data),
    info:  (msg: string, data?: unknown) => log('info', msg, data),
    warn:  (msg: string, data?: unknown) => log('warn', msg, data),
    error: (msg: string, data?: unknown) => log('error', msg, data),
  };
}

// ===== Public API =====

/** Create a named logger for a module */
export function getLogger(module: string) {
  // Kick off async level load (non-blocking)
  loadLevel();
  return createLogger(module);
}

/** Set log level at runtime */
export async function setLogLevel(level: LogLevel): Promise<void> {
  _effectiveLevel = level;
  try {
    await browser.storage.local.set({ logLevel: level });
  } catch { /* ignore */ }
}

/** Retrieve persisted logs (newest first) */
export async function getLogs(limit = 100): Promise<LogEntry[]> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const logs: LogEntry[] = stored[STORAGE_KEY] || [];
    return logs.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

/** Clear all persisted logs */
export async function clearLogs(): Promise<void> {
  try {
    await browser.storage.local.remove(STORAGE_KEY);
  } catch { /* ignore */ }
}

/** Export logs as downloadable text */
export async function exportLogs(): Promise<string> {
  const logs = await getLogs(MAX_ENTRIES);
  return logs.map(e => {
    const dataStr = e.data ? ` ${JSON.stringify(e.data)}` : '';
    return `[${e.t}] [${e.l.toUpperCase()}] [${e.m}] ${e.msg}${dataStr}`;
  }).join('\n');
}
