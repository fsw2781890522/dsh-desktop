/** Minimal marker that selects the desktop custom-protocol API carrier. */

import { contextBridge, ipcRenderer } from 'electron'
import { stampDesktopShellClass } from './desktop-shell-class.ts'
import type { DshDesktopAppApi } from './ipc.ts'

/** Must stay identical to `DESKTOP_IPC.colorSchemeSet`; a value import would split this sandbox preload. */
const COLOR_SCHEME_SET = 'dsh-desktop:color-scheme-set'

const api: DshDesktopAppApi = {
  protocolVersion: 1,
  setColorScheme(scheme) {
    void ipcRenderer.invoke(COLOR_SCHEME_SET, scheme).catch(() => {
      // The BrowserWindow can be destroyed before the invoke settles.
    })
  },
}

contextBridge.exposeInMainWorld('dshDesktop', api)

stampDesktopShellClass(document.documentElement)
window.addEventListener('DOMContentLoaded', () => {
  stampDesktopShellClass(document.documentElement)
}, { once: true })
