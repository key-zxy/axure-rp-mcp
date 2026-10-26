# axure-rp-mcp · MCP 快速接入

把 Axure `.rp / .rplib` 的读写能力接到 Agent（Claude Code / Cursor / 其它支持 stdio MCP 的客户端）。
本项目源自 [zee-rp](https://github.com/LilZeeCN/zee-rp)（MIT）；差异见 [CHANGELOG](CHANGELOG.md)。

## 1. 环境

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 18 | 必需 |
| Axure RP 9 / 11 | 已安装 | 原生模板/元件库来源；RP9 默认读 `C:\Program Files (x86)\Axure\Axure RP 9\DefaultSettings`，可设 `AXURE_APP_RP9` / `AXURE_APP_RP11` 指到安装根目录 |
| Python | ≥ 3.10（可选） | 仅 RP/1 语言与 `proto.*` 生成命令需要；`rp-read`、`merge-pages`、`append-library-pages`、`hide-widgets` 等纯 Node 命令不需要 |
| 依赖 | `npm ci --ignore-scripts`（或 `npm install`） | 只装可选的 `@modelcontextprotocol/sdk`；核心 CLI 不依赖它 |

## 2. 注册

```json
{
  "mcpServers": {
    "axure-rp-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/axure-rp-mcp/bin/mcp.mjs"],
      "env": {
        "AXURE_APP_RP9": "C:/Program Files (x86)/Axure/Axure RP 9"
      }
    }
  }
}
```

Windows 路径用双反斜杠或正斜杠；`env` 可省略（默认即上面的 RP9 路径）。
`mcp.example.json` 是同内容的示例文件。

## 3. 工具概览

`tools/list` 覆盖 CLI 注册表（一个命令一个工具）+ 少量会话工具。与存量文件直接相关的：

| 工具 | 用途 |
|---|---|
| `rp_read` | 解析 `.rp / .rplib`（`--full` 带原始字段；`--json` 结构化） |
| `verify` / `locate` / `inspect` / `edit_text` / `rename_widget` | 会话式检查与就地改写 |
| `append_library_pages` | **`.rp` → `.rplib`**：增量追加页，既有库页字节不动，写完自检 |
| `hide_widgets` | 按清单把元件设为隐藏（原生 `VISIBLE=false`） |
| `clone_library_widget` / `clone_library_page_content` | 从 `.rplib` 把库页/控件闭包导入 `.rp` |
| `proto_*` / `generate_from_image` | RP/1 spec / 截图 → 原生 `.rp`（需 Python + 本机 Axure 模板） |

## 3.1 容器一致性（`.rp` / `.rplib`）

RP9 的 `.rplib` 与 `.rp` 是同一容器；记录/元件级写入与**页级 CRUD**对两者都成立：

| 能力 | `.rp` | `.rplib` |
|---|---|---|
| 解析、样式读写、元件级改写（改字/改名/富文本/交互/控件/表格/连接线/面板内容） | ✅ | ✅ |
| 页 CRUD：`create-blank-page` / `duplicate-page` / `append-pages` / `remove-page` / `create-blank-library` | ✅ | ✅ |
| 库专属：`append-library-pages` / `hide-widgets` / `clone-library-*` | —（hide 通用） | ✅ |
| 工程专属：`create-blank-project` / 母版 / 自适应 / `proto` 生成 | ✅ | ❌（用法只声明 `.rp`） |
| 裸流 `.rplib`（无 manifest 老变体） | — | ⚠️ 只读（写入会明确报错） |

`AXURE_LIBRARY_SEED=/path/to/library.rplib npm run test:parity` 可跑真实库的页 CRUD 检查（默认跳过）。

## 4. 命令行等价入口

```bash
node bin/axure.mjs --help
node bin/axure.mjs rp-read <file.rp|rplib> --json
# 多页工程装配（库脚本，直接跑；file:页名 = 选中该页，缺页报错）
node scripts/merge-pages.mjs -o <merged.rp> <base.rp> <other.rp:PageName>
node bin/axure.mjs append-library-pages <base.rplib> <source.rp> <out.rplib> [--pages a,b,c] [--json]
node bin/axure.mjs hide-widgets <source.rp> <output.rp> <targets.json> [--json] [--strict]
```

## 5. 已知边界

- `.rplib` 写入已在文件层与 Axure 程序集加载层验证；RP9 `Libraries` 面板中的呈现形态仍需在 GUI 确认。
- 裸流 `.rplib`（无 manifest 的老变体）只读，不写。
- 超大库（如 `Icons.rplib`）解析会带既有 dangling-ref 告警，不影响读取。
