import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  analyzeTrello,
  isTrelloBoard,
  readTrelloBoard,
  trelloLabelColor
} from '../../src/shared/import/trello-import'
import { PROJECT_COLORS } from '../../src/shared/project-colors'

const board = readTrelloBoard(
  JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'import', 'trello-board.json'), 'utf8')
  )
)
const known = { milestones: [], people: ['Sam Lee'] }

describe('Trello import', () => {
  it('recognises a board export and refuses anything else', () => {
    expect(isTrelloBoard({ lists: [], cards: [] })).toBe(true)
    expect(isTrelloBoard({ format: 'ostler-project-package' })).toBe(false)
    expect(() => readTrelloBoard({ name: 'x' })).toThrow(/not a Trello board/)
  })

  it('keeps card order by list, then by place, and skips archived cards', () => {
    const { plan, preview } = analyzeTrello(board, {}, known)
    expect(plan.tasks.map((task) => task.title)).toEqual([
      'Send invites',
      'Book the venue',
      'Plan the menu',
      'Print posters'
    ])
    expect(preview.archivedCardCount).toBe(2)
    expect(preview.lists.map((list) => [list.name, list.mapped, list.cardCount])).toEqual([
      ['To Do', 'backlog', 1],
      ['Doing', 'active', 2],
      ['Done', 'done', 1],
      ['Old ideas', 'backlog', 0]
    ])
  })

  it('brings archived cards when chosen', () => {
    const { plan } = analyzeTrello(board, { includeArchived: true }, known)
    expect(plan.tasks.map((task) => task.title)).toContain('Hire a magician')
    expect(plan.tasks.map((task) => task.title)).toContain('Fireworks')
  })

  it('maps lists to statuses through the chosen mapping, and dueComplete to Done', () => {
    const { plan } = analyzeTrello(board, { listMap: { 'l-doing': 'review' } }, known)
    const byTitle = new Map(plan.tasks.map((task) => [task.title, task]))
    expect(byTitle.get('Plan the menu')!.status).toBe('review')
    expect(byTitle.get('Book the venue')!.status).toBe('done')
  })

  it('brings descriptions, due dates, attachment links, labels, members and checklists', () => {
    const { plan, preview } = analyzeTrello(board, {}, known)
    const menu = plan.tasks.find((task) => task.title === 'Plan the menu')!
    expect(menu.description).toBe(
      'Three courses\n\nAttachments:\n- [Recipe](https://example.com/recipe)'
    )
    expect(menu.dueDate).toMatch(/^2026-10-2[01]$/)
    expect(menu.labels).toEqual(['Food', 'Urgent'])
    expect(menu.assigneeName).toBe('Alex Chen')
    expect(menu.checklist).toEqual([
      { text: 'Starter', checked: true },
      { text: 'Dessert', checked: false }
    ])
    expect(plan.people).toEqual(['Alex Chen', 'Sam Lee'])
    expect(preview.newPeople).toEqual(['Alex Chen'])
    // One assignee: a warning names the one kept.
    const row = preview.rows.find((entry) => entry.title === 'Plan the menu')!
    expect(row.warnings[0].message).toMatch(/only Alex Chen is assigned/)
  })

  it('maps label colours to the nearest palette colour', () => {
    const { plan } = analyzeTrello(board, {}, known)
    for (const label of plan.labelColors) expect(PROJECT_COLORS).toContain(label.color)
    expect(plan.labelColors.find((label) => label.name === 'Urgent')!.color).toBe('#ef4444')
    expect(plan.labelColors.find((label) => label.name === 'Food')!.color).toBe('#84cc16')
    // A label with no name is named by its colour.
    expect(plan.tasks.find((task) => task.title === 'Send invites')!.labels).toEqual(['sky'])
    expect(trelloLabelColor(null)).toBeNull()
    expect(trelloLabelColor('purple_light')).toBe(trelloLabelColor('purple'))
  })
})
