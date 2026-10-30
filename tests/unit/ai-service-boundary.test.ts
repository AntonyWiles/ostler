import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')

describe('built-in AI / harness boundary', () => {
  it('keeps the AI service independent of the harness control plane', () => {
    const source = fs.readFileSync(path.join(root, 'electron/services/ai-service.ts'), 'utf8')

    expect(source).not.toMatch(/from ['"].*harness-(?:service|http-server)['"]/)
    expect(source).not.toMatch(/HarnessService|HarnessHttpServer/)
  })

  it('stores AI-authored notes in the dedicated AI namespace, not harness storage', () => {
    const source = fs.readFileSync(
      path.join(root, 'electron/services/ai-storage-service.ts'),
      'utf8'
    )

    expect(source).toContain("this.ensureDirectory('ai', 'project-notes', projectId)")
    expect(source).not.toContain("'harness'")
  })

  it('keeps AI planning drafts outside the harness control plane', () => {
    const source = fs.readFileSync(
      path.join(root, 'electron/services/ai-planning-service.ts'),
      'utf8'
    )

    expect(source).not.toMatch(/from ['"].*harness-(?:service|http-server)['"]/)
    expect(source).not.toMatch(/HarnessService|HarnessHttpServer/)
    expect(source).toContain('writePlanningDraft')
    expect(source).toContain('writeNextTasksDraft')
  })
})
