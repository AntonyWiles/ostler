import type {
  ImportPreviewRow,
  ImportRowIssue,
  PlanningWorkItemStatus,
  TrelloImportOptions,
  TrelloImportPreview,
  TrelloListMapping
} from '../ostler-api'
import {
  cleanImportedText,
  clip,
  guessProjectStatus,
  LIMITS,
  MAX_IMPORT_ROWS,
  nearestPaletteColor,
  PREVIEW_ROWS,
  previewTotals,
  type ImportChecklistItem,
  type ImportKnownRecords,
  type ImportPlan,
  type ImportTaskDraft
} from './import-plan'
import { t } from '../i18n'

/**
 * Trello import (P6.1) from a board's JSON export (Menu › Print, export and
 * share › Export as JSON). Lists map to statuses, card order is kept,
 * archived cards are skipped unless chosen, `dueComplete` becomes Done,
 * labels keep their colour (the nearest palette colour), members become
 * people, checklists keep their ticks, and attachment links are appended to
 * the description.
 */

interface TrelloList {
  id: string
  name: string
  closed: boolean
  pos: number
}

interface TrelloLabel {
  id: string
  name: string
  color: string | null
}

interface TrelloMember {
  id: string
  fullName: string
}

interface TrelloCheckItem {
  name: string
  state: string
  pos: number
}

interface TrelloChecklist {
  id: string
  idCard: string
  name: string
  pos: number
  checkItems: TrelloCheckItem[]
}

interface TrelloCard {
  id: string
  name: string
  desc: string
  idList: string
  closed: boolean
  pos: number
  due: string | null
  start: string | null
  dueComplete: boolean
  idLabels: string[]
  idMembers: string[]
  attachments: { name: string; url: string }[]
}

export interface TrelloBoard {
  name: string
  lists: TrelloList[]
  labels: TrelloLabel[]
  members: TrelloMember[]
  checklists: TrelloChecklist[]
  cards: TrelloCard[]
}

/** Trello's label colours (the classic palette); `_dark` and `_light` variants use their base. */
const TRELLO_COLORS: Record<string, string> = {
  green: '#61bd4f',
  yellow: '#f2d600',
  orange: '#ff9f1a',
  red: '#eb5a46',
  purple: '#c377e0',
  blue: '#0079bf',
  sky: '#00c2e0',
  lime: '#51e898',
  pink: '#ff78cb',
  black: '#344563'
}

/** A Trello label colour as the nearest palette colour, or null for a colourless label. */
export function trelloLabelColor(color: string | null): string | null {
  if (!color) return null
  const base = TRELLO_COLORS[color.replace(/_(dark|light)$/, '')]
  return base ? nearestPaletteColor(base) : null
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : []
}

function string(value: unknown): string {
  return typeof value === 'string' ? cleanImportedText(value) : ''
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/** Whether parsed JSON looks like a Trello board export. */
export function isTrelloBoard(json: unknown): boolean {
  const root = object(json)
  return Array.isArray(root.cards) && Array.isArray(root.lists)
}

/** Reads a board export, keeping only what the import uses. Throws on anything else. */
export function readTrelloBoard(json: unknown): TrelloBoard {
  if (!isTrelloBoard(json)) throw new Error(t('data:trelloImport.notTrelloBoardExport'))
  const root = object(json)
  const cards = array(root.cards)
  if (cards.length > MAX_IMPORT_ROWS)
    throw new Error(
      t('data:trelloImport.boardHasCardsImport', { cardCount: cards.length, MAX_IMPORT_ROWS })
    )
  return {
    name: string(root.name).trim() || t('data:trelloImport.trelloBoard'),
    lists: array(root.lists).map((list, index) => ({
      id: string(list.id),
      name: string(list.name).trim() || t('data:trelloImport.untitledList'),
      closed: list.closed === true,
      pos: number(list.pos, index)
    })),
    labels: array(root.labels).map((label) => ({
      id: string(label.id),
      name: string(label.name).trim(),
      color: typeof label.color === 'string' ? label.color : null
    })),
    members: array(root.members).map((member) => ({
      id: string(member.id),
      fullName: string(member.fullName).trim() || string(member.username).trim()
    })),
    checklists: array(root.checklists).map((checklist, index) => ({
      id: string(checklist.id),
      idCard: string(checklist.idCard),
      name: string(checklist.name).trim(),
      pos: number(checklist.pos, index),
      checkItems: array(checklist.checkItems).map((item, itemIndex) => ({
        name: string(item.name).trim(),
        state: string(item.state),
        pos: number(item.pos, itemIndex)
      }))
    })),
    cards: cards.map((card, index) => ({
      id: string(card.id),
      name: string(card.name),
      desc: string(card.desc),
      idList: string(card.idList),
      closed: card.closed === true,
      pos: number(card.pos, index),
      due: typeof card.due === 'string' ? card.due : null,
      start: typeof card.start === 'string' ? card.start : null,
      dueComplete: card.dueComplete === true,
      idLabels: ids(card.idLabels),
      idMembers: ids(card.idMembers),
      attachments: array(card.attachments).flatMap((attachment) => {
        const url = string(attachment.url).trim()
        return /^https?:\/\//i.test(url)
          ? [{ name: string(attachment.name).trim() || url, url }]
          : []
      })
    }))
  }
}

/**
 * A Trello date (an instant, `2026-10-20T12:00:00.000Z`) as the local
 * calendar day it falls on, as Trello shows it.
 */
function trelloDay(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface TrelloImportAnalysis {
  preview: TrelloImportPreview
  plan: ImportPlan
}

export function analyzeTrello(
  board: TrelloBoard,
  options: TrelloImportOptions,
  known: ImportKnownRecords
): TrelloImportAnalysis {
  const includeArchived = options.includeArchived === true
  const lists = [...board.lists].sort((a, b) => a.pos - b.pos)
  const listOrder = new Map(lists.map((list, index) => [list.id, index]))
  const listById = new Map(lists.map((list) => [list.id, list]))
  const archived = (card: TrelloCard) => card.closed || listById.get(card.idList)?.closed === true
  const statusFor = new Map<string, PlanningWorkItemStatus>(
    lists.map((list) => [
      list.id,
      options.listMap?.[list.id] ?? guessProjectStatus(list.name, known.columns)
    ])
  )
  const labelById = new Map(board.labels.map((label) => [label.id, label]))
  const memberById = new Map(board.members.map((member) => [member.id, member]))
  const checklistsFor = new Map<string, TrelloChecklist[]>()
  for (const checklist of [...board.checklists].sort((a, b) => a.pos - b.pos)) {
    checklistsFor.set(checklist.idCard, [...(checklistsFor.get(checklist.idCard) ?? []), checklist])
  }

  // Card order is kept: by list, then by place in the list.
  const cards = [...board.cards].sort(
    (a, b) =>
      (listOrder.get(a.idList) ?? Infinity) - (listOrder.get(b.idList) ?? Infinity) || a.pos - b.pos
  )
  const rows: ImportPreviewRow[] = []
  const tasks: ImportTaskDraft[] = []
  const labelColors = new Map<string, string>()

  cards.forEach((card, index) => {
    const line = index + 1
    if (archived(card) && !includeArchived) return
    const errors: ImportRowIssue[] = []
    const warnings: ImportRowIssue[] = []
    let title = card.name.replace(/\s+/g, ' ').trim()
    if (!title) errors.push({ field: 'title', message: t('data:trelloImport.cardHasNoName') })
    let cut: boolean
    ;[title, cut] = clip(title, LIMITS.title)
    if (cut)
      warnings.push({
        field: 'title',
        message: t('data:trelloImport.nameCutCharacters', { LIMITSTitle: LIMITS.title })
      })

    const links = card.attachments.map((attachment) =>
      attachment.name === attachment.url
        ? `- <${attachment.url}>`
        : `- [${attachment.name.replace(/[[\]]/g, '')}](${attachment.url})`
    )
    let description = card.desc.trim()
    if (links.length > 0)
      description = `${description}${description ? '\n\n' : ''}Attachments:\n${links.join('\n')}`
    ;[description, cut] = clip(description, LIMITS.description)
    if (cut)
      warnings.push({
        field: 'description',
        message: t('data:trelloImport.descriptionCutCharacters', {
          description: LIMITS.description
        })
      })

    let labels: string[] = []
    for (const id of card.idLabels) {
      const label = labelById.get(id)
      if (!label) continue
      const [name] = clip(label.name || label.color || 'label', LIMITS.label)
      if (!labels.includes(name)) labels.push(name)
      const color = trelloLabelColor(label.color)
      if (color && !labelColors.has(name)) labelColors.set(name, color)
    }
    if (labels.length > LIMITS.labels) {
      warnings.push({
        field: 'labels',
        message: t('data:trelloImport.onlyFirstLabelsKept', { labels: LIMITS.labels })
      })
      labels = labels.slice(0, LIMITS.labels)
    }

    const members = card.idMembers.flatMap((id) => {
      const name = memberById.get(id)?.fullName
      return name ? [name] : []
    })
    if (members.length > 1)
      warnings.push({
        field: 'assignee',
        message: t('data:trelloImport.taskHasOneAssignee', { members: members[0] })
      })

    const checklist: ImportChecklistItem[] = []
    for (const list of checklistsFor.get(card.id) ?? []) {
      for (const item of [...list.checkItems].sort((a, b) => a.pos - b.pos)) {
        const [text] = clip(item.name, LIMITS.checklistItem)
        if (text && !checklist.some((entry) => entry.text === text))
          checklist.push({ text, checked: item.state === 'complete' })
      }
    }
    if (checklist.length > LIMITS.checklist) {
      warnings.push({
        field: 'checklist',
        message: t('data:trelloImport.onlyFirstChecklistItems', { checklist: LIMITS.checklist })
      })
      checklist.length = LIMITS.checklist
    }

    const dueDate = trelloDay(card.due)
    let startDate = trelloDay(card.start)
    if (startDate && dueDate && startDate > dueDate) startDate = null
    const list = listById.get(card.idList)
    const status: PlanningWorkItemStatus = card.dueComplete
      ? 'done'
      : (statusFor.get(card.idList) ?? 'backlog')

    rows.push({
      line,
      title,
      cells: {
        status: list?.name ?? '',
        labels: labels.join(', '),
        assignee: members[0] ?? '',
        due: dueDate ?? '',
        checklist:
          checklist.length > 0
            ? t('data:trelloImport.items', { checklistCount: checklist.length })
            : ''
      },
      errors,
      warnings
    })
    if (errors.length > 0) return
    tasks.push({
      line,
      title,
      description,
      status,
      priority: 'medium',
      labels,
      checklist,
      assigneeName: members[0] ? clip(members[0], LIMITS.name)[0] : null,
      startDate,
      dueDate,
      estimate: null,
      milestoneName: null
    })
  })

  const plan: ImportPlan = {
    tasks,
    labelColors: [...labelColors.entries()].map(([name, color]) => ({ name, color })),
    people: board.members.map((member) => clip(member.fullName, LIMITS.name)[0]).filter(Boolean),
    skipped: rows.length - tasks.length
  }
  const counts = new Map<string, number>()
  for (const card of board.cards) {
    if (!archived(card) || includeArchived)
      counts.set(card.idList, (counts.get(card.idList) ?? 0) + 1)
  }
  const mappings: TrelloListMapping[] = lists.map((list) => ({
    id: list.id,
    name: list.name,
    cardCount: counts.get(list.id) ?? 0,
    archived: list.closed,
    mapped: statusFor.get(list.id) ?? 'backlog'
  }))
  return {
    plan,
    preview: {
      ...previewTotals(rows, plan, known),
      boardName: board.name,
      lists: mappings,
      archivedCardCount: board.cards.filter(archived).length,
      labelCount: board.labels.length,
      memberCount: board.members.length,
      rows: rows.slice(0, PREVIEW_ROWS)
    }
  }
}
