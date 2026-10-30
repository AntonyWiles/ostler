import type { ComponentProps } from 'react'
import { Trans as BaseTrans } from 'react-i18next'
import { i18n } from '@shared/i18n'

/**
 * A translated sentence with markup inside it (P11.1): "Move
 * <strong>{{title}}</strong> to Done?". The markup's elements are passed as
 * `components`, so the sentence stays whole for translators. Bound to the
 * app's i18next instance, so it works with or without a provider above it.
 */
export function Trans(props: ComponentProps<typeof BaseTrans>) {
  return <BaseTrans i18n={i18n} {...props} />
}
