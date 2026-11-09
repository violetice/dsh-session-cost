# dsh-session-cost

[English](README.en.md) | 中文

在 DeepSeek Harness（DSH）Web 侧栏底部添加一个「成本」入口：按 **会话** 与 **工作区** 展示 token 用量和成本估算，并按 DeepSeek 官方的 **峰 / 谷** 分时单价分别计价。

<p align="center"><img src="assets/cost.svg" alt="由 DeepSeek V4.1 Flash 开发，目前累计花费 1.43 元"></p>

## 功能

- 侧栏底部「成本」按钮，点开浮层面板；侧栏收窄时只显示图标。
- 按工作区分组，`rf4`、`charge-power` 这类子目录各自独立成组，组内按会话列出支出。
- 每个会话按实际调用的 model 分桶，标签上直接显示该 model 的单独花费。
- 每次调用用自身时间戳判定 **峰 / 谷**，同一会话跨时段会自动拆价。
- 子代理会话默认折叠，父会话列表保持干净。
- 打开即取数，之后每 30 秒刷新一次，也可手动刷新。
- 中文 / 英文界面跟随 DSH 语言实时切换。

## 安装

需要 DSH 的 `plugin_manager`（或手工改 profile）：

```text
plugin_manager install_bundle target: <本仓库绝对路径>
```

手工方式：在 profile 的 `package.json` 中加入依赖与 bundle，然后 `pnpm install` 并重启 DSH。

```json
{
  "dependencies": { "dsh-session-cost": "link:/abs/path/to/dsh-session-cost" },
  "dsh": { "profile": { "bundles": ["dsh-session-cost"] } }
}
```

安装后刷新页面，入口在左侧栏底部、设置按钮旁边。

## 数据来源

全部只读，不写任何业务数据：

| 维度 | 来源 |
|---|---|
| 会话与事件 | `ctx.sessionQuery`（`listSessions` / `readSession` / `readTitleSnapshots`），覆盖在线与已持久化会话 |
| 工作区与标题 | `ctx.workspaceRegistry.list()` |
| token | 每条 `assistant/message` 事件里的 `usage` |
| 成本 | token × 单价，逐次调用计算后累加 |

fork 出来的会话会复制父会话的历史事件，`inheritedEventCount` 之前的事件不计费，避免重复。

## 计价

单价单位为「每 100 万 token」，内置 DeepSeek 官方价（CNY）：

| 模型 | 时段 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|---|
| deepseek-flash | 峰 | 0.04 | 2 | 8 |
| deepseek-flash | 谷 | 0.02 | 1 | 4 |
| deepseek-v4-pro | 峰 | 0.3 | 9 | 27 |
| deepseek-v4-pro | 谷 | 0.15 | 4.5 | 13.5 |

- **峰**：北京时间周一至周五 09:00–12:00、14:00–18:00，法定节假日除外。
- **谷**：其余所有时段（含周末），价格为峰的一半。
- 节假日无法从系统日历推断，在单价文件的 `holidays` 中列出日期即可。

覆盖内置单价：把 [`pricing.example.json`](pricing.example.json) 复制到 `$DSH_HOME/storages/session-cost-pricing.json` 后修改。

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

查表顺序 `provider/model` → `model` → `provider/*` → `*`；一个模型也可写扁平的 `{ input, output, cacheRead, cacheWrite }` 表示两段同价。改完下次刷新即生效，无需重启。

## HTTP API

仅监听回环地址：

```text
GET /session-cost/api/summary             # 8 秒内存缓存
GET /session-cost/api/summary?refresh=1   # 强制重算
GET /session-cost/api/locales             # 界面词典
```

## 限制

- 金额是按单价表估算的，不等于厂商实际扣费，也无法还原阶梯价。
- 只统计会话日志里带 `usage` 的调用；失败重试的 `assistant/attempt` 没有 usage，不计入。
- 活跃会话每次刷新都会重读，非活跃会话按会话缓存。

## 目录

```text
index.js              Host 半区：聚合、单价、HTTP API
client.js             Client 半区：侧栏按钮 + 浮层面板
locale/en.json        英文界面与插件元数据
locale/zh.json        简体中文界面与插件元数据
pricing.example.json  单价覆盖示例
cordis.patch.yml      bundle 的 Loader 补丁
```

修改后需重装 bundle 并刷新页面；Host 代码的改动需要重启 DSH。

## 许可

[MIT](LICENSE)
