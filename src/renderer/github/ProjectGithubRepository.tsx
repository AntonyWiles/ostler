import { useEffect, useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { Button, TextField } from '../ui'
import { t } from '@shared/i18n'
import { useSavedDraft } from '../hooks/useSavedDraft'

/**
 * Project settings › GitHub (R4.4): the project's repository, optional. When
 * the linked folder's origin remote is on GitHub, Ostler suggests it (read
 * from the folder's Git settings, read only) and the person confirms.
 */
export function ProjectGithubRepository({
  project,
  onSaved,
  setError
}: {
  project: RendererProject
  onSaved: (project: RendererProject) => void
  setError: (error: string | null) => void
}) {
  const saved = project.githubRepository ?? ''
  const [draft, setDraft] = useSavedDraft(saved)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const folder = projectFolder(project)

  useEffect(() => {
    if (!folder) return setSuggestion(null)
    let current = true
    void window.ostlerAPI.suggestGithubRepository(project.id).then((result) => {
      if (current) setSuggestion(result.ok ? result.value : null)
    })
    return () => {
      current = false
    }
  }, [project.id, folder])

  const save = async (value: string) => {
    if (value.trim() === saved) return setDraft(saved)
    const result = await window.ostlerAPI.updateProject(project.id, { githubRepository: value })
    if (!result.ok) return setError(result.error)
    setDraft(result.value.githubRepository ?? '')
    onSaved(result.value)
  }

  const offer = suggestion && suggestion.toLowerCase() !== saved.toLowerCase() ? suggestion : null
  return (
    <>
      <TextField
        label={t('projects:projectSettingsDialog.githubRepository')}
        placeholder={t('projects:projectSettingsDialog.githubRepositoryPlaceholder')}
        hint={t('projects:projectSettingsDialog.githubRepositoryHint')}
        value={draft}
        maxLength={300}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save(draft)
        }}
      />
      {offer && (
        <div className="ostler-project-settings-folder">
          <span className="ostler-project-settings-muted">
            {t('projects:projectSettingsDialog.githubSuggested', { repository: offer })}
          </span>
          <Button size="sm" onClick={() => void save(offer)}>
            {t('projects:projectSettingsDialog.githubUseSuggested')}
          </Button>
        </div>
      )}
    </>
  )
}
