import { execFile } from 'child_process'
import { existsSync } from 'fs'
import type { AgentRequirements, OstlerConfig } from '@shared/ostler-api'
import { isAiConfigured } from '@shared/ai-configured'
import { defaultResolveBinary } from './opencode-runner-service'
import { getRuntimeApiKey } from './runtime-credentials'

export interface AgentRequirementProbes {
  gitVersion(): Promise<string | null>
  runtimePresent(): boolean
  getConfig(): OstlerConfig
}

/** Runs `git --version`; null when Git is missing or does not answer in time. */
export function probeGitVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      const version = String(stdout ?? '').trim()
      resolve(error || !version ? null : version)
    })
  })
}

/** Whether the bundled agent runtime is where this build expects it. */
export function probeRuntime(): boolean {
  try {
    return existsSync(defaultResolveBinary())
  } catch {
    return false
  }
}

/**
 * The guided agent setup's checks (P7.2): Git is installed, Ostler AI is set
 * up, and the bundled agent runtime is present. Each answer is a fact the
 * dialog pairs with a plain fix; nothing here changes anything.
 */
export async function checkAgentRequirements(
  probes: AgentRequirementProbes
): Promise<AgentRequirements> {
  const config = probes.getConfig()
  return {
    gitVersion: await probes.gitVersion(),
    aiConfigured: isAiConfigured({ ...config.ai, hasApiKey: getRuntimeApiKey(config).length > 0 }),
    runtimePresent: probes.runtimePresent()
  }
}
