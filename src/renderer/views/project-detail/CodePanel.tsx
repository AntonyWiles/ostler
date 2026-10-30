import React from 'react'
import { CodeWorkspace } from '../../components/CodeWorkspace'
import { CodeWorkspaceRoot } from './types'

interface CodePanelProps {
  projectId: string
  roots: CodeWorkspaceRoot[]
  selectedRoot: CodeWorkspaceRoot | null
  onSelectRoot: (root: CodeWorkspaceRoot) => void
  openAt?: { path: string; line: number | null }
}

export function CodePanel({
  projectId,
  roots,
  selectedRoot,
  onSelectRoot,
  openAt
}: CodePanelProps) {
  const liveSelectedRoot =
    selectedRoot && roots.some((root) => root.path === selectedRoot.path) ? selectedRoot : roots[0]
  return (
    <CodeWorkspace
      projectId={projectId}
      roots={roots}
      selectedRoot={liveSelectedRoot}
      onSelectRoot={onSelectRoot}
      openAt={openAt}
    />
  )
}
