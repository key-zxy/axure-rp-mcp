// .rp / .rplib 一致性检查：容器探测、写入守卫、命令声明、页 CRUD（有真实库基座时）。
// 真实库基座不随仓库分发：设置 AXURE_LIBRARY_SEED=/path/to/library.rplib 才会跑这一组，
// 否则只跑不依赖 Axure 文件的检查（CI 默认走这条）。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerKind, requireWritableContainer } from '../scripts/rp-records.mjs';
import { listCommands } from '../scripts/registry.mjs';
import { removePages, pageNames } from '../scripts/page-ops.mjs';
import { appendPages } from '../scripts/append-pages.mjs';
import { buildBlankLibrary } from '../scripts/create-blank-library.mjs';

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); console.log('PASS ', name); }
  catch (error) { checks.push({ name, ok: false }); console.log('FAIL ', name, '—', error.message); }
}
function skip(name, reason) { console.log('SKIP ', name, '—', reason); }

const seed = process.env.AXURE_LIBRARY_SEED;

check('containerKind distinguishes manifest / bare / invalid', () => {
  const manifest = Buffer.alloc(32); manifest[0] = 0xac; manifest[1] = 0xef;
  const bare = Buffer.alloc(64); bare.writeUInt32LE(40, 0); bare[4] = 0x1f; bare[5] = 0x8b; bare[6] = 0x08;
  assert.equal(containerKind(manifest), 'manifest');
  assert.equal(containerKind(bare), 'bare');
  assert.equal(containerKind(Buffer.from('not an axure file')), 'invalid');
  assert.equal(containerKind(Buffer.alloc(4)), 'invalid');
});

check('requireWritableContainer rejects bare-stream .rplib with a clear message', () => {
  const bare = Buffer.alloc(64); bare.writeUInt32LE(40, 0); bare[4] = 0x1f; bare[5] = 0x8b; bare[6] = 0x08;
  assert.throws(() => requireWritableContainer(bare), /裸流/);
  assert.throws(() => requireWritableContainer(Buffer.from('junk')), /不是 Axure/);
  const manifest = Buffer.alloc(32); manifest[0] = 0xac; manifest[1] = 0xef;
  assert.equal(requireWritableContainer(manifest), 'manifest');
});

check('record/widget-level commands declare both containers', () => {
  const commands = new Map(listCommands().map(c => [c.command, c.usage]));
  const mustDeclare = [
    'set-widget-text', 'set-widget-richtext', 'name-widget', 'add-interaction', 'remove-interaction',
    'add-click-link', 'set-combobox-options', 'set-listbox-options', 'set-native-table',
    'clone-native-connector', 'set-connector-anchors', 'fill-panel-state', 'remove-panel-state-content',
    'set-panel-fit-to-content', 'patch-link-window', 'patch-string',
    'append-pages', 'remove-page', 'create-blank-page', 'duplicate-page', 'create-blank-library',
  ];
  for (const command of mustDeclare) {
    const usage = commands.get(command);
    assert.ok(usage, `${command} 未登记`);
    assert.match(usage, /rplib/, `${command} 的 usage 未声明 .rplib`);
  }
});

check('project-only commands stay .rp-only', () => {
  const commands = new Map(listCommands().map(c => [c.command, c.usage]));
  for (const command of ['create-blank-project', 'create-master', 'set-master-overrides', 'create-global-variable']) {
    const usage = commands.get(command);
    assert.ok(usage, `${command} 未登记`);
    assert.doesNotMatch(usage, /rplib/, `${command} 不应声明 .rplib`);
  }
});

if (!seed || !existsSync(seed)) {
  skip('page CRUD against a real library', '设置 AXURE_LIBRARY_SEED 指向一份 RP9 库后运行');
} else {
  const work = mkdtempSync(join(tmpdir(), 'axure-parity-'));
  try {
    const seedBuf = readFileSync(seed);
    const names = pageNames(seedBuf);

    check('create-blank-library empties a seed library', () => {
      const result = buildBlankLibrary(seedBuf);
      assert.equal(result.pages.length, 0);
      assert.equal(containerKind(result.file), 'manifest');
    });

    check('remove-page empties a library and keeps it parseable', () => {
      const result = removePages(seedBuf, names);
      const remaining = pageNames(result.file);
      assert.equal(remaining.length, 0, `剩余页: ${remaining.join(', ')}`);
      assert.equal(containerKind(result.file), 'manifest');
    });

    if (names.length < 2) {
      skip('append-pages adds a missing page into a library base', '基座只有 1 页，无法先摘一页再追加（脚手架需要 ≥1 页）');
    } else {
      check('append-pages adds a missing page into a library base', () => {
        const basePath = join(work, 'base.rplib');
        const baseBuf = removePages(seedBuf, [names[0]]).file;
        writeFileSync(basePath, baseBuf);
        const baseCount = pageNames(baseBuf).length;
        const sourcePath = join(work, 'source.rplib');
        writeFileSync(sourcePath, seedBuf);
        const result = appendPages({ target: basePath, source: sourcePath, pages: [names[0]] });
        assert.equal(result.appended.length, 1);
        assert.equal(pageNames(result.buf).length, baseCount + 1);
      });
    }

    check('append-pages is a no-op when the page already exists', () => {
      const targetPath = join(work, 'seed.rplib');
      writeFileSync(targetPath, seedBuf);
      const result = appendPages({ target: targetPath, source: targetPath, pages: [names[0]] });
      assert.equal(result.buf, null);
      assert.equal(result.skipped.length, 1);
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const failed = checks.filter(c => !c.ok).length;
console.log(JSON.stringify({ total: checks.length, passed: checks.length - failed, failed }));
process.exitCode = failed ? 1 : 0;
