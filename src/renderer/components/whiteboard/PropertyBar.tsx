import { useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import type { WhiteboardObjectInput } from '@shared/whiteboard/model'
import { Button, Menu, Popover, type MenuEntry } from '../../ui'
import { ChevronDown, Icon } from '../../ui/icons'
import { cx } from '../../ui/cx'
import { textPaint } from './paint'
import { STYLE_CONTROLS, controlApplies, sharedValue, type StyleControl } from './style-controls'

export interface PropertyBarProps {
  /**
   * What the controls read and set: the selected objects, or a stand-in for
   * what the chosen drawing tool makes next. Empty when there is neither.
   */
  objects: readonly WhiteboardObjectInput[]
  /** Only these controls (by id) are offered; the rest stay in place, disabled. */
  only?: readonly string[]
  /** Sets one control's value (one commit for a selection). */
  onPick(control: StyleControl, value: string): void
  /** Shown after the controls, always in the same place: actions on the selection. */
  actions?: ReactNode
  /** Shown under the swatches when the colour opens: Apply to the whole map (prompt 14). */
  colourExtra?: ReactNode
}

/**
 * How a colour's swatch is drawn: as the light fill a note, an idea or a
 * lightly filled shape takes, or as the solid colour of ink, lines and solid
 * fills. A swatch shows the colour the object will actually have.
 */
export function swatchTone(objects: readonly WhiteboardObjectInput[]): 'light' | 'solid' {
  return objects.length > 0 &&
    objects.every((object) => textPaint(object).fill?.endsWith('-light') === true)
    ? 'light'
    : 'solid'
}

/** Why a control is disabled, for its tooltip. */
function disabledReason(objects: readonly WhiteboardObjectInput[]): string {
  return t(
    objects.length === 0
      ? 'library:whiteboard.style.selectFirst'
      : 'library:whiteboard.style.notForThese'
  )
}

/**
 * The whiteboard's style controls, fixed in the top bar (plan
 * `docs/plans/whiteboards/`, prompt 06, reworked): every control from
 * `STYLE_CONTROLS` is always there, in the same order and at the same width,
 * so nothing moves or changes size as the selection changes. A control that
 * does not apply to the selection (or to the chosen tool) is disabled and says
 * why. Each names what it sets: a colour button with its swatch, menus that
 * show the chosen option, and the Dashed toggle.
 */
export function PropertyBar({ objects, only, onPick, actions, colourExtra }: PropertyBarProps) {
  return (
    <div className="wb-props" role="toolbar" aria-label={t('library:whiteboard.style.bar')}>
      {STYLE_CONTROLS.map((control) => {
        const enabled = controlApplies(control, objects, only)
        const value = enabled ? sharedValue(control, objects) : null
        const props = { control, value, onPick, objects }
        const reason = enabled ? undefined : disabledReason(objects)
        if (control.view === 'swatches') {
          return (
            <ColourControl
              key={control.id}
              {...props}
              disabledReason={reason}
              extra={colourExtra}
            />
          )
        }
        if (control.view === 'toggle') {
          const on = value === 'true'
          return (
            <Button
              key={control.id}
              variant="ghost"
              size="sm"
              icon={control.icon}
              className={cx('wb-prop', `wb-prop--${control.id}`, 'wb-prop__toggle')}
              aria-label={t(control.labelKey)}
              title={reason ? undefined : t(control.labelKey)}
              aria-pressed={enabled ? on : undefined}
              disabled={!enabled}
              disabledReason={reason}
              onClick={() => onPick(control, on ? 'false' : 'true')}
            />
          )
        }
        return <ChoiceControl key={control.id} {...props} disabledReason={reason} />
      })}
      {actions && (
        <>
          <span className="wb-editor__divider" aria-hidden="true" />
          <div className="wb-props__actions">{actions}</div>
        </>
      )}
    </div>
  )
}

interface ControlProps {
  control: StyleControl
  value: string | null
  objects: readonly WhiteboardObjectInput[]
  onPick(control: StyleControl, value: string): void
  disabledReason?: string
}

/** A menu of a control's options; its button shows the chosen one. */
function ChoiceControl({ control, value, onPick, disabledReason }: ControlProps) {
  const label = t(control.labelKey)
  const chosen = value === null ? null : t(control.optionLabelKey(value))
  const optionIcon = value === null ? undefined : control.optionIcon?.(value)
  const entries = (): MenuEntry[] =>
    control.options.map((option) => ({
      label: t(control.optionLabelKey(option)),
      icon: control.optionIcon?.(option),
      checked: option === value,
      checkKind: 'radio',
      onSelect: () => onPick(control, option)
    }))
  return (
    <Menu
      label={label}
      items={entries}
      renderTrigger={(trigger) => (
        <Button
          variant="ghost"
          size="sm"
          icon={optionIcon ?? control.icon ?? control.optionIcon?.(control.options[0])}
          iconEnd={ChevronDown}
          className={cx('wb-prop', `wb-prop--${control.id}`)}
          aria-label={chosen ? `${label}: ${chosen}` : label}
          title={disabledReason ? undefined : chosen ? `${label}: ${chosen}` : label}
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          {...trigger}
          // A disabled control's menu does not open from the keyboard either.
          onKeyDown={disabledReason ? undefined : trigger.onKeyDown}
        >
          {control.optionIcon ? null : <span className="wb-prop__value">{chosen ?? label}</span>}
        </Button>
      )}
    />
  )
}

/** The colour button: its swatch is the colour chosen; the swatches open under it and stay open while picking. */
function ColourControl({
  control,
  value,
  objects,
  onPick,
  disabledReason,
  extra
}: ControlProps & { extra?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const label = t(control.labelKey)
  const tone = swatchTone(objects)
  const chosen = value === null ? null : t(control.optionLabelKey(value))
  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        iconEnd={ChevronDown}
        className="wb-prop wb-prop--colour"
        aria-label={chosen ? `${label}: ${chosen}` : label}
        title={disabledReason ? undefined : chosen ? `${label}: ${chosen}` : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabledReason !== undefined}
        disabledReason={disabledReason}
        onClick={() => setOpen((was) => !was)}
      >
        <span
          className={cx(
            'wb-swatch',
            'wb-swatch--chip',
            `wb-swatch--${tone}`,
            value ? `wb-swatch--${value}` : 'wb-swatch--mixed'
          )}
          aria-hidden="true"
        />
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        label={label}
        className="wb-colour-popover"
      >
        <div className="wb-colour-popover__swatches" role="group" aria-label={label}>
          {control.options.map((option) => {
            const name = t(control.optionLabelKey(option))
            return (
              <button
                key={option}
                type="button"
                className={cx('wb-swatch', `wb-swatch--${tone}`, `wb-swatch--${option}`)}
                aria-label={name}
                title={name}
                aria-pressed={value === option}
                // Stays open: the change shows at once, with any offer it brings
                // (Apply to the whole map); Escape or a click away closes it.
                onClick={() => onPick(control, option)}
              />
            )
          })}
        </div>
        {extra && (
          <div className="wb-colour-popover__extra" onClick={() => setOpen(false)}>
            {extra}
          </div>
        )}
      </Popover>
    </>
  )
}

/** Icons for the actions after the controls, so the bar reads as one row of buttons. */
export function PropertyAction({
  icon,
  label,
  onClick,
  disabledReason,
  shortcut,
  iconOnly = false
}: {
  icon: Parameters<typeof Icon>[0]['icon']
  label: string
  onClick(): void
  /** Set when the action cannot run now: the button stays, disabled, saying why. */
  disabledReason?: string
  /** The keys from the shortcut table, shown with the label. */
  shortcut?: string
  /** Only the icon shows; the label is its name and tooltip. */
  iconOnly?: boolean
}) {
  const named = shortcut ? `${label} (${shortcut})` : label
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={icon}
      className="wb-prop wb-prop__action"
      aria-label={iconOnly ? label : undefined}
      title={disabledReason ? undefined : named}
      disabled={disabledReason !== undefined}
      disabledReason={disabledReason}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      {iconOnly ? null : label}
    </Button>
  )
}
