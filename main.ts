/**
 * Token Radar entrypoint (Node 22, standard library only).
 *
 * Reads the sealed DefiLlama snapshot from /input/snapshot.json (or --input),
 * computes empirical pre-token implied valuations and farm plans via lib/model.ts,
 * emits /output/board.json, /output/data.js, static dashboard/ and screenshots/,
 * and seals /output/dossier.json via vendor/makefun-board.ts.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, parseSnapshot, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const PLAIN_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function readFlag(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${flag}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  const prefix = `--${flag}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function copyDirectoryTree(srcDir: string, dstDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(dstDir, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(srcDir).sort()) {
    if (entry.startsWith('.')) continue;
    const srcPath = join(srcDir, entry);
    const dstPath = join(dstDir, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      for (const child of copyDirectoryTree(srcPath, dstPath)) {
        copied.push(`${entry}/${child}`);
      }
    } else if (st.isFile()) {
      copyFileSync(srcPath, dstPath);
      copied.push(entry);
    }
  }
  return copied;
}

const inputArg = readFlag('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`token-radar: missing snapshot file at ${inputPath}\n`);
  process.exit(2);
}

const outDir = readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = validateBoard(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token-radar: validation failed: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

const dashFiles = copyDirectoryTree(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
if (!dashFiles.includes('index.html')) {
  process.stderr.write('token-radar: dashboard/index.html is required\n');
  process.exit(1);
}

const shotFiles = copyDirectoryTree(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shotFiles.length < 3) {
  process.stderr.write(`token-radar: need 3 screenshots in screenshots/, found ${shotFiles.length}\n`);
  process.exit(1);
}
for (const name of shotFiles) {
  if (!PLAIN_NAME_RE.test(name)) {
    process.stderr.write(`token-radar: invalid screenshot filename ${name}\n`);
    process.exit(1);
  }
}

const dossierBytes = buildDossier(outDir, DOSSIER_CAPS);
writeFileSync(join(outDir, 'dossier.json'), dossierBytes);

process.stdout.write(
  `token-radar: ${board.length} pre-token rows (${radar.watchlist_count} watchlist, ${radar.early_count} early), ${radar.live_token_count} live comparables, dossier ${dossierBytes.length} bytes\n`,
);
