import type { ProjectViewProps } from '../../navigation/view-props'
import { ListView } from '../planning/list/ListView'
import { Button } from '../../ui'
import { FileSpreadsheet, Sparkles } from '../../ui/icons'
import { t } from '@shared/i18n'

/**
 * The List view, with Edit in Excel (N2.8) in its toolbar, and "Suggest tasks"
 * when AI is set up, as on the Board.
 */
export function ListTab({ ws, features, suggestTasks, reportView, editInExcel }: ProjectViewProps) {
  return (
    <ListView
      ws={ws}
      onViewOutput={reportView}
      toolbarEnd={
        <>
          {editInExcel && (
            <Button size="sm" icon={FileSpreadsheet} onClick={editInExcel}>
              {t('data:editInExcel.menuItem')}
            </Button>
          )}
          {features.ai ? (
            <Button
              variant="ai"
              size="sm"
              icon={Sparkles}
              loading={suggestTasks.busy}
              onClick={suggestTasks.start}
            >
              {suggestTasks.busy
                ? t('navigation:listTab.generating')
                : t('navigation:listTab.suggestTasks')}
            </Button>
          ) : null}
        </>
      }
    />
  )
}
