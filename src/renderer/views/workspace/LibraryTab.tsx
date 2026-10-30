import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ProjectViewProps } from '../../navigation/view-props'
import { LibraryPanel } from '../project-detail/library/LibraryPanel'
import '../ProjectDetailView.css'

/**
 * The project's Library. `?item=<id>` opens with that item selected and
 * `?new=brief|guide|note` starts a new written item.
 */
export function LibraryTab({ project }: ProjectViewProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const newKind = libraryNewKind(searchParams.get('new'))

  // ?new= is consumed once: the Library opened its editor on mount, so drop it
  // from the URL to keep a later visit from starting another new item.
  useEffect(() => {
    if (!searchParams.get('new')) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        return next
      },
      { replace: true }
    )
  }, [searchParams, setSearchParams])

  return (
    <div className="ostler-project-detail-grid ostler-project-detail-grid--library">
      <div className="ostler-project-detail-column">
        <LibraryPanel
          key={project.id}
          projectId={project.id}
          initialItemId={searchParams.get('item')}
          initialNewKind={newKind}
        />
      </div>
    </div>
  )
}

/** `?new=`: which written kind to start, if any. */
function libraryNewKind(value: string | null): 'brief' | 'guide' | 'note' | null {
  return value === 'brief' || value === 'guide' || value === 'note' ? value : null
}
