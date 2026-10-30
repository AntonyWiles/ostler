import { useOptionalHelp } from '../../help/HelpProvider'
import { shortcut } from '../../navigation/shortcuts'
import { Menu, Tooltip } from '../../ui'
import {
  BookOpen,
  Bug,
  CircleHelp,
  Copy,
  Gift,
  Icon,
  Info,
  Keyboard,
  Signpost
} from '../../ui/icons'
import { useOptionalTips } from '../../tips/TipsProvider'
import { t } from '@shared/i18n'

/**
 * The Help button at the bottom of the sidebar (P8.1): the user guide, the
 * shortcut overlay, What's new, Report a problem, Copy diagnostics and About.
 */
export function HelpMenu({ collapsed }: { collapsed: boolean }) {
  const help = useOptionalHelp()
  const tips = useOptionalTips()
  // Outside the app shell (a component rendered on its own) there is no Help.
  if (!help) return null
  return (
    <Menu
      label={t('navigation:helpMenu.help')}
      placement="top-start"
      items={[
        {
          label: t('navigation:helpMenu.userGuide'),
          icon: BookOpen,
          onSelect: () => help.openGuide()
        },
        {
          label: t('navigation:helpMenu.keyboardShortcuts'),
          icon: Keyboard,
          shortcut: shortcut('shortcut-help').keys,
          onSelect: help.showShortcuts
        },
        ...(tips
          ? [
              {
                label: t('navigation:helpMenu.takeTheTour'),
                icon: Signpost,
                hint: t('navigation:helpMenu.takeTheTourHint'),
                onSelect: tips.startTour
              }
            ]
          : []),
        { label: t('navigation:helpMenu.whatSNew'), icon: Gift, onSelect: help.showWhatsNew },
        { type: 'separator' },
        {
          label: t('navigation:helpMenu.reportProblem'),
          icon: Bug,
          hint: t('navigation:helpMenu.opensIssuePageBrowser'),
          onSelect: () => void help.reportProblem()
        },
        {
          label: t('navigation:helpMenu.copyDiagnostics'),
          icon: Copy,
          onSelect: () => void help.copyDiagnostics()
        },
        { type: 'separator' },
        { label: t('navigation:helpMenu.about'), icon: Info, onSelect: help.openAbout }
      ]}
      renderTrigger={(trigger) => (
        <Tooltip content={collapsed ? t('navigation:helpMenu.help') : null} placement="right-start">
          <button
            {...trigger}
            type="button"
            className="ostler-sidebar-link ostler-sidebar-help"
            data-tour="help"
            aria-label={collapsed ? t('navigation:helpMenu.help') : undefined}
          >
            <Icon icon={CircleHelp} />
            {!collapsed && (
              <span className="ostler-sidebar-label">{t('navigation:helpMenu.help')}</span>
            )}
          </button>
        </Tooltip>
      )}
    />
  )
}
