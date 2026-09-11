/** Settings namespace written by the General Settings proxy-port row and read by this plugin. */
export const HTTP_PROXY_SETTINGS_NAMESPACE = 'http-proxy'

/** Field carrying the local HTTP proxy TCP port. */
export const HTTP_PROXY_PORT_FIELD = 'port'

/** Default Clash/V2Ray mixed port when the user-settings document has no override. */
export const DEFAULT_PROXY_PORT = 7897

/** Smallest accepted TCP port. */
const PORT_MIN = 1

/** Largest accepted TCP port. */
const PORT_MAX = 65535

/**
 * Whether a value is a TCP port the settings schema and this plugin both accept.
 * @param value - candidate from config or user input.
 * @returns whether the value is an integer in 1–65535.
 */
export function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= PORT_MIN && value <= PORT_MAX
}

/**
 * Narrow a config or settings value to a TCP port.
 * @param value - number or decimal digit string.
 * @returns the port, or undefined when the value is not a valid port.
 */
export function parsePort(value: unknown): number | undefined {
  if (isValidPort(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const port = Number(value.trim())
    if (isValidPort(port)) return port
  }
  return undefined
}

/**
 * Loopback HTTP proxy URL for one TCP port.
 * @param port - already-validated TCP port.
 * @returns `http://127.0.0.1:{port}`.
 */
export function proxyUrlForPort(port: number): string {
  return `http://127.0.0.1:${String(port)}`
}
