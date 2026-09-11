---
description: "在设置里选择本地 HTTP 代理端口，而不必导出 HTTPS_PROXY：http-proxy 设置段、导出变量优先的时机，以及改端口如何让 harness 即刻改道。"
kind: "package-reference"
---

# @deepseek-ai/dsh-proxy-port

[English](README.md) | 中文

## 概述

当 harness 需要经由本地代理联网、且端口由用户在设置里选择而非导出 `HTTPS_PROXY` 时，挂载本插件。它发布通用设置**代理端口**行所编辑的 `http-proxy` 段，并为该端口安装 harness 的出站代理策略，因此改动立即生效。已导出的 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY` 始终优先于所存端口；卸载插件后恢复直连。它不注册任何智能体工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh-base` patch 在 settings 行之后挂载本插件，因此组合了 base bundle 的 profile 无需其他配置即可获得设置行及其驱动的路由。

### 何时选用

当运行 harness 的人经由某个代理应用联网、该应用暴露一个本地 HTTP 端口（Clash 与 V2Ray 称之为混合端口），并希望在界面里改这个端口而不是改 shell 配置时，选用本插件。不要用它替代已导出的代理变量：环境里已指定代理时，路由权仍归环境，本插件只发布该设置段。想让环境成为唯一来源的部署根本不需要本插件；`dsh` 启动器已为每个 profile 安装 `@deepseek-ai/dsh-http-proxy`。

### 最小配置

```yaml
- id: proxy-port
  name: '@deepseek-ai/dsh-proxy-port'
  config:
    port: 7897
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `port` | `7897` | 用户设置文档没有覆盖时，该设置段的组合默认值 |

生成的[配置目录](../../../docs/config-catalog.zh.md)列出全部可接受字段。`port` 必须是 1–65535 的整数；组合值超出该范围会使插件加载失败，而不是静默回退。

### `http-proxy` 设置段

插件注册 `http-proxy` namespace，只有一个即时生效字段 `port`，默认 `7897`。通用设置里的**代理端口**行绑定该 namespace，显示解析后的端口，并通过 settings scope 写回 `port`；插件监视该设置段，只要解析值变化就重新安装策略。该行是浏览器侧界面：其标记由 `packages/client/ui-settings-general` 拥有，而 namespace 名、字段名与默认值是两半之间的契约。

### 它对出站 HTTP 做了什么

设置段已注册、且启动环境未指定代理变量时，插件以一份 lookup 调用 `@deepseek-ai/dsh-http-proxy` 的 `installProxyFromEnvironment`，该 lookup 为每个空的代理槽位返回 `http://127.0.0.1:{port}`。此后所有经 Node `fetch` 的 harness 请求都走该端口：模型调用、web 搜索、`web_fetch`、HTTP MCP 服务器与 E2B SDK，与 `docs/user/guide/network-proxy.md` 对导出变量的描述完全一致。loopback 始终绕过，`NO_PROXY` 条目保持其含义，派生子进程通过环境获得解析后的策略。

有两处行为与本包所取代的旧个人插件不同。官方 0.1.5 路由没有“先直连再回退”：已配置代理即按代理发送，代理连不上就使该请求失败，而不会改为直连重试。另外，本插件只拥有端口——它不包装 `globalThis.fetch`，也不构造 undici dispatcher，因此每个进程只有一份路由实现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本插件是一个薄而带状态的一次库调用适配层。`apply` 通过 `launchEnvironmentOf(ctx)` 读取启动环境，由组合 config 或 `DEFAULT_PROXY_PORT` 解析出起始端口，注册 `http-proxy` 设置段，随后按该设置段解析出的端口安装策略——先注册设置段，是为了让已存端口直接生效，而不必先用组合默认值路由一瞬。

每次安装都经过同一个串行化 transition：若环境已指定代理，或该端口已在路由，transition 什么都不做；否则先释放上一次安装，再为当前端口安装策略。释放正是设置段即时生效的原因：`installProxyFromEnvironment` 返回的 disposer 会恢复上一个 dispatcher、策略与环境，而插件在运行它之前会等待 transition 队列排空，因此改端口不会与卸载交错。在一次安装等待 undici 动态导入期间落地的提交会被丢弃而不发布，这就是 transition 在该 await 之后重新检查端口的原因。

| 文件 | 内容 |
|---|---|
| `src/index.ts` | 插件接口：`name`、`Config`、`apply`、`http-proxy` 设置段 schema，以及串行化的安装 transition。 |
| `src/environment.ts` | `hasExplicitProxy` 与 `withLocalProxyPort` —— 本包对启动环境所做的唯一变换。 |
| `src/constants.ts` | namespace、字段、默认端口，以及 config 与 schema 共用的端口辅助函数。 |

这里不做解析、匹配或派发：策略由 `resolveProxyPolicy` 决定，某个 URL 的去向由 `proxyForUrl` 决定，实际请求由已安装的 undici `Agent` 完成。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [在代理后运行 DSH](../../../docs/user/guide/network-proxy.zh.md) —— 该导出哪些变量、哪些流量保持直连，以及为何浏览器走代理而终端不走。
- [`dsh-http-proxy`](../../util/http-proxy/README.zh.md) —— 本插件所安装的解析器、dispatcher 与子进程环境构造器。
- [`dsh-settings-file`](../../settings/settings-file/README.zh.md) —— 把 `http-proxy` 段持久化到 `$DSH_HOME/settings.yaml` 的提供方。
- [通用设置界面](../../client/ui-settings-general/README.zh.md) —— 编辑该端口的那一行。
- [`dsh-base`](../../bundle/base/README.zh.md) —— 在 `settings` 之后挂载本行的 patch。
- [唯一的出站代理策略](../../../.agents/notes/implemented/architecture/2026-08-27-outbound-proxy-policy.zh.md) —— 为何官方路由是进程级且由环境解析的。

-----

<a id="model-experience"></a>
## 模型体验

### 出站传输策略

#### 模型看到什么

无：插件不注册工具、提示词段或 session 事件，模型请求中没有任何字段来自 `http-proxy` 端口。

#### Token 影响

无：让请求经 `127.0.0.1` 只是换了承载字节的套接字，字节本身不变。

#### KV Cache 影响

无：本包既不组装请求也不改动请求前缀，因此提供方缓存复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了何时不应挂载本插件。

- **已配置代理即直接使用，没有先直连再回退** —— 官方 0.1.5 路由在配置了代理时按代理发送，因此代理应用停掉会让请求失败，而直连本可服务它。旧个人插件先试目标、再回退到代理；该行为在此刻意不恢复。
- **环境代理变量优先，包括解析器拒绝的值** —— 只要 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY` 被设为任何非空值，本插件就不安装，因此 `socks5://` 值会让该协议保持直连，设置里的端口不起作用。
- **只有在组合了 settings 提供方的地方端口才可编辑** —— 没有 `ctx.settings` 时插件仍按组合 config 端口路由，但没有任何界面能改它。
- **改端口不会移动已派发的请求** —— 上一个 dispatcher 是被关闭而非销毁，因此在途请求仍在其上完成，之后的请求才使用新端口。
- **重新安装失败会让进程回到直连** —— 上一个策略会先被释放，再尝试安装新策略，因为官方 disposer 会恢复它所顶替的 dispatcher；失败会记录到插件日志，下一次提交端口或重启后会重新安装。
- **子进程与模型编写的代码保持自己的可达性** —— 派生子进程通过环境获得解析后的策略，而 code-runtime 与 workflow worker 按设计不获得，因为代理 URL 可能带凭据。
- **环境不是证书颁发机构** —— 拦截 TLS 的代理需要在进程启动前设置 `NODE_EXTRA_CA_CERTS`，本插件既不设置也不校验它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本插件之所以存在，是因为设置界面需要宿主侧的一半。上游 0.1.5 连同其暴露的配置界面一起移除了早期的代理插件，只保留由启动器安装、由环境解析的一份策略；本包只补回 GUI 行所需的那部分，把全部路由决策委派给该策略。

本插件交出的 `EnvLookup` 与 `@deepseek-ai/dsh-http-proxy` 声明的那一个结构相同，`LaunchEnvironmentSnapshot` 同时满足两者，因此该类型在此本地声明，而不从解析器的内部 `policy.ts` 模块引入。

</details>

**Runtime invariant:** No companion is published. 这里唯一的可变状态——已安装的 disposer 与其路由的端口——由单元测试断言：改端口前后与卸载之后都用 `proxyRouteFor` 驱动验证。
