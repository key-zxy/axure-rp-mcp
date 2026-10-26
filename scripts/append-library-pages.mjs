#!/usr/bin/env node
// append-library-pages.mjs — 往 .rplib 控件库**增量追加页面**（RP9 库与 .rp 同容器：AC EF 头 + LZ4 manifest + gzip 记录）。
//
// 用法：
//   node scripts/append-library-pages.mjs <base.rplib> <source.rp> <output.rplib> \
//        [--pages a,b,c] [--fail-on-duplicate] [--json]
//
// 语义：
//   · base 的既有页记录字节不动；只在 dd 里追加 PackageInfo / Sitemap 节点，并把源页包追加到记录流
//   · 默认增量：只追加「页名不在 base 里」的源页；同名页跳过并列进报告
//   · --pages 显式挑页（逗号分隔，可重复传）：页不在源里 → 直接失败；已在库里 → 跳过（除非 --fail-on-duplicate）
//   · 写完自检：重新扫描输出，页名集合 = base ∪ 追加，且每页都能解析回 Page 记录
//
// 退出码：0 成功（含"无新增"），1 失败。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRecords } from './rp-records.mjs';
import { mergePages, listSourcePages } from './merge-pages.mjs';

const ARCHIVE_MAGIC = [0xac, 0xef];

function isArchive(buf) {
  return buf.length > 16 && buf[0] === ARCHIVE_MAGIC[0] && buf[1] === ARCHIVE_MAGIC[1];
}

function pageNames(buf) {
  return listSourcePages(readRecords(buf)).map(p => p.name).filter(Boolean);
}

function requireLibraryBase(buf, label) {
  if (!isArchive(buf)) {
    throw new Error(`${label} 不是 RP9 容器（缺少 AC EF 头）。裸流 .rplib（无 manifest）暂不支持写入；`
      + '请用 RP9 另存为带 manifest 的库，或改用 .rp 作为 base。');
  }
  const records = readRecords(buf);
  if (!records.some(r => r.className === 'Axure:DesignDocument')) {
    throw new Error(`${label} 缺少 Axure:DesignDocument 记录，不是可用的 Axure 工程/库`);
  }
  const names = pageNames(buf);
  if (!names.length) throw new Error(`${label} 里没有任何页（Axure:Page + PackageInfo），无法当作库基座`);
  return names;
}

function parseArgs(argv) {
  const positional = [];
  const options = { pages: [], failOnDuplicate: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--fail-on-duplicate') options.failOnDuplicate = true;
    else if (arg === '--pages') {
      const value = argv[++i];
      if (!value) throw new Error('--pages 需要一个逗号分隔的页名列表');
      options.pages.push(...value.split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`未知选项 ${arg}`);
    else positional.push(arg);
  }
  return { positional, options };
}

export function appendLibraryPages({ base, source, pages = [], failOnDuplicate = false }) {
  const baseBuf = readFileSync(base);
  const srcBuf = readFileSync(source);
  const baseNames = requireLibraryBase(baseBuf, 'base .rplib');
  const sourcePages = listSourcePages(readRecords(srcBuf));
  if (!sourcePages.length) throw new Error('source .rp 里没有任何页');

  const available = sourcePages.map(p => p.name).filter(Boolean);
  const baseSet = new Set(baseNames);
  const requested = pages.length ? pages : available;

  const unknown = requested.filter(n => !available.includes(n));
  if (unknown.length) {
    throw new Error(`源 .rp 中找不到页: ${unknown.join(', ')}；可用页: ${available.join(', ')}`);
  }

  const append = [];
  const skipped = [];
  for (const name of requested) {
    if (baseSet.has(name)) {
      if (failOnDuplicate) throw new Error(`[ERR_DUPLICATE_PAGE_NAME] 库里已有页「${name}」`);
      skipped.push(name);
    } else if (!append.includes(name)) append.push(name);
  }

  if (!append.length) {
    return { pagesAppended: 0, appended: [], skipped, basePages: baseNames.length, sourcePages: available.length, out: null };
  }

  const merged = mergePages([
    { file: base },
    ...append.map(name => ({ file: source, sourcePageName: name })),
  ]);

  // 自检：输出版本/页数/页名可解析，且既有页仍在。
  const outNames = pageNames(merged);
  const outSet = new Set(outNames);
  const missingBase = baseNames.filter(n => !outSet.has(n));
  const missingNew = append.filter(n => !outSet.has(n));
  if (missingBase.length || missingNew.length) {
    throw new Error(`写出后自检失败: 丢页 ${[...missingBase, ...missingNew].join(', ')}；`
      + `输出页数 ${outNames.length}（base ${baseNames.length} + 追加 ${append.length}）`);
  }
  if (outNames.length !== baseNames.length + append.length) {
    throw new Error(`写出后页数不符: ${outNames.length} != ${baseNames.length} + ${append.length}`);
  }
  return {
    pagesAppended: append.length,
    appended: append,
    skipped,
    basePages: baseNames.length,
    outPages: outNames.length,
    sourcePages: available.length,
    buf: merged,
  };
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help || positional.length !== 3) {
    console.log(`用法: node append-library-pages.mjs <base.rplib> <source.rp> <output.rplib> [--pages a,b,c] [--fail-on-duplicate] [--json]

  base.rplib   既有控件库（RP9 带 manifest 的 .rplib；也可直接用 .rp 作基座）
  source.rp    提供新页的工程（通常是一次 export_components_rp 产出的 .rp）
  output.rplib 输出库路径（不要与输入相同）
  --pages      只追加指定页（逗号分隔）；缺省 = 源里所有「库里没有的页」
  --fail-on-duplicate  遇到同名页直接失败（缺省跳过并报告）
  --json       输出 JSON 报告`);
    process.exit(positional.length === 3 ? 0 : 1);
  }

  const [basePath, sourcePath, outPath] = positional.map(p => resolve(p));
  if (basePath === outPath) throw new Error('output 不能与 base 相同（先写新文件，再手动替换）');
  const result = appendLibraryPages({
    base: basePath, source: sourcePath,
    pages: options.pages, failOnDuplicate: options.failOnDuplicate,
  });
  if (result.buf) writeFileSync(outPath, result.buf);
  const report = {
    ok: true,
    out: result.buf ? outPath : null,
    pagesAppended: result.pagesAppended,
    appended: result.appended,
    skipped: result.skipped,
    basePages: result.basePages,
    outPages: result.outPages ?? result.basePages,
    bytes: result.buf ? result.buf.length : 0,
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else if (!result.pagesAppended) console.log(`无新增：库中已包含所选页（base ${result.basePages} 页）；未写输出文件`);
  else console.log(`追加 ${report.pagesAppended} 页 → ${report.out}（${report.basePages} + ${report.pagesAppended} = ${report.outPages} 页，${report.bytes} B）`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
