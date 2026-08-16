/**
 * Frameless window chrome for the official Web UI (and the splash page).
 * Injected into every document. Reuses --dsw-* tokens when the GUI theme
 * presenter has applied them; splash falls back to currentColor.
 */
(function () {
  if (window.__dshDesktopChrome) return;
  window.__dshDesktopChrome = true;

  var CONTROLS_ID = 'dsh-desktop-window-controls';
  var INTERACTIVE =
    'a,button,input,textarea,select,option,[role="button"],[role="tab"],[role="menuitem"],[role="slider"],[role="switch"],[contenteditable="true"],#' +
    CONTROLS_ID;
  var ICON_MIN =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
  var ICON_MAX =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.75" y="2.75" width="6.5" height="6.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';
  var ICON_RESTORE =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.25 3.5h4.25v4.25" fill="none" stroke="currentColor" stroke-width="1.25"/><rect x="2.5" y="4.25" width="5.25" height="5.25" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';

  var STYLE =
    'html.dsh-desktop-frameless header{padding-right:132px !important}' +
    '#' + CONTROLS_ID + '{' +
      'position:fixed;top:0;right:0;z-index:2147483646;display:flex;height:40px;' +
      'flex:none;-webkit-app-region:no-drag;app-region:no-drag;' +
      'color:var(--dsw-alias-label-secondary,currentColor);' +
      'font-family:inherit;' +
    '}' +
    '#' + CONTROLS_ID + ' button{' +
      'appearance:none;display:inline-flex;align-items:center;justify-content:center;' +
      'width:40px;height:40px;margin:0;padding:0;border:0;border-radius:0;' +
      'background:transparent;color:inherit;cursor:default;' +
    '}' +
    '#' + CONTROLS_ID + ' button svg{width:12px;height:12px;display:block}' +
    '#' + CONTROLS_ID + ' button:hover{' +
      'background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));' +
    '}' +
    '#' + CONTROLS_ID + ' button:active{' +
      'background:var(--dsw-alias-interactive-bg-hover-solid,rgba(128,128,128,.22));' +
    '}' +
    '#' + CONTROLS_ID + ' button[data-action="close"]:hover,' +
    '#' + CONTROLS_ID + ' button[data-action="close"]:active{' +
      'background:var(--dsw-alias-state-error-primary,#c42b1c);color:#fff;' +
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
    if (el.closest('[data-shell-overlay]')) return false;
    if (el.closest(INTERACTIVE)) return false;
    if (el.closest('header')) return true;
    if (typeof el.className === 'string' && el.closest('[class*="logoRow"]')) return true;
    return event.clientY <= 40;
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

  function mount() {
    if (document.getElementById(CONTROLS_ID)) return;
    document.documentElement.classList.add('dsh-desktop-frameless');

    var style = document.createElement('style');
    style.setAttribute('data-dsh-desktop-chrome', '');
    style.textContent = STYLE;
    document.head.appendChild(style);

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
