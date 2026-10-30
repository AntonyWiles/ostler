import { useState } from 'react'
import { useOstler } from '../../context/OstlerContext'
import { useRemoveDemoProjects } from '../../components/project-care/useRemoveDemoProjects'
import { isDemoProject } from '../../hooks/sample-project'
import { Button, Card, IconButton } from '../../ui'
import { X } from '../../ui/icons'
import { t } from '@shared/i18n'

/** Set when the person chose to keep the demos: Home stops offering. */
export const DEMO_OFFER_DISMISSED_KEY = 'ostler.home.demoOfferDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DEMO_OFFER_DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Home's offer to remove the demo projects, once the person has a project of
 * their own beside them. One click and one confirmation remove both; the
 * close button keeps them and stops the offer.
 */
export function DemoProjectsOffer() {
  const { projects } = useOstler()
  const removeDemos = useRemoveDemoProjects()
  const [dismissed, setDismissed] = useState(readDismissed)
  const hasDemo = projects.some((project) => isDemoProject(project))
  const hasOwn = projects.some((project) => project.enabled && !project.demo)
  if (dismissed || !hasDemo || !hasOwn) return null

  const keep = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DEMO_OFFER_DISMISSED_KEY, 'true')
    } catch {
      // Storage unavailable: the offer is gone until Home opens again.
    }
  }

  return (
    <Card as="section" className="ostler-demo-offer" aria-labelledby="ostler-demo-offer-title">
      <div className="ostler-demo-offer__text">
        <h2 id="ostler-demo-offer-title">{t('views:demoOffer.title')}</h2>
        <p>{t('views:demoOffer.text')}</p>
      </div>
      <Button size="sm" onClick={() => void removeDemos()}>
        {t('projects:demoRemoval.button')}
      </Button>
      <IconButton label={t('views:demoOffer.keep')} icon={X} size="sm" onClick={keep} />
    </Card>
  )
}
