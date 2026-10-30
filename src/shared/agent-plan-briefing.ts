import type { AIPlanTaskNode } from './ostler-api'

/**
 * The work item description for one approved plan node. It is the single
 * source of what the agent is asked to do (formatPlanningTaskDetails carries
 * it unchanged), so the node's briefing lists and the approved master plan's
 * rules travel with it. Empty sections are omitted.
 *
 * Each heading says how to use its section. The same text reaches embedded and
 * external agents alike, so the headings are the one place that meaning lives;
 * the wizard previews exactly this text before the human approves a task.
 */
export function agentPlanTaskDescription(
  node: Pick<
    AIPlanTaskNode,
    | 'context'
    | 'task'
    | 'constraints'
    | 'outOfScope'
    | 'preconditions'
    | 'references'
    | 'deliverables'
  >,
  planRules: string[] = []
): string {
  const list = (heading: string, entries: string[] | undefined): string => {
    const lines = (Array.isArray(entries) ? entries : [])
      .map((entry) => String(entry).trim())
      .filter(Boolean)
    return lines.length > 0 ? `${heading}\n${lines.map((line) => `- ${line}`).join('\n')}` : ''
  }
  return [
    (node.context ?? '').trim(),
    list(
      'Do not start if (check each one before you change anything; if any is true, change nothing and report it as a blocker instead of working around it):',
      node.preconditions
    ),
    list('Refer to (read these before you start):', node.references),
    (node.task ?? '').trim(),
    list(
      'Deliverables (create each at exactly this path and commit it; later tasks depend on finding it there):',
      node.deliverables
    ),
    list('Constraints:', node.constraints),
    list('Out of scope (do not do these, even if they look related):', node.outOfScope),
    list('Plan rules:', planRules)
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The "Done when" section every work item's task text ends its scope with (formatPlanningTaskDetails). */
export function doneWhenSection(acceptanceCriteria: string[]): string {
  const lines = acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean)
  return lines.length > 0
    ? `Done when (check every one yourself before you report the task complete, and say how you checked it):\n${lines.map((line) => `- ${line}`).join('\n')}`
    : ''
}
