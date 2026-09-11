# DeepSeek Harness Desktop

这是个人维护的 **Windows 桌面端**，不是 DeepSeek 官方安装包。

当前构建基于官方 Electron 壳 [`apps/desktop`](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop)，版本身份与 `@deepseek-ai/dsh` 同为 **0.1.5-rc.2**。已不再使用 Tauri，也不再顺延个人 0.2 / 0.3 / 0.4 版本号。

[English](README.en.md)

![Windows 上的 DeepSeek Harness 桌面端](apps/desktop/docs/window.png)

## 下载

安装包在 GitHub Release：**[v0.1.5-rc.2](https://github.com/fsw2781890522/dsh-desktop/releases/tag/v0.1.5-rc.2)**

- 文件：`deepseek-harness-0.1.5-rc.2-win-x64.exe`（Windows x64 NSIS）
- 未走官方 EV 签名通道，SmartScreen 可能提示「未知发布者」
- 用户数据仍在 `~/.dsh`，与 CLI / 旧桌面端共用设置、凭证和会话

## 这一版实际有什么

相对官方 Desktop 源码，这个快照多了个人界面与设置，而不是再叠一层 Tauri WebView：

- **窗口：** 隐藏标题栏应用名和图标，保留 Windows 原生最小化 / 最大化 / 关闭；深色界面用白色按钮字形，浅色用灰色；标题栏可拖动
- **环抱式毛玻璃：** 标题栏与侧栏连成一块底板，会话区域用不透明圆角卡片浮在上面（右下角半径更小）；最大化时窗口外角变直角，会话卡片圆角保留
- **图标：** 官方白鲸、黑底圆角方标
- **设置：** 侧栏透明度、代理端口（写入官方 `dsh-http-proxy` 策略，不是先直连再回退）、Agent / Subagent 默认模型分开配置
- **开发态：** 继续用本机 `~/.dsh`，不会默认写进 `.desktop-build/development/home`

官方 0.1.5 已经自带的能力不再重复实现：轮次导航、过程折叠、右侧栏、多模态与 `read_image`。本仓库也不再捆绑 `dsh-better-sidebar`、ModLens 或 Anchored Standard。

## 从源码跑（可选）

本仓库的 `main` 是官方 0.1.5-rc.2 工作树加上面这些桌面改动。需要 Node.js 22+ 与 pnpm：

```powershell
pnpm install
pnpm run start:desktop
```

打 Windows 安装包（本机未签名）：

```powershell
$env:DSH_DESKTOP_APP_ID = 'ai.deepseek.harness'
$env:DSH_DESKTOP_ALLOW_UNSIGNED = '1'
$env:DSH_DESKTOP_AUTO_UPDATE_ENV = 'test'
$env:DOWNLOAD_TEST_ORIGIN = 'https://github.com'
pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64
```

产物在 `apps/desktop/.desktop-build/targets/win-x64/artifacts/`。

## 分支

只维护 **`main`**（默认，当前桌面快照）和 **`dev`**。不要在这个仓库开 Dependabot 或功能分支。
