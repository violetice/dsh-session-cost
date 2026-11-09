# dsh-session-cost

English | [中文](README.md)

Adds a **Cost** entry at the bottom of the DeepSeek Harness (DSH) Web sidebar: token usage and estimated spend per **session** and per **workspace**, priced with DeepSeek's **Peak / Off-peak** rates.

## Features

- A **Cost** button at the sidebar foot opens a floating board; in the collapsed rail it shows the icon only.
- Workspaces are listed separately, so sub-directories such as `rf4` and `charge-power` get their own group; sessions sit under their workspace.
- Every session is bucketed by the model it actually called, and the model chip shows that model's own spend.
- Each call is priced by its own timestamp against the Peak / Off-peak windows, so one session can span both.
- Subagent sessions are folded behind a single toggle.
- The board loads on open, then refreshes every 30 seconds; it can also be refreshed manually.
- Chinese / English UI follows the DSH language and switches live.

## Install

Use DSH's `plugin_manager` (or edit the profile by hand):

```text
plugin_manager install_bundle target: <absolute path to this repository>
```

Manual install: add the dependency and bundle to the profile's `package.json`, then `pnpm install` and restart DSH.

```json
{
  "dependencies": { "dsh-session-cost": "link:/abs/path/to/dsh-session-cost" },
  "dsh": { "profile": { "bundles": ["dsh-session-cost"] } }
}
```

After installing, refresh the page; the entry sits beside Settings at the bottom of the left sidebar.

## Data sources

Read-only, nothing is written:

| Dimension | Source |
|---|---|
| Sessions and events | `ctx.sessionQuery` (`listSessions` / `readSession` / `readTitleSnapshots`), live and persisted |
| Workspaces and titles | `ctx.workspaceRegistry.list()` |
| Tokens | the `usage` of every `assistant/message` event |
| Cost | tokens × rate, summed per call |

Forked sessions copy their parent's history; events before `inheritedEventCount` are excluded so the same usage is never billed twice.

## Pricing

Rates are per 1,000,000 tokens and ship with DeepSeek's official CNY prices:

| Model | Window | Cache hit | Cache miss | Output |
|---|---|---|---|---|
| deepseek-flash | Peak | 0.04 | 2 | 8 |
| deepseek-flash | Off-peak | 0.02 | 1 | 4 |
| deepseek-v4-pro | Peak | 0.3 | 9 | 27 |
| deepseek-v4-pro | Off-peak | 0.15 | 4.5 | 13.5 |

- **Peak**: Beijing time, Monday to Friday 09:00–12:00 and 14:00–18:00, excluding statutory holidays.
- **Off-peak**: every other moment, including weekends, at half the Peak rate.
- Holidays cannot be derived from the system calendar; list the dates in the pricing file's `holidays`.

To override the built-in rates, copy [`pricing.example.json`](pricing.example.json) to `$DSH_HOME/storages/session-cost-pricing.json` and edit it.

```json
{
  "currency": "CNY",
  "holidays": ["2026-10-01"],
  "models": {
    "deepseek-flash": {
      "peak": { "input": 2, "output": 8, "cacheRead": 0.04, "cacheWrite": 0 },
      "offPeak": { "input": 1, "output": 4, "cacheRead": 0.02, "cacheWrite": 0 }
    }
  }
}
```

Lookup order is `provider/model` → `model` → `provider/*` → `*`. A model may also use a flat `{ input, output, cacheRead, cacheWrite }` entry to apply one rate to both windows. Changes apply on the next refresh; no restart needed.

## HTTP API

Loopback only:

```text
GET /session-cost/api/summary             # 8-second in-memory cache
GET /session-cost/api/summary?refresh=1   # force recompute
GET /session-cost/api/locales             # UI dictionaries
```

## Limitations

- Spend is an estimate from the price table, not the provider's invoice; tiered pricing is not modelled.
- Only calls with a recorded `usage` count; failed `assistant/attempt` events carry none.
- Live sessions are re-read on every refresh; inactive sessions are cached.

## Layout

```text
index.js              Host: aggregation, pricing, HTTP API
client.js             Client: sidebar button + overlay board
locale/en.json        English UI and plugin metadata
locale/zh.json        Simplified Chinese UI and plugin metadata
pricing.example.json  Pricing override example
cordis.patch.yml      Loader patch for the bundle
```

Reinstall the bundle and refresh the page after changes; Host changes need a DSH restart.

## License

[MIT](LICENSE)
