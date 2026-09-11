/** Official OS icon: white whale on a black rounded square. */

import { fileURLToPath } from 'node:url'

/** PNG electron-builder and `BrowserWindow` share for the product identity. */
export const DESKTOP_APP_ICON_PATH = fileURLToPath(new URL('../icons/icon.png', import.meta.url))

/**
 * Windows AppUserModelID used when packaging did not stamp one.
 * Packaged installers use `DSH_DESKTOP_APP_ID` instead.
 */
export const DESKTOP_APP_USER_MODEL_ID = 'ai.deepseek.harness'

/** Name shown in the process list and unpackaged taskbar grouping. */
export const DESKTOP_PRODUCT_NAME = 'DeepSeek Harness'
