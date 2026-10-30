import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = path.resolve('scripts/extract-codex-session.cjs')
const genericScriptPath = path.resolve('scripts/extract-agent-session.cjs')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-codex-extractor-'))
  temporaryDirectories.push(root)
  const input = path.join(root, 'rollout.jsonl')
  const lines = [
    {
      type: 'session_meta',
      payload: {
        session_id: 'session-123',
        cwd: 'C:\\work\\ostler',
        git: {
          branch: 'main',
          repository_url: 'https://github.com/example/ostler.git'
        }
      }
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '<recommended_plugins>context</recommended_plugins>\n# AGENTS.md instructions for C:\\work\\ostler\n<environment_context>injected context</environment_context>'
          }
        ]
      }
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'Ignore this internal instruction.' }]
      }
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please inspect src/app.tsx and docs/progress.md.' }]
      }
    },
    {
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'I will inspect the requested files.' }],
        encrypted_content: 'must never appear in the export'
      }
    },
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        input: 'Get-Content C:\\work\\ostler\\src\\app.tsx'
      }
    },
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        output: [
          {
            type: 'input_text',
            text: 'Changed C:\\work\\ostler\\docs\\progress.md and C:\\Users\\jordan\\secret\\outside.txt'
          }
        ]
      }
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'The inspection is complete at C:\\work\\ostler\\src\\app.tsx. https://github.com/example/ostler.git'
          }
        ]
      }
    },
    {
      type: 'event_msg',
      payload: { type: 'task_complete', last_agent_message: 'The inspection is complete.' }
    }
  ]
  fs.writeFileSync(
    input,
    lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')
  )
  return { root, input }
}

describe('extract-codex-session', () => {
  it('keeps conversation content, readable reasoning, and derived references only', () => {
    const { root, input } = makeFixture()
    const outputDirectory = path.join(root, 'exports')
    const before = fs.readFileSync(input, 'utf8')

    execFileSync(process.execPath, [scriptPath, input, '--output-dir', outputDirectory], {
      encoding: 'utf8'
    })

    const output = path.join(outputDirectory, 'rollout.ostler.json')
    const exportData = JSON.parse(fs.readFileSync(output, 'utf8')) as {
      format: string
      schemaVersion: number
      session: {
        id: string
        project: { name: string; directory: string; match: { status: string } }
      }
      messages: { role: string; content: string }[]
      references: { files: string[]; folders: string[]; projects: string[] }
      extraction: { malformedLineCount: number }
    }

    expect(exportData.format).toBe('ostler.agent-session')
    expect(exportData.schemaVersion).toBe(1)
    expect(exportData.session).toMatchObject({
      id: 'session-123',
      project: {
        name: 'ostler',
        directory: 'ostler',
        match: { status: 'unresolved' }
      }
    })
    expect(exportData.messages).toEqual([
      { role: 'user', content: 'Please inspect src/app.tsx and docs/progress.md.' },
      { role: 'reasoning', content: 'I will inspect the requested files.' },
      {
        role: 'assistant',
        content: 'The inspection is complete at ostler\\src\\app.tsx. '
      }
    ])
    expect(exportData.references.projects).toContain('ostler')
    expect(exportData.references.files).toEqual(
      expect.arrayContaining([
        'src\\app.tsx',
        'docs\\progress.md',
        'ostler\\src\\app.tsx',
        'ostler\\docs\\progress.md',
        'outside.txt'
      ])
    )
    expect(exportData.references.folders).toEqual(expect.arrayContaining(['src', 'docs']))
    expect(JSON.stringify(exportData)).not.toContain('Ignore this internal instruction')
    expect(JSON.stringify(exportData)).not.toContain('must never appear in the export')
    expect(JSON.stringify(exportData)).not.toContain('C:\\work')
    expect(JSON.stringify(exportData)).not.toContain('repositoryUrl')
    expect(JSON.stringify(exportData)).not.toContain('github.com')
    expect(exportData.extraction.malformedLineCount).toBe(0)
    expect(fs.readFileSync(input, 'utf8')).toBe(before)
  })

  it('can omit readable reasoning and refuses to overwrite the input', () => {
    const { input } = makeFixture()
    const output = `${input}.ostler.json`

    execFileSync(process.execPath, [scriptPath, input, '--output', output, '--no-reasoning'], {
      encoding: 'utf8'
    })
    const exportData = JSON.parse(fs.readFileSync(output, 'utf8')) as {
      messages: { role: string }[]
    }
    expect(exportData.messages.some((message) => message.role === 'reasoning')).toBe(false)

    expect(() =>
      execFileSync(process.execPath, [scriptPath, input, '--output', input], {
        encoding: 'utf8',
        stdio: 'pipe'
      })
    ).toThrow()
  })

  it('fails loudly when the JSONL format cannot be parsed or has no conversation roles', () => {
    const { root, input } = makeFixture()
    fs.appendFileSync(input, '\n{not valid json}')
    const output = path.join(root, 'should-not-exist.ostler.json')

    let failure: { status?: number; stderr?: Buffer | string } | undefined
    try {
      execFileSync(process.execPath, [scriptPath, input, '--output', output], {
        encoding: 'utf8',
        stdio: 'pipe'
      })
    } catch (error) {
      failure = error as { status?: number; stderr?: Buffer | string }
    }

    expect(failure?.status).toBe(1)
    expect(String(failure?.stderr)).toContain('SESSION_FORMAT_CHANGED')
    expect(String(failure?.stderr)).toContain('malformed JSONL')
    expect(fs.existsSync(output)).toBe(false)

    const roleLessInput = path.join(root, 'role-less.jsonl')
    fs.writeFileSync(
      roleLessInput,
      JSON.stringify({
        type: 'session_meta',
        payload: { session_id: 'role-less', cwd: 'C:\\work\\ostler' }
      })
    )
    let roleFailure: { status?: number; stderr?: Buffer | string } | undefined
    try {
      execFileSync(process.execPath, [scriptPath, roleLessInput], {
        encoding: 'utf8',
        stdio: 'pipe'
      })
    } catch (error) {
      roleFailure = error as { status?: number; stderr?: Buffer | string }
    }
    expect(roleFailure?.status).toBe(1)
    expect(String(roleFailure?.stderr)).toContain('No user message text')
    expect(String(roleFailure?.stderr)).toContain('No assistant/agent message text')
  })

  it('matches the raw session folder to exactly one Ostler project', () => {
    const { root, input } = makeFixture()
    const manifest = path.join(root, 'ostler-config.json')
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        projects: [{ id: 'project-ostler', name: 'Ostler', path: 'C:\\work\\ostler' }]
      })
    )
    const output = path.join(root, 'matched.ostler.json')

    execFileSync(
      process.execPath,
      [scriptPath, input, '--output', output, '--projects', manifest],
      { encoding: 'utf8' }
    )

    const exportData = JSON.parse(fs.readFileSync(output, 'utf8')) as {
      session: { project: { match: { status: string; id?: string; name?: string } } }
    }
    expect(exportData.session.project.match).toEqual({
      status: 'matched',
      id: 'project-ostler',
      name: 'Ostler'
    })
  })

  it('fails loudly when a supplied Ostler project manifest does not match', () => {
    const { root, input } = makeFixture()
    const manifest = path.join(root, 'ostler-config.json')
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        projects: [{ id: 'project-other', name: 'Other', path: 'C:\\work\\other' }]
      })
    )

    let failure: { status?: number; stderr?: Buffer | string } | undefined
    try {
      execFileSync(process.execPath, [scriptPath, input, '--projects', manifest], {
        encoding: 'utf8',
        stdio: 'pipe'
      })
    } catch (error) {
      failure = error as { status?: number; stderr?: Buffer | string }
    }

    expect(failure?.status).toBe(1)
    expect(String(failure?.stderr)).toContain('PROJECT_MATCH_FAILED')
    expect(String(failure?.stderr)).toContain('unmatched')
  })

  it('extracts a generic Claude-style JSONL session without importing tool blocks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-agent-extractor-'))
    temporaryDirectories.push(root)
    const inputDirectory = path.join(root, 'sessions', 'nested')
    fs.mkdirSync(inputDirectory, { recursive: true })
    const input = path.join(inputDirectory, 'claude.jsonl')
    fs.writeFileSync(
      input,
      [
        JSON.stringify({
          type: 'user',
          cwd: 'C:\\work\\generic-project',
          message: { role: 'user', content: [{ type: 'text', text: 'Review the project.' }] }
        }),
        JSON.stringify({
          type: 'assistant',
          cwd: 'C:\\work\\generic-project',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'I will review the project structure.' },
              { type: 'tool_use', name: 'Read', input: { path: 'C:\\private\\secret.ts' } },
              { type: 'text', text: 'The project is ready for review.' }
            ]
          }
        }),
        JSON.stringify({
          type: 'user',
          cwd: 'C:\\work\\generic-project',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', content: 'secret tool output' }]
          }
        })
      ].join('\n')
    )
    const outputDirectory = path.join(root, 'exports')
    const output = path.join(outputDirectory, 'claude.ostler.json')

    execFileSync(process.execPath, [genericScriptPath, root, '--output-dir', outputDirectory], {
      encoding: 'utf8'
    })
    const exportData = JSON.parse(fs.readFileSync(output, 'utf8')) as {
      session: { project: { name: string; directory: string } }
      messages: { role: string; content: string }[]
    }

    expect(exportData.session.project).toMatchObject({
      name: 'generic-project',
      directory: 'generic-project'
    })
    expect(exportData.messages).toEqual([
      { role: 'user', content: 'Review the project.' },
      { role: 'reasoning', content: 'I will review the project structure.' },
      { role: 'assistant', content: 'The project is ready for review.' }
    ])
    expect(JSON.stringify(exportData)).not.toContain('tool_use')
    expect(JSON.stringify(exportData)).not.toContain('secret tool output')
    expect(JSON.stringify(exportData)).not.toContain('C:\\work')
  })
})
