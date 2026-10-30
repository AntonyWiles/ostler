import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { languageName, t } from '@shared/i18n'
import { demoProjectName } from '@shared/templates/template-text'
import { useOstler } from '../context/OstlerContext'
import { addDemoProjects, isDemoProject } from '../hooks/sample-project'
import { useLocale } from '../i18n/LocaleProvider'
import { parseAppPath, projectPath } from '../navigation/paths'
import { useToast } from '../ui'

/**
 * The demos are made in the language shown when they are made. When the
 * language changes and the demos are still as they were made (nothing added,
 * changed or renamed: `untouched`), this offers to make them again in the new
 * one. Edited demos are never offered: making them again would lose the work.
 * The main window only, so a pop-out does not offer it twice.
 */
export function DemoLanguageOffer() {
  const { language } = useLocale()
  const { projects, refreshProjects } = useOstler()
  const { toast } = useToast()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const shown = useRef(language)
  const latest = useRef({ projects, refreshProjects, toast, navigate, pathname })
  latest.current = { projects, refreshProjects, toast, navigate, pathname }

  useEffect(() => {
    if (shown.current === language) return
    shown.current = language
    const demos = latest.current.projects.filter((project) => isDemoProject(project))
    if (demos.length === 0) return
    if (demos.every((project) => project.name === demoProjectName(project.demo!, language))) return
    let cancelled = false
    void untouchedDemos().then((ok) => {
      if (!ok || cancelled || shown.current !== language) return
      latest.current.toast({
        title: t('projects:demoLanguage.title', { language: languageName(language) }),
        body: t('projects:demoLanguage.body'),
        action: { label: t('projects:demoLanguage.switch'), onClick: () => switchDemos() },
        secondaryAction: { label: t('projects:demoLanguage.keep'), onClick: () => {} }
      })
    })
    return () => {
      cancelled = true
    }
  }, [language])

  async function switchDemos(): Promise<void> {
    const { toast, refreshProjects, navigate, pathname, projects } = latest.current
    if (!(await untouchedDemos())) {
      toast({ title: t('projects:demoLanguage.changedSince'), tone: 'warning' })
      return
    }
    const here = parseAppPath(pathname)
    const openKind =
      here && 'projectId' in here
        ? projects.find((project) => project.id === here.projectId)?.demo
        : undefined
    const removed = await window.ostlerAPI.removeDemoProjects()
    const made = removed.ok ? await addDemoProjects([]) : null
    await refreshProjects()
    if (!made?.ok) {
      const error = made ? made.error : !removed.ok ? removed.error : undefined
      toast({ title: t('projects:demoLanguage.couldntSwitch'), body: error, tone: 'danger' })
      return
    }
    if (openKind) navigate(projectPath(made.value[openKind].id))
    toast({ title: t('projects:demoLanguage.switched'), tone: 'success' })
  }

  return null
}

/** Both demos there, not archived, and as they were made. */
async function untouchedDemos(): Promise<boolean> {
  const status = await window.ostlerAPI.getDemoProjects()
  return (
    status.ok &&
    status.value.untouched &&
    status.value.projects.length > 0 &&
    status.value.projects.every((project) => project.enabled)
  )
}
