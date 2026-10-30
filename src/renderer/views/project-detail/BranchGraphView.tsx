import React, { useEffect, useMemo, useState } from 'react'
import type { GitGraphCommit } from '@shared/ostler-api'
import { Badge, InlineAlert, Skeleton } from '../../ui'
import './BranchGraphView.css'
import { t } from '@shared/i18n'

interface BranchGraphViewProps {
  projectId: string
}

interface LaidOutNode {
  commit: GitGraphCommit
  row: number
  col: number
}

interface LaidOutEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

const ROW_HEIGHT = 34
const COL_WIDTH = 22
const MARGIN = 16
/** Lanes take the six chart colours in turn (tokens.css), so both themes fit. */
const LANE_COUNT = 6

/**
 * Assigns each commit a (row, column) lane position from Git's own commit
 * order (newest first, parents always appearing later in the list) using a
 * simplified version of the lane-tracking approach `git log --graph` uses:
 * each open lane remembers the hash it expects next, and a commit claims
 * whichever lane (if any) was already expecting it before handing its lane(s)
 * off to its parent(s).
 */
function layoutCommits(commits: GitGraphCommit[]): LaidOutNode[] {
  const lanes: Array<string | null> = []
  const nodes: LaidOutNode[] = []

  commits.forEach((commit, row) => {
    let col = lanes.indexOf(commit.hash)
    if (col === -1) {
      col = lanes.indexOf(null)
      if (col === -1) {
        col = lanes.length
        lanes.push(null)
      }
    }
    lanes[col] = null
    nodes.push({ commit, row, col })

    commit.parents.forEach((parentHash, parentIndex) => {
      if (parentIndex === 0) {
        lanes[col] = parentHash
        return
      }
      let freeCol = lanes.indexOf(null)
      if (freeCol === -1) {
        freeCol = lanes.length
        lanes.push(null)
      }
      lanes[freeCol] = parentHash
    })
  })

  return nodes
}

function buildEdges(nodes: LaidOutNode[]): LaidOutEdge[] {
  const rowByHash = new Map(nodes.map((n) => [n.commit.hash, n]))
  const edges: LaidOutEdge[] = []

  for (const node of nodes) {
    for (const parentHash of node.commit.parents) {
      const parentNode = rowByHash.get(parentHash)
      if (!parentNode) continue
      edges.push({
        x1: node.col,
        y1: node.row,
        x2: parentNode.col,
        y2: parentNode.row
      })
    }
  }

  return edges
}

function laneClass(col: number): string {
  return `branch-graph__lane-${(col % LANE_COUNT) + 1}`
}

export function BranchGraphView({ projectId }: BranchGraphViewProps) {
  const [commits, setCommits] = useState<GitGraphCommit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.ostlerAPI.getGitBranchGraph(projectId, 60).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setCommits(result.value.commits)
      } else {
        setError(result.error)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const nodes = useMemo(() => (commits ? layoutCommits(commits) : []), [commits])
  const edges = useMemo(() => buildEdges(nodes), [nodes])
  const maxCol = nodes.reduce((max, n) => Math.max(max, n.col), 0)
  const width = MARGIN * 2 + (maxCol + 1) * COL_WIDTH
  const height = MARGIN * 2 + Math.max(nodes.length - 1, 0) * ROW_HEIGHT + ROW_HEIGHT

  function pointFor(col: number, row: number): [number, number] {
    return [MARGIN + col * COL_WIDTH, MARGIN + row * ROW_HEIGHT]
  }

  if (loading) return <Skeleton lines={4} />
  if (error) return <InlineAlert tone="danger">{error}</InlineAlert>
  if (!commits || commits.length === 0) {
    return <p className="branch-graph__empty">{t('projects:branchGraphView.noCommitsGraph')}</p>
  }

  return (
    <div className="branch-graph">
      <svg
        className="branch-graph__svg"
        width={width}
        height={height}
        role="img"
        aria-label={t('projects:branchGraphView.branchCommitGraph')}
      >
        {edges.map((edge, i) => {
          const [x1, y1] = pointFor(edge.x1, edge.y1)
          const [x2, y2] = pointFor(edge.x2, edge.y2)
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`branch-graph__edge ${laneClass(edge.x1)}`}
            />
          )
        })}
        {nodes.map(({ commit, row, col }) => {
          const [x, y] = pointFor(col, row)
          const isSession = commit.refs.some((r) => r.isSessionBranch)
          return (
            <circle
              key={commit.hash}
              cx={x}
              cy={y}
              r={5}
              className={
                isSession
                  ? 'branch-graph__node branch-graph__node--session'
                  : `branch-graph__node ${laneClass(col)}`
              }
            >
              <title>
                {commit.abbreviatedHash} {commit.message}
              </title>
            </circle>
          )
        })}
      </svg>

      <ul className="branch-graph__list">
        {nodes.map(({ commit }) => (
          <li key={commit.hash} style={{ height: ROW_HEIGHT }}>
            <span className="branch-graph__hash">{commit.abbreviatedHash}</span>
            {commit.refs.length > 0 && (
              <span className="branch-graph__refs">
                {commit.refs.map((ref) => (
                  <Badge
                    key={ref.name}
                    tone={ref.isSessionBranch ? 'accent' : 'neutral'}
                    className={ref.isHead ? 'branch-graph__ref--head' : undefined}
                  >
                    {ref.name}
                  </Badge>
                ))}
              </span>
            )}
            <span className="branch-graph__message" title={commit.message}>
              {commit.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
