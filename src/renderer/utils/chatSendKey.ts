import type { KeyboardEvent } from 'react'
import type { RendererConfig } from '@shared/ostler-api'

/**
 * Determines whether a keydown event on an AI chat textarea should send the
 * message, based on the user's "Send message on" setting. Shift+Enter always
 * inserts a newline instead of sending, regardless of the setting.
 */
export function isChatSendShortcut(
  e: KeyboardEvent,
  sendMessageOn: RendererConfig['ui']['sendMessageOn']
): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false
  if (sendMessageOn === 'enter') return true
  return e.ctrlKey || e.metaKey
}
