import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { analyzeCorrection } from '../analysis/correction/chain.js';
import type { CorrectionAnalysisInput } from '../analysis/correction/types.js';
import { normalizeToAnalysisInput } from './validation.js';
import { logger } from '../openai/logger.js';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const JSON_LIMIT = process.env.JSON_LIMIT || '10mb';
const RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.RATE_LIMIT_PER_MIN || 10));

const app = express();
app.set('trust proxy', true); // honor X-Forwarded-For when behind a proxy
app.use(express.json({ limit: JSON_LIMIT }));

// Simple sliding-window rate limiter per IP for POST /process-correction
const windowMs = 60_000;
type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

function rateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = buckets.get(ip) || { timestamps: [] };
  // prune old
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= RATE_LIMIT_PER_MIN) {
    const oldest = bucket.timestamps[0];
    const retryAfterMs = Math.max(0, windowMs - (now - oldest));
    buckets.set(ip, bucket);
    return { allowed: false, retryAfterMs };
  }
  bucket.timestamps.push(now);
  buckets.set(ip, bucket);
  return { allowed: true };
}

function getIp(req: express.Request): string {
  return (req.ip || req.socket.remoteAddress || '').toString();
}

function extractApiKey(req: express.Request): string | undefined {
  const header = req.header('x-api-key');
  if (header) return header;
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const q = req.query['api_key'];
  return typeof q === 'string' ? q : undefined;
}

function authorize(req: express.Request): { ok: true } | { ok: false; message: string } {
  const expected = process.env.INBOUND_API_KEY;
  if (!expected) {
    // Warn once per process start; avoid log spam on each call.
    if (!(globalThis as any).__inbound_key_warned) {
      logger.warn('INBOUND_API_KEY not set; accepting all requests');
      (globalThis as any).__inbound_key_warned = true;
    }
    return { ok: true };
  }
  const provided = extractApiKey(req);
  if (!provided) return { ok: false, message: 'Missing API key' };
  if (provided !== expected) return { ok: false, message: 'Invalid API key' };
  return { ok: true };
}

// Request/response logging middleware with correlation IDs
app.use((req, res, next) => {
  const correlationId = req.header('x-correlation-id') || uuidv4();
  (res.locals as any).correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);

  const ip = getIp(req);
  const started = Date.now();
  logger.info('HTTP request start', {
    correlationId,
    method: req.method,
    path: req.path,
    ip,
    userAgent: req.header('user-agent'),
    contentLength: Number(req.header('content-length') || '0') || undefined,
  });
  res.on('finish', () => {
    const elapsedMs = Date.now() - started;
    logger.info('HTTP request end', {
      correlationId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      elapsedMs,
    });
  });
  next();
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.SERVICE_VERSION || '1.0.0',
    uptimeSec: Math.round(process.uptime()),
  });
});

// Main correction processing endpoint
app.post('/process-correction', async (req, res) => {
  const correlationId = (res.locals as any).correlationId as string;
  const ip = getIp(req);

  // Auth
  const auth = authorize(req);
  if (!auth.ok) {
    logger.warn('Unauthorized request', { correlationId, ip, reason: auth.message });
    return res.status(401).json({ error: auth.message, correlationId });
  }

  // Rate limiting
  const limit = rateLimit(ip);
  if (!limit.allowed) {
    logger.warn('Rate limit exceeded', { correlationId, ip, retryAfterMs: limit.retryAfterMs });
    if (typeof limit.retryAfterMs === 'number') {
      res.setHeader('retry-after', Math.ceil(limit.retryAfterMs / 1000).toString());
    }
    return res.status(429).json({ error: 'Too many requests', correlationId });
  }

  try {
    const normalized = normalizeToAnalysisInput(req.body);
    if ('error' in (normalized as any)) {
      return res.status(400).json({
        error: 'Invalid input format',
        details: (normalized as any).details,
        correlationId,
      });
    }

    const input = normalized as CorrectionAnalysisInput;
    // Delegate to the workflow
    const result = await analyzeCorrection(input);

    return res.status(200).json({ success: true, correlationId, result });
  } catch (err) {
    const e = err as any;
    logger.error('Processing failed', {
      correlationId,
      errorName: e?.name,
      errorMessage: e?.message,
    });
    return res.status(500).json({ error: 'Internal processing error', correlationId });
  }
});

// Start server only when this module is the entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, HOST, () => {
    logger.info('Service listening', { host: HOST, port: PORT });
  });
}

export default app;
