<div align="center">

<img src="assets/readme/hero.svg" alt="axure-rp-mcp — Describe. Compile. Keep editing." width="100%">

<h1>让 AI 画出原型，<br>在 Axure 里继续改。</h1>

从一句需求、一张截图，到带页面、变量和交互的原生 **`.rp`**。<br>
用 **RP/1** 写设计，用 **MCP / CLI** 生成，打开 **Axure** 接着改。

[![MIT](https://img.shields.io/badge/license-MIT-142033?style=flat-square)](LICENSE)
[![Repo](https://img.shields.io/badge/repo-key--zxy%2Faxure--rp--mcp-304FFE?style=flat-square)](https://github.com/key-zxy/axure-rp-mcp)

[仓库](https://github.com/key-zxy/axure-rp-mcp) · [MCP 接入](README-MCP.md) · [与上游差异](#与上游-zee-rp-的差异) · [RP/1 手册](references/rp-language.md) · [English](README.en.md)

</div>

## 与上游 zee-rp 的差异

本项目源自 [zee-rp](https://github.com/LilZeeCN/zee-rp)（MIT），在它的能力之上做了下面几处增补；未列出的行为与上游一致。

| 改动 | 说明 |
| :--- | :--- |
| 改名与打包 | 包名 / bin / MCP server 名统一为 `axure-rp-mcp`（`axure-rp-mcp` CLI、`axure-rp-mcp-server` MCP），版本 `0.2.2` |
| **新增 `append-library-pages`** | 把 `.rp` 的页增量写进 `.rplib` 控件库：既有库页记录字节不动，默认只追加"库里没有的页名"，写完自检页数与页名；无新增不落盘 |
| **新增 `hide-widgets`** | 按 `[{page?, name, x, y, w, h}]` 清单隐藏元件，写原生 `MyStyle VISIBLE=false`；先按「页 + 几何」再退化到「页 + 名字」匹配，未命中默认只报告（`--strict` 才失败） |
| 修复 `merge-pages` 选页 | `file:页名` 以前只改名、实际复制源文件第一页（内容与页名不符且静默）；现在真正按页名选中，缺页抛 `[ERR_SOURCE_PAGE_NOT_FOUND]` 并列出可用页 |
| 页面级开关 | RP/1 页面新增可选 `background` / `frame`（缺省 `true`，不写时行为不变）：`background:false` 不发射整页底板，`frame:false` 不发射 `frame-<名>` 包裹层 |
| 文档与登记 | 新增 [README-MCP.md](README-MCP.md) 与 `mcp.example.json`；registry / 命令表 / SKILL / 变更记录同步；发布清单与基线指纹已重算 |

完整改动见 [CHANGELOG](CHANGELOG.md)。

## 30 秒接入 MCP

```json
{
  "mcpServers": {
    "axure-rp-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/axure-rp-mcp/bin/mcp.mjs"],
      "env": { "AXURE_BLANK_TEMPLATE_RP9": "/absolute/path/my-rp9-blank.rp" }
    }
  }
}
```

需要 **Node.js 18+**；生成原生工程另需 **Python 3.10+** 与本机 **Axure RP9**（模板路径可用 `AXURE_BLANK_TEMPLATE_RP9` 指定，Windows 下可设 `AXURE_APP_RP9` 指到安装根目录）。依赖：`npm ci --ignore-scripts`。详细步骤见 [README-MCP.md](README-MCP.md)，Agent 创作入口是 [SKILL.md](SKILL.md)。

## 能做什么

| 你想做的事 | axure-rp-mcp 的做法 |
| :--- | :--- |
| 从需求搭多页原型 | 用 RP/1 写页面/布局/数据/事件，一次生成原生 `.rp` |
| 从截图开始重建 | OCR + 布局识别；文字与支持的几何成为原生元件，照片保留为独立图片 |
| 读 / 写存量文件 | 解析 `.rp` / `.rplib`；改字、改名、改样式；按需把 `.rp` 页增量写进 `.rplib` |
| 元件库维护 | 库页/控件闭包导入 `.rp`；隐藏不需要的元件；库写入带上自检 |
| 第二轮设计 | 改源码重建，或在已支持范围内合并原生改稿 |
| 交付前确认 | 布局审计、引用检查、离线预览、原生打开分别留证据 |

最短的 RP/1 示例（保存为 `birding.rp1` 后用 CLI 生成）：

```text
rp/1 target=9 name="观鸟" domain=mobile theme=mobile-hifi

page #home name="发现" device=iphone-17-pro
  phone-shell #shell title="今天，认识一只翠鸟" gap=16
    card #bird [fillxhug] title="从水边的一抹蓝绿开始" actionText="记下这次遇见" goto="notes"

page #notes name="手记" device=iphone-17-pro
  phone-shell #shell title="我的第一篇手记" gap=16
    input #note [fillx44] value="今天在水边遇见了它。"
```

```sh
export AXURE_BLANK_TEMPLATE_RP9=/absolute/path/my-rp9-blank.rp
node scripts/proto.mjs check --spec birding.rp1
node scripts/proto.mjs generate --spec birding.rp1 --out-dir outputs/birding --out-rp outputs/birding/birding.rp
node bin/axure.mjs rp-read outputs/birding/birding.rp --json
```

## 验证与边界

"能解析 / 能在 Axure 打开 / 能在浏览器点击 / 能保存重开"是四件分别需要证据的事；本工具分别记录，不会互相代替。原生生成目标为 **RP9**（读写按文件版本处理）；视觉上 RP/1 暂无 `fontFamily`，图片圆角/阴影/渐变以嵌入位图呈现。

[能力范围](references/capabilities.md) · [验证记录](docs/verification.md) · [命令表](references/commands-generated.md) · [变更记录](CHANGELOG.md)

## 许可与来源

源码与原创示例采用 [MIT](LICENSE)。本项目源自 [zee-rp](https://github.com/LilZeeCN/zee-rp)，保留其版权与署名；案例中的第三方照片许可单列于 [图片署名](assets/readme/README.md)，流程片说明见 [宣传素材](assets/promo/README.md)。与 Axure 无隶属关系；模板、官方元件库、字体和运行时由使用者本机提供。
