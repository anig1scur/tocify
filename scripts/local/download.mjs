import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function download(url, destination, expectedHash) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
  const hash = createHash('sha256');
  const verify = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(destination, { flags: 'wx' }));
    if (expectedHash && hash.digest('hex') !== expectedHash) {
      throw new Error(`Checksum mismatch: ${url}`);
    }
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}
