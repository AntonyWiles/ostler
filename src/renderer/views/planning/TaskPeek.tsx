import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
} from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router-dom'
import { usePlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { lazyLayer, lazyNamed } from '../../lib/lazy-named'
import { taskPath } from '../../navigation/paths'

const WorkItemDrawer = lazyNamed(() => import('./WorkItemDrawer'), 'WorkItemDrawer')
const WontDoDialog = lazyLayer(() => import('./WontDoDialog'), 'WontDoDialog')
const BlockTimeFor = lazyLayer(
  () => import('../../components/time-blocks/BlockTimeDialog'),
  'BlockTimeFor'
)
const MarkDuplicateDialog = lazyLayer(() => import('./MarkDuplicateDialog'), 'MarkDuplicateDialog')

type Peek = { projectId: string; taskId: string }

const PeekContext = createContext<((peek: Peek) => void) | null>(null)

/**
 * Tasks open where they were clicked (MOP-30): inside this, a `TaskLink`
 * opens the task's drawer over the page instead of going to its project, so
 * Home stays Home. The drawer is the project's own, on the project's own
 * planning workspace, so everything in it saves and undoes as it does there.
 * Ctrl, Shift or a middle click still follow the link to the project.
 */
export function TaskPeekProvider({ children }: { children: ReactNode }) {
  const [peek, setPeek] = useState<Peek | null>(null)
  const open = useCallback((next: Peek) => setPeek(next), [])
  return (
    <PeekContext.Provider value={open}>
      {children}
      {peek && (
        <PeekedTask
          key={`${peek.projectId}:${peek.taskId}`}
          {...peek}
          onClose={() => setPeek(null)}
        />
      )}
    </PeekContext.Provider>
  )
}

function PeekedTask({ projectId, taskId, onClose }: Peek & { onClose: () => void }) {
  const navigate = useNavigate()
  const ws = usePlanningWorkspace(projectId, navigate, {
    view: 'board',
    setView: () => {},
    safetyPoll: false
  })
  const opened = useRef(false)
  // Loading starts false: only once a read has begun does "not found" mean gone.
  const read = useRef(false)
  if (ws.loading) read.current = true
  const item = ws.workItems.find((candidate) => candidate.id === taskId)
  useEffect(() => {
    if (opened.current || !item) return
    opened.current = true
    ws.openWorkItem(item)
  }, [item])
  // Gone (deleted elsewhere) before it opened: nothing to show.
  useEffect(() => {
    if (read.current && !opened.current && !ws.loading && !item) onClose()
  }, [ws.loading, item])
  // Closed: the peek is over.
  useEffect(() => {
    if (opened.current && ws.selectedWorkItem === null) onClose()
  }, [ws.selectedWorkItem])

  return (
    <>
      <Suspense fallback={null}>{opened.current && <WorkItemDrawer ws={ws} />}</Suspense>
      <Suspense fallback={null}>
        {ws.wontDoTargets && <WontDoDialog ws={ws} targets={ws.wontDoTargets} />}
        {ws.blockTimeTarget && (
          <BlockTimeFor item={ws.blockTimeTarget} onClose={() => ws.setBlockTimeTarget(null)} />
        )}
        {ws.duplicateTarget && <MarkDuplicateDialog ws={ws} target={ws.duplicateTarget} />}
      </Suspense>
    </>
  )
}

function plainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

/**
 * A link to a task: inside `TaskPeekProvider` a plain click opens it in
 * place, and Ctrl (or Cmd) with a click goes to the task in its project.
 * Anywhere else it is a plain link to the task in its project.
 */
export function TaskLink({
  projectId,
  taskId,
  onClick,
  ...props
}: Omit<LinkProps, 'to'> & { projectId: string; taskId: string }) {
  const peek = useContext(PeekContext)
  const navigate = useNavigate()
  const to = useMemo(() => taskPath(projectId, taskId), [projectId, taskId])
  return (
    <Link
      {...props}
      to={to}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !peek) return
        if (event.button === 0 && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          navigate(to)
          return
        }
        if (!plainClick(event)) return
        event.preventDefault()
        peek({ projectId, taskId })
      }}
    />
  )
}
