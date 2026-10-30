/**
 * Planning proposals that Ostler's project chat may suggest.
 *
 * The chat model never creates anything. It can only write a fenced
 * `ostler-proposal` block into its reply; the renderer turns each valid block
 * into a card, and a record exists only after the human presses Add. That keeps
 * the chat reporting-only while still letting it offer to
 * capture goals, milestones and tasks.
 *
 * Everything the model writes is untrusted input, so this module is the
 * enforcement point and is deliberately narrow:
 *  - an allowlist of three proposal types; anything else is dropped;
 *  - every field is type-checked, trimmed and length-capped, unknown fields are
 *    discarded, and at most MAX_PROPOSALS_PER_MESSAGE survive per reply;
 *  - the create-input mapper never forwards status, autoQueue, dependencies or
 *    any harness-facing field, so an accepted proposal can only ever become a
 *    backlog record that a human still has to queue.
 */
import type {
  CreatePlanningGoalInput,
  CreatePlanningMilestoneInput,
  CreatePlanningWorkItemInput,
  PlanningPriority
} from './ostler-api/planning-types'

export const PROPOSAL_FENCE_TAG = 'ostler-proposal'
/**
 * The notes chat asks Ostler for project files in a block with this tag
 * (`project-files.ts`). Main reads them and continues the reply; the block is
 * hidden like a proposal, and never becomes anything else.
 */
export const READ_FENCE_TAG = 'ostler-read'
export const MAX_PROPOSALS_PER_MESSAGE = 5

const PRIORITIES: readonly PlanningPriority[] = ['low', 'medium', 'high', 'critical']

export type ChatProposal =
  | { type: 'goal'; title: string; outcome: string }
  | {
      type: 'milestone'
      name: string
      outcome: string
      targetDate: string | null
      successCriteria: string[]
    }
  | {
      type: 'work_item'
      title: string
      description: string
      priority: PlanningPriority
      labels: string[]
      /** Name of an existing milestone to attach to; resolved by the renderer. */
      milestone: string | null
    }

const COMPLETE_BLOCK = new RegExp('```' + PROPOSAL_FENCE_TAG + '[^\\S\\n]*\\n([\\s\\S]*?)```', 'g')
const HIDDEN_TAGS = `(?:${PROPOSAL_FENCE_TAG}|${READ_FENCE_TAG})`
const HIDDEN_BLOCK = new RegExp('```' + HIDDEN_TAGS + '[^\\S\\n]*\\n[\\s\\S]*?```', 'g')
// A block still being streamed: opened, never closed.
const UNTERMINATED_BLOCK = new RegExp('```' + HIDDEN_TAGS + '[\\s\\S]*$')
// "```ostler-prop" at the very end of a stream, before the tag is fully written.
const PARTIAL_OPENER = new RegExp(
  '```(?:' +
    [
      ...new Set(
        [PROPOSAL_FENCE_TAG, READ_FENCE_TAG].flatMap((tag) =>
          Array.from({ length: tag.length - 1 }, (_, index) => tag.slice(0, index + 1))
        )
      )
    ]
      .sort((a, b) => b.length - a.length)
      .join('|') +
    ')$'
)

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const entry of value) {
    const cleaned = text(entry, maxLength)
    if (cleaned) items.push(cleaned)
    if (items.length >= maxItems) break
  }
  return items
}

function parseProposal(value: unknown): ChatProposal | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>

  if (raw.type === 'goal') {
    const title = text(raw.title, 120)
    return title ? { type: 'goal', title, outcome: text(raw.outcome, 500) } : null
  }
  if (raw.type === 'milestone') {
    const name = text(raw.name, 120)
    if (!name) return null
    const targetDate = text(raw.targetDate, 10)
    return {
      type: 'milestone',
      name,
      outcome: text(raw.outcome, 500),
      targetDate: /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : null,
      successCriteria: textList(raw.successCriteria, 6, 200)
    }
  }
  if (raw.type === 'work_item') {
    const title = text(raw.title, 120)
    if (!title) return null
    const priority = PRIORITIES.find((candidate) => candidate === raw.priority) ?? 'medium'
    return {
      type: 'work_item',
      title,
      description: text(raw.description, 2000),
      priority,
      labels: textList(raw.labels, 5, 32),
      milestone: text(raw.milestone, 120) || null
    }
  }
  return null
}

/** The display title of a proposal, also the identity used to spot duplicates. */
export function proposalTitle(proposal: ChatProposal): string {
  return proposal.type === 'milestone' ? proposal.name : proposal.title
}

/** The valid, capped, de-duplicated proposals in one assistant reply. */
export function extractProposals(content: string): ChatProposal[] {
  const proposals: ChatProposal[] = []
  const seen = new Set<string>()
  for (const match of content.matchAll(COMPLETE_BLOCK)) {
    if (proposals.length >= MAX_PROPOSALS_PER_MESSAGE) break
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1])
    } catch {
      continue
    }
    const proposal = parseProposal(parsed)
    if (!proposal) continue
    const key = `${proposal.type}:${proposalTitle(proposal).toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    proposals.push(proposal)
  }
  return proposals
}

/**
 * The reply with every proposal and file-request block removed, including one still streaming.
 * This is what gets displayed as text and what gets saved as a status note, so
 * machine-readable JSON never lands in either.
 */
export function stripProposalBlocks(content: string): string {
  return content
    .replace(HIDDEN_BLOCK, '')
    .replace(UNTERMINATED_BLOCK, '')
    .replace(PARTIAL_OPENER, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

export function toGoalInput(
  proposal: Extract<ChatProposal, { type: 'goal' }>
): CreatePlanningGoalInput {
  return { title: proposal.title, outcome: proposal.outcome }
}

export function toMilestoneInput(
  proposal: Extract<ChatProposal, { type: 'milestone' }>
): CreatePlanningMilestoneInput {
  return {
    name: proposal.name,
    outcome: proposal.outcome,
    targetDate: proposal.targetDate,
    successCriteria: proposal.successCriteria
  }
}

/**
 * Deliberately an allowlist, not a spread: status is pinned to backlog and
 * autoQueue, dependencies, parent links and task codes are never set, so the
 * record cannot reach the harness until a human promotes and queues it.
 */
export function toWorkItemInput(
  proposal: Extract<ChatProposal, { type: 'work_item' }>,
  milestoneId: string | null
): CreatePlanningWorkItemInput {
  return {
    title: proposal.title,
    description: proposal.description,
    priority: proposal.priority,
    labels: proposal.labels,
    milestoneId,
    status: 'backlog'
  }
}
