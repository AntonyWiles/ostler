import { useState } from 'react'
import type { GitCommit, GitProjectState } from '@shared/ostler-api'
import { GitDiffModal } from './GitDiffModal'
import { BranchGraphView } from './BranchGraphView'
import { Collapse, Button, Card, EmptyState, Section } from '../../ui'
import { chevronClass, ChevronRight, GitBranch, Icon } from '../../ui/icons'
import { t } from '@shared/i18n'
import { formatRelativeTime } from '@shared/format'

interface FolderOverviewProps {
  id: string
  gitState: GitProjectState | null
  recentCommits: GitCommit[]
}

/**
 * The Overview's folder part, shown only while a folder is linked (D4): how
 * agent workspaces drift from the trunk, and the folder's Git status with its
 * recent commits.
 */
export function FolderOverview({ id, gitState, recentCommits }: FolderOverviewProps) {
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [diffTarget, setDiffTarget] = useState<{ commitHash: string; filePath: string } | null>(
    null
  )
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [showBranchGraph, setShowBranchGraph] = useState(false)

  async function openFileDiff(commitHash: string, filePath: string) {
    setDiffTarget({ commitHash, filePath })
    setDiffContent(null)
    setDiffError(null)
    setDiffLoading(true)
    const result = await window.ostlerAPI.getGitFileDiff(id, commitHash, filePath)
    if (result.ok) {
      setDiffContent(result.value)
    } else {
      setDiffError(result.error)
    }
    setDiffLoading(false)
  }

  const isRepo = Boolean(gitState?.isGitRepo)
  const counts = gitState
    ? ([
        [t('projects:folderOverview.status.modified'), gitState.workingTreeStatus.modified],
        [t('projects:folderOverview.status.untracked'), gitState.workingTreeStatus.untracked],
        [t('projects:folderOverview.status.staged'), gitState.workingTreeStatus.staged],
        [t('projects:folderOverview.status.conflicted'), gitState.workingTreeStatus.conflicted]
      ] as const)
    : []

  return (
    <>
      <Section
        title={t('projects:folderOverview.git')}
        actions={
          isRepo ? (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={showBranchGraph}
              onClick={() => setShowBranchGraph((value) => !value)}
            >
              {showBranchGraph
                ? t('projects:folderOverview.hideBranchGraph')
                : t('projects:folderOverview.showBranchGraph')}
            </Button>
          ) : undefined
        }
      >
        {gitState && isRepo ? (
          <Card className="overview-git">
            <p className="overview-git__branch">
              <Icon icon={GitBranch} />
              {gitState.currentBranch || t('projects:folderOverview.noBranch')}
            </p>
            {showBranchGraph && <BranchGraphView projectId={id} />}
            <dl className="overview-git__counts">
              {counts.map(([label, value]) => (
                <div
                  key={label}
                  data-tone={label === 'Conflicted' && value > 0 ? 'danger' : undefined}
                >
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {recentCommits.length > 0 && (
              <div>
                <h3 className="overview-summary__label">
                  {t('projects:folderOverview.recentCommits')}
                </h3>
                <ul className="overview-commits">
                  {recentCommits.map((commit) => {
                    const open = expandedCommit === commit.hash
                    return (
                      <li key={commit.hash}>
                        <button
                          type="button"
                          className="overview-commit"
                          onClick={() => setExpandedCommit(open ? null : commit.hash)}
                          aria-expanded={open}
                        >
                          <Icon icon={ChevronRight} className={chevronClass(open)} />
                          <code>{commit.abbreviatedHash || commit.hash.substring(0, 7)}</code>
                          <span className="overview-row__title" title={commit.message}>
                            {commit.message}
                          </span>
                          <span className="overview-muted">
                            {commit.date ? formatRelativeTime(new Date(commit.date).getTime()) : ''}
                          </span>
                        </button>
                        <Collapse open={open}>
                          <ul className="overview-commit__files">
                            {!commit.changedFiles || commit.changedFiles.length === 0 ? (
                              <li className="overview-muted">
                                {t('projects:folderOverview.noFileListAvailable')}
                              </li>
                            ) : (
                              commit.changedFiles.map((file) => (
                                <li key={file}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void openFileDiff(commit.hash, file)}
                                  >
                                    {file}
                                  </Button>
                                </li>
                              ))
                            )}
                          </ul>
                        </Collapse>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </Card>
        ) : (
          <EmptyState
            headingLevel={3}
            icon={GitBranch}
            title={t('projects:folderOverview.noGitRepository')}
            description={t('projects:folderOverview.folderNotGitRepository')}
          />
        )}
      </Section>

      {diffTarget && (
        <GitDiffModal
          filePath={diffTarget.filePath}
          commitHash={diffTarget.commitHash}
          diff={diffContent}
          loading={diffLoading}
          error={diffError}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </>
  )
}
