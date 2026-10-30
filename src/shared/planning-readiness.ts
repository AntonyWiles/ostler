import type {
  PlanningHumanSignOff,
  PlanningReadinessCheck,
  PlanningReadinessReport,
  PlanningWorkItem,
  PlanningWorkItemMetrics
} from './ostler-api'
import { t } from './i18n'

export interface ReadinessEvidence {
  items: PlanningWorkItem[]
  metrics: Map<string, PlanningWorkItemMetrics>
  reviewCount: number
  pendingQuestionCount: number
  gitDirty: boolean
  gitConflicted: number
  signOffs?: PlanningHumanSignOff[]
}

const check = (
  id: PlanningReadinessCheck['id'],
  label: string,
  state: PlanningReadinessCheck['state'],
  detail: string,
  evidence: string[] = []
): PlanningReadinessCheck => ({ id, label, state, detail, evidence })

export function buildReadinessReport(
  milestoneId: string,
  evidence: ReadinessEvidence,
  now = Date.now()
): PlanningReadinessReport {
  const incomplete = evidence.items.filter((item) => item.acceptanceCriteria.length === 0)
  const blocked = evidence.items.filter((item) => item.status === 'blocked')
  const stale = evidence.items.filter(
    (item) => (evidence.metrics.get(item.id)?.queueAgeMs ?? 0) >= 7 * 86_400_000
  )
  const signOffs = evidence.signOffs ?? []
  const gitProblem = evidence.gitConflicted > 0 || evidence.gitDirty
  // Every other check here asks "is anything in the way?", so on their own they
  // passed a milestone whose work had not started exactly as they passed one
  // whose work was finished. This is the check that says how far along it is.
  const open = evidence.items.filter((item) => item.status !== 'done')
  const checks: PlanningReadinessCheck[] = [
    check(
      'linked-work',
      t('tasks:planningReadiness.linkedWorkDone'),
      evidence.items.length === 0 ? 'warning' : open.length ? 'fail' : 'pass',
      evidence.items.length === 0
        ? t('tasks:planningReadiness.noWorkLinkedMilestone')
        : open.length
          ? t('tasks:planningReadiness.linkedItemSDone', {
              itemCount: evidence.items.length - open.length
            })
          : t('tasks:planningReadiness.allLinkedItemS', { itemCount: evidence.items.length }),
      open.map((item) => item.id)
    ),
    check(
      'acceptance-criteria',
      t('tasks:planningReadiness.acceptanceCriteria'),
      incomplete.length ? 'fail' : 'pass',
      incomplete.length
        ? t('tasks:planningReadiness.linkedItemSHave', { incompleteCount: incomplete.length })
        : t('tasks:planningReadiness.everyLinkedItemHas'),
      incomplete.map((item) => item.id)
    ),
    check(
      'blocked-or-stale',
      t('tasks:planningReadiness.blockedStaleWork'),
      blocked.length || stale.length ? 'fail' : 'pass',
      blocked.length || stale.length
        ? t('tasks:planningReadiness.blockedStaleLinkedItem', {
            blockedCount: blocked.length,
            staleCount: stale.length
          })
        : t('tasks:planningReadiness.noLinkedItemBlocked'),
      [...blocked, ...stale].map((item) => item.id)
    ),
    check(
      'workspace-review',
      t('tasks:planningReadiness.agentWorkspacesAwaitingReview'),
      evidence.reviewCount ? 'warning' : 'pass',
      evidence.reviewCount
        ? t('tasks:planningReadiness.workspaceSAwaitHuman', { reviewCount: evidence.reviewCount })
        : t('tasks:planningReadiness.noAgentWorkspaceAwaits')
    ),
    check(
      'agent-questions',
      t('tasks:planningReadiness.unresolvedAgentQuestions'),
      evidence.pendingQuestionCount ? 'warning' : 'pass',
      evidence.pendingQuestionCount
        ? t('tasks:planningReadiness.agentQuestionSNeed', {
            pendingQuestionCount: evidence.pendingQuestionCount
          })
        : t('tasks:planningReadiness.noUnresolvedAgentQuestions')
    ),
    // Applied agent work is in the project folder itself, and work not yet
    // applied is counted by the review check above.
    check(
      'git-state',
      t('tasks:planningReadiness.gitState'),
      gitProblem ? 'fail' : 'pass',
      gitProblem
        ? evidence.gitConflicted
          ? t('tasks:planningReadiness.checkoutConflicted')
          : t('tasks:planningReadiness.checkoutDirty')
        : t('tasks:planningReadiness.checkoutCleanConflictFree')
    ),
    check(
      'human-sign-off',
      t('tasks:planningReadiness.humanSignOff'),
      signOffs.every((item) => item.completed) ? 'pass' : 'warning',
      signOffs.every((item) => item.completed)
        ? t('tasks:planningReadiness.allSignOffItems')
        : t('tasks:planningReadiness.oneMoreExplicitHuman')
    )
  ]
  return {
    milestoneId,
    generatedAt: now,
    verdict: checks.some((item) => item.state === 'fail')
      ? 'not-ready'
      : checks.some((item) => item.state === 'warning')
        ? 'attention'
        : 'ready',
    signOffs,
    checks
  }
}
