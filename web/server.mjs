import Fastify from 'fastify';
import { inspectSource, sha256 } from './provenance.mjs';
import { pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const APKSIGNER_BIN = process.env.APKSIGNER_BIN || 'apksigner';
const KEYTOOL_BIN = process.env.KEYTOOL_BIN || 'keytool';
const ZIPALIGN_BIN = process.env.ZIPALIGN_BIN || 'zipalign';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '8787', 10);

const REQUIRE_CF_ACCESS = truthy(process.env.REQUIRE_CF_ACCESS);
const ALLOWED_EMAILS = parseCsvSet(process.env.ALLOWED_EMAILS || '');

const STATE_DIR =
  process.env.APKTOOL_WEB_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'apktool-web');
const DOWNLOADS_DIR =
  process.env.APKTOOL_WEB_DOWNLOADS_DIR || path.join(os.homedir(), 'mini', 'Downloads');
const ASSETS_DIR = process.env.WEB_ASSETS_DIR || path.join(process.cwd(), 'dist');

const JOBS_DIR = path.join(STATE_DIR, 'jobs');
const KEYSTORE_DIR = path.join(STATE_DIR, 'keystore');
const DEBUG_KEYSTORE = path.join(KEYSTORE_DIR, 'debug.keystore');

/** @type {Map<string, any>} */
const jobs = new Map();

// Retry + timeout settings to avoid jobs hanging forever.
const CMD_RETRIES = clampInt(process.env.APKTOOL_WEB_CMD_RETRIES ?? '2', 1, 10);
const CMD_RETRY_DELAY_MS = clampInt(process.env.APKTOOL_WEB_CMD_RETRY_DELAY_MS ?? '750', 0, 60_000);

// Defaults chosen to allow large APKs while still failing fast on a stuck subprocess.
const TIMEOUT_SIGN_MS = clampInt(process.env.APKTOOL_WEB_TIMEOUT_SIGN_MS ?? String(5 * 60_000), 10_000, 60 * 60_000);
const TIMEOUT_VERIFY_MS = clampInt(process.env.APKTOOL_WEB_TIMEOUT_VERIFY_MS ?? String(5 * 60_000), 10_000, 60 * 60_000);
const TIMEOUT_KEYTOOL_MS = clampInt(process.env.APKTOOL_WEB_TIMEOUT_KEYTOOL_MS ?? String(2 * 60_000), 10_000, 60 * 60_000);
const TIMEOUT_ZIPALIGN_MS = clampInt(process.env.APKTOOL_WEB_TIMEOUT_ZIPALIGN_MS ?? String(2 * 60_000), 10_000, 60 * 60_000);

await fsp.mkdir(JOBS_DIR, { recursive: true });
await fsp.mkdir(KEYSTORE_DIR, { recursive: true });
await fsp.mkdir(DOWNLOADS_DIR, { recursive: true });

export const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  },
  bodyLimit: 1024 * 1024 * 1024 // 1GiB for JSON bodies; uploads are streamed via multipart
});

// Optional defense-in-depth when you put this behind Cloudflare Access.
// If enabled, requests must have Access-injected headers at the origin.
app.addHook('onRequest', async (req, reply) => {
  if (!REQUIRE_CF_ACCESS) return;

  const email = req.headers['cf-access-authenticated-user-email'];
  const jwt = req.headers['cf-access-jwt-assertion'];

  // Cloudflare Access typically injects identity headers on authenticated requests.
  // Some configurations reliably provide the JWT assertion even when email is absent,
  // so accept either as proof the request came through Access.
  if ((!email || typeof email !== 'string') && (!jwt || typeof jwt !== 'string')) {
    reply.code(403).type('text/plain').send('Cloudflare Access required.\n');
    return;
  }

  // If we have the email header, enforce a local allowlist as defense-in-depth.
  // If email is missing but JWT exists, rely on Access policy decisions upstream.
  if (email && typeof email === 'string' && ALLOWED_EMAILS.size > 0 && !ALLOWED_EMAILS.has(email)) {
    reply.code(403).type('text/plain').send('Cloudflare Access: user not allowed.\n');
    return;
  }
});

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GiB
  }
});

if (fs.existsSync(ASSETS_DIR)) {
  await app.register(fastifyStatic, {
    root: ASSETS_DIR,
    decorateReply: true
  });

  app.get('/', async (_req, reply) => {
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async (_req, reply) => {
    reply.type('text/plain').send(`Missing assets dir: ${ASSETS_DIR}\nRun "npm -C web install && npm -C web run build".\n`);
  });
}

app.get('/api/health', async () => ({ ok: true }));

app.post('/api/upload', async (req, reply) => {
  const operation = req.query.operation || 'preserve';
  if (!['preserve', 'resign'].includes(operation)) return reply.code(400).send({ error: 'operation must be preserve or resign' });
  const id = crypto.randomBytes(8).toString('hex');
  const jobDir = path.join(JOBS_DIR, id);
  await fsp.mkdir(jobDir, { recursive: true });

  const job = {
    id,
    status: 'uploading',
    createdAt: new Date().toISOString(),
    dir: jobDir,
    inputApk: path.join(jobDir, 'input.apk'),
    alignedApk: path.join(jobDir, 'aligned.apk'),
    signedApk: path.join(jobDir, 'output.apk'),
    logPath: path.join(jobDir, 'job.log'),
    meta: { operation },
    error: null
  };
  jobs.set(id, job);
  await log(job, `job ${id} created`);

  const parts = req.parts();
  let gotApk = false;
  for await (const part of parts) {
    if (part.type !== 'file') continue;
    // Frontend uses "apk". Accept "file" as a convenience for curl/tests.
    if (part.fieldname !== 'apk' && part.fieldname !== 'file') {
      // If we ignore a file part, we must drain it or the request will stall.
      part.file.resume();
      continue;
    }

    gotApk = true;
    await log(job, `upload: ${part.filename} (${part.mimetype})`);
    await streamToFile(part.file, job.inputApk);
    if (part.file.truncated) {
      job.status = 'error';
      job.error = 'upload exceeds file size limit';
      return reply.code(413).send(await publicJob(job));
    }
    job.meta.originalFilename = part.filename;
    break;
  }

  if (!gotApk) {
    job.status = 'error';
    job.error = 'missing multipart file field "apk"';
    await log(job, job.error);
    return reply.code(400).send(await publicJob(job));
  }

  // Inspect and process asynchronously; the client polls.
  if (job.status !== 'building') {
    job.status = 'building';
    job.error = null;
    await log(job, 'repackage: queued');
    repackageJob(job).catch(async (e) => {
      job.status = 'error';
      job.error = String(e?.message || e);
      await log(job, `repackage error: ${job.error}`);
    });
  }

  return reply.send(await publicJob(job));
});

app.get('/api/jobs/:id', async (req, reply) => {
  const job = jobs.get(req.params.id);
  if (!job) return reply.code(404).send({ error: 'job not found' });
  return reply.send(await publicJob(job));
});

app.get('/api/jobs/:id/log', async (req, reply) => {
  const job = jobs.get(req.params.id);
  if (!job) return reply.code(404).type('text/plain').send('job not found\n');
  const logs = await safeReadText(job.logPath, { maxBytes: 10 * 1024 * 1024 });
  reply.type('text/plain').send(logs);
});

app.get('/api/jobs/:id/log-analysis', async (req, reply) => {
  const job = jobs.get(req.params.id);
  if (!job) return reply.code(404).send({ error: 'job not found' });
  const logs = await safeReadText(job.logPath, { maxBytes: 10 * 1024 * 1024 });
  return reply.send(analyzeLog(logs));
});

app.post('/api/jobs/:id/build', async (req, reply) => {
  const job = jobs.get(req.params.id);
  if (!job) return reply.code(404).send({ error: 'job not found' });

  // Retry the operation explicitly selected at upload; never silently change signing identity.
  if (job.status === 'building') return reply.send(await publicJob(job));
  if (job.status === 'done') return reply.send(await publicJob(job));

  job.status = 'building';
  job.error = null;
  await log(job, 'repackage: queued (via /build)');

  repackageJob(job).catch(async (e) => {
    job.status = 'error';
    job.error = String(e?.message || e);
    await log(job, `repackage error: ${job.error}`);
  });

  return reply.send(await publicJob(job));
});

app.get('/api/jobs/:id/download', async (req, reply) => {
  const job = jobs.get(req.params.id);
  if (!job) return reply.code(404).send({ error: 'job not found' });
  if (job.status !== 'done' || !fs.existsSync(job.signedApk)) return reply.code(409).send({ error: 'output not ready' });

  const nameBase = (job.meta?.originalFilename || 'repacked.apk').replace(/[^a-zA-Z0-9._-]+/g, '_');
  reply.header('content-type', 'application/vnd.android.package-archive');
  reply.header('content-disposition', `attachment; filename="${nameBase.replace(/\.apk$/i, '')}-${job.meta.operation}-${job.id}.apk"`);
  return reply.send(fs.createReadStream(job.signedApk));
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`listening on http://${HOST}:${PORT}`);
}

async function repackageJob(job) {
  await log(job, 'repackage: start');
  await log(job, `repackage: retries=${CMD_RETRIES} retryDelayMs=${CMD_RETRY_DELAY_MS}`);
  await log(job, `repackage: timeouts zipalign=${TIMEOUT_ZIPALIGN_MS}ms sign=${TIMEOUT_SIGN_MS}ms verify=${TIMEOUT_VERIFY_MS}ms`);

  job.meta.source = await inspectSource(job.inputApk, APKSIGNER_BIN, TIMEOUT_VERIFY_MS);
  await log(job, `source SHA-256: ${job.meta.source.sha256}; signature: ${job.meta.source.signature.status}`);
  await log(job, 'Signature verification checks integrity. Publisher trust and malware assessment require separate evidence.');
  if (job.meta.operation === 'preserve') {
    await fsp.copyFile(job.inputApk, job.signedApk);
  } else {
    await ensureDebugKeystore(job);

    // zipalign is optional; if missing, we still sign the original input apk.
    let signInput = job.inputApk;
    if (ZIPALIGN_BIN) {
      const ok = await maybeZipalign(job, job.inputApk, job.alignedApk);
      if (ok) signInput = job.alignedApk;
    }

    await log(job, 'apksigner: sign');
    await runWithRetries(
      job,
      APKSIGNER_BIN,
      [
        'sign',
        '--ks',
        DEBUG_KEYSTORE,
        '--ks-key-alias',
        'androiddebugkey',
        '--ks-pass',
        'pass:android',
        '--key-pass',
        'pass:android',
        '--out',
        job.signedApk,
        signInput
      ],
      { cwd: job.dir },
      {
        label: 'apksigner sign',
        timeoutMs: TIMEOUT_SIGN_MS,
        retries: CMD_RETRIES,
        onBeforeAttempt: async () => {
          await rmRF(job.signedApk);
        }
      }
    );

    await log(job, 'apksigner: verify');
    await runWithRetries(job, APKSIGNER_BIN, ['verify', '--verbose', '--print-certs', job.signedApk], { cwd: job.dir }, {
      label: 'apksigner verify',
      timeoutMs: TIMEOUT_VERIFY_MS,
      retries: CMD_RETRIES
    });

  }
  job.meta.outputSha256 = await sha256(job.signedApk);
  if (job.meta.operation === 'preserve' && job.meta.outputSha256 !== job.meta.source.sha256) {
    throw new Error('Original-byte preservation failed');
  }

  // Copy output to ~/mini/Downloads
  const safeBase = (job.meta?.originalFilename || 'output.apk').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outName = `${safeBase.replace(/\.apk$/i, '')}-${job.meta.operation}-${job.id}.apk`;
  const outPath = path.join(DOWNLOADS_DIR, outName);
  try {
    await fsp.mkdir(DOWNLOADS_DIR, { recursive: true });
    await fsp.copyFile(job.signedApk, outPath);
    await fsp.copyFile(job.logPath, path.join(DOWNLOADS_DIR, `${outName}.log.txt`));
    await log(job, `copied output: ${outPath}`);
  } catch (e) {
    await log(job, `warning: failed to copy output to downloads dir (${DOWNLOADS_DIR}): ${String(e?.message || e)}`);
  }

  job.status = 'done';
  await log(job, 'repackage: done');
}

async function maybeZipalign(job, inputApk, alignedApk) {
  await log(job, 'zipalign: attempt');
  try {
    await runWithRetries(job, ZIPALIGN_BIN, ['-p', '4', inputApk, alignedApk], { cwd: job.dir }, {
      label: 'zipalign',
      timeoutMs: TIMEOUT_ZIPALIGN_MS,
      retries: 1,
      onBeforeAttempt: async () => {
        await rmRF(alignedApk);
      }
    });
    await log(job, 'zipalign: ok');
    return true;
  } catch (e) {
    // zipalign not found, or alignment failed. Continue without it.
    await log(job, `zipalign: skip (${String(e?.message || e)})`);
    return false;
  }
}

async function ensureDebugKeystore(job) {
  if (fs.existsSync(DEBUG_KEYSTORE)) return;
  await log(job, `keystore: generating ${DEBUG_KEYSTORE}`);

  await runWithRetries(job, KEYTOOL_BIN, [
    '-genkeypair',
    '-keystore',
    DEBUG_KEYSTORE,
    '-storepass',
    'android',
    '-alias',
    'androiddebugkey',
    '-keypass',
    'android',
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-dname',
    'CN=Android Debug,O=Android,C=US'
  ], { cwd: job.dir }, { label: 'keytool genkeypair', timeoutMs: TIMEOUT_KEYTOOL_MS, retries: CMD_RETRIES });
}

async function publicJob(job) {
  const logs = await safeReadText(job.logPath, { maxBytes: 512 * 1024 });
  return {
    id: job.id,
    status: job.status,
    meta: job.meta,
    error: job.error,
    logs,
    outputReady: job.status === 'done' && fs.existsSync(job.signedApk)
  };
}

async function log(job, line) {
  const msg = `[${new Date().toISOString()}] ${line}\n`;
  await fsp.appendFile(job.logPath, msg, 'utf8');
}

async function runWithRetries(job, cmd, args, opts, cfg) {
  const retries = cfg?.retries ?? 1;
  const timeoutMs = cfg?.timeoutMs ?? 0;
  const label = cfg?.label ?? 'command';
  const onBeforeAttempt = cfg?.onBeforeAttempt ?? null;

  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (onBeforeAttempt) await onBeforeAttempt(attempt);

    await log(job, `try ${attempt}/${retries}: ${label}: start (timeoutMs=${timeoutMs || 'none'})`);
    const startedAt = Date.now();
    try {
      await runOnce(job, cmd, args, opts, { timeoutMs, attempt, retries, label });
      await log(job, `try ${attempt}/${retries}: ${label}: ok (durationMs=${Date.now() - startedAt})`);
      return;
    } catch (e) {
      lastErr = e;
      await log(
        job,
        `try ${attempt}/${retries}: ${label}: fail (durationMs=${Date.now() - startedAt}) err=${String(e?.message || e)}`
      );
      if (attempt < retries && CMD_RETRY_DELAY_MS > 0) {
        await log(job, `try ${attempt}/${retries}: ${label}: retrying after ${CMD_RETRY_DELAY_MS}ms`);
        await sleep(CMD_RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr || new Error(`${label} failed`);
}

async function runOnce(job, cmd, args, opts, cfg) {
  const attempt = cfg?.attempt ?? 1;
  const retries = cfg?.retries ?? 1;
  const label = cfg?.label ?? 'command';
  const timeoutMs = cfg?.timeoutMs ?? 0;

  await log(job, `run: (${attempt}/${retries}) ${label}: ${cmd} ${args.join(' ')}`);

  return await new Promise((resolve, reject) => {
    // Use a process group so we can reliably kill the full tree on timeouts.
    const child = spawn(cmd, args, {
      ...opts,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    let timedOut = false;
    const start = Date.now();

    const killTree = (why) => {
      try {
        // Negative PID kills the process group when detached.
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5000).unref?.();
      log(job, `run: (${attempt}/${retries}) ${label}: killed (${why}) pid=${child.pid}`).catch(() => {});
    };

    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(`timeout after ${timeoutMs}ms`);
      }, timeoutMs);
      timer.unref?.();
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => logChunk(job, 'stdout', String(d)).catch(() => {}));
    child.stderr.on('data', (d) => logChunk(job, 'stderr', String(d)).catch(() => {}));

    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const dur = Date.now() - start;
      log(job, `run: (${attempt}/${retries}) ${label}: exit code=${code} signal=${signal || 'none'} durationMs=${dur}`).catch(
        () => {}
      );
      if (timedOut) return reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      if (code === 0) return resolve();
      return reject(new Error(`${cmd} exited ${code}${signal ? ` (signal ${signal})` : ''}`));
    });
  });
}

async function logChunk(job, streamName, chunk) {
  // Preserve log readability for tools that output partial lines.
  const lines = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    const t = line.trimEnd();
    if (!t) continue;
    await log(job, `${streamName}: ${t}`);
  }
}

async function streamToFile(readable, destPath) {
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    readable.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    readable.pipe(out);
  });
}

async function safeReadText(p, opts = {}) {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  try {
    const st = await fsp.stat(p);
    if (st.size > maxBytes) {
      const fh = await fsp.open(p, 'r');
      try {
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
        return buf.subarray(0, bytesRead).toString('utf8') + `\n... (truncated ${st.size - bytesRead} bytes)\n`;
      } finally {
        await fh.close();
      }
    }
    return await fsp.readFile(p, 'utf8');
  } catch {
    return '';
  }
}

async function rmRF(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

function truthy(v) {
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function parseCsvSet(v) {
  const out = new Set();
  for (const part of String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    out.add(part);
  }
  return out;
}

function clampInt(v, min, max) {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function analyzeLog(logText) {
  const lines = String(logText || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);

  /** @type {Array<any>} */
  const runExits = [];
  /** @type {Array<any>} */
  const failures = [];

  for (const line of lines) {
    const mExit = line.match(/run:\s+\((\d+)\/(\d+)\)\s+(.+?):\s+exit\s+code=(\S+)\s+signal=(\S+)\s+durationMs=(\d+)/);
    if (mExit) {
      runExits.push({
        attempt: Number(mExit[1]),
        total: Number(mExit[2]),
        label: mExit[3],
        code: mExit[4],
        signal: mExit[5],
        durationMs: Number(mExit[6])
      });
    }

    if (line.includes('timed out after')) failures.push({ kind: 'timeout', line });
    if (
      line.includes(': fail ') ||
      line.includes(' decode error:') ||
      line.includes(' build error:') ||
      line.includes(' repackage error:')
    ) {
      failures.push({ kind: 'fail', line });
    }
  }

  const byLabel = new Map();
  for (const e of runExits) {
    const key = e.label;
    const prev = byLabel.get(key) || { label: key, runs: 0, totalDurationMs: 0, lastCode: null, lastSignal: null };
    prev.runs += 1;
    prev.totalDurationMs += e.durationMs || 0;
    prev.lastCode = e.code;
    prev.lastSignal = e.signal;
    byLabel.set(key, prev);
  }

  return {
    summary: {
      lines: lines.length,
      commandExits: runExits.length,
      failureHints: failures.length
    },
    commands: Array.from(byLabel.values()),
    failures: failures.slice(-50),
    tail: lines.slice(-200)
  };
}
