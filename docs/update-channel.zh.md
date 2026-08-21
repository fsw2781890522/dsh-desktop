# 桌面更新通道

[English](update-channel.md) | 中文

桌面构造仓库拥有运行中应用如何发现新安装包。DeepSeek Harness 设置行只调用 `window.__DSH_DESKTOP__.checkUpdate()` / `installUpdate()`，自己不拉取这份文档。

## Release 信源

正式构建只从个人仓库 GitHub Releases API 获取最新的非 draft、非
prerelease Release：

`https://api.github.com/repos/fsw2781890522/dsh-desktop/releases/latest`

应用使用 Release 的 `tag_name`（例如 `v0.3.2`）作为版本，并选择名称以
`_x64-setup.exe` 结尾的安装包。GitHub 的 `digest` 必须是 `sha256:` 值；
安装包从同一个 Release asset URL 下载，并按该 digest 校验。Release body
会显示在设置更新行中。

`releases/latest.json` 仍作为本地发布台账和打包审查样例跟踪，但正式检查更新
不会读取它。`main` 分支、本地旁路文件和环境变量都不能发布更新。

## 应用如何找到 Release

固定信源记录在 [`../src-tauri/update-channel.json`](../src-tauri/update-channel.json)。
如果个人仓库 Releases API URL 缺失，检查会明确失败；不会回退到分支内容或本地文件。

## 代理回退

Release 发现与安装包下载使用与 `@deepseek-ai/dsh-http-proxy` 相同的直连再代理传输规则。直连连接预算五秒（总共八秒）；传输失败后经 `http://127.0.0.1:{port}` 重试。端口来自 `DSH_PROXY_PORT`，然后是 `DSH_PROXY_URL` 中的端口，然后是 `$DSH_HOME/settings.yaml` 或 `%USERPROFILE%\.dsh\settings.yaml` 里的 `http-proxy.port`，最后是 `7897`。代理只改变传输方式，不改变 GitHub Releases URL 或响应信源。这是产品 HTTP：它不注册也不启用 `web_search` / `web_fetch` / `tool-web`。

## 发布一个版本

`scripts/build.ps1` 在 NSIS 构建成功后运行 `scripts/publish-release.ps1`。该脚本把安装包拷进 `releases/<version>/`，写入 `SHA256SUMS`，并在 `latest.json` 中 upsert 该版本供本地审查。只有在 `fsw2781890522/dsh-desktop` 创建对应的非 draft GitHub Release 并上传安装包后，版本才会被正式发现。安装包二进制不进 git；生产信源是个人 GitHub Release。

安装使用 NSIS `/S`，`/D=` 为当前 exe 所在目录（通常是 `%LOCALAPPDATA%\DeepSeek Harness`）。用户数据仍在 `~/.dsh`。

## 更新日志

给人读的历史：[`../CHANGELOG.md`](../CHANGELOG.md) / [`../CHANGELOG.zh.md`](../CHANGELOG.zh.md)。设置行展示通道索引里新版本的 `notes`。
