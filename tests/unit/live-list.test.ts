import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { LibraryService } from '../../electron/services/library-service'
import { queryLiveLists, rewriteLiveListBody } from '../../electron/services/live-lists'
import { createMigratedDatabase } from '../helpers/database'
import {
  fenceLiveListBlock,
  findLiveListBlocks,
  formatLiveListBlock,
  parseLiveListBlock,
  rewriteLiveListWords,
  type LiveListResult
} from '../../src/shared/live-list'
// The List's applyTaskFilters is this function with its view's filter, search and Hide done.
import { matchingTasks } from '../../src/shared/task-view-filter'
import type { TaskFilter } from '../../src/shared/task-filter'
import { useTempDir } from '../helpers/temp-dir'

const ACTIVE: TaskFilter = {
  match: 'all',
  conditions: [{ field: 'status', op: 'is', value: ['active'] }]
}
const filterLine = (filter: TaskFilter) => `filter: ${JSON.stringify(filter)}`

describe('parseLiveListBlock (N4.4c)', () => {
  it('reads the view form with a title and a limit, ignoring # lines and blank lines', () => {
    const parsed = parseLiveListBlock(
      '# Tasks in a view\n\nview: abc-123\ntitle: Open work\nlimit: 5'
    )
    expect(parsed).toEqual({
      ok: true,
      spec: { source: { kind: 'view', viewId: 'abc-123' }, title: 'Open work', limit: 5 }
    })
  })

  it('reads the filter form through parseTaskFilter, with the default limit', () => {
    const parsed = parseLiveListBlock(filterLine(ACTIVE))
    expect(parsed).toEqual({
      ok: true,
      spec: { source: { kind: 'filter', filter: ACTIVE }, title: null, limit: 20 }
    })
  })

  it('reports what is wrong in words', () => {
    const problem = (text: string) => {
      const parsed = parseLiveListBlock(text)
      return parsed.ok ? null : parsed.problem
    }
    expect(problem('filter: {not json')).toMatch(/not valid JSON/)
    expect(problem('colour: red\nview: abc')).toMatch(/Line 1 is not part of a live list/)
    expect(problem('view: abc\nview: def')).toMatch(/more than once/)
    expect(problem(`view: abc\n${filterLine(ACTIVE)}`)).toMatch(/not both/)
    expect(problem('title: Only a title')).toMatch(/Give a saved view/)
    expect(problem('view: abc\nlimit: 0')).toMatch(/from 1 to 100/)
    expect(problem('view: abc\nlimit: 101')).toMatch(/from 1 to 100/)
    expect(problem('view: abc\nlimit: 2.5')).toMatch(/from 1 to 100/)
    expect(problem('view: ../../etc')).toMatch(/view id/)
    expect(problem('filter: {"conditions":[{"field":"mood","op":"is","value":"x"}]}')).toMatch(
      /unknown field "mood"/
    )
  })

  it('writes a block that reads back the same', () => {
    const spec = { source: { kind: 'filter' as const, filter: ACTIVE }, title: 'Now', limit: 7 }
    const block = fenceLiveListBlock(formatLiveListBlock(spec, 'Tasks where status is In progress'))
    const [found] = findLiveListBlocks(`Intro\n\n${block}\n\nOutro`)
    expect(found.body.split('\n')[0]).toBe('# Tasks where status is In progress')
    expect(parseLiveListBlock(found.body)).toEqual({ ok: true, spec })
  })
})

describe('findLiveListBlocks and rewriteLiveListWords (N4.4c)', () => {
  it('finds only ostler-tasks fences, with tildes and longer fences too', () => {
    const text = [
      '```js',
      'view: no',
      '```',
      '~~~~ostler-tasks',
      'view: one',
      '~~~~',
      '```ostler-tasks',
      'view: two',
      '```'
    ].join('\n')
    expect(findLiveListBlocks(text).map((block) => block.body)).toEqual(['view: one', 'view: two'])
  })

  it('replaces the # lines with the words now, and leaves a broken block alone', () => {
    const text = [
      'Before',
      '```ostler-tasks',
      '# old words',
      '# more old words',
      filterLine(ACTIVE),
      '```',
      '```ostler-tasks',
      '# keep me',
      'filter: {broken',
      '```',
      'After'
    ].join('\n')
    const out = rewriteLiveListWords(text, () => 'Tasks where status is In progress')
    expect(out).toBe(
      [
        'Before',
        '```ostler-tasks',
        '# Tasks where status is In progress',
        filterLine(ACTIVE),
        '```',
        '```ostler-tasks',
        '# keep me',
        'filter: {broken',
        '```',
        'After'
      ].join('\n')
    )
  })
})

describe('queryLiveLists (N4.4c)', () => {
  const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const human = { kind: 'human' as const }
  const tempDir = useTempDir('ostler-live-lists-')
  let planning: PlanningService

  beforeEach(async () => {
    const dbPath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(dbPath, () => [P])
  })

  afterEach(() => {
    planning.close()
  })

  const add = (title: string, extra: Record<string, unknown> = {}) =>
    planning.createWorkItem(P, { title, ...extra }, human)

  const ok = (result: LiveListResult) => {
    if (!result.ok) throw new Error(result.problem)
    return result
  }

  it('shows the same tasks as the List for the same filter, with counts and the limit', () => {
    for (let i = 0; i < 5; i++) add(`Design ${i}`, { status: 'active', labels: ['design'] })
    add('Design review', { status: 'review', labels: ['design'] })
    add('Design done', { status: 'done', labels: ['design'] })
    add('Other', { status: 'active' })
    const filter: TaskFilter = {
      match: 'all',
      conditions: [{ field: 'labels', op: 'hasAny', value: ['design'] }]
    }
    const [result] = queryLiveLists(planning, P, [`${filterLine(filter)}\nlimit: 3`], null)
    const list = ok(result)
    const items = planning.listWorkItems(P)
    const context = planning.taskFilterContext(P)
    const expected = matchingTasks(items, filter, '', context)
    expect(list.total).toBe(expected.length)
    expect(list.total).toBe(7)
    expect(list.tasks.map((task) => task.id)).toEqual(expected.slice(0, 3).map((item) => item.id))
    expect(list.counts).toEqual([
      { status: 'active', label: 'in progress', count: 5 },
      { status: 'review', label: 'in review', count: 1 },
      { status: 'done', label: 'done', count: 1 }
    ])
    expect(list.words).toBe('Tasks where labels include any of design')
  })

  it('uses a saved view filter and search, and says so when the view is deleted', () => {
    add('Write the brief', { status: 'active' })
    add('Write the tests', { status: 'backlog' })
    const view = planning.views.create(P, {
      name: 'Writing in progress',
      viewType: 'board',
      config: { filter: ACTIVE, query: 'write', options: { hideDone: true, sort: 'title' } }
    })
    const block = `view: ${view.id}`
    const list = ok(queryLiveLists(planning, P, [block], null)[0])
    expect(list.tasks.map((task) => task.title)).toEqual(['Write the brief'])
    expect(list.viewName).toBe('Writing in progress')
    expect(list.query).toBe('write')
    planning.views.delete(view.id)
    expect(queryLiveLists(planning, P, [block], null)[0]).toMatchObject({
      ok: false,
      reason: 'missingView'
    })
  })

  it('answers many blocks in one call, a broken one quietly', () => {
    for (let i = 0; i < 50; i++) add(`Task ${i}`, { status: i % 2 ? 'active' : 'done' })
    const blocks = [...Array.from({ length: 9 }, () => filterLine(ACTIVE)), 'filter: {broken']
    const results = queryLiveLists(planning, P, blocks, null)
    expect(results).toHaveLength(10)
    expect(results.slice(0, 9).every((result) => result.ok && result.total === 25)).toBe(true)
    expect(results[9]).toMatchObject({ ok: false, reason: 'invalid' })
    expect(() => queryLiveLists(planning, P, 'view: x', null)).toThrow()
  })

  it('writes the words line again when a note is saved', () => {
    const library = new LibraryService(path.join(tempDir(), 'ostler.db'), tempDir())
    try {
      library.setBodyRewriter((projectId, body) => rewriteLiveListBody(planning, projectId, body))
      const body = `Status:\n\n\`\`\`ostler-tasks\n# stale\n${filterLine(ACTIVE)}\n\`\`\``
      const item = library.createItem(P, { kind: 'note', title: 'Status', body })
      expect(item.body).toContain('# Tasks where status is In progress\nfilter:')
      expect(item.body).not.toContain('# stale')
      expect(rewriteLiveListBody(planning, P, 'No lists here')).toBe('No lists here')
    } finally {
      library.close()
    }
  })
})
