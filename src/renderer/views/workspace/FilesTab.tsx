import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { projectFolder } from '@shared/project-folder'
import type { ProjectViewProps } from '../../navigation/view-props'
import { CodePanel } from '../project-detail/CodePanel'
import type { CodeWorkspaceRoot } from '../project-detail/types'
import '../ProjectDetailView.css'
import { t } from '@shared/i18n'

/**
 * Files: the file browser, editor and command runner across the project
 * folder and one entry per task copy (simplify pass §7). The registry loads
 * it lazily, so Monaco loads only here. `?rootLabel=&rootPath=` opens a
 * specific copy (from Agents or a task's review); `?file=&line=` opens a file
 * in the project folder at a line (from Ask Ostler's sources, N8.3a).
 */
export function FilesTab({ project, ws }: ProjectViewProps) {
  const projectId = project.id
  const [searchParams] = useSearchParams()
  const harnessState = ws.harnessState

  const requestedLabel = searchParams.get('rootLabel')
  const requestedPath = searchParams.get('rootPath')
  const requestedFile = searchParams.get('file')
  const requestedLine = Number(searchParams.get('line'))
  const openAt = useMemo(
    () =>
      requestedFile
        ? {
            path: requestedFile,
            line: Number.isInteger(requestedLine) && requestedLine > 0 ? requestedLine : null
          }
        : undefined,
    [requestedFile, requestedLine]
  )
  const [selectedRoot, setSelectedRoot] = useState<CodeWorkspaceRoot | null>(() =>
    requestedLabel && requestedPath ? { label: requestedLabel, path: requestedPath } : null
  )
  // A link arriving while Files is already open selects its copy too.
  useEffect(() => {
    if (requestedLabel && requestedPath)
      setSelectedRoot({ label: requestedLabel, path: requestedPath })
  }, [requestedLabel, requestedPath])

  const roots = useMemo<CodeWorkspaceRoot[]>(() => {
    const list: CodeWorkspaceRoot[] = []
    const folder = projectFolder(project)
    if (folder)
      list.push({
        label: t('projects:filesTab.folder', { projectName: project.name }),
        path: folder
      })
    const seen = new Set<string>()
    const addCopy = (title: string, path: string | undefined) => {
      if (!path || seen.has(path)) return
      seen.add(path)
      list.push({ label: t('projects:filesTab.taskCopy', { title }), path })
    }
    for (const session of harnessState?.activeSessions ?? []) {
      addCopy(session.title, session.workspace?.worktreePath)
    }
    for (const session of harnessState?.reviewSessions ?? []) {
      addCopy(session.title, session.workspace?.worktreePath)
    }
    for (const task of harnessState?.taskQueue ?? []) {
      if (task.status === 'pending' && task.copy?.state === 'ready') {
        addCopy(task.title, task.copy.worktreePath)
      }
    }
    return list
  }, [harnessState?.activeSessions, harnessState?.reviewSessions, harnessState?.taskQueue, project])

  // A file link names a file in the project folder, the first root.
  useEffect(() => {
    if (requestedFile && roots[0] && projectFolder(project)) setSelectedRoot(roots[0])
    // Only when the link changes, not whenever a copy comes or goes.
  }, [requestedFile, requestedLine])

  return (
    <div className="ostler-project-detail-grid ostler-project-detail-grid--code">
      <div className="ostler-project-detail-column">
        <CodePanel
          projectId={projectId}
          roots={roots}
          selectedRoot={selectedRoot}
          onSelectRoot={setSelectedRoot}
          openAt={openAt}
        />
      </div>
    </div>
  )
}
