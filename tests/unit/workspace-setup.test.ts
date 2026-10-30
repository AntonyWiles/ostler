import { describe, expect, it } from 'vitest'
import {
  describeWorkspaceSetup,
  parseAgentSetup,
  resolveWorkspaceSetup,
  type SetupInputs
} from '../../src/shared/workspace-setup'

const inputs = (rootFiles: string[], extra: Partial<SetupInputs> = {}): SetupInputs => ({
  rootFiles,
  hasYarnrcYml: false,
  ...extra
})

const runCommand = (rootFiles: string[], extra?: Partial<SetupInputs>) => {
  const resolved = resolveWorkspaceSetup(undefined, inputs(rootFiles, extra))
  return resolved.kind === 'run' ? resolved.command : null
}

describe('resolveWorkspaceSetup detection table', () => {
  it.each([
    [['pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
    [['bun.lock'], 'bun install --frozen-lockfile'],
    [['bun.lockb'], 'bun install --frozen-lockfile'],
    [['package-lock.json'], 'npm ci'],
    [['npm-shrinkwrap.json'], 'npm ci'],
    [['uv.lock'], 'uv sync --frozen']
  ])('detects %j', (rootFiles, command) => {
    expect(runCommand(rootFiles)).toBe(command)
  })

  it('restores a .NET solution at the root, by its name', () => {
    expect(runCommand(['PomodoroDesk.sln', 'README.md', 'src'])).toBe(
      'dotnet restore "PomodoroDesk.sln"'
    )
    expect(runCommand(['My App.slnx'])).toBe('dotnet restore "My App.slnx"')
    const resolved = resolveWorkspaceSetup(undefined, inputs(['PomodoroDesk.sln']))
    expect(resolved).toMatchObject({ detectedFrom: 'PomodoroDesk.sln' })
  })

  it('restores a lone .NET project when there is no solution, and prefers the solution', () => {
    expect(runCommand(['Timer.csproj'])).toBe('dotnet restore "Timer.csproj"')
    expect(runCommand(['Timer.fsproj'])).toBe('dotnet restore "Timer.fsproj"')
    expect(runCommand(['Timer.csproj', 'Timer.sln'])).toBe('dotnet restore "Timer.sln"')
  })

  it('runs nothing for a .NET repository whose solution does not exist yet', () => {
    // The first task usually creates the solution; a restore before it fails.
    expect(runCommand(['README.md', '.gitignore'])).toBeNull()
  })

  it('uses Yarn Classic flags for yarn.lock without Berry markers', () => {
    expect(runCommand(['yarn.lock'])).toBe('yarn install --frozen-lockfile')
  })

  it('uses Yarn Berry flags when .yarnrc.yml is present', () => {
    expect(runCommand(['yarn.lock', '.yarnrc.yml'], { hasYarnrcYml: true })).toBe(
      'yarn install --immutable'
    )
  })

  it('uses Yarn Berry flags when packageManager pins yarn 2 or later', () => {
    expect(runCommand(['yarn.lock'], { packageManagerField: 'yarn@4.1.0+sha256.abc' })).toBe(
      'yarn install --immutable'
    )
  })

  it('keeps Yarn Classic when packageManager pins yarn 1', () => {
    expect(runCommand(['yarn.lock'], { packageManagerField: 'yarn@1.22.22' })).toBe(
      'yarn install --frozen-lockfile'
    )
  })

  it('ignores a packageManager field that names another tool', () => {
    expect(runCommand(['package-lock.json'], { packageManagerField: 'pnpm@9.0.0' })).toBe('npm ci')
  })

  it('returns no command when no recognised lockfile exists', () => {
    expect(resolveWorkspaceSetup(undefined, inputs(['package.json', 'src']))).toEqual({
      kind: 'none',
      reason: 'no-lockfile'
    })
  })

  it('does not treat a Rust or Go project as needing setup', () => {
    expect(resolveWorkspaceSetup(undefined, inputs(['Cargo.toml', 'Cargo.lock']))).toEqual({
      kind: 'none',
      reason: 'no-lockfile'
    })
    expect(resolveWorkspaceSetup(undefined, inputs(['go.mod', 'go.sum']))).toEqual({
      kind: 'none',
      reason: 'no-lockfile'
    })
  })

  it('takes the first matching row when several lockfiles exist', () => {
    // pnpm sits above npm in the table, so a project carrying both is installed with pnpm.
    expect(runCommand(['package-lock.json', 'pnpm-lock.yaml'])).toBe(
      'pnpm install --frozen-lockfile'
    )
    expect(runCommand(['uv.lock', 'package-lock.json'])).toBe('npm ci')
  })

  it('reports which root file selected the command', () => {
    expect(resolveWorkspaceSetup(undefined, inputs(['yarn.lock']))).toEqual({
      kind: 'run',
      command: 'yarn install --frozen-lockfile',
      source: 'detected',
      detectedFrom: 'yarn.lock'
    })
  })
})

describe('resolveWorkspaceSetup settings', () => {
  it('treats a missing setting as automatic', () => {
    expect(runCommand(['package-lock.json'])).toBe('npm ci')
  })

  it('runs nothing when off, even with a lockfile present', () => {
    expect(resolveWorkspaceSetup({ mode: 'off' }, inputs(['package-lock.json']))).toEqual({
      kind: 'none',
      reason: 'off'
    })
  })

  it('runs the custom command, trimmed, and ignores the lockfile', () => {
    expect(
      resolveWorkspaceSetup(
        { mode: 'custom', command: '  poetry install  ' },
        inputs(['package-lock.json'])
      )
    ).toEqual({ kind: 'run', command: 'poetry install', source: 'custom' })
  })

  it('refuses a whitespace-only custom command', () => {
    expect(() => resolveWorkspaceSetup({ mode: 'custom', command: '   ' }, inputs([]))).toThrow(
      /empty/
    )
  })
})

describe('parseAgentSetup', () => {
  it('accepts the three modes', () => {
    expect(parseAgentSetup({ mode: 'auto' })).toEqual({ mode: 'auto' })
    expect(parseAgentSetup({ mode: 'off' })).toEqual({ mode: 'off' })
    expect(parseAgentSetup({ mode: 'custom', command: ' npm ci ' })).toEqual({
      mode: 'custom',
      command: 'npm ci'
    })
  })

  it('rejects a blank custom command, so it is never saved', () => {
    expect(() => parseAgentSetup({ mode: 'custom', command: '  ' })).toThrow(/needs a command/)
    expect(() => parseAgentSetup({ mode: 'custom' })).toThrow(/needs a command/)
  })

  it('rejects a value that is not one of the three modes', () => {
    expect(() => parseAgentSetup({ mode: 'none' })).toThrow(/Automatic, Custom or Off/)
    expect(() => parseAgentSetup('npm ci')).toThrow(/must be an object/)
  })

  it('rejects an overlong command', () => {
    expect(() => parseAgentSetup({ mode: 'custom', command: 'x'.repeat(501) })).toThrow(
      /at most 500/
    )
  })
})

describe('describeWorkspaceSetup', () => {
  it('is null without a record', () => {
    expect(describeWorkspaceSetup(undefined)).toBeNull()
  })

  it('says what ran', () => {
    expect(describeWorkspaceSetup({ status: 'succeeded', command: 'npm ci' })).toContain(
      'Ostler ran `npm ci` in this workspace before you started'
    )
  })

  it('says why nothing ran', () => {
    expect(describeWorkspaceSetup({ status: 'skipped', skipReason: 'off' })).toMatch(/Setup is off/)
    expect(describeWorkspaceSetup({ status: 'skipped', skipReason: 'no-lockfile' })).toMatch(
      /No setup ran: this project has no lockfile/
    )
    expect(describeWorkspaceSetup({ status: 'skipped' })).toBe('No setup ran for this workspace.')
  })

  it('says a running setup is still going, and a failed one why', () => {
    expect(describeWorkspaceSetup({ status: 'running' })).toMatch(/still preparing/)
    expect(describeWorkspaceSetup({ status: 'failed', failure: 'Setup failed: x' })).toBe(
      'Ostler could not prepare this workspace: Setup failed: x.'
    )
    expect(describeWorkspaceSetup({ status: 'cancelled' })).toMatch(/stopped preparing/)
  })
})
