import type { PlanningWorkItem } from '@shared/ostler-api'
import { taskBranchName, taskKey } from '@shared/task-key'
import { t } from '@shared/i18n'
import { useProjectTaskPrefix } from '../../context/OstlerContext'
import type { MenuItem } from '../../ui'
import { useToast } from '../../ui'
import { GitBranch, Hash } from '../../ui/icons'

/**
 * A task's ID, SHOP-12 (N9.8a), from its project's prefix as it is now and
 * the task's number, or null for a task with no number. Read from the
 * project, so a changed prefix shows at once.
 */
export function useTaskId(item: Pick<PlanningWorkItem, 'projectId' | 'number'>): string | null {
  return taskKey(useProjectTaskPrefix(item.projectId), item.number)
}

/** A task's accessible name: its title, then its ID when it has one. */
export function taskAccessibleName(title: string, id: string | null): string {
  return id ? t('tasks:taskId.nameWithId', { title, id }) : title
}

/** Copies a task's ID or branch name to the clipboard and says so in a toast. */
export function useCopyTaskText(): (text: string) => Promise<void> {
  const { toast } = useToast()
  return async (text: string) => {
    const copied = await window.ostlerAPI.copyText(text)
    toast(
      copied.ok
        ? { title: t('tasks:taskId.copied', { text }) }
        : { title: t('tasks:taskId.copyFailed'), body: copied.error, tone: 'danger' }
    )
  }
}

/**
 * Copy ID and Copy branch name (N9.8a), for the card's and the drawer's
 * menus: one list, so both offer the same. None for a task with no ID.
 */
export function useTaskIdMenuItems(
  item: Pick<PlanningWorkItem, 'projectId' | 'number' | 'title'>
): () => MenuItem[] {
  const prefix = useProjectTaskPrefix(item.projectId)
  const copy = useCopyTaskText()
  return () => {
    const id = taskKey(prefix, item.number)
    if (!id || !prefix || typeof item.number !== 'number') return []
    const branch = taskBranchName(prefix, item.number, item.title)
    return [
      {
        label: t('tasks:taskId.copyId'),
        icon: Hash,
        hint: id,
        onSelect: () => void copy(id)
      },
      {
        label: t('tasks:taskId.copyBranchName'),
        icon: GitBranch,
        hint: branch,
        onSelect: () => void copy(branch)
      }
    ]
  }
}
