// page-ops.mjs — 页级增删的共用实现（.rp 工程与 RP9 .rplib 元件库同容器）。
//
// removePages(file, names)：从 dd 的 PackageInfos / SiteTreeMap.node-table / Tree.children 摘除页，
// 连同页拥有的 PanelState 包一起删；再从 manifest 删除对应 package 子树，平移后续 parts 偏移，重建文件。
// 约束：manifest 容器（裸流 .rplib 只读）。其它引用（如交互跳转）可能留下悬空引用，由 rp-read 的
// problems 暴露，本模块不静默改写。
import { readRecords, readManifest, encodeManifest, encodeRecord, replaceRecord, requireWritableContainer } from './rp-records.mjs';
import { parsePayload, encodePayload, field } from './parse-payload.mjs';
import { listSourcePages } from './merge-pages.mjs';
import { guidKey } from './duplicate-page.mjs';

const guidTable = graph => graph.roots.find(n => n.tag === 0x1e)?.values;
const packageGuid = graph => {
  const table = guidTable(graph);
  const index = graph.roots.find(n => n.tag === 0x12)?.value;
  return table && index ? table[index - 1] : null;
};

/** manifest 树展平：[{key, offset, node}]。 */
function flattenParts(root) {
  const out = [];
  const walk = node => {
    for (const [key, offset] of Object.entries(node.parts ?? {})) out.push({ key, offset, node });
    for (const child of Object.values(node.children ?? {})) walk(child);
  };
  walk(root);
  return out;
}

/** 删除 manifest 中匹配 key 的子树，返回被删子树的全部 part 列表。 */
function detachManifestSubtrees(root, keys) {
  const removed = [];
  const walk = node => {
    for (const [key, child] of Object.entries(node.children ?? {})) {
      if (keys.has(key)) {
        removed.push(...flattenParts(child));
        delete node.children[key];
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return removed;
}

/** 按删除区间前移其余 parts 的 offset（parts 相对 dataStart）。 */
function shiftParts(root, removals) {
  const sorted = [...removals].sort((a, b) => a.offset - b.offset);
  const walk = node => {
    for (const [key, offset] of Object.entries(node.parts ?? {})) {
      let delta = 0;
      for (const r of sorted) {
        if (r.offset >= offset) break;
        delta += r.size;
      }
      if (delta) node.parts[key] = offset - delta;
    }
    for (const child of Object.values(node.children ?? {})) walk(child);
  };
  walk(root);
}

/**
 * 删除指定页。返回 { file, removed: [页名], missing: [页名] }。
 */
export function removePages(file, pageNames) {
  requireWritableContainer(file);
  const records = readRecords(file);
  const pages = listSourcePages(records);
  // 同名页在真实库里合法（Sample UI Patterns 有 4 个 "Instructions"）：一个名字删掉**全部**同名页。
  const targets = [];
  const missing = [];
  for (const name of pageNames) {
    const hits = pages.filter(p => p.name === name);
    if (hits.length) targets.push(...hits); else missing.push(name);
  }
  if (!targets.length) return { file, removed: [], missing };

  const manifest = readManifest(file);
  const recordByOffset = new Map(records.map(r => [r.offset - 8 - manifest.dataStart, r]));
  const docRec = records.find(r => r.className === 'Axure:DesignDocument');
  if (!docRec) throw new Error('缺少 Axure:DesignDocument，无法删除页');
  const doc = parsePayload(docRec);
  const docGuids = doc.roots.find(n => n.tag === 0x1e)?.values ?? [];
  const docRootId = doc.roots.find(n => n.tag === 0x0f)?.value;
  const docRoot = doc.objects.get(docRootId);
  const site = doc.objects.get(field(docRoot?.body ?? {}, 'sitemap')?.value);
  const tree = doc.objects.get(field(site?.body ?? {}, 'tree')?.value);
  if (!docRoot || !site || !tree) throw new Error('dd 结构缺少 PackageInfos / sitemap / tree');

  // 1) 目标页 + 其拥有的 PanelState 包（递归）
  const stateRecords = records.filter(r => r.className === 'Axure:PanelState');
  const statesByGuid = new Map();
  for (const record of stateRecords) {
    const guid = packageGuid(parsePayload(record));
    if (guid) statesByGuid.set(guid, record);
  }
  const collectOwnedStates = (record, sink) => {
    const graph = parsePayload(record);
    const table = guidTable(graph) ?? [];
    for (const object of graph.objects.values()) {
      if (object.className !== 'Axure:DiagramObject:DynamicPanel') continue;
      for (const item of field(object.body, 'panel-diagrams')?.items ?? []) {
        const guid = item?.values ? table[item.values[1] - 1] : null; // (strIdx, guidIdx)
        const state = guid && statesByGuid.get(guid);
        if (state && !sink.has(state)) { sink.add(state); collectOwnedStates(state, sink); }
      }
    }
  };
  const ownedStates = new Set();
  for (const target of targets) collectOwnedStates(target.record, ownedStates);

  const targetGuids = new Set();
  for (const target of targets) targetGuids.add(packageGuid(parsePayload(target.record)));
  for (const state of ownedStates) targetGuids.add(packageGuid(parsePayload(state)));

  // 2) dd：摘除 PackageInfo / sitemap 节点 / tree 引用
  const infos = [...doc.objects.values()].filter(o => o.className === 'Axure:PackageInfo');
  const removedInfoIds = new Set();
  const removedPackageIdxs = new Set();
  for (const info of infos) {
    const values = field(info.body, 'package-id')?.values;
    if (!values) continue;
    if (!targetGuids.has(docGuids[values[1] - 1])) continue;
    removedInfoIds.add(info.id);
    removedPackageIdxs.add(values[1]);
  }

  const removedNodeIds = new Set();
  const nodeTable = field(site.body, 'node-table');
  if (nodeTable?.entries) {
    for (const [nodeRef, value] of nodeTable.entries) {
      const pkgIdx = value?.values?.[1];
      if (pkgIdx && removedPackageIdxs.has(pkgIdx)) removedNodeIds.add(nodeRef?.value);
    }
    nodeTable.entries = nodeTable.entries.filter(([nodeRef, value]) => {
      const pkgIdx = value?.values?.[1];
      return !(pkgIdx && removedPackageIdxs.has(pkgIdx)) && !removedNodeIds.has(nodeRef?.value);
    });
  }
  const children = field(tree.body, 'children');
  if (children?.items) children.items = children.items.filter(node => !removedNodeIds.has(node.value));
  const pkgInfos = field(docRoot.body, 'PackageInfos');
  if (pkgInfos?.items) pkgInfos.items = pkgInfos.items.filter(node => !removedInfoIds.has(node.value));

  doc.roots = doc.roots.filter(node => {
    if (node.tag !== 9) return true;
    return !removedInfoIds.has(node.id) && !removedNodeIds.has(node.id);
  });

  // 真实库的 sitemap 是"文件夹树"：页节点挂在父 Axure:Node 的 body.children 里，
  // 只改 tree.children 会留下指向已删 node 的悬空 ref（Axure 侧 RPTreeMapNode.ChildNodes NPE）。
  // 统一剪掉 dd 图里指向已删对象 id 的所有 tag-3 引用。
  const deadIds = new Set([...removedInfoIds, ...removedNodeIds]);
  const pruneList = list => {
    if (!Array.isArray(list)) return list;
    return list.filter(item => !(item && item.tag === 3 && deadIds.has(item.value)));
  };
  const walkPrune = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.items)) node.items = pruneList(node.items);
    for (const pair of node.entries ?? []) {
      if (pair[1] && pair[1].tag === 3 && deadIds.has(pair[1].value)) pair[1] = { tag: 3, value: 0 };
      walkPrune(pair[1]);
    }
    if (node.body) walkPrune(node.body);
  };
  for (const node of doc.roots) walkPrune(node);

  // 3) manifest：删子树 + 平移 parts
  const removedKeys = new Set([...targetGuids].filter(Boolean).map(guidKey));
  const removedParts = detachManifestSubtrees(manifest.value.root, removedKeys);
  const removals = removedParts
    .map(part => ({ offset: part.offset, size: 8 + (recordByOffset.get(part.offset)?.compressedSize ?? 0) }))
    .sort((a, b) => a.offset - b.offset);
  shiftParts(manifest.value.root, removals);

  // 4) 重组：新 manifest + 原记录区（挖掉被删区间）
  const newManifest = encodeManifest(file, manifest.value);
  const base = manifest.dataStart;
  const chunks = [newManifest];
  let cursor = base;
  for (const span of removals) {
    chunks.push(file.subarray(cursor, base + span.offset));
    cursor = base + span.offset + span.size;
  }
  chunks.push(file.subarray(cursor));
  let out = Buffer.concat(chunks);

  // 5) 用新 dd 覆盖旧 dd 记录
  const docNow = readRecords(out).find(r => r.className === 'Axure:DesignDocument');
  out = replaceRecord(out, docNow, encodeRecord(docNow, docRec.strings, encodePayload(doc.roots)));
  return { file: out, removed: [...new Set(targets.map(t => t.name))], removedCount: targets.length, missing };
}

/** 该文件里所有页名（供 CLI 报告用）。 */
export function pageNames(file) {
  return listSourcePages(readRecords(file)).map(p => p.name).filter(Boolean);
}
