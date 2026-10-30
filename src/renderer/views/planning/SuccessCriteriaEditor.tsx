import { t } from '@shared/i18n'
import './SuccessCriteriaEditor.css'
import { TaskChecklistEditor } from './TaskChecklistEditor'

/**
 * A milestone's success criteria, edited as a checklist: one row per
 * criterion, Enter for the next. The milestone review reads the same list,
 * so the create dialog and the milestone's edit dialog share this editor.
 */
export function SuccessCriteriaEditor({
  items,
  onChange
}: {
  items: string[]
  onChange: (items: string[]) => void
}) {
  return (
    <fieldset className="success-criteria">
      <legend className="success-criteria__legend">{t('tasks:successCriteria.title')}</legend>
      <p className="success-criteria__hint">{t('tasks:successCriteria.hint')}</p>
      <TaskChecklistEditor items={items} onChange={onChange} />
    </fieldset>
  )
}
