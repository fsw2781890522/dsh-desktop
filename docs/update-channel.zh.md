# 桌面更新通道

[English](update-channel.md) | 中文

桌面构造仓库拥有运行中应用如何发现新安装包。DeepSeek Harness 设置行只调用 `window.__DSH_DESKTOP__.checkUpdate()` / `installUpdate()`，自己不拉取这份文档。

## 通道索引

`releases/latest.json` 是应用拉取的文档。JSON Schema：[`../releases/channel.schema.json`](../releases/channel.schema.json)。

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "latest": "0.2.1",
  "releases": [
    {
      "version": "0.2.1",
      "releasedAt": "2026-08-16T11:22:00Z",
      "notes": { "zh": "…", "en": "…" },
      "artifacts": {
        "windows-x64": {
          "kind": "nsis",
          "filename": "DeepSeek Harness_0.2.1_x64-setup.exe",
          "url": "https://example.invalid/DeepSeek-Harness_0.2.1_x64-setup.exe",
          "sha256": "…",
          "size": 123
        }
      }
    }
  ]
}
```

规则：

- `schemaVersion` 为 `1`。其他值是明确失败。
- `latest` 和每个 `version` 为 `major.minor.patch`，不含预发布后缀。
- 已安装壳版本大于或等于 `latest` 时，应用报告已最新，不要求产物。
- `latest` 更新时，该 release 必须包含 `artifacts.windows-x64`，且 `url` 与 `sha256` 非空。`kind` 为 `nsis`（已实现）或 `runtime-zip`（预留）。
- `url` 可以是 `https:`、`http:` 或 `file:`。

## 应用如何找到索引

1. 环境变量 `DSH_DESKTOP_UPDATE_MANIFEST`（路径或 URL）非空时。
2. [`../src-tauri/update-channel.json`](../src-tauri/update-channel.json) 里的 `manifestUrl` 非空时。
3. 可执行文件旁的 `latest.json`，然后是 Tauri 资源目录旁。
4. 仅调试构建：本仓库的 `releases/latest.json`。

配置为空时，设置里显示错误，而不是静默跳过。

## 代理回退

发现与安装包下载使用与 `@deepseek-ai/dsh-http-proxy` 相同的直连再代理规则。直连连接预算五秒（总共八秒）；传输失败后经 `http://127.0.0.1:{port}` 重试。端口来自 `DSH_PROXY_PORT`，然后是 `DSH_PROXY_URL` 中的端口，然后是 `$DSH_HOME/settings.yaml` 或 `%USERPROFILE%\.dsh\settings.yaml` 里的 `http-proxy.port`，最后是 `7897`。回环和 `file:` 源不走代理。这是产品 HTTP：它不注册也不启用 `web_search` / `web_fetch` / `tool-web`。

## 发布一个版本

`scripts/build.ps1` 在 NSIS 构建成功后运行 `scripts/publish-release.ps1`。该脚本把安装包拷进 `releases/<version>/`，写入 `SHA256SUMS`，并在 `latest.json` 中 upsert 该版本。它从不删除其他版本的目录。安装包二进制不进 git；`latest.json`、说明和校验和纳入跟踪。

安装使用 NSIS `/S`，`/D=` 为当前 exe 所在目录（通常是 `%LOCALAPPDATA%\DeepSeek Harness`）。用户数据仍在 `~/.dsh`。

## 更新日志

给人读的历史：[`../CHANGELOG.md`](../CHANGELOG.md) / [`../CHANGELOG.zh.md`](../CHANGELOG.zh.md)。设置行展示通道索引里新版本的 `notes`。
