#!/usr/bin/env node
// remove-page.mjs — 删除 .rp 工程或 .rplib 元件库里的页（含页拥有的 PanelState 包）。
//
// 用法：node remove-page.mjs <source.rp|rplib> <output.rp|rplib> <pageName...> [--json] [--strict]
//
// 语义：
//   · dd 里摘除 PackageInfo / sitemap node-table / tree.children / 父 Axure:Node 的 children 引用，
//     并剪掉 dd 图里指向已删对象的所有 tag-3 悬空引用（真实库的 sitemap 是文件夹树，漏剪会让
//     Axure 侧 RPTreeMapNode.ChildNodes 抛 NPE）
//   · manifest 里删除对应 package 子树、平移后续 parts 偏移
//   · 找不到页名默认只报告；--strict 时失败
//   · 交互跳转等外部引用不会被静默改写，交给 rp-read 的 problems 暴露
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNotProtected, assertWritable } from './engine.mjs';
import { removePages, pageNames } from './page-ops.mjs';

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const strict = argv.includes('--strict');
  const positional = argv.filter(a => !a.startsWith('--'));
  if (positional.length < 3 || argv.includes('-h') || argv.includes('--help')) {
    console.log(`用法: node remove-page.mjs <source.rp|rplib> <output.rp|rplib> <pageName...> [--json] [--strict]

删除页（含其 PanelState 包），支持 .rp 工程与 .rplib 元件库；裸流 .rplib 只读。`);
    process.exit(positional.length >= 3 ? 0 : 1);
  }
  const source = resolve(positional[0]);
  const output = resolve(positional[1]);
  const names = positional.slice(2);
  assertNotProtected(source);
  assertWritable(output);
  const { file, removed, missing } = removePages(readFileSync(source), names);
  if (!removed.length) {
    console.error('没有匹配到页：' + names.join(', ') + '；现有页: ' + pageNames(readFileSync(source)).join(', '));
    process.exit(1);
  }
  writeFileSync(output, file, { flag: 'wx' });
  const report = { ok: missing.length === 0 || !strict, output, removed, missing, remainingPages: pageNames(file).length, bytes: file.length };
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(`删除 ${removed.length} 页 → ${output}（剩余 ${report.remainingPages} 页）`
    + (missing.length ? `；未找到: ${missing.join(', ')}` : ''));
  if (missing.length && strict) process.exit(1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
