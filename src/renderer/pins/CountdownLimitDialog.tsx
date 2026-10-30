import type { PinView } from '@shared/ostler-api'
import { COUNTDOWN_MAX } from '@shared/planning/countdown'
import { Button, Dialog } from '../ui'
import { pinTitle } from './pin-display'
import './CountdownLimitDialog.css'
import { t } from '@shared/i18n'

/**
 * At most three countdowns show at once (N5.2b): turning on a fourth asks
 * which of the three to turn off. Choosing one turns it off and the new one
 * on in the same change; Cancel leaves all three as they are.
 */
export function CountdownLimitDialog({
  pin,
  countdowns,
  onChoose,
  onClose
}: {
  /** The pin waiting to count down, or null when nothing is asked. */
  pin: PinView | null
  countdowns: readonly PinView[]
  onChoose: (off: PinView) => void
  onClose: () => void
}) {
  if (!pin) return null
  return (
    <Dialog
      open
      size="sm"
      title={t('common:countdowns.limitTitle')}
      description={t('common:countdowns.limitBody', {
        max: COUNTDOWN_MAX,
        title: pinTitle(pin)
      })}
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('common:countdowns.cancel')}
        </Button>
      }
    >
      <ul className="countdown-limit-list">
        {countdowns.map((entry) => (
          <li key={entry.id}>
            <Button onClick={() => onChoose(entry)}>
              {t('common:countdowns.turnOff', { title: pinTitle(entry) })}
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
