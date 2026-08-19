/**
 * Frameless window chrome for the official Web UI (and the splash page).
 * Injected into every document. Caption buttons sit in the existing Web UI
 * (no extra titlebar strip). Caption, better-sidebar cluster, and Session
 * log sit on one header row: window buttons at the far right, the cluster
 * second, Session log third. Caption buttons reuse the 28px circular rail
 * control (1.5px 16px glyphs, 4px gap, top: 3px) so they match the plugin
 * cluster. The top 36px of non-interactive chrome is a drag region (the
 * blank-session hero has no header). Button ink follows --dsw-* tokens.
 */
(function () {
  if (window.__dshDesktopChrome) return;
  window.__dshDesktopChrome = true;

  var CONTROLS_ID = 'dsh-desktop-window-controls';
  var BTN = 28;
  var GAP = 4;
  var EDGE = 10;
  var DRAG_BAND = 36;
  var CLUSTER_W = 60;
  var CAPTION_SPAN = EDGE + BTN * 3 + GAP * 2;
  var CLUSTER_RIGHT = CAPTION_SPAN + GAP;
  var HEADER_PAD_CAPTION = CAPTION_SPAN + EDGE;
  var HEADER_PAD_CLUSTER = CLUSTER_RIGHT + CLUSTER_W + EDGE;
  var INTERACTIVE =
    'a,button,input,textarea,select,option,[role="button"],[role="tab"],[role="menuitem"],[role="slider"],[role="switch"],[contenteditable="true"],#' +
    CONTROLS_ID;
  var ICON_ATTR =
    ' viewBox="0 0 16 16" fill="none" aria-hidden="true" width="16" height="16"' +
    ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  var ICON_MIN =
    '<svg' + ICON_ATTR + '><path d="M3.5 8h9"/></svg>';
  var ICON_MAX =
    '<svg' + ICON_ATTR + '><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>';
  var ICON_RESTORE =
    '<svg' + ICON_ATTR + '><path d="M6 4.5h5.5v5.5"/><rect x="3.5" y="6" width="6.5" height="6.5" rx="1"/></svg>';
  var ICON_CLOSE =
    '<svg' + ICON_ATTR + '><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';

  var STYLE =
    'html.dsh-desktop-frameless{' +
      '--dsh-desktop-cluster-right:' + CLUSTER_RIGHT + 'px;' +
    '}' +
    '#' + CONTROLS_ID + '{' +
      'position:fixed;top:3px;right:0;z-index:2147483646;' +
      'display:flex;align-items:center;gap:' + GAP + 'px;' +
      'height:' + BTN + 'px;padding:0 ' + EDGE + 'px 0 0;box-sizing:content-box;' +
      'color:var(--dsw-alias-label-secondary,#61656b);' +
    '}' +
    'html.dsh-desktop-frameless body[data-ds-dark-theme] #' + CONTROLS_ID + '{' +
      'color:var(--dsw-alias-label-secondary,#cfd3d6);' +
    '}' +
    'html.dsh-desktop-splash #' + CONTROLS_ID + '{color:#c8c9cc;}' +
    '#' + CONTROLS_ID + ' button{' +
      'appearance:none;display:inline-flex;align-items:center;justify-content:center;' +
      'width:' + BTN + 'px;height:' + BTN + 'px;margin:0;padding:0;border:0;border-radius:50%;' +
      'background:transparent;color:inherit;cursor:pointer;' +
      'transition:background var(--ds-transition-duration-slow,.24s) var(--ds-ease-in-out,ease),' +
        'color var(--ds-transition-duration-slow,.24s) var(--ds-ease-in-out,ease);' +
    '}' +
    '#' + CONTROLS_ID + ' button svg{width:16px;height:16px;display:block}' +
    '#' + CONTROLS_ID + ' button:hover{' +
      'background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));' +
      'color:var(--dsw-alias-label-primary,currentColor);' +
    '}' +
    '#' + CONTROLS_ID + ' button:active{' +
      'background:var(--dsw-alias-interactive-bg-hover-solid,rgba(128,128,128,.22));' +
    '}' +
    '#' + CONTROLS_ID + ' button[data-action="close"]:hover,' +
    '#' + CONTROLS_ID + ' button[data-action="close"]:active{' +
      'background:var(--dsw-alias-state-error-primary,#c42b1c);color:#fff;' +
    '}' +
    'html.dsh-desktop-frameless [data-slot="conversation.session.header"] > header{' +
      'padding-right:' + HEADER_PAD_CAPTION + 'px !important;' +
    '}' +
    'html.dsh-desktop-frameless body[data-dsh-sidebar-collapsed] ' +
      '[data-slot="conversation.session.header"] > header{' +
      'padding-right:' + HEADER_PAD_CLUSTER + 'px !important;' +
    '}' +
    'html.dsh-desktop-frameless body:not([data-dsh-sidebar-collapsed]):has([data-dsh-better-sidebar]) ' +
      '[data-slot="conversation.session.header"] > header{' +
      'padding-right:28px !important;' +
    '}' +
    'html.dsh-desktop-frameless [data-dsh-better-sidebar] [class*="toggleCluster"]{' +
      'top:3px !important;' +
      'right:var(--dsh-desktop-cluster-right) !important;' +
      'gap:' + GAP + 'px;' +
    '}' +
    'html.dsh-desktop-frameless [data-dsh-better-sidebar] [class$="panel"] [class*="tabBar"]{' +
      'padding-right:' + HEADER_PAD_CLUSTER + 'px !important;' +
    '}';

  function currentWindow() {
    var t = window.__TAURI__;
    if (!t) return null;
    if (t.window && typeof t.window.getCurrentWindow === 'function') {
      return t.window.getCurrentWindow();
    }
    if (t.webviewWindow && typeof t.webviewWindow.getCurrentWebviewWindow === 'function') {
      return t.webviewWindow.getCurrentWebviewWindow();
    }
    return null;
  }

  function shouldDrag(event) {
    var el = event.target;
    if (!(el instanceof Element)) return false;
    if (el.closest('#' + CONTROLS_ID)) return false;
    if (el.closest('[data-dsh-better-sidebar]')) return false;
    if (el.closest('[data-shell-overlay]')) return false;
    if (document.documentElement.classList.contains('dsh-desktop-splash')) return true;
    if (el.closest('[class*="logoRow"]')) return true;
    if (el.closest(INTERACTIVE)) return false;
    if (el.closest('header')) return true;
    if (event.clientY <= DRAG_BAND) return true;
    return false;
  }

  function wireDrag() {
    var pending = null;
    document.addEventListener('mousedown', function (event) {
      if (event.button !== 0 || !shouldDrag(event)) {
        pending = null;
        return;
      }
      pending = { x: event.screenX, y: event.screenY };
    }, true);
    document.addEventListener('mousemove', function (event) {
      if (!pending) return;
      if (Math.abs(event.screenX - pending.x) + Math.abs(event.screenY - pending.y) < 4) return;
      pending = null;
      var win = currentWindow();
      if (win && typeof win.startDragging === 'function') win.startDragging();
    }, true);
    document.addEventListener('mouseup', function () {
      pending = null;
    }, true);
    document.addEventListener('dblclick', function (event) {
      if (!shouldDrag(event)) return;
      var win = currentWindow();
      if (win && typeof win.toggleMaximize === 'function') win.toggleMaximize();
    }, true);
  }

  function setMaximized(button, maximized) {
    button.dataset.maximized = maximized ? 'true' : 'false';
    button.setAttribute('aria-label', maximized ? '还原' : '最大化');
    button.innerHTML = maximized ? ICON_RESTORE : ICON_MAX;
  }

  function syncMaximized(button) {
    var win = currentWindow();
    if (!win || typeof win.isMaximized !== 'function') return;
    Promise.resolve(win.isMaximized()).then(function (maximized) {
      setMaximized(button, !!maximized);
    }, function () {});
  }

  function stripLegacyTitlebar() {
    var titlebar = document.getElementById('dsh-desktop-titlebar');
    var frame = document.getElementById('dsh-desktop-app-frame');
    if (frame) {
      while (frame.firstChild) {
        document.body.appendChild(frame.firstChild);
      }
      frame.remove();
    }
    if (titlebar) titlebar.remove();
  }

  function mount() {
    if (document.getElementById(CONTROLS_ID)) return;
    document.documentElement.classList.add('dsh-desktop-frameless');
    if (!document.getElementById('root')) {
      document.documentElement.classList.add('dsh-desktop-splash');
    }

    stripLegacyTitlebar();

    if (!document.head.querySelector('[data-dsh-desktop-chrome]')) {
      var style = document.createElement('style');
      style.setAttribute('data-dsh-desktop-chrome', '');
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    var bar = document.createElement('div');
    bar.id = CONTROLS_ID;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '窗口控制');

    function makeButton(action, label, icon) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.setAttribute('aria-label', label);
      button.innerHTML = icon;
      return button;
    }

    var min = makeButton('minimize', '最小化', ICON_MIN);
    var max = makeButton('maximize', '最大化', ICON_MAX);
    var close = makeButton('close', '关闭', ICON_CLOSE);
    bar.appendChild(min);
    bar.appendChild(max);
    bar.appendChild(close);
    document.body.appendChild(bar);

    bar.addEventListener('click', function (event) {
      var button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button) return;
      var win = currentWindow();
      if (!win) return;
      var action = button.dataset.action;
      if (action === 'minimize' && typeof win.minimize === 'function') win.minimize();
      else if (action === 'maximize' && typeof win.toggleMaximize === 'function') win.toggleMaximize();
      else if (action === 'close' && typeof win.close === 'function') win.close();
    });

    wireDrag();
    syncMaximized(max);
    var win = currentWindow();
    if (win && typeof win.onResized === 'function') {
      win.onResized(function () { syncMaximized(max); });
    }
  }

  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  }

  if (currentWindow()) {
    boot();
    return;
  }
  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (currentWindow() || tries >= 40) {
      clearInterval(timer);
      boot();
    }
  }, 50);
})();
