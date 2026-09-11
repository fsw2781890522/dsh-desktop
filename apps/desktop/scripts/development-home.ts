/** Unpackaged Desktop Harness home: `$DSH_HOME` when set, otherwise `~/.dsh`. */

import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/**
 * Resolve the Harness home for an unpackaged Electron development launch.
 * @param env - process environment; `$DSH_HOME` overrides `~/.dsh`.
 * @returns absolute Harness home path shared with CLI dsh.
 */
export function resolveDevelopmentHarnessHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveDshHome(undefined, env)
}
