import type { ReactNode } from 'react'
import { splitErrorDetails } from '@shared/error-details'
import './ErrorText.css'
import { t } from '@shared/i18n'

/**
 * A message that may carry the raw technical text behind it
 * (`withErrorDetails`, from main's AI error mapping): the plain advice shows,
 * the rest waits behind "Details". Anything that is not a string shows as is.
 */
export function ErrorText({ children }: { children: ReactNode }) {
  if (typeof children !== 'string') return <>{children}</>
  const { message, details } = splitErrorDetails(children)
  if (!details) return <>{message}</>
  return (
    <>
      {message}
      <details className="ui-error-details">
        <summary>{t('common:errorText.details')}</summary>
        <p className="ui-error-details__raw">{details}</p>
      </details>
    </>
  )
}
