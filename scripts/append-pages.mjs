#!/usr/bin/env node
// append-pages.mjs — 把一个源 .rp 的页追加进目标（.rp 工程 或 .rplib 元件库），统一入口。
//
// 用法：
//   node append-pages.mjs <target.rp|rplib> <source.rp> <output> [--pages a,b,c] [--fail-on-duplicate] [--as rp|rplib] [--json]
//
// 语义（两种容器一致）：
//   · 目标已有页保持原样；只追加"目标里没有的页名"
//   · --pages 显式挑页（必须存在于源）；同名页默认跳过，--fail-on-duplicate 改为失败
//   · 无新增 → 不写输出文件（退出码 0）
//   · 写完自检：页数 = 目标 + 追加，且每页都能解析回 Page 记录
// 分派：目标库走 append-library-pages 的库语义（dd 追加 PackageInfo/Sitemap 节点），
//       目标工程走 merge-pages；两者都基于 manifest 容器（裸流 .rplib 只读）。
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNotProtected, assertWritable } from './engine.mjs';
import { requireWritableContainer, readRecords } from './rp-records.mjs';
import { listSourcePages, mergePages } from './merge-pages.mjs';
import { appendLibraryPages } from './append-library-pages.mjs';

function parseArgs(argv) {
  const positional = [];
  const options = { pages: [], failOnDuplicate: false, json: false, as: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--fail-on-duplicate') options.failOnDuplicate = true;
    else if (arg === '--as') options.as = argv[++i] ?? '';
    else if (arg === '--pages') options.pages.push(...String(argv[++i] ?? '').split(',').map(s => s.trim()).filter(Boolean));
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`未知选项 ${arg}`);
    else positional.push(arg);
  }
  return { positional, options };
}

function pageNames(buf) {
  return listSourcePages(readRecords(buf)).map(p => p.name).filter(Boolean);
}

export function appendPages({ target, source, pages = [], failOnDuplicate = false, as = '' }) {
  const targetBuf = readFileSync(target);
  const sourceBuf = readFileSync(source);
  requireWritableContainer(targetBuf, 'target');
  const targetNames = pageNames(targetBuf);            // 含重名（真实库允许同名页）
  const targetPages = new Set(targetNames);            // 判重按页名集合
  const sourcePages = pageNames(sourceBuf);
  if (!sourcePages.length) throw new Error('源 .rp 里没有任何页');

  const requested = pages.length ? pages : sourcePages;
  const unknown = requested.filter(name => !sourcePages.includes(name));
  if (unknown.length) throw new Error(`源 .rp 中找不到页: ${unknown.join(', ')}；可用页: ${sourcePages.join(', ')}`);

  const appended = [];
  const skipped = [];
  for (const name of requested) {
    if (targetPages.has(name)) {
      if (failOnDuplicate) throw new Error(`[ERR_DUPLICATE_PAGE_NAME] 目标已有页「${name}」`);
      skipped.push(name);
    } else if (!appended.includes(name)) {
      appended.push(name);
    }
  }
  if (!appended.length) return { buf: null, appended, skipped, targetPages: targetNames.length, targetUnique: targetPages.size };

  const kind = as || (extname(target).toLowerCase() === '.rplib' ? 'rplib' : 'rp');
  let buf;
  if (kind === 'rplib') {
    const result = appendLibraryPages({ base: target, source, pages: appended, failOnDuplicate: false });
    buf = result.buf;
  } else {
    buf = mergePages([{ file: target }, ...appended.map(name => ({ file: source, sourcePageName: name }))]);
  }

  const outNames = pageNames(buf);
  const outSet = new Set(outNames);
  const lost = [...targetPages].filter(name => !outSet.has(name)).concat(appended.filter(name => !outSet.has(name)));
  if (lost.length) throw new Error(`写出后自检失败，丢页: ${lost.join(', ')}`);
  // 允许目标原有同名页（真实库合法）：只要求原有唯一页名一个不少、追加页各到一份、且多出的页名都在追加清单里。
  const expectedExtra = outNames.length - targetNames.length;
  if (expectedExtra !== appended.length) {
    throw new Error(`写出后页数不符: ${outNames.length} - ${targetNames.length} = ${expectedExtra} != 追加 ${appended.length}`);
  }
  const unexpected = outNames.filter(name => !targetPages.has(name) && !appended.includes(name));
  if (unexpected.length) throw new Error(`写出后出现非预期页: ${[...new Set(unexpected)].join(', ')}`);
  return { buf, appended, skipped, targetPages: targetNames.length, targetUnique: targetPages.size, outPages: outNames.length };
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help || positional.length !== 3) {
    console.log(`用法: node append-pages.mjs <target.rp|rplib> <source.rp> <output> [--pages a,b,c] [--fail-on-duplicate] [--as rp|rplib] [--json]

目标已有页不动，只追加"目标里没有的页名"；无新增不写输出文件。`);
    process.exit(positional.length === 3 ? 0 : 1);
  }
  const [target, source, output] = positional.map(p => resolve(p));
  if (target === output) throw new Error('output 不能与 target 相同（先写新文件，再手动替换）');
  assertNotProtected(target);
  assertWritable(output);
  const result = appendPages({ target, source, pages: options.pages, failOnDuplicate: options.failOnDuplicate, as: options.as });
  if (result.buf) writeFileSync(output, result.buf, { flag: 'wx' });
  const report = {
    ok: true,
    output: result.buf ? output : null,
    pagesAppended: result.appended.length,
    appended: result.appended,
    skipped: result.skipped,
    targetPages: result.targetPages,
    outPages: result.outPages ?? result.targetPages,
    bytes: result.buf ? result.buf.length : 0,
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else if (!result.appended.length) console.log(`无新增：目标已包含所选页（${result.targetPages} 页）；未写输出文件`);
  else console.log(`追加 ${report.pagesAppended} 页 → ${report.output}（${report.targetPages} + ${report.pagesAppended} = ${report.outPages} 页）`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
