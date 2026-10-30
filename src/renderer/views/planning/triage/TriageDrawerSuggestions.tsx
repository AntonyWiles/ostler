import type { PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { useToast } from '../../../ui'
import { markTriagedDuplicate } from './triage-actions'
import { SuggestButton, TriageSuggestionLine, useTriageSuggestions } from './triage-suggestions'

/**
 * Suggest in the drawer of a task in To triage (N4.3b). The drawer has no
 * Accept fields, so there is no Use: a likely duplicate offers Duplicate of
 * this and Open. Shown only while Ostler AI is on, by its caller.
 */
export function TriageDrawerSuggestions({
  item,
  workItems,
  openWorkItem
}: {
  item: PlanningWorkItem
  workItems: PlanningWorkItem[]
  openWorkItem: (item: PlanningWorkItem) => void
}) {
  const { toast, toastUndo } = useToast()
  const suggestions = useTriageSuggestions(item.projectId)
  const state = suggestions.states[item.id]
  return (
    <div className="triage-suggestion__drawer">
      <SuggestButton item={item} state={state} onSuggest={() => void suggestions.suggest(item)} />
      <TriageSuggestionLine
        item={item}
        state={state}
        onDuplicate={(originalId) =>
          void markTriagedDuplicate(item, originalId, toastUndo).then((error) => {
            if (error)
              toast({ title: t('tasks:triage.couldntDecide'), body: error, tone: 'danger' })
            else suggestions.dismiss(item.id)
          })
        }
        onOpen={(workItemId) => {
          const found = workItems.find((candidate) => candidate.id === workItemId)
          return found ? () => openWorkItem(found) : null
        }}
        onDismiss={() => suggestions.dismiss(item.id)}
      />
    </div>
  )
}
