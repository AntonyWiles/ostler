import { useState } from 'react'
import type { AIPlanTaskNode, PlanningPriority } from '@shared/ostler-api'
import { agentPlanTaskDescription, doneWhenSection } from '@shared/agent-plan-briefing'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import { ProposedAttachments } from '../../components/ProposedAttachments'
import { AiTaskReviewItem } from '../../components/AiTaskReview'
import { Badge, IconButton, Select } from '../../ui'
import { chevronClass, ChevronRight } from '../../ui/icons'
import { t } from '@shared/i18n'

export interface PlanTaskTreeEdit {
  included: boolean
  title: string
  task: string
  priority: PlanningPriority
  /** Proposed attachments the human left ticked; starts as the node's proposal. */
  attachments: string[]
}

export type PlanTaskTreeEdits = Map<string, PlanTaskTreeEdit>

export function flattenPlanTaskNodes(nodes: AIPlanTaskNode[]): AIPlanTaskNode[] {
  return nodes.flatMap((node) => [node, ...flattenPlanTaskNodes(node.subtasks)])
}

export function initialPlanTaskTreeEdits(nodes: AIPlanTaskNode[]): PlanTaskTreeEdits {
  const edits: PlanTaskTreeEdits = new Map()
  for (const node of flattenPlanTaskNodes(nodes)) {
    edits.set(node.code, {
      included: true,
      title: node.title,
      task: node.task,
      priority: node.priority,
      attachments: node.attachments ?? []
    })
  }
  return edits
}

/**
 * A reusable, indented tree renderer for the agent plan split node shape
 * (phases as headers, tasks/subtasks nested up to depth 3). Used both by the
 * wizard's review step (the shared AI task review row for each node) and, later, anywhere
 * plan-derived work items are already shown.
 */
export function PlanTaskTree({
  projectId,
  phases,
  edits,
  onToggle,
  onEdit,
  disabled
}: {
  /** For naming proposed attachments; without it none are shown. */
  projectId?: string
  phases: { code: string; name: string; tasks: AIPlanTaskNode[] }[]
  edits: PlanTaskTreeEdits
  onToggle: (code: string, included: boolean) => void
  onEdit: (code: string, patch: Partial<PlanTaskTreeEdit>) => void
  disabled?: boolean
}) {
  return (
    <div className="plan-tree">
      {phases.map((phase) => (
        <section
          key={phase.code}
          className="plan-tree__phase"
          aria-label={t('ai:planTaskTree.phase', { code: phase.code })}
        >
          <h3 className="plan-tree__phase-title">
            <span className="plan-wizard__code">{phase.code}</span>
            {phase.name}
          </h3>
          <ul className="plan-tree__nodes">
            {phase.tasks.map((node) => (
              <PlanTaskTreeNode
                key={node.code}
                projectId={projectId}
                node={node}
                edits={edits}
                onToggle={onToggle}
                onEdit={onEdit}
                disabled={disabled}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((priority) => ({
  value: priority,
  get label() {
    return taskPriorityLabel(priority)
  }
}))

function PlanTaskTreeNode({
  projectId,
  node,
  edits,
  onToggle,
  onEdit,
  disabled
}: {
  projectId?: string
  node: AIPlanTaskNode
  edits: PlanTaskTreeEdits
  onToggle: (code: string, included: boolean) => void
  onEdit: (code: string, patch: Partial<PlanTaskTreeEdit>) => void
  disabled?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const edit = edits.get(node.code)
  if (!edit) return null
  const hasChildren = node.subtasks.length > 0
  const locked = disabled || !edit.included

  return (
    <AiTaskReviewItem
      compact
      className="plan-tree__node"
      name={node.code}
      included={edit.included}
      onToggle={(included) => onToggle(node.code, included)}
      title={edit.title}
      onTitleChange={(title) => onEdit(node.code, { title })}
      details={edit.task}
      onDetailsChange={(task) => onEdit(node.code, { task })}
      disabled={disabled}
      lead={
        <>
          {hasChildren ? (
            <IconButton
              label={
                expanded
                  ? t('ai:planTaskTree.collapse', { code: node.code })
                  : t('ai:planTaskTree.expand', { code: node.code })
              }
              icon={ChevronRight}
              iconClassName={chevronClass(expanded)}
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            />
          ) : (
            <span className="plan-tree__spacer" />
          )}
          <span className="plan-wizard__code">{node.code}</span>
        </>
      }
      fields={
        <Select
          label={t('ai:planTaskTree.priority', { code: node.code })}
          hideLabel
          size="sm"
          value={edit.priority}
          disabled={locked}
          options={PRIORITY_OPTIONS}
          onChange={(event) =>
            onEdit(node.code, { priority: event.target.value as PlanningPriority })
          }
        />
      }
      after={
        expanded &&
        hasChildren && (
          <ul className="plan-tree__nodes plan-tree__children">
            {node.subtasks.map((child) => (
              <PlanTaskTreeNode
                key={child.code}
                projectId={projectId}
                node={child}
                edits={edits}
                onToggle={onToggle}
                onEdit={onEdit}
                disabled={disabled}
              />
            ))}
          </ul>
        )
      }
    >
      {node.reliesOn.length > 0 && (
        <div className="plan-tree__relies">
          {node.reliesOn.map((code) => (
            <Badge key={code}>{t('ai:planTaskTree.relies', { code })}</Badge>
          ))}
        </div>
      )}
      <details className="dialog-disclosure">
        <summary>{t('ai:planTaskTree.whatAgentWillRead')}</summary>
        <pre className="plan-tree__briefing">
          {[
            agentPlanTaskDescription({ ...node, task: edit.task }),
            doneWhenSection(node.acceptanceCriteria)
          ]
            .filter(Boolean)
            .join('\n\n')}
        </pre>
      </details>
      {projectId && (
        <ProposedAttachments
          projectId={projectId}
          proposed={node.attachments}
          selected={edit.attachments}
          disabled={locked}
          onChange={(ids) => onEdit(node.code, { attachments: ids })}
        />
      )}
    </AiTaskReviewItem>
  )
}
