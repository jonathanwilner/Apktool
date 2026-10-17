import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inspectSource(file, signer, timeout) {
  const source = { sha256: await sha256(file), signature: { status: 'error', certificatesSha256: [] }, malwareAssessment: 'not-performed' };
  try {
    const { stdout, stderr } = await execute(signer, ['verify', '--verbose', '--print-certs', file], { timeout, maxBuffer: 1024 * 1024 });
    source.signature = {
      status: 'verified',
      certificatesSha256: [...stdout.matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]{64})\s*$/gm)].map(m => m[1].toLowerCase()),
      details: stdout + stderr
    };
  } catch (error) {
    source.signature.status = Number.isInteger(error.code) && !error.killed ? 'failed' : 'error';
    source.signature.details = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n');
  }
  return source;
}
