import { useOstler } from '../../../context/OstlerContext'
import { useAreaActions } from '../../../components/areas/useAreaActions'
import { Button, IconButton } from '../../../ui'
import { ArrowDown, ArrowUp } from '../../../ui/icons'
import { SettingsGroup } from '../settings-form'
import { t } from '@shared/i18n'

/**
 * Settings › Projects › Areas (N5.1): New area, Rename, reorder and Remove
 * (with undo), the same actions as the sidebar's menus.
 */
export function AreasGroup({ projects }: { projects: readonly { areaId?: string | null }[] }) {
  const { areas = [] } = useOstler()
  const actions = useAreaActions(areas)
  return (
    <SettingsGroup
      id="areas"
      description={t('projects:areas.hint')}
      actions={<Button onClick={actions.newArea}>{t('projects:areas.newArea')}</Button>}
    >
      {areas.length === 0 ? (
        <p className="ostler-settings-project-folder">{t('projects:areas.none')}</p>
      ) : (
        <ul className="ostler-settings-project-list" aria-label={t('projects:areas.areas')}>
          {areas.map((area, index) => (
            <li key={area.id} className="ostler-settings-project">
              <div className="ostler-settings-project-text">
                <span className="ostler-settings-project-name">{area.name}</span>
                <span className="ostler-settings-project-folder">
                  {t('projects:areas.projectCount', {
                    count: projects.filter((project) => project.areaId === area.id).length
                  })}
                </span>
              </div>
              <div className="ostler-settings-project-actions">
                <IconButton
                  size="sm"
                  icon={ArrowUp}
                  label={t('projects:areas.moveAreaUp', { name: area.name })}
                  disabled={index === 0}
                  onClick={() => void actions.move(area, -1)}
                />
                <IconButton
                  size="sm"
                  icon={ArrowDown}
                  label={t('projects:areas.moveAreaDown', { name: area.name })}
                  disabled={index === areas.length - 1}
                  onClick={() => void actions.move(area, 1)}
                />
                <Button
                  size="sm"
                  onClick={() => actions.rename(area)}
                  aria-label={t('projects:areas.renameArea', { name: area.name })}
                >
                  {t('projects:areas.rename')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void actions.remove(area)}
                  aria-label={t('projects:areas.removeArea', { name: area.name })}
                >
                  {t('projects:areas.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {actions.dialogs}
    </SettingsGroup>
  )
}
