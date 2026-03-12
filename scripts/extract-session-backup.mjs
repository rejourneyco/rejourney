#!/usr/bin/env node

import { gunzipSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('Usage: node scripts/extract-session-backup.mjs <session-backup-dir> [--out <dir>]');
  process.exit(1);
}

function isGzip(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isBinaryFrameBundle(buffer) {
  if (buffer.length < 16) return false;

  const possibleSize = buffer.readUInt32BE(8);
  return (
    buffer[12] === 0xff &&
    buffer[13] === 0xd8 &&
    buffer[14] === 0xff &&
    possibleSize > 0 &&
    possibleSize < buffer.length
  );
}

function parseFrameTimestamp(filename) {
  const patternMatch = filename.match(/(\d+)_\d+_(\d+)\.jpe?g$/i);
  if (patternMatch) return Number(patternMatch[2]);

  const timestampMatch = filename.match(/(\d{13,})\.jpe?g$/i);
  if (timestampMatch) return Number(timestampMatch[1]);

  return null;
}

function parseTarEntries(buffer) {
  const files = [];
  let offset = 0;

  while (offset < buffer.length - 512) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const nameEnd = header.indexOf(0);
    const name = header.subarray(0, nameEnd > 0 ? Math.min(nameEnd, 100) : 100).toString('utf8').trim();
    const sizeStr = header.subarray(124, 136).toString('utf8').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];
    const isRegularFile = typeFlag === 0 || typeFlag === 48;

    offset += 512;

    if (isRegularFile && size > 0) {
      files.push({
        name,
        data: Buffer.from(buffer.subarray(offset, offset + size)),
      });
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

function parseBinaryFrames(buffer, sessionStartTime) {
  const frames = [];
  let offset = 0;

  while (offset + 12 <= buffer.length) {
    const tsHigh = buffer.readUInt32BE(offset);
    const tsLow = buffer.readUInt32BE(offset + 4);
    const tsOffset = tsHigh * 0x100000000 + tsLow;
    const jpegSize = buffer.readUInt32BE(offset + 8);

    offset += 12;

    if (jpegSize <= 0 || offset + jpegSize > buffer.length) break;
    if (buffer[offset] !== 0xff || buffer[offset + 1] !== 0xd8) break;

    frames.push({
      timestamp: sessionStartTime + tsOffset,
      data: Buffer.from(buffer.subarray(offset, offset + jpegSize)),
    });

    offset += jpegSize;
  }

  return frames;
}

function extractFramesFromArchive(buffer, sessionStartTime) {
  const raw = isGzip(buffer) ? gunzipSync(buffer) : buffer;

  if (isBinaryFrameBundle(raw)) {
    return {
      format: 'binary-gzip',
      frames: parseBinaryFrames(raw, sessionStartTime),
    };
  }

  const tarEntries = parseTarEntries(raw);
  const tarFrames = tarEntries
    .filter((entry) => /\.jpe?g$/i.test(entry.name))
    .map((entry) => ({
      timestamp: parseFrameTimestamp(entry.name),
      data: entry.data,
    }))
    .filter((entry) => Number.isFinite(entry.timestamp));

  if (tarFrames.length > 0) {
    tarFrames.sort((a, b) => a.timestamp - b.timestamp);
    return {
      format: 'tar-gzip',
      frames: tarFrames,
    };
  }

  return {
    format: 'unknown',
    frames: [],
  };
}

async function maybeReadManifest(sessionDir, outputDir) {
  const manifestCandidates = [
    path.join(sessionDir, 'manifest.json.gz'),
    path.join(sessionDir, 'manifest.json'),
  ];

  for (const manifestPath of manifestCandidates) {
    try {
      const buffer = await fs.readFile(manifestPath);
      const manifestBuffer = isGzip(buffer) ? gunzipSync(buffer) : buffer;
      const manifest = JSON.parse(manifestBuffer.toString('utf8'));
      await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      return manifest;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const sessionDir = path.resolve(args[0]);
  let outputDir = path.join(sessionDir, 'extracted');

  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--out') {
      if (!args[i + 1]) usage();
      outputDir = path.resolve(args[i + 1]);
      i += 1;
      continue;
    }

    usage();
  }

  // Look for screenshots/ (production-mirrored layout) first, fall back to replay/ (legacy backup layout)
  let replayDir = path.join(sessionDir, 'screenshots');
  try {
    await fs.access(replayDir);
  } catch {
    replayDir = path.join(sessionDir, 'replay');
  }
  const replayEntries = (await fs.readdir(replayDir))
    .filter((entry) => !entry.startsWith('.'))
    .sort();

  if (replayEntries.length === 0) {
    throw new Error(`No replay files found in ${replayDir}`);
  }

  await fs.mkdir(outputDir, { recursive: true });

  const manifest = await maybeReadManifest(sessionDir, outputDir);
  const sessionStartTime = manifest?.session?.startedAt ? Date.parse(manifest.session.startedAt) : 0;

  if (!Number.isFinite(sessionStartTime)) {
    throw new Error('Manifest is missing a valid session.startedAt value.');
  }

  let totalFrames = 0;
  const summary = [];

  for (const replayEntry of replayEntries) {
    const inputPath = path.join(replayDir, replayEntry);
    const buffer = await fs.readFile(inputPath);
    const { format, frames } = extractFramesFromArchive(buffer, sessionStartTime);
    const segmentName = replayEntry.replace(/\.(bin|gz)+$/i, '');
    const segmentOutputDir = path.join(outputDir, 'replay', segmentName);

    await fs.mkdir(segmentOutputDir, { recursive: true });

    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const filename = `frame_${String(index).padStart(4, '0')}_${frame.timestamp}.jpg`;
      await fs.writeFile(path.join(segmentOutputDir, filename), frame.data);
    }

    summary.push({
      file: replayEntry,
      format,
      frameCount: frames.length,
    });

    totalFrames += frames.length;
  }

  await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`Extracted ${totalFrames} frames from ${replayEntries.length} replay file(s).`);
  console.log(`Output: ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
