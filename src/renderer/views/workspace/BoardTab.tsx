import type { ProjectViewProps } from '../../navigation/view-props'
import { BoardView } from '../planning/BoardView'
import { Button } from '../../ui'
import { Sparkles } from '../../ui/icons'
import { t } from '@shared/i18n'

/** The Kanban board, with "Suggest tasks" in its toolbar when AI is set up. */
export function BoardTab({ ws, features, suggestTasks }: ProjectViewProps) {
  return (
    <BoardView
      ws={ws}
      toolbarEnd={
        features.ai ? (
          <Button
            variant="ai"
            size="sm"
            icon={Sparkles}
            loading={suggestTasks.busy}
            onClick={suggestTasks.start}
          >
            {suggestTasks.busy
              ? t('navigation:boardTab.generating')
              : t('navigation:boardTab.suggestTasks')}
          </Button>
        ) : null
      }
    />
  )
}
