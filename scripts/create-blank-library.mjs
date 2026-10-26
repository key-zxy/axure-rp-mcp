#!/usr/bin/env node
// create-blank-library.mjs — 由一份真实 RP9 库派生"空库"（.rplib），等价 create-blank-project 的库版本。
//
// 用法：node create-blank-library.mjs <output.rplib> [--seed <library.rplib>] [--keep-pages] [--json]
//
// 基座来源：--seed > 环境变量 AXURE_LIBRARY_SEED > 与脚本同目录的 blank9.rplib。
// 默认会删掉基座里的所有页（RP9「New Library」固定带 1 个空页）；--keep-pages 保留原页。
// 说明：仓库不分发 Axure 库文件；源库需自备（RP9 File → New Library 另存）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWritable } from './engine.mjs';
import { containerKind } from './rp-records.mjs';
import { removePages, pageNames } from './page-ops.mjs';

/** 由基座字节派生空库（keepPages=true 时原样保留）。 */
export function buildBlankLibrary(seedBuf, { keepPages = false } = {}) {
  const kind = containerKind(seedBuf);
  if (kind !== 'manifest') throw new Error(`基座不是可写容器（${kind}）；请用 RP9 另存的库`);
  const names = pageNames(seedBuf);
  const result = keepPages || !names.length ? { file: seedBuf, removed: [] } : removePages(seedBuf, names);
  return { file: result.file, removed: result.removed, pages: pageNames(result.file) };
}

const HERE = dirname(fileURLToPath(import.meta.url));

function resolveSeed(explicit) {
  const candidates = [explicit, process.env.AXURE_LIBRARY_SEED, join(HERE, 'blank9.rplib')].filter(Boolean);
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (existsSync(path)) return path;
  }
  throw new Error('未找到库基座：请用 --seed 指定一份 RP9 库（File → New Library 另存），'
    + '或设置 AXURE_LIBRARY_SEED');
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const keepPages = argv.includes('--keep-pages');
  const positional = [];
  let seedArg = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') { seedArg = argv[++i]; continue; }
    if (argv[i].startsWith('--')) continue;
    positional.push(argv[i]);
  }
  if (positional.length !== 1 || argv.includes('-h') || argv.includes('--help')) {
    console.log(`用法: node create-blank-library.mjs <output.rplib> [--seed <library.rplib>] [--keep-pages] [--json]

默认删掉基座里的所有页（得到空库）；--keep-pages 原样保留。基座可用 AXURE_LIBRARY_SEED 指定。`);
    process.exit(positional.length === 1 ? 0 : 1);
  }
  const output = resolve(positional[0]);
  assertWritable(output);
  const seed = resolveSeed(seedArg);
  const result = buildBlankLibrary(readFileSync(seed), { keepPages });
  writeFileSync(output, result.file, { flag: 'wx' });
  const report = { ok: true, output, seed, removed: result.removed, pages: result.pages.length, bytes: result.file.length };
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(`空库 → ${output}（基座 ${seed}，删页 ${result.removed.length}，剩余 ${report.pages} 页）`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
