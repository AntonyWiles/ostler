import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GithubClient } from '../../electron/services/github/github-client'
import { ImportService } from '../../electron/services/import-service'
import { PlanningService } from '../../electron/services/planning-service'
import type { GithubImportPreview, ImportResult, WatchedProject } from '../../src/shared/ostler-api'
import { analyzeGithubIssues, type GithubImportIssue } from '../../src/shared/import/github-import'
import { createMigratedDatabase } from '../helpers/database'
import { RECORDED, recordedGithub } from '../helpers/github'
import { useTempDir } from '../helpers/temp-dir'

const issue = (number: number, extra: Partial<GithubImportIssue> = {}): GithubImportIssue => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  body: '',
  labels: [],
  assignees: [],
  milestone: null,
  ...extra
})

describe('analyzeGithubIssues (R4.4)', () => {
  it('drafts tasks from issues, skipping the ones already linked', () => {
    const { plan, preview } = analyzeGithubIssues(
      {
        owner: 'acme',
        repo: 'site',
        truncated: false,
        issues: [
          issue(1, {
            title: 'Fix\u0007 the  footer',
            body: 'Body with **Markdown**\r\nand <img src=x onerror=alert(1)>',
            labels: [
              { name: 'bug', color: 'd73a4a' },
              { name: 'bug', color: 'd73a4a' },
              { name: 'ui', color: 'zzz' }
            ],
            assignees: ['ada', 'grace'],
            milestone: 'Launch'
          }),
          issue(2),
          issue(3, { state: 'closed', title: '' })
        ]
      },
      { milestones: [], people: ['Ada'] },
      new Set([2])
    )
    expect(preview).toMatchObject({
      repository: 'acme/site',
      issueCount: 3,
      alreadyLinkedCount: 1,
      importableCount: 2,
      truncated: false,
      newMilestones: ['Launch'],
      newPeople: []
    })
    expect(plan.tasks.map((task) => task.line)).toEqual([1, 3])
    const [first, closed] = plan.tasks
    expect(first).toMatchObject({
      title: 'Fix the footer',
      // Kept as Markdown, as data: the drawer renders it through the sanitiser.
      description: 'Body with **Markdown**\nand <img src=x onerror=alert(1)>',
      status: 'backlog',
      labels: ['bug', 'ui'],
      assigneeName: 'ada',
      milestoneName: 'Launch',
      githubIssue: { owner: 'acme', repo: 'site', number: 1, state: 'open' }
    })
    expect(plan.labelColors.map((label) => label.name)).toEqual(['bug'])
    expect(preview.rows[0].warnings.map((warning) => warning.field)).toEqual(['assignee'])
    expect(closed).toMatchObject({ title: 'Issue 3', status: 'done' })
  })
})

describe('ImportService from GitHub issues (R4.4)', () => {
  const tempDir = useTempDir('ostler-github-import-')
  let planning: PlanningService
  let imports: ImportService
  const project = { id: 'p1', name: 'Site', githubRepository: 'acme/site' } as WatchedProject
  let issues: unknown[]

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1'])
    issues = [RECORDED.openIssue, { ...RECORDED.closedIssue, state: 'open' }, RECORDED.mergedPull]
    const recorded = recordedGithub({
      '/repos/acme/site/issues': () => ({ status: 200, body: issues })
    })
    imports = new ImportService({
      planning,
      packages: {} as never,
      getProjects: () => [project],
      locale: () => 'en-GB',
      github: new GithubClient({ fetch: recorded.fetch, token: () => '', userAgent: 'Test' })
    })
  })

  afterEach(() => {
    planning.close()
  })

  const importOnce = async () => {
    const file = await imports.loadGithubIssues({ repository: 'https://github.com/acme/site' })
    expect(file).toMatchObject({ kind: 'github', fileName: 'acme/site' })
    const preview = imports.previewGithub(file.fileId, 'p1')
    const result =
      preview.importableCount > 0
        ? await imports.runImport(
            file.fileId,
            { kind: 'github' },
            { kind: 'project', projectId: 'p1' }
          )
        : null
    return { preview, result }
  }

  it('imports issues as linked tasks, adds only new ones next time, and undoes', async () => {
    const { preview, result } = await importOnce()
    expect(preview).toMatchObject({ issueCount: 2, importableCount: 2, alreadyLinkedCount: 0 })
    expect(result!.batch).toMatchObject({ source: 'github', fileName: 'acme/site', itemCount: 2 })
    const items = planning.listWorkItems('p1')
    expect(items.map((item) => [item.title, item.origin, item.labels])).toEqual([
      ['Footer links are broken', 'imported', ['bug']],
      ['Old logo', 'imported', ['design']]
    ])
    expect(items[0].description).toContain('The **footer** links go nowhere.')
    expect(items[0].githubLinks).toEqual([
      expect.objectContaining({
        owner: 'acme',
        repo: 'site',
        number: 12,
        kind: 'issue',
        title: 'Footer links are broken',
        state: 'open',
        fetchedAt: expect.any(Number)
      })
    ])

    // Nothing new: nothing to import. One new issue: only that one.
    expect((await importOnce()).preview).toMatchObject({
      importableCount: 0,
      alreadyLinkedCount: 2
    })
    issues = [...issues, { ...RECORDED.openIssue, number: 14, title: 'New one' }]
    const second = await importOnce()
    expect(second.preview).toMatchObject({ importableCount: 1, alreadyLinkedCount: 2 })
    expect(planning.listWorkItems('p1').map((item) => item.title)).toContain('New one')

    // Undo the first import: its tasks go to the recycle bin, and their issues import again.
    const undone = imports.undo(result!.batch.id, false, planning.humanActor())
    expect(undone.movedIds).toHaveLength(2)
    expect(planning.listWorkItems('p1').map((item) => item.title)).toEqual(['New one'])
    expect((await importOnce()).preview).toMatchObject({
      importableCount: 2,
      alreadyLinkedCount: 1
    })
  })

  it('imports through the automation entry point, with a dry run first', async () => {
    const dry = (await imports.importGithubIssues(
      'p1',
      { repository: 'acme/site', state: 'all' },
      true,
      { kind: 'automation' }
    )) as GithubImportPreview
    expect(dry.importableCount).toBe(2)
    expect(planning.listWorkItems('p1')).toEqual([])
    const done = (await imports.importGithubIssues('p1', { repository: 'acme/site' }, false, {
      kind: 'automation'
    })) as ImportResult
    expect(done.batch.itemCount).toBe(2)
    await expect(
      imports.importGithubIssues('p1', { repository: 'gitlab.com/x/y' }, true, {
        kind: 'automation'
      })
    ).rejects.toThrow(/GitHub repository/)
  })
})
