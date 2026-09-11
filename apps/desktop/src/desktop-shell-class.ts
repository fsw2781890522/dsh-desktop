/** Class the product-window renderer stamps on `document.documentElement`. */
export const DESKTOP_SHELL_CLASS = 'dsh-desktop'

/**
 * Stamp the layout chrome class. A sandboxed preload may run before
 * `document.documentElement` exists; callers retry on `DOMContentLoaded`.
 * @param root - `document.documentElement`, or null when the document is not ready.
 */
export function stampDesktopShellClass(root: { readonly classList: { add(name: string): void } } | null): void {
  root?.classList.add(DESKTOP_SHELL_CLASS)
}
