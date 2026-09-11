/** Shared `http-proxy` port constants for the General Settings row. */

/** Settings namespace registered by `@deepseek-ai/dsh-http-proxy`. */
export const HTTP_PROXY_SETTINGS_NAMESPACE = 'http-proxy'

/** Default Clash/V2Ray mixed port. Must match `@deepseek-ai/dsh-http-proxy`. */
export const DEFAULT_PROXY_PORT = 7897

/**
 * Narrow a draft string to a TCP port the Host schema accepts.
 * @param text - raw input from the Settings row.
 * @returns the port, or undefined when the draft is not an integer 1–65535.
 */
export function parsePortDraft(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return port
}
