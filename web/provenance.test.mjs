import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectSource, sha256 } from './provenance.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'apk-provenance-'));
process.env.APKTOOL_WEB_STATE_DIR = path.join(root, 'state');
process.env.APKTOOL_WEB_DOWNLOADS_DIR = path.join(root, 'downloads');
process.env.APKSIGNER_BIN = path.join(root, 'missing-signer');
process.env.LOG_LEVEL = 'silent';
const { app } = await import('./server.mjs');

test('source failures remain explicit; preserve downloads exact bytes; invalid operations fail', async (t) => {
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const bytes = Buffer.from('untrusted APK input\x00\xff', 'latin1');
  const file = path.join(root, 'fixture.apk');
  await writeFile(file, bytes);
  const signer = path.join(root, 'signer');
  await writeFile(signer, `#!${process.execPath}\nconsole.error('DOES NOT VERIFY'); process.exit(1);\n`, { mode: 0o700 });
  const failed = await inspectSource(file, signer, 1000);
  assert.equal(failed.signature.status, 'failed');
  assert.match(failed.signature.details, /DOES NOT VERIFY/);
  assert.equal(failed.malwareAssessment, 'not-performed');
  await writeFile(signer, `#!${process.execPath}\nconsole.log('Signer #1 certificate SHA-256 digest: ${'ab'.repeat(32)}');\n`, { mode: 0o700 });
  const verified = await inspectSource(file, signer, 1000);
  assert.equal(verified.signature.status, 'verified');
  assert.deepEqual(verified.signature.certificatesSha256, ['ab'.repeat(32)]);
  const response = await app.inject({ method: 'POST', url: '/api/upload', headers: { 'content-type': 'multipart/form-data; boundary=fixture' }, payload: Buffer.concat([Buffer.from('--fixture\r\nContent-Disposition: form-data; name="apk"; filename="source.apk"\r\nContent-Type: application/vnd.android.package-archive\r\n\r\n'), bytes, Buffer.from('\r\n--fixture--\r\n')]) });
  assert.equal(response.statusCode, 200);
  let job = response.json();
  for (let i = 0; i < 100 && job.status === 'building'; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    job = (await app.inject(`/api/jobs/${job.id}`)).json();
  }
  assert.equal(job.status, 'done');
  assert.equal(job.meta.operation, 'preserve');
  assert.equal(job.meta.source.signature.status, 'error');
  assert.equal(job.meta.source.sha256, await sha256(file));
  assert.equal(job.meta.outputSha256, job.meta.source.sha256);
  assert.equal(job.outputReady, true);
  const download = await app.inject(`/api/jobs/${job.id}/download`);
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, bytes);
  assert.equal((await app.inject({ method: 'POST', url: '/api/upload?operation=unknown' })).statusCode, 400);
});
