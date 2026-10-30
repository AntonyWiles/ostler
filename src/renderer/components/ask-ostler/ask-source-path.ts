import type { AskSource } from '@shared/ostler-api'
import { projectPath } from '../../navigation/paths'
import { searchResultPath } from '../../views/search/search-results'

/**
 * Where a source opens: a record where search opens it (the task drawer, the
 * decision, the Library item…), and a file at its lines in the project's
 * Files tab.
 */
export function askSourcePath(source: AskSource): string {
  if (source.type === 'file') {
    return projectPath(source.projectId, 'files', {
      file: source.path ?? source.id,
      line: source.startLine ? String(source.startLine) : undefined
    })
  }
  return searchResultPath({
    type: source.type,
    id: source.id,
    projectId: source.projectId,
    title: source.title,
    snippet: [],
    workItemId: source.workItemId,
    score: 0
  })
}
