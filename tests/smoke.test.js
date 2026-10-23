/**
 * Smoke tests — verify server boots and responds to basic requests.
 *
 * Spawns the real server.js in a child process with mocked env so no
 * actual Anthropic / Supabase calls happen. Catches: syntax errors,
 * missing-module errors, broken middleware setup, helmet/Sentry init
 * problems, and the Anthropic-timeout fetch wrapper.
 */
import { spawn } from 'node:child_process';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

const PORT = 3098; // unlikely to clash with dev (3000) or other tests
const BASE = `http://localhost:${PORT}`;

let server;

beforeAll(async () => {
  server = spawn('node', ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MOCK_AI: 'true',
      PORT: String(PORT),
      SUPABASE_URL: 'http://localhost',
      SUPABASE_SERVICE_KEY: 'dummy_service_key',
      ANTHROPIC_API_KEY: 'sk-ant-dummy',
      ENCRYPTION_KEY: 'a'.repeat(64),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait up to 8 s for "Forsyne" in stdout — server's listen log line.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout (8s)')), 8000);
    let stdoutBuf = '';
    let stderrBuf = '';
    server.stdout.on('data', (data) => {
      stdoutBuf += data.toString();
      if (stdoutBuf.includes('Forsyne')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (data) => {
      stderrBuf += data.toString();
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with code ${code}\nstderr:\n${stderrBuf}\nstdout:\n${stdoutBuf}`));
    });
  });
}, 10000);

afterAll(() => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
  }
});

describe('server boots and responds', () => {
  test('GET / returns the landing page', async () => {
    const r = await fetch(`${BASE}/`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('<html');
  });

  test('GET /api/me without token returns 401', async () => {
    const r = await fetch(`${BASE}/api/me`);
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error).toBeDefined();
  });

  test('helmet sets security headers on responses', async () => {
    const r = await fetch(`${BASE}/`);
    // Helmet's defaults — at least these should be present
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')?.toLowerCase()).toBe('sameorigin');
    // x-powered-by removed by helmet
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  test('rate limiter sends standard headers on /api/ responses', async () => {
    const r = await fetch(`${BASE}/api/me`);
    // express-rate-limit standardHeaders: true — uses RateLimit-* headers
    expect(r.headers.get('ratelimit-limit') ?? r.headers.get('x-ratelimit-limit')).toBeTruthy();
  });

  test('unknown route returns 404 (or static 404 if served)', async () => {
    const r = await fetch(`${BASE}/this-route-does-not-exist-${Date.now()}`);
    expect([404, 200]).toContain(r.status); // 200 if static catch-all serves landing
  });
});
