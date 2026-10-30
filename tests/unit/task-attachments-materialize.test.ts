import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { materializeTaskAttachments } from '../../electron/services/opencode/task-attachments'
import type { TaskAttachmentReader } from '../../electron/services/task-attachments'

function noteReader(body: string): TaskAttachmentReader {
  const item = {
    id: '9b4dd3fe-0000-0000-0000-000000000000',
    kind: 'note',
    title: 'Improve the graphics',
    summary: '',
    body,
    revision: 1
  }
  return {
    agentAttachments: () => ({
      given: [{ item, attachedBy: 'human', revisionAtAttach: 1, currentRevision: 1 }],
      skipped: []
    }),
    originalFilePath: () => {
      throw new Error('no file')
    },
    getItemText: () => body
  } as unknown as TaskAttachmentReader
}

describe('materializeTaskAttachments', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-attachments-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('delivers again into a slot whose previous task left read-only copies behind', () => {
    const log: string[] = []
    const first = materializeTaskAttachments(noteReader('first'), 'p', 'w', home, (m) =>
      log.push(m)
    )
    expect(first).toHaveLength(1)

    // Same slot, next task: the earlier copy is still there and read-only.
    const leftover = path.join(home, 'attachments', 'stale-from-last-task.md')
    fs.writeFileSync(leftover, 'stale')
    fs.chmodSync(leftover, 0o444)

    const second = materializeTaskAttachments(noteReader('second'), 'p', 'w', home, (m) =>
      log.push(m)
    )
    expect(second).toHaveLength(1)
    expect(fs.readFileSync(second[0].paths[0], 'utf8')).toContain('second')
    expect(fs.existsSync(leftover)).toBe(false)
  })
})
