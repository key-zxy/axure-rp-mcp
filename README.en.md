<div align="center">

<img src="assets/readme/hero.svg" alt="axure-rp-mcp — Describe. Compile. Keep editing." width="100%">

<h1>Let AI build a prototype<br>you can keep editing in Axure.</h1>

From a sentence or a screenshot to a native **`.rp`** with pages, variables and interactions.<br>
Write the design in **RP/1**, generate it with **MCP / CLI**, keep editing it in **Axure**.

[![MIT](https://img.shields.io/badge/license-MIT-142033?style=flat-square)](LICENSE)
[![Repo](https://img.shields.io/badge/repo-key--zxy%2Faxure--rp--mcp-304FFE?style=flat-square)](https://github.com/key-zxy/axure-rp-mcp)

[Repository](https://github.com/key-zxy/axure-rp-mcp) · [MCP setup](README-MCP.md) · [Changes vs upstream](#changes-vs-upstream-zee-rp) · [RP/1 reference](references/rp-language.md) · [中文](README.md)

</div>

## Changes vs upstream zee-rp

This project starts from [zee-rp](https://github.com/LilZeeCN/zee-rp) (MIT). Everything not listed below behaves the same.

| Change | What it does |
| :--- | :--- |
| Rename & packaging | Package / bins / MCP server name are `axure-rp-mcp` (CLI `axure-rp-mcp`, server `axure-rp-mcp-server`), version `0.2.2` |
| **New `append-library-pages`** | Append pages from a `.rp` into a `.rplib` widget library: existing library pages keep their bytes, only pages missing by name are added, and the result is self-checked (page count + name resolution). No new pages → no output file |
| **New `hide-widgets`** | Hide widgets from a `[{page?, name, x, y, w, h}]` list by writing the native `MyStyle VISIBLE=false`; matches by page + geometry first, then name. Unmatched targets are reported (`--strict` to fail) |
| `merge-pages` page selection fix | `<file>:<page>` used to only rename and silently copy the first page; it now really selects that page and throws `[ERR_SOURCE_PAGE_NOT_FOUND]` with the available names |
| Page-level flags | RP/1 pages accept optional `background` / `frame` (default `true`, unchanged when omitted): `background:false` drops the full-page background rect, `frame:false` drops the `frame-<name>` wrapper |
| Docs & registry | Adds [README-MCP.md](README-MCP.md) + `mcp.example.json`; registry, command table, SKILL and release manifest updated |

Full list: [CHANGELOG](CHANGELOG.md).

## MCP setup in 30 seconds

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

Requires **Node.js 18+**; native generation also needs **Python 3.10+** and a local **Axure RP9** (set `AXURE_BLANK_TEMPLATE_RP9`, or `AXURE_APP_RP9` to the install root on Windows). Install deps with `npm ci --ignore-scripts`. Details in [README-MCP.md](README-MCP.md); the agent entry point is [SKILL.md](SKILL.md).

## What it does

| Task | How |
| :--- | :--- |
| Multi-page prototypes from a brief | Write pages/layout/data/events in RP/1, generate a native `.rp` |
| Rebuild from a screenshot | OCR + layout detection; text and supported geometry become native widgets, photos stay images |
| Read / write existing files | Parse `.rp` / `.rplib`; edit text, names, styles; append `.rp` pages into a `.rplib` |
| Library maintenance | Import library pages/widgets into `.rp`, hide what you do not need, self-checked library writes |
| Second-round design | Rebuild from source, or merge native edits within the supported scope |
| Verify before delivery | Layout audit, reference check, offline preview and native open are recorded separately |

Minimal RP/1 sample (save as `birding.rp1`):

```text
rp/1 target=9 name="Birding" domain=mobile theme=mobile-hifi

page #home name="Discover" device=iphone-17-pro
  phone-shell #shell title="Meet a kingfisher today" gap=16
    card #bird [fillxhug] title="Start with a flash of blue" actionText="Note this sighting" goto="notes"

page #notes name="Journal" device=iphone-17-pro
  phone-shell #shell title="My first note" gap=16
    input #note [fillx44] value="Met one by the river today."
```

```sh
export AXURE_BLANK_TEMPLATE_RP9=/absolute/path/my-rp9-blank.rp
node scripts/proto.mjs check --spec birding.rp1
node scripts/proto.mjs generate --spec birding.rp1 --out-dir outputs/birding --out-rp outputs/birding/birding.rp
node bin/axure.mjs rp-read outputs/birding/birding.rp --json
```

## Verification and limits

"Parses", "opens in Axure", "clicks in a browser" and "survives save + reopen" are four separate claims, each with its own evidence. Native generation targets **RP9** (readers/writers follow the file version). Visually, RP/1 has no `fontFamily` yet, and image radius/shadow/gradient are rendered through embedded bitmaps.

[Capabilities](references/capabilities.md) · [Verification](docs/verification.md) · [Command table](references/commands-generated.md) · [Changelog](CHANGELOG.md)

## License and origin

Source and original examples are [MIT](LICENSE). This project starts from [zee-rp](https://github.com/LilZeeCN/zee-rp) and keeps its copyright and attribution. Third-party photo credits live in [image notes](assets/readme/README.md); the promo video notes are in [promo assets](assets/promo/README.md). Not affiliated with Axure; templates, official libraries, fonts and runtimes are provided by your own machine.
