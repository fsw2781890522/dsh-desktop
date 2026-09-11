---
description: "The deployment default model selection for delegated child agents, for users and maintainers choosing, configuring, or debugging which model a freshly started subagent runs on."
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-default-model

English | [中文](README.zh.md)

## Summary

`dsh-subagent-default-model` gives newly created delegated children a shared default provider and model, independently of the parent agent. Use it when the top-level Agent should run one model while subagents run another — a cheaper, larger-context, or vision model, for instance — and when that child default must change without redeploying. A delegation that names its own provider or model keeps that route, and children already running keep the route their log recorded. The default is process-wide; per-child selection remains the responsibility of the caller that delegates.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package beside [`dsh-agent-default-model`](../agent-default-model/README.md) wherever agents delegate. The top-level default and this child default are separate state owners: changing one never moves the other, and a deployment that composes only this package leaves top-level Agents on their entry point's own selection.

### Configure the default

The composition entry is the base of the default: it requires a provider and model and stays usable without any settings provider.

```yaml
- name: '@deepseek-ai/dsh-subagent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | Registered provider route for freshly created children |
| `model` | required | Provider-owned model id for freshly created children |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-default-model) is the exhaustive source for every accepted field. `reasoningEffort` is deliberately not a config field: it belongs to the settings layer, so a complete saved selection can clear an effort when the next selected model has none, while a composition value would be inherited again.

### Read and change the default

`currentSelection()` returns a detached `{ provider, model, reasoningEffort? }` applied to the next delegated child; `saveSelection()` stores the complete selection for later children.

```text
const selection = ctx.subagentDefaultModel.currentSelection()
await ctx.subagentDefaultModel.saveSelection({ provider, model, reasoningEffort: 'high' })
```

Without a settings provider, `saveSelection()` is a no-op and the composition entry remains current. The service does not validate catalog membership: a provider route may serve an unadvertised model, and the child's own request owns availability diagnostics.

### What reaches a delegation

The selection is applied where a child is created, so the child's `AgentOptions` — and the `{{model}}` prompt variable derived from them — are correct from its first step.

| Delegation | Result |
|---|---|
| No provider or model in the request | The configured route is injected field by field; an explicitly named `provider` or `model` always wins |
| Explicit provider and model | The request is passed through untouched |
| One-shot provider that refuses child `agentOptions` | The request is passed through untouched, because that provider rejects a route rather than ignoring it |
| A child that already exists or cold-resumes | Keeps the route recorded when it was created |

`reasoningEffort` is not part of `AgentOptions`, so it is applied per request instead: a subagent request whose resolved provider and model are the configured route receives the configured effort, and any other route keeps the effort it owns.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the service realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The service is a composition entry with a settings-backed source, exactly like [`agent-default-model`](../agent-default-model/README.md), plus two registrations that make the selection observable at runtime. Because the registry that starts children exposes no per-request resolution hook, the plugin wraps `ctx.subagents.start()` and `ctx.subagents.startContinuable()` for the lifetime of its own fiber: the default must be part of the child's `AgentOptions` before the child is composed, and the wrap is the only seam that reaches every delegating caller — the model-facing delegation tool, background jobs, the workflow worker, the SDK server, and the Agent Teams roster. A one-shot provider that does not advertise the `agentOptions` capability keeps its request untouched, because the registry validates that capability before delegating and a route injected there would reject the delegation instead of routing it.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `SubagentDefaultModelConfig` service, settings section install, delegation-route wrap, subagent reasoning-effort waterfall |
| — | No runtime invariant companion is published; settings validation owns the only mutable-value relationship. |

### Behavior notes

`currentSelection()` returns a fresh detached object so a caller can hold it without aliasing service state, and `saveSelection()` writes the whole selection through `ctx.settings` when present. The delegation wrap reads the live selection per start, is installed only while a `ctx.subagents` registry is mounted, and restores both original methods when its fiber unloads. The effort waterfall reads the same live selection and compares the RESOLVED request route, so a child routed elsewhere is never rewritten.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The package-level contract is enough for most consumers; read these when you need the surrounding domain.

- [Core subsystem](../../../docs/subsystems/core.md) — the `Agent` handle and `AgentOptions` route selection.
- [agent-default-model package](../agent-default-model/README.md) — the top-level counterpart this package is composed with.
- [subagent package](../../subagent/subagent/README.md) — the provider registry, child composition, and `AgentOptions` capability gate.
- [tool-subagent package](../../subagent/tool-subagent/README.md) — the model-facing delegation tool whose requests reach this default.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-default-model) — every accepted config field and its source declaration.
- [Core group map](../README.md) — how the core packages compose.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `ModelSelection` the service applies when a child is created; child request assembly and the provider adapters own the model-visible request.

#### KV Cache effect

Changing the default affects only children created afterwards. A child whose session already logged a request route keeps that route on every later turn and after a cold resume, so this service never invalidates an established prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the service's scope. They are current package constraints, not a task backlog.

- **One process-wide child default** — the service owns a single default; per-child route selection remains the delegating caller's responsibility.
- **No retention without a settings provider** — `saveSelection()` cannot keep a selection for a later child when no settings provider is mounted.
- **Route injection needs a capable composer** — a one-shot provider that does not accept child `AgentOptions` keeps its request, so its children still inherit the parent route instead of this default.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
