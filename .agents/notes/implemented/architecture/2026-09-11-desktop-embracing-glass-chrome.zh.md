# Agent Note: Desktop embracing glass chrome

Status: implemented

[English](2026-09-11-desktop-embracing-glass-chrome.md) | 中文

## Problem

Electron 产品窗口原先使用完整的系统标题栏，因此 Windows caption 按钮落在与 Web UI 分离的一条带上。若再把自定义最小化/最大化/关闭画在会话标题行上，就会与会话 chrome 重叠，拖拽窗口还可能改变尺寸。个人 Tauri 壳还需要侧栏毛玻璃采样桌面，完全不透明的客户区做不到这一点。

产品窗口仍然需要原生 caption 按钮，这样这些控件就不可能叠到 Web UI 上。承载标题带与侧栏的毛玻璃底板必须完整环抱会话瀑布流，包括右侧与下方的细边距。只有会话卡片的右下角落在等宽细边距里，必须与底板保持同心；其余三个角使用底板半径。操作系统 chrome（任务栏、安装程序、`.exe`）必须显示官方鲸鱼，而不是 Electron 默认图标。设置浮层是侧栏的后代，必须画在不透明会话卡片之上。

## Decision

主窗口通过 `titleBarStyle: 'hidden'` 加上 `titleBarOverlay` 以及空 `title` 保留平台 caption 按钮，由系统绘制最小化/最大化/关闭，不显示图标或应用名称。overlay 的 `color` 保持透明（`#00000000`），让毛玻璃底板从按钮簇透出。字形跟随主题呈现器经 IPC 上报的已解析应用内方案：深色时为白色（`#ffffff`），浅色时为 `#61656b`。`nativeTheme.shouldUseDarkColors` 只在该上报之前作为回退。插件窗口仍使用带系统边框的标题栏。在 Windows 上，产品窗口还设置 `backgroundMaterial: 'acrylic'` 与透明 `backgroundColor`，让框架上的 CSS `backdrop-filter` 采样桌面。

应用 preload 在首次绘制前盖上 `html.dsh-desktop`。布局 CSS 随后在整个框架上绘制一块毛玻璃底板（标题带与侧栏相连），并把会话界面与右栏裁进一块不透明圆角舞台。舞台在左、右、下三边各内缩 `--dsh-desktop-stage-inset`（6px），顶边内缩 `caption-height + inset`，因此会话卡片四周都能露出细毛玻璃。舞台三个角使用 `--dsh-desktop-card-radius`（12px）。右下角使用 `--dsh-desktop-stage-radius`（`max(0px, 卡片半径 − inset)`）。最大化窗口会切换 `html.dsh-desktop-maximized`，从而把底板上的 `--dsh-desktop-window-radius` 归零，并保持会话卡片圆角不变。侧栏列不设 `z-index`；一旦设了，设置浮层（`position: fixed`，`z-index: 1000`）就会被困在后一个同级舞台之下。

`.exe`、NSIS 快捷方式和未封装任务栏共用 `icons/icon.png`：官方 favicon 鲸鱼为白色，画在黑色圆角方底上。`BrowserWindow.icon` 指向该 PNG。在 Windows 上，壳还会调用 `app.setAppUserModelId`（打包时用 `DSH_DESKTOP_APP_ID`，否则用 `ai.deepseek.harness`），以免任务栏继续沿用 Electron 身份。`dev:desktop` 运行 `build:official`，以便侧栏品牌填充注册。

舞台包装在浏览器里是 `display: contents`，因此三栏网格不变。在 `html.dsh-desktop` 下，框架是两列（侧栏 | 舞台），舞台是中栏 | 右栏轨道的内网格。专用拖拽条占侧栏右侧的 caption 带，叠在 overlay 层之上，并使用 `-webkit-app-region: drag`；`html` / `body` / `#root` 保持 `overflow: visible`，以免 Chromium 丢掉该拖拽区。会话列表的裁切是滚动树上的 mask，而不是填色 overlay，因此不会给毛玻璃底板叠第二层着色。

本地 Windows 打包可以设置 `DSH_DESKTOP_ALLOW_UNSIGNED=1` 以跳过 EV token 签名。该路径不是发布产物。

## Alternatives considered

**只靠 `nativeTheme.shouldUseDarkColors` 决定 caption 字形。** Appearance 可以是深色而操作系统仍是浅色，于是为浅色系统选的深色字形会叠在深色毛玻璃上几乎看不见。否决；overlay 跟随已解析的应用内方案。

**给 caption 按钮簇加不透明底色。** 会在毛玻璃底板上读成一块色块。否决；overlay `color` 保持透明，深色方案下字形为白色。

**把 `nativeTheme.themeSource` 设成 Appearance。** 这也会改掉文件对话框等 Electron 持有的操作系统 chrome。否决；只通过 `setTitleBarOverlay` 改变 caption。

**在会话标题行上叠自定义圆形最小化/最大化/关闭。** 这些控件与会话 chrome 同一行并会重叠，还替换了平台 caption 命中区。否决，因为重叠正是要修的缺陷。

**保留含图标与应用名称的完整原生标题栏。** 系统条无法与侧栏共用 Acrylic，图标与名称也和应用内品牌重复。否决，改用 overlay caption 按钮加空标题。

**每个内角都使用底板半径。** 右下角落在等宽 6px 细边距里，内外半径相同会在那里把毛玻璃挤窄。该角否决；其余三角远离底板圆角（caption 带、侧栏），使用底板半径。

**给桌面侧栏列加 `z-index`。** 该层叠上下文会把 `sidebar.settings`（视口 fixed，`z-index: 1000`）困在同一 z-index 的会话舞台之下。否决；侧栏列保持 `z-index: auto`，让浮层参与框架的层叠上下文。

**用填色 overlay 把会话列表淡入侧栏 tint。** 第二层 mix 叠在毛玻璃底板上，会在设置按钮上方读成一条色带。否决；滚动树改用 mask，让行像素溶进底板。

**只在顶边和左边内缩（L 形毛玻璃）。** 这样会话卡片会在右侧与下方贴齐窗口，底板无法环抱瀑布流。否决；右侧与下方同样需要细边距。

## Consequences

浏览器里的 `dsh web` 会话不会盖上 `html.dsh-desktop`，因此保持齐边的三栏框架。Windows 11 DWM 可能把窗口裁成比 12px 底板 token 更紧的 8px 外圆角；CSS 关系仍让右下内角与我们绘制的底板保持同心。最大化与贴边窗口会把底板变成直角；会话卡片仍保持 12 / 12 / 6 / 12。即使操作系统是浅色，应用内深色方案下 caption 字形仍为白色。未封装的开发态需要 `BrowserWindow.icon` 加上 Windows AppUserModelID，否则任务栏会继续显示 Electron 图标。未签名的本地安装包不能参加已签名的更新流。
