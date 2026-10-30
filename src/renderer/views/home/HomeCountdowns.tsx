import { formatIsoDate } from '@shared/dates'
import { countdownProgress, countdownWords } from '@shared/planning/countdown'
import { myWorkingDays } from '@shared/planning/working-days'
import { useOstler } from '../../context/OstlerContext'
import { useDaysOff } from '../../context/DaysOffContext'
import { usePeople } from '../../context/PeopleContext'
import { ProjectMark } from '../../components/ProjectMark'
import { canCountDown, usePins } from '../../pins/PinsProvider'
import { useOpenPin } from '../../pins/useOpenPin'
import { pinIcon, pinShown } from '../../pins/pin-display'
import { Button, Icon, ProgressBar } from '../../ui'
import './HomeCountdowns.css'
import { t } from '@shared/i18n'

/**
 * Home's countdowns (N5.2b, N37): a card for each pinned milestone or dated
 * task shown as a countdown, in pin order, near the top of Home. Each says
 * the countdown in the words the tray and the jump list use, its date, and
 * its project's colour and icon, with a small bar of the time passed since
 * it was pinned; it opens its item. A done item offers to turn it off.
 * Nothing shows while there are none.
 */
export function HomeCountdowns({ today }: { today: string }) {
  const pins = usePins()
  const open = useOpenPin()
  const { daysOff } = useDaysOff()
  const { me } = usePeople()
  const { projects } = useOstler()
  const byId = new Map(projects.map((project) => [project.id, project]))
  const shown = pins.countdowns.filter((pin) => canCountDown(pin) && pinShown(pin, byId))
  if (shown.length === 0) return null
  // My own working days, as main words the tray's and the API's countdowns.
  const mine = myWorkingDays(me, daysOff)

  return (
    <section className="ostler-home-countdowns" aria-label={t('common:countdowns.heading')}>
      <ul className="ostler-home-countdowns__list">
        {shown.map((pin) => {
          const title = pin.title ?? ''
          const date = pin.date!
          const done = pin.done === true
          const words = countdownWords({ title, date, done }, today, mine)
          const dateText = formatIsoDate(date)
          return (
            <li key={pin.id} className="ostler-home-countdown">
              <button
                type="button"
                className="ostler-home-countdown__open"
                aria-label={t('common:countdowns.open', { title, words, date: dateText })}
                onClick={() => void open(pin)}
              >
                <span className="ostler-home-countdown__words">
                  {byId.has(pin.projectId) ? (
                    <ProjectMark project={byId.get(pin.projectId)} className="project-color" />
                  ) : (
                    <Icon icon={pinIcon(pin)} />
                  )}
                  <span>{words}</span>
                </span>
                <span className="ostler-home-countdown__date">{dateText}</span>
              </button>
              <ProgressBar
                label={t('common:countdowns.progress')}
                value={Math.round(countdownProgress(pin.createdAt, date, today) * 100)}
                tone={done ? 'success' : 'accent'}
              />
              {done && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('common:countdowns.turnOffDone', { title })}
                  onClick={() => void pins.setCountdown(pin, false)}
                >
                  {t('common:countdowns.turnOffShort')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
