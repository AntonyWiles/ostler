import { useState, type ReactNode } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { Button, Card } from '../../ui'
import { useRemoveDemoProjects } from './useRemoveDemoProjects'
import { t } from '@shared/i18n'

/**
 * Project settings › Remove for a demo project: one button removes both
 * demos, since they come back from Ctrl+K. The backups, the list of what is
 * deleted and the four ways to remove a project (`children`) stay one
 * click away, for a demo the person has made their own.
 */
export function DemoRemovePanel({
  project,
  onRemoved,
  children
}: {
  project: RendererProject
  /** Both demos are gone: the dialog closes. */
  onRemoved: () => void
  children: ReactNode
}) {
  const removeDemos = useRemoveDemoProjects()
  const [otherWays, setOtherWays] = useState(false)

  if (otherWays) return <>{children}</>

  return (
    <div className="project-care-demo">
      <Card as="section" className="project-care-choice project-care-choice--danger">
        <h3 className="project-care-choice__title">{t('projects:demoRemoval.heading')}</h3>
        <p className="project-care-choice__text">
          {t('projects:demoRemoval.text', { projectName: project.name })}
        </p>
        <div className="project-care-choice__actions">
          <Button
            variant="danger"
            onClick={() => void removeDemos().then((removed) => removed && onRemoved())}
          >
            {t('projects:demoRemoval.button')}
          </Button>
        </div>
      </Card>
      <p className="project-care-demo__other">
        {t('projects:demoRemoval.otherWaysText')}{' '}
        <Button size="sm" variant="ghost" onClick={() => setOtherWays(true)}>
          {t('projects:demoRemoval.otherWays')}
        </Button>
      </p>
    </div>
  )
}
