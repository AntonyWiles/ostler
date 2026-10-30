import type { SessionTranscriptEntry } from '@shared/ostler-api'
import { t } from '@shared/i18n'

/** What one transcript entry is, for its bubble and label. */
export type TranscriptEntryKind =
  'tool-call' | 'tool-result' | 'task' | 'answer' | 'assistant' | 'question' | 'security' | 'system'

export const TRANSCRIPT_KIND_LABEL: Record<TranscriptEntryKind, string> = {
  get 'tool-call'() {
    return t('agents:transcriptEntry.toolCall')
  },
  get 'tool-result'() {
    return t('agents:transcriptEntry.toolResult')
  },
  get task() {
    return t('agents:transcriptEntry.taskUser')
  },
  get answer() {
    return t('agents:transcriptEntry.answer')
  },
  get assistant() {
    return t('agents:transcriptEntry.assistant')
  },
  get question() {
    return t('agents:transcriptEntry.agentQuestion')
  },
  get security() {
    return t('agents:transcriptEntry.securityAlert')
  },
  get system() {
    return t('agents:transcriptEntry.system')
  }
}

export function transcriptEntryKind(entry: SessionTranscriptEntry): TranscriptEntryKind {
  const content = entry.content
  if (entry.role === 'tool') {
    // A call and what it returned are recorded separately, so the feed reads
    // as command then output rather than two Tool rows.
    return content.split('\n')[0].endsWith(' →') ? 'tool-result' : 'tool-call'
  }
  if (entry.role === 'user') {
    return content.startsWith('[Human Answer]') || content.startsWith('[User answer]')
      ? 'answer'
      : 'task'
  }
  if (entry.role === 'assistant') {
    return content.startsWith('[Question to human]') || content.startsWith('[Agent Question]')
      ? 'question'
      : 'assistant'
  }
  if (
    content.startsWith('[Defense-in-depth blocked]') ||
    content.startsWith('[Security Violation]')
  )
    return 'security'
  return 'system'
}
