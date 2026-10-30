import { describe, expect, it } from 'vitest'
import { projectMatch, sanitizeText, textFrom } from '../../scripts/agent-session-parser-core.cjs'

describe('agent session parser core', () => {
  it('normalizes nested text-bearing response blocks', () => {
    expect(
      textFrom([
        { type: 'input_text', text: 'User request' },
        { summary: [{ summary_text: 'Reasoning summary' }] }
      ])
    ).toBe('User request\nReasoning summary')
  })

  it('prefers an exact project path over ambiguous display names', () => {
    expect(
      projectMatch({ directory: 'C:\\projects\\one', projectName: 'one' }, [
        { id: 'exact', path: 'C:\\projects\\one', name: 'One' },
        { id: 'same-name', path: 'D:\\archive\\one', name: 'One' }
      ])
    ).toEqual({ status: 'matched', id: 'exact', name: 'One' })
  })

  it('sanitizes workspace paths without leaking absolute roots', () => {
    expect(
      sanitizeText('Changed C:\\projects\\one\\src\\main.ts.', {
        directory: 'C:\\projects\\one',
        projectName: 'one'
      })
    ).toBe('Changed one\\src\\main.ts.')
  })
})
