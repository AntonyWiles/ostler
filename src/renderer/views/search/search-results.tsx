import { Fragment } from 'react'
import type {
  LibraryTextLocation,
  SearchEntityType,
  SearchResult,
  SearchSnippetPart
} from '@shared/ostler-api'
import { contactsPath, itemPath, projectPath, taskPath } from '../../navigation/paths'
import {
  BookUser,
  FileText,
  Flag,
  ListChecks,
  MessageSquare,
  Milestone,
  Scale,
  type LucideIcon
} from '../../ui/icons'
import { t } from '@shared/i18n'

/** Each kind of result: its group heading, one-word name and icon. */
export const SEARCH_TYPES: Record<
  SearchEntityType,
  { group: string; label: string; icon: LucideIcon }
> = {
  task: {
    get group() {
      return t('views:searchResults.tasks')
    },
    get label() {
      return t('views:searchResults.task')
    },
    icon: ListChecks
  },
  comment: {
    get group() {
      return t('views:searchResults.comments')
    },
    get label() {
      return t('views:searchResults.comment')
    },
    icon: MessageSquare
  },
  decision: {
    get group() {
      return t('views:searchResults.decisions')
    },
    get label() {
      return t('views:searchResults.decision')
    },
    icon: Scale
  },
  library: {
    get group() {
      return t('views:searchResults.library')
    },
    get label() {
      return t('views:searchResults.libraryItem')
    },
    icon: FileText
  },
  milestone: {
    get group() {
      return t('views:searchResults.milestones')
    },
    get label() {
      return t('views:searchResults.milestone')
    },
    icon: Milestone
  },
  goal: {
    get group() {
      return t('views:searchResults.goals')
    },
    get label() {
      return t('views:searchResults.goal')
    },
    icon: Flag
  },
  contact: {
    get group() {
      return t('views:searchResults.contacts')
    },
    get label() {
      return t('views:searchResults.contact')
    },
    icon: BookUser
  }
}

/**
 * Where a result opens, in place: a task or comment in the task's drawer,
 * a Library item in the Library, a decision, milestone or goal in its view
 * with its editor open.
 */
export function searchResultPath(result: SearchResult): string {
  switch (result.type) {
    case 'task':
      // A task in To triage counts nowhere yet: it opens where it waits (N4.3a).
      return result.inTriage
        ? projectPath(result.projectId, 'triage')
        : taskPath(result.projectId, result.workItemId ?? result.id)
    case 'comment':
      return taskPath(result.projectId, result.workItemId ?? result.id)
    case 'library':
    case 'decision':
    case 'milestone':
      return itemPath(result.type, result.projectId, result.id)
    case 'goal':
      return projectPath(result.projectId, 'milestones', { edit: `goal:${result.id}` })
    case 'contact':
      return contactsPath(result.id)
  }
}

/** Where in a Library file a result's passage is: "page 7", "Slide 3", "Sheet Budget". */
export function locationLabel(location: LibraryTextLocation | undefined): string | null {
  if (!location) return null
  return t(`views:searchResults.${location.kind}`, { label: location.label })
}

/** A snippet with its matching words marked. */
export function Snippet({ parts }: { parts: readonly SearchSnippetPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </>
  )
}

/** The snippet as plain words, for an accessible name. */
export function snippetText(parts: readonly SearchSnippetPart[]): string {
  return parts.map((part) => part.text).join('')
}
