---
description: "面向用户与维护者的委派子 agent 部署默认模型选择说明，用于选择、配置或调试新启动的 subagent 从哪个模型开始。"
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-default-model

[English](README.md) | 中文

## 概述

`dsh-subagent-default-model` 为新创建的委派子 agent 提供共享的默认提供方与模型，且独立于父 agent。当顶层 Agent 与 subagent 需要跑不同模型时使用它——例如给子 agent 换用更便宜、上下文更大或带视觉能力的模型——也用于在不重新部署的前提下更改这个子 agent 默认值。委派请求自带 provider 或 model 时仍沿用自身的路由，已经运行中的子 agent 继续使用其日志记录的路由。该默认值作用于整个进程；按子 agent 选择模型仍由发起委派的调用方负责。

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

把本包与 [`dsh-agent-default-model`](../agent-default-model/README.zh.md) 一起挂在会发生委派的地方。顶层默认值与这里的子 agent 默认值是各自独立的状态所有者：改动一个不会带动另一个；只挂载本包时，顶层 Agent 仍使用其入口自己的选择。

### 配置默认值

组合配置项是默认值的基础：它要求提供方与模型，并且不依赖任何设置提供方也能使用。

```yaml
- name: '@deepseek-ai/dsh-subagent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | 必填 | 新创建子 agent 使用的已注册提供方路由 |
| `model` | 必填 | 新创建子 agent 使用的、由提供方持有的模型 id |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-subagent-default-model)是每个受支持字段的穷尽式真源。`reasoningEffort` 刻意不是配置字段：它属于设置层，因此完整保存的选择可以在下一个选定的模型没有推理强度时清除旧值，而组合配置值会再次被继承。

### 读取与更改默认值

`currentSelection()` 返回一份独立的 `{ provider, model, reasoningEffort? }`，应用于下一个委派子 agent；`saveSelection()` 为后续子 agent 保存完整选择。

```text
const selection = ctx.subagentDefaultModel.currentSelection()
await ctx.subagentDefaultModel.saveSelection({ provider, model, reasoningEffort: 'high' })
```

未挂载设置提供方时，`saveSelection()` 不执行任何操作，组合配置项仍为当前值。该服务不校验目录成员关系：提供方路由可以服务未在目录中公布的模型；可用性诊断由子 agent 自身的请求负责。

### 委派时实际生效的行为

该选择在创建子 agent 的位置应用，因此子 agent 的 `AgentOptions`——以及由它推导出的 `{{model}}` 提示变量——从第一步起就是正确的。

| 委派情形 | 结果 |
|---|---|
| 请求未提供 provider 或 model | 逐字段注入配置路由；请求显式给出的 `provider` 或 `model` 始终优先 |
| 请求同时给出 provider 与 model | 原样透传 |
| 拒绝子 agent `agentOptions` 的一次性提供方 | 原样透传，因为该提供方会拒绝路由而不是静默忽略 |
| 已存在的子 agent 或冷恢复 | 沿用其创建时记录的路由 |

`reasoningEffort` 不属于 `AgentOptions`，因此改为按请求应用：解析后的 provider 与 model 等于配置路由的 subagent 请求会拿到配置的推理强度，其他路由保留自己持有的强度。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释该服务如何实现上述行为；可观察约定已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该服务是一个带设置后援真源的组合配置项，与 [`agent-default-model`](../agent-default-model/README.zh.md) 完全同构，另外注册两处运行时行为。由于启动子 agent 的注册表没有提供按请求解析的钩子，插件在其自身 fiber 的生命周期内包装 `ctx.subagents.start()` 与 `ctx.subagents.startContinuable()`：默认值必须在子 agent 被组合之前就写入其 `AgentOptions`，而包装是唯一能覆盖所有委派调用方的接缝——模型可见的委派工具、后台任务、workflow worker、SDK server，以及 Agent Teams 花名册。不接受 `agentOptions` 能力的一次性提供方会保持请求原样，因为注册表在委派前校验该能力，注入路由会让委派被拒绝而不是被路由。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`SubagentDefaultModelConfig` 服务、设置分节安装、委派路由包装、subagent 推理强度瀑布 |
| — | 不发布运行时不变式伴生入口；唯一的可变值关系由 settings 校验负责。 |

### 行为说明

`currentSelection()` 返回全新独立对象，调用方持有它不会别名化服务状态；`saveSelection()` 在存在 `ctx.settings` 时写入完整选择。委派包装在每次启动时读取实时选择，只在挂载了 `ctx.subagents` 注册表时安装，并在其 fiber 卸载时恢复两个原始方法。推理强度瀑布读取同一份实时选择并比较**解析后**的请求路由，因此路由指向别处的子 agent 绝不会被改写。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

包级约定对大多数消费方已经足够；需要周边领域时再阅读以下页面。

- [Core 子系统](../../../docs/subsystems/core.zh.md)——`Agent` 句柄与 `AgentOptions` 路由选择。
- [agent-default-model 包](../agent-default-model/README.zh.md)——与本包配合使用的顶层对应项。
- [subagent 包](../../subagent/subagent/README.zh.md)——提供方注册表、子 agent 组合，以及 `AgentOptions` 能力闸门。
- [tool-subagent 包](../../subagent/tool-subagent/README.zh.md)——其请求会命中该默认值的模型可见委派工具。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-subagent-default-model)——每个受支持配置字段及其源声明。
- [core 分组地图](../README.zh.md)——core 各包如何组合。

-----

<a id="model-experience"></a>
## 模型体验

通过该服务在创建子 agent 时应用的 `ModelSelection` 间接影响；子 agent 的请求组装与提供方适配器负责模型可见请求。

#### KV Cache 影响

更改默认值只影响之后创建的子 agent。会话已经记录请求路由的子 agent 会在之后的每个轮次乃至冷恢复后继续使用该路由，因此本服务不会使其已建立的前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定该服务的范围。它们是当前包约束，不是任务积压。

- **单一的进程级子 agent 默认值**——该服务只拥有一个默认值；按子 agent 选择路由仍由发起委派的调用方负责。
- **没有设置提供方时无法保留**——未挂载设置提供方时，`saveSelection()` 无法为后续子 agent 保留选择。
- **注入路由需要可接受的组合方**——不接受子 agent `AgentOptions` 的一次性提供方会保持请求原样，因此其子 agent 仍继承父级路由，而不使用这里的默认值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
