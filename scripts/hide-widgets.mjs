#!/usr/bin/env node
// hide-widgets.mjs — 按清单把 .rp/.rplib 里的指定元件设为**隐藏**（原生 MyStyle VISIBLE 属性 = false）。
//
// 用法：
//   node scripts/hide-widgets.mjs <source.rp> <output.rp> <targets.json> [--json]
//
// targets.json：[{ "page"?: "页名", "name": "元件名", "x": 0, "y": 0, "w": 0, "h": 0 }]
//   · page 省略 = 跨所有 Page/PanelState 记录匹配
//   · name + 几何 一起匹配（同名多实例时取几何最近的一个）；name 单独命中唯一实例时也接受
//
// 实现依据（Axure 自己的写法，非发明）：
//   MyStyle.PropList 里 `DOAName = 0xC000006E`、`Value = {tag:25, value:false}` 即隐藏；
//   真实样本：Axure 自带 `Sample UI Patterns.rplib` 的 32 个模板面板都带这一项（值为 false），
//   而原生可见元件**没有这一项**——所以是"无条目 = 可见"，写 true 反而非原生形态。
//   参考：create-panel-clone.mjs 克隆面板时正是删掉该项来恢复可见。
//
// 退出码：0 全部命中；1 有未命中/歧义（不静默放过，避免"以为隐藏了其实没隐藏"）。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRecords, encodeRecord, replaceRecord } from './rp-records.mjs';
import { parsePayload, encodePayload, field } from './parse-payload.mjs';
import { listSourcePages } from './merge-pages.mjs';

const VISIBLE_PROP = 0xC000006E;
const GEOMETRY_TOLERANCE = 2.0;

const isBool = node => node?.tag === 25;

function intern(strings, text) {
  let index = strings.indexOf(text);
  if (index < 0) { index = strings.length; strings.push(text); }
  return { tag: 8, value: index + 1, text };
}

/** 从 MyStyle PropList 读 X/Y/Width/Height（与 add-adaptive-view / create-panel-clone 同一套 DOA）。 */
function geometryOf(style) {
  const out = {};
  for (const item of field(style?.body ?? {}, 'PropList')?.items ?? []) {
    const code = field(item, 'DOAName')?.value;
    const value = field(item, 'Value');
    if (code === 3221225573) { out.x = field(value ?? {}, 'X')?.value; out.y = field(value ?? {}, 'Y')?.value; }
    if (code === 3221225577) { out.w = field(value ?? {}, 'Width')?.value; out.h = field(value ?? {}, 'Height')?.value; }
  }
  return out;
}

function geometryDistance(target, widget) {
  const keys = ['x', 'y', 'w', 'h'];
  let sum = 0;
  for (const key of keys) {
    const a = Number(target[key]);
    const b = Number(widget[key]);
    if (!Number.isFinite(a)) continue;
    if (!Number.isFinite(b)) return Number.POSITIVE_INFINITY;
    sum += Math.abs(a - b);
  }
  return sum;
}

/** 给元件写入/覆盖 VISIBLE=false；返回 'updated' | 'inserted' | 'already'。 */
function hideWidget(graph, object, strings) {
  const styleRef = field(object.body, 'MyStyle')?.value;
  const style = graph.objects.get(styleRef);
  const propList = field(style?.body ?? {}, 'PropList');
  if (!propList) throw new Error(`元件 ${field(field(object.body, 'name-block') ?? {}, 'text')?.text ?? object.id} 没有 MyStyle.PropList，无法写可见性`);
  const existing = propList.items.find(item => field(item, 'DOAName')?.value === VISIBLE_PROP);
  if (existing) {
    const valueEntry = existing.entries.find(([k]) => k?.text === 'Value');
    if (valueEntry?.[1] && isBool(valueEntry[1]) && valueEntry[1].value === false) return 'already';
    const node = { tag: 25, value: false };
    if (valueEntry) valueEntry[1] = node;
    else existing.entries.push([intern(strings, 'Value'), node]);
    return 'updated';
  }
  propList.items.push({
    tag: 1,
    entries: [
      [intern(strings, 'DOAName'), { tag: 5, value: VISIBLE_PROP }],
      [intern(strings, 'Value'), { tag: 25, value: false }],
    ],
  });
  return 'inserted';
}

export function hideWidgets({ source, targets }) {
  const buf = readFileSync(source);
  const records = readRecords(buf);

  // 记录 → 页名（PanelState 记录为 null）：用于 target.page 过滤
  const pageRecords = new Map();
  for (const page of listSourcePages(records)) pageRecords.set(page.record.index, page.name);

  // 记录 → 元件身份（objectId + name + 几何）。几何用于同名多实例消歧。
  const widgetsOf = record => {
    const graph = parsePayload(record);
    const list = [];
    for (const object of graph.objects.values()) {
      if (!object.className?.startsWith('Axure:DiagramObject:')) continue;
      const name = field(field(object.body, 'name-block') ?? {}, 'text')?.text;
      if (!name) continue;
      const style = graph.objects.get(field(object.body, 'MyStyle')?.value);
      list.push({ id: object.id, name, geometry: geometryOf(style) });
    }
    return list;
  };

  // 1) 解析目标 → { recordIndex, objectId }（只读一遍）
  const index = records
    .filter(record => ['Axure:Page', 'Axure:PanelState', 'Axure:Master'].includes(record.className))
    .map(record => ({ record, widgets: widgetsOf(record) }));

  const report = { updated: 0, inserted: 0, already: 0, unresolved: [] };
  const hits = new Map(); // recordIndex -> Set(objectId)
  for (const target of targets) {
    const wanted = String(target.name ?? '').trim();
    const pageName = target.page ? String(target.page) : null;
    const scoped = index.filter(entry => !pageName || pageRecords.get(entry.record.index) === pageName);

    // 主匹配 = 几何（页内几何唯一：导出侧已对重复矩形做偏移）；名字只作退化匹配。
    // 原生元件名会被编译器改写（重名加后缀/前缀哈希），所以几何才是稳定身份。
    let best = null;
    for (const entry of scoped) {
      for (const widget of entry.widgets) {
        const distance = geometryDistance(target, widget.geometry);
        if (distance > GEOMETRY_TOLERANCE) continue;
        if (!best || distance < best.distance) best = { recordIndex: entry.record.index, widget, distance };
      }
    }
    if (!best && wanted) {
      for (const entry of scoped) {
        for (const widget of entry.widgets) {
          if (widget.name !== wanted) continue;
          const distance = geometryDistance(target, widget.geometry);
          if (!best || distance < best.distance) best = { recordIndex: entry.record.index, widget, distance };
        }
      }
    }
    if (!best) { report.unresolved.push({ target, reason: '目标元件不在文件里（多半被编译器丢弃 = 未生成）' }); continue; }
    if (!hits.has(best.recordIndex)) hits.set(best.recordIndex, new Set());
    hits.get(best.recordIndex).add(best.widget.id);
  }

  // 2) 逐记录改写：每次 replaceRecord 都会移动后续记录偏移，必须重新 readRecords 取当次字节。
  let out = buf;
  for (const recordIndex of [...hits.keys()].sort((a, b) => a - b)) {
    const record = readRecords(out)[recordIndex];
    if (!record) throw new Error(`记录 ${recordIndex} 在多轮改写后丢失`);
    const graph = parsePayload(record);
    const strings = [...record.strings];
    let dirty = false;
    for (const object of graph.objects.values()) {
      if (!object.className?.startsWith('Axure:DiagramObject:')) continue;
      if (!hits.get(recordIndex).has(object.id)) continue;
      const outcome = hideWidget(graph, object, strings);
      report[outcome]++;
      dirty = true;
    }
    if (!dirty) continue;
    out = replaceRecord(out, record, encodeRecord(record, strings, encodePayload(graph.roots)));
  }
  return { buf: out, report };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const strict = argv.includes('--strict');
  const positional = argv.filter(a => !a.startsWith('--'));
  if (positional.length !== 3 || argv.includes('-h') || argv.includes('--help')) {
    console.log(`用法: node hide-widgets.mjs <source.rp> <output.rp> <targets.json> [--json] [--strict]

targets.json = [{ "page"?: "页名", "name": "元件名", "x": 0, "y": 0, "w": 0, "h": 0 }, ...]
  匹配：先按「页 + 几何」（容差 ${GEOMETRY_TOLERANCE}px），再退化到「页 + 名字」。
  未命中 = 该元件不在文件里（没生成），默认只报告；--strict 时按失败退出。`);
    process.exit(positional.length === 3 ? 0 : 1);
  }
  const [source, output, targetsPath] = positional.map(p => resolve(p));
  const targets = JSON.parse(readFileSync(targetsPath, 'utf8'));
  if (!Array.isArray(targets)) throw new Error('targets.json 必须是数组');
  const { buf, report } = hideWidgets({ source, targets });
  writeFileSync(output, buf);
  const result = {
    ok: strict ? report.unresolved.length === 0 : true,
    out: output,
    hidden: report.inserted + report.updated,
    alreadyHidden: report.already,
    inserted: report.inserted,
    updated: report.updated,
    unresolved: report.unresolved,
    bytes: buf.length,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`隐藏 ${result.hidden} 个元件（新增属性 ${report.inserted} / 覆写 ${report.updated} / 已是隐藏 ${report.already}）`
    + (report.unresolved.length ? `；未命中 ${report.unresolved.length} 个` : ''));
  if (report.unresolved.length) {
    const msg = `未命中 ${report.unresolved.length} 个目标（这些元件不在文件里 = 未生成）：\n`
      + JSON.stringify(report.unresolved.slice(0, 20), null, 2);
    if (strict) { console.error(msg); process.exit(1); }
    console.error(msg + (report.unresolved.length > 20 ? '\n…（已截断）' : ''));
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
