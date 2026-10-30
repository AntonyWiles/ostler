import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import { Checkbox, SegmentedControl, Select } from '../../../ui'
import { fieldColumnId, isGroupableField } from '@shared/planning/list'
import { t } from '@shared/i18n'
import { liveSubprojects } from '../subproject-ui'

type GroupBy = PlanningWorkspace['boardGroupBy']
type SortBy = PlanningWorkspace['boardSortBy']

/**
 * The Board's view options: grouping, sort and its direction, Hide done and
 * the custom fields on cards. One form, shown in the toolbar's View options
 * and in Customise board, both reading and writing the Board's view state.
 */
export function BoardViewOptionsFields({ ws }: { ws: PlanningWorkspace }) {
  return (
    <>
      <Select
        label={t('tasks:boardToolbar.group')}
        size="sm"
        value={ws.boardGroupBy}
        onChange={(event) => ws.setBoardGroupBy(event.target.value as GroupBy)}
        options={[
          { value: 'none', label: t('tasks:boardToolbar.none') },
          { value: 'milestone', label: t('tasks:boardToolbar.milestone') },
          { value: 'goal', label: t('tasks:boardToolbar.goal') },
          { value: 'origin', label: t('tasks:boardToolbar.origin') },
          { value: 'assignee', label: t('tasks:boardToolbar.assignee') },
          // Offered once the project has an iteration (R6.1).
          ...(ws.iterations.length > 0 || ws.boardGroupBy === 'iteration'
            ? [{ value: 'iteration', label: t('tasks:iterations.field') }]
            : []),
          // And once it has a task type (N2.7a).
          ...(ws.taskTypes.length > 0 || ws.boardGroupBy === 'type'
            ? [{ value: 'type', label: t('tasks:taskTypes.field') }]
            : []),
          // And once it has a workstream, in a view of the whole project.
          ...((liveSubprojects(ws.subprojects).length > 0 && !ws.subprojectScope) ||
          ws.boardGroupBy === 'subproject'
            ? [{ value: 'subproject', label: t('tasks:subprojects.field') }]
            : []),
          ...ws.fields
            .filter(isGroupableField)
            .map((field) => ({ value: fieldColumnId(field.id), label: field.name }))
        ]}
      />
      <Select
        label={t('tasks:boardToolbar.sort')}
        size="sm"
        value={ws.boardSortBy}
        onChange={(event) => ws.setBoardSortBy(event.target.value as SortBy)}
        options={[
          { value: 'manual', label: t('tasks:boardToolbar.manual') },
          { value: 'priority', label: t('tasks:boardToolbar.priority') },
          { value: 'targetDate', label: t('tasks:boardToolbar.dueDate') },
          { value: 'title', label: t('tasks:boardToolbar.title') },
          { value: 'created', label: t('tasks:boardToolbar.created') }
        ]}
      />
      {ws.boardSortBy !== 'manual' && (
        <SegmentedControl
          label={t('tasks:boardToolbar.sortDirection')}
          size="sm"
          value={ws.boardSortDir}
          onChange={ws.setBoardSortDir}
          options={[
            { value: 'asc', label: t('tasks:boardToolbar.ascending') },
            { value: 'desc', label: t('tasks:boardToolbar.descending') }
          ]}
        />
      )}
      <Checkbox
        label={t('tasks:boardToolbar.hideDone')}
        checked={ws.boardHideDone}
        onChange={(event) => ws.setBoardHideDone(event.target.checked)}
      />
      {ws.fields.length > 0 && (
        <fieldset className="task-view-options__fields">
          <legend className="task-view-options__legend">
            {t('tasks:boardToolbar.fieldsOnCards')}
          </legend>
          {ws.fields.map((field) => (
            <Checkbox
              key={field.id}
              label={field.name}
              checked={ws.boardCardFields.includes(field.id)}
              onChange={(event) =>
                ws.setBoardCardFields(
                  event.target.checked
                    ? [...ws.boardCardFields, field.id]
                    : ws.boardCardFields.filter((id) => id !== field.id)
                )
              }
            />
          ))}
        </fieldset>
      )}
      {ws.boardSortBy !== 'manual' && (
        <p className="task-view-options__hint">
          {t('tasks:boardView.sortedHint', {
            sort: t(`tasks:boardView.sortName.${ws.boardSortBy}`)
          })}
        </p>
      )}
      {ws.boardGroupBy === 'none' && (
        <p className="task-view-options__hint">{t('tasks:boardToolbar.arrowKeysJK')}</p>
      )}
    </>
  )
}
