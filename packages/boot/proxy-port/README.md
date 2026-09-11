---
description: "Choose the local HTTP proxy port in Settings instead of exporting HTTPS_PROXY: the http-proxy settings section, when an exported proxy variable wins, and how a port edit re-routes the harness live."
kind: "package-reference"
---

# @deepseek-ai/dsh-proxy-port

English | [中文](README.zh.md)

## Summary

Mount this plugin when the harness should reach the network through a local proxy whose port a user picks in Settings instead of exporting `HTTPS_PROXY`. It publishes the `http-proxy` section the General **Proxy port** row edits and installs the harness's outbound proxy policy for that port, so an edit takes effect live. An exported `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` always wins over the stored port, and unloading the plugin restores direct connections. It registers no agent tool.

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

The `dsh-base` patch mounts this plugin after the settings row, so a profile that composes the base bundle gets the Settings row and the routing it drives with no further configuration.

### When to choose it

Choose it when the person running the harness reaches the network through a proxy application that exposes a local HTTP port — Clash and V2Ray call it the mixed port — and expects to change that port in the UI rather than in a shell profile. Do not mount it as a substitute for an exported proxy variable: an environment that already names one keeps its own routing, and this plugin then only publishes the section. A deployment that wants the environment to be the only source needs no plugin at all; `@deepseek-ai/dsh-http-proxy` is installed by the `dsh` launcher for every profile.

### Minimal configuration

```yaml
- id: proxy-port
  name: '@deepseek-ai/dsh-proxy-port'
  config:
    port: 7897
```

| Field | Default | Meaning |
|---|---|---|
| `port` | `7897` | Composition default for the section when the user-settings document has no override |

The generated [configuration catalog](../../../docs/config-catalog.md) lists every accepted field. `port` must be an integer 1–65535; a composed value outside that range fails the plugin load rather than falling back silently.

### The `http-proxy` section

The plugin registers the `http-proxy` namespace with one live field, `port`, defaulting to `7897`. The General Settings **Proxy port** row binds that namespace, shows the resolved port, and writes `port` back through the settings scope; the plugin watches the section and installs the policy again whenever the resolved value changes. The row is a browser surface: `packages/client/ui-settings-general` owns its markup, and the namespace name, field name, and default are the contract between the two halves.

### What it does to outbound HTTP

With the section registered and no proxy variable in the launch environment, the plugin calls `installProxyFromEnvironment` from `@deepseek-ai/dsh-http-proxy` with a lookup that answers `http://127.0.0.1:{port}` for each empty proxy slot. Every harness request that goes through Node's `fetch` then routes through that port: model calls, web search, `web_fetch`, HTTP MCP servers, and the E2B SDK, exactly as `docs/user/guide/network-proxy.md` describes for an exported variable. Loopback is always bypassed, `NO_PROXY` entries keep their meaning, and a spawned child receives the resolved policy through its environment.

Two behaviours differ from the retired personal plugin that this package replaces. Official 0.1.5 routing has no direct-first fallback: a configured proxy is used for the request, and a proxy that cannot connect fails the request rather than retrying it direct. And the port is the only thing this plugin owns — no `globalThis.fetch` wrapper and no undici dispatcher is constructed here, so there is exactly one routing implementation per process.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a thin, stateful adapter over one library call. `apply` reads the launch environment through `launchEnvironmentOf(ctx)`, resolves the starting port from the composition config or `DEFAULT_PROXY_PORT`, registers the `http-proxy` section, and then installs the policy for the port the section resolves — the section is registered first so a stored port boots directly instead of routing through the composition default for a moment.

Every install goes through one serialized transition: if the environment names a proxy, or the port already routed, the transition does nothing; otherwise it disposes the previous install and installs a policy for the current port. Disposal is what makes the section live: `installProxyFromEnvironment` returns a disposer that restores the previous dispatcher, policy, and environment, and the plugin awaits the transition tail before running it, so a port edit cannot interleave with unload. A commit that lands while an install is awaiting the undici import is discarded rather than published, which is why the transition re-checks the port after that await.

| File | Holds |
|---|---|
| `src/index.ts` | Plugin face: `name`, `Config`, `apply`, the `http-proxy` section schema, and the serialized install transition. |
| `src/environment.ts` | `hasExplicitProxy` and `withLocalProxyPort` — the only transformation this package applies to a launch environment. |
| `src/constants.ts` | Namespace, field, default port, and the port helpers the config and schema share. |

Nothing here resolves, matches, or dispatches: `resolveProxyPolicy` decides what a policy is, `proxyForUrl` decides where one URL goes, and the installed undici `Agent` performs the request.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Run DSH behind a network proxy](../../../docs/user/guide/network-proxy.md) — what to export, what stays direct, and why a browser is proxied when a terminal is not.
- [`dsh-http-proxy`](../../util/http-proxy/README.md) — the resolver, dispatcher, and child-environment builder this plugin installs.
- [`dsh-settings-file`](../../settings/settings-file/README.md) — the provider that persists the `http-proxy` section under `$DSH_HOME/settings.yaml`.
- [General Settings surface](../../client/ui-settings-general/README.md) — the row that edits the port.
- [`dsh-base`](../../bundle/base/README.md) — the patch that mounts this row after `settings`.
- [One outbound proxy policy](../../../.agents/notes/implemented/architecture/2026-08-27-outbound-proxy-policy.md) — why official routing is process-wide and environment-resolved.

-----

<a id="model-experience"></a>
## Model Experience

### Outbound transport policy

#### What the model sees

Nothing: the plugin registers no tool, prompt section, or session event, and no field of a model request is derived from the `http-proxy` port.

#### Token effect

None: routing a request through `127.0.0.1` changes which socket carries the bytes, not the bytes themselves.

#### KV Cache effect

None: the package never assembles a request or mutates a request prefix, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when mounting this plugin is the wrong answer.

- **A configured proxy is used directly, with no direct-first fallback** — official 0.1.5 routing sends a request through the proxy when one is configured, so a stopped proxy application fails requests that a direct attempt would have served. The retired personal plugin tried the destination first and fell back to the proxy; that behaviour is deliberately not restored here.
- **An environment proxy variable wins, including one the resolver refuses** — `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` set to anything non-blank stops this plugin from installing, so a `socks5://` value keeps that scheme direct and the Settings port does nothing.
- **The port is editable only where a settings provider is composed** — without `ctx.settings` the plugin still routes at the composition config port, but no surface can change it.
- **A port edit does not move requests already dispatched** — the previous dispatcher is closed, not destroyed, so an in-flight request finishes on it while later ones use the new port.
- **A re-install that fails leaves the process direct** — the previous policy is disposed before the new one is installed, because the official disposer restores the dispatcher it displaced; a failure is reported on the plugin logger, and the next port commit or a restart installs again.
- **Child processes and model-authored code keep their own reach** — a spawned child receives the resolved policy through its environment, while the code-runtime and workflow workers receive none by design, because a proxy URL may carry credentials.
- **The environment is not a certificate authority** — a TLS-intercepting proxy needs `NODE_EXTRA_CA_CERTS` set before the process starts, which this plugin neither sets nor validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The plugin exists because Settings needs a host half. Upstream 0.1.5 removed its earlier proxy plugin together with the configuration surface it exposed, and kept one environment-resolved policy installed by the launcher; this package adds back only the part a GUI row needs, delegating every routing decision to that policy.

The `EnvLookup` this plugin hands over is structurally identical to the one `@deepseek-ai/dsh-http-proxy` declares, and `LaunchEnvironmentSnapshot` satisfies both, so the type is declared locally rather than imported from the resolver's internal `policy.ts` module.

</details>

**Runtime invariant:** No companion is published. The one piece of mutable state here — the installed disposer and the port it routes — is asserted by unit tests that drive `proxyRouteFor` before and after a port edit and after unload.
