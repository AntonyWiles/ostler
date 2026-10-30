import { useEffect, useRef } from 'react'
import { useConfig } from '../hooks/useConfig'
import { useNavigate } from 'react-router-dom'
import { IN_APP_NOTIFICATION_DURATIONS, type InAppNotificationDuration } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { settingsPath } from '../navigation/paths'
import {
  Button,
  ErrorText,
  IconButton,
  Popover,
  TONE_ICON,
  useNotificationCenter,
  type NotificationCenterApi,
  type NotificationRecord
} from '../ui'
import { Bell, Icon, Settings, Undo2, X } from '../ui/icons'
import { absoluteTimeText, relativeTimeText } from '../ui/date-text'
import './NotificationCenter.css'

/**
 * The status bar's bell and the notification centre it opens: every in-app
 * notification (toast) since Ostler started, newest first, with its Undo or
 * other action still there until it is used. Windows notifications are not
 * here; they are in Windows' own notification centre.
 */
export function NotificationCenter() {
  const center = useNotificationCenter()
  // Outside a ToastProvider (some component tests) there is nothing to keep.
  return center ? <NotificationBell center={center} /> : null
}

function NotificationBell({ center }: { center: NotificationCenterApi }) {
  const bellRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  useInAppDuration(center.setDuration)

  const register = center.registerCenter
  useEffect(() => register(), [register])

  const { records, unread, open, setOpen } = center

  return (
    <>
      <button
        ref={bellRef}
        type="button"
        className="statusbar-bell"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unread > 0
            ? t('navigation:statusBar.notificationsUnread', { count: unread })
            : t('navigation:statusBar.notifications')
        }
        title={t('navigation:statusBar.notificationsTitle')}
        onClick={() => setOpen(!open)}
      >
        <Icon icon={Bell} />
        <span aria-hidden="true">{t('navigation:statusBar.notificationsShort')}</span>
        {unread > 0 && (
          <span className="statusbar-bell__count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={bellRef}
        placement="top-end"
        label={t('common:notificationCenter.title')}
        className="notification-center"
      >
        <header className="notification-center__header">
          <h2 className="notification-center__title">{t('common:notificationCenter.title')}</h2>
          {records.length > 0 && (
            <Button size="sm" variant="ghost" onClick={center.clear}>
              {t('common:notificationCenter.clearAll')}
            </Button>
          )}
        </header>
        <p className="notification-center__intro">{t('common:notificationCenter.intro')}</p>
        {records.length === 0 ? (
          <p className="notification-center__empty">{t('common:notificationCenter.empty')}</p>
        ) : (
          <ol className="notification-center__list">
            {records.map((record) => (
              <NotificationRow key={record.id} record={record} />
            ))}
          </ol>
        )}
        <footer className="notification-center__footer">
          <Button
            size="sm"
            variant="ghost"
            icon={Settings}
            onClick={() => {
              setOpen(false)
              navigate(settingsPath('notifications'))
            }}
          >
            {t('common:notificationCenter.settings')}
          </Button>
        </footer>
      </Popover>
    </>
  )
}

function NotificationRow({ record }: { record: NotificationRecord }) {
  const center = useNotificationCenter()!
  const tone = record.tone ?? 'info'
  return (
    <li className={`notification-center__item notification-center__item--${tone}`}>
      <span className="notification-center__icon">
        <Icon icon={record.undo ? Undo2 : TONE_ICON[tone]} />
      </span>
      <div className="notification-center__text">
        <p className="notification-center__item-title">{record.title}</p>
        {record.body && (
          <div className="notification-center__body">
            <ErrorText>{record.body}</ErrorText>
          </div>
        )}
        <div className="notification-center__meta">
          <time dateTime={new Date(record.at).toISOString()} title={absoluteTimeText(record.at)}>
            {relativeTimeText(record.at)}
          </time>
          {record.used && (
            <span>
              {record.undo
                ? t('common:notificationCenter.undone')
                : t('common:notificationCenter.done')}
            </span>
          )}
        </div>
        {!record.used && (record.action || record.secondaryAction) && (
          <div className="notification-center__actions">
            {record.secondaryAction && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => center.runAction(record.id, 'secondary')}
              >
                {record.secondaryAction.label}
              </Button>
            )}
            {record.action && (
              <Button
                size="sm"
                variant="ghost"
                icon={record.undo ? Undo2 : undefined}
                onClick={() => center.runAction(record.id, 'action')}
              >
                {record.action.label}
              </Button>
            )}
          </div>
        )}
      </div>
      <IconButton
        label={t('common:notificationCenter.remove', { title: record.title })}
        icon={X}
        size="sm"
        onClick={() => center.remove(record.id)}
      />
    </li>
  )
}

/** Keeps the toasts' time on screen to Settings › Notifications, as it changes. */
function useInAppDuration(setDuration: (duration: InAppNotificationDuration) => void) {
  const { config } = useConfig()
  const value = config?.notifications.inAppDuration
  useEffect(() => {
    if (value === undefined) return
    setDuration(IN_APP_NOTIFICATION_DURATIONS.includes(value) ? value : 'normal')
  }, [value, setDuration])
}
