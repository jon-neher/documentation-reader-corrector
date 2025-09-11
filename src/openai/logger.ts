type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): Level {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
  return 'info';
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/sk-[A-Za-z0-9]{10,}/g, 'sk-***REDACTED***');
  }
  return value;
}

export const logger = {
  log(level: Level, msg: string, meta: Record<string, unknown> = {}): void {
    const target = currentLevel();
    if (LEVEL_ORDER[level] < LEVEL_ORDER[target]) return;
    const safeMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) safeMeta[k] = redact(v);
    const line = JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...safeMeta,
    });
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](line);
  },
  debug(msg: string, meta?: Record<string, unknown>): void {
    this.log('debug', msg, meta);
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    this.log('info', msg, meta);
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log('warn', msg, meta);
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    this.log('error', msg, meta);
  },
};
