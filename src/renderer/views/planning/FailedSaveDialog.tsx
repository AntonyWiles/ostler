import { useRef } from 'react'
import { Button, Dialog } from '../../ui'
import type { DrawerField, DrawerFailure } from '../../hooks/planning/drawer-saves'
import { t } from '@shared/i18n'

/**
 * A drawer field's name in the words the editor uses for it. A custom field
 * (R2.2) is named by `customName`, its own name.
 */
export function drawerFieldName(
  field: DrawerField,
  customName: (fieldId: string) => string | undefined = () => undefined
): string {
  if (field.startsWith('custom:'))
    return customName(field.slice('custom:'.length)) ?? t('tasks:customFields.aField')
  switch (field) {
    case 'title':
      return t('tasks:workItemDrawer.title')
    case 'description':
      return t('tasks:workItemDrawer.description')
    case 'status':
      return t('tasks:workItemDrawer.status')
    case 'priority':
      return t('tasks:workItemDrawer.priority')
    case 'milestoneId':
      return t('tasks:workItemDrawer.milestone')
    case 'targetDate':
      return t('tasks:workItemDrawer.dueDate')
    case 'startDate':
      return t('tasks:workItemDrawer.startDate')
    case 'assigneeId':
      return t('tasks:assigneeField.assignee')
    case 'estimate':
      return t('tasks:workItemDrawer.estimate')
    case 'labels':
      return t('tasks:taskLabelsField.labels')
    case 'acceptanceCriteria':
      return t('tasks:workItemDrawer.checklist')
    case 'dependencyIds':
    case 'dependencyLinks':
      return t('tasks:workItemDrawer.dependencies')
    case 'autoQueue':
      return t('agents:taskAgentRunSection.autoContinue')
    case 'subtaskPhase':
      return t('tasks:workItemDrawer.phase')
    default:
      return t('tasks:customFields.aField')
  }
}

export type FailedSaveChoice = 'retry' | 'discard' | 'keep'

/**
 * Closing the drawer with a save that failed asks, in the app: retry the save,
 * discard that change (the field goes back to its saved text), or keep
 * editing. Escape keeps editing, so it never throws the text away.
 */
export function FailedSaveDialog({
  failures,
  onChoose,
  customFieldName
}: {
  failures: DrawerFailure[]
  onChoose: (choice: FailedSaveChoice) => void
  /** A custom field's name by its id (R2.2). */
  customFieldName?: (fieldId: string) => string | undefined
}) {
  const retryRef = useRef<HTMLButtonElement | null>(null)
  return (
    <Dialog
      open
      role="alertdialog"
      size="sm"
      title={t('tasks:workItemDrawer.failedSaveTitle')}
      onClose={() => onChoose('keep')}
      initialFocusRef={retryRef}
      footer={
        <>
          <Button variant="secondary" onClick={() => onChoose('keep')}>
            {t('tasks:workItemDrawer.keepEditing')}
          </Button>
          <Button variant="danger" onClick={() => onChoose('discard')}>
            {t('tasks:workItemDrawer.discardChange')}
          </Button>
          <Button ref={retryRef} variant="primary" onClick={() => onChoose('retry')}>
            {t('tasks:workItemDrawer.retry')}
          </Button>
        </>
      }
    >
      <p>{t('tasks:workItemDrawer.failedSaveBody')}</p>
      <ul>
        {failures.map((failure) => (
          <li key={failure.field}>
            {t('tasks:workItemDrawer.couldntSaveField', {
              field: drawerFieldName(failure.field, customFieldName),
              message: failure.message
            })}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
