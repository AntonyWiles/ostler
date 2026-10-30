import { describe, expect, it } from 'vitest'
import {
  collectPackages,
  policyProblem,
  renderNotices,
  resolveEntries
} from '../../scripts/generate-third-party-notices.cjs'

const tree = {
  dependencies: {
    alpha: {
      version: '1.0.0',
      path: '/nm/alpha',
      license: 'MIT',
      dependencies: {
        beta: { version: '2.0.0', path: '/nm/beta', license: 'GPL-3.0' },
        gamma: { version: '3.0.0' } // a deduped reference
      }
    },
    gamma: { version: '3.0.0', path: '/nm/gamma', license: '(MIT OR Apache-2.0)' },
    'opencode-ai': { version: '1.0.0', path: '/nm/opencode-ai', license: 'MIT' },
    'opencode-windows-x64': { version: '1.0.0', path: '/nm/opencode-windows-x64' }
  }
}

const texts: Record<string, string> = {
  '/nm/alpha': 'MIT License\n\nCopyright (c) Alpha',
  '/nm/beta': 'GNU GENERAL PUBLIC LICENSE',
  '/nm/gamma': 'Gamma licence text',
  '/nm/opencode-ai': 'MIT License\n\nCopyright (c) opencode'
}
const readText = (dir: string): string | null => texts[dir] ?? null

describe('third-party notices', () => {
  it('flattens the tree once per package, skipping deduped references', () => {
    expect(collectPackages(tree).map((p) => p.name)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'opencode-ai',
      'opencode-windows-x64'
    ])
  })

  it('refuses a synthetic GPL entry', () => {
    const { problems } = resolveEntries(collectPackages(tree), readText)
    expect(problems).toEqual(['beta@2.0.0 is GPL-3.0, which the policy refuses (GPL/AGPL)'])
  })

  it('refuses AGPL, missing and unknown licences, and allows permissive ones', () => {
    expect(policyProblem('AGPL-3.0-only')).toMatch(/GPL/)
    expect(policyProblem('MIT OR GPL-2.0')).toMatch(/GPL/)
    expect(policyProblem(null)).toBe('has no licence')
    expect(policyProblem('SEE LICENSE IN LICENSE.txt')).toMatch(/unknown/)
    expect(policyProblem('(MIT OR WTFPL)')).toBeNull()
    expect(policyProblem('BSD-3-Clause')).toBeNull()
    expect(policyProblem('MIT AND CC-BY-NC-4.0')).toMatch(/unknown/)
  })

  it('writes each package with its licence text, the vendored opencode binary included', () => {
    const safe = collectPackages(tree).filter((p) => p.name !== 'beta')
    const { entries, problems } = resolveEntries(safe, readText)
    expect(problems).toEqual([])
    const notices = renderNotices(entries)
    expect(notices).toContain('## alpha 1.0.0')
    expect(notices).toContain('Copyright (c) Alpha')
    expect(notices).toContain('Licence: (MIT OR Apache-2.0)')
    const binary = notices.slice(notices.indexOf('## opencode-windows-x64 1.0.0'))
    expect(binary).toContain('Licence: MIT')
    expect(binary).toContain('Copyright (c) opencode')
  })
})
