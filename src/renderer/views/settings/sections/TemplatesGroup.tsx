import { useCallback, useEffect, useState } from 'react'
import type { ProjectTemplateSummary } from '@shared/ostler-api'
import { templateContents } from '../../../components/TemplatePicker'
import { TEMPLATE_ICON_GLYPHS } from '../../../components/template-icons'
import { Button, Dialog, EmptyState, Icon, TextField, useToast } from '../../../ui'
import { LayoutTemplate } from '../../../ui/icons'
import { SettingsGroup } from '../settings-form'
import { t } from '@shared/i18n'

/**
 * Settings › Projects › Templates (P5.8): the templates saved from projects,
 * with rename, delete (at once, with undo) and "Export file…", and "Import
 * template…" to add one from a file (P6.1).
 */
export function TemplatesGroup() {
  const { toast, toastUndo } = useToast()
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([])
  const [renaming, setRenaming] = useState<ProjectTemplateSummary | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.listProjectTemplates()
    if (result.ok) setTemplates(result.value.filter((template) => template.source === 'saved'))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (template: ProjectTemplateSummary) => {
    const result = await window.ostlerAPI.deleteProjectTemplate(template.id)
    if (!result.ok) {
      toast({
        title: t('settings:templatesGroup.couldntDelete', { templateName: template.name }),
        body: result.error,
        tone: 'danger'
      })
      return
    }
    await load()
    toastUndo(
      t('settings:templatesGroup.deletedTemplate', { templateName: template.name }),
      async () => {
        await window.ostlerAPI.restoreProjectTemplate(template.id, result.value)
        await load()
      }
    )
  }

  const importFile = async () => {
    const result = await window.ostlerAPI.importTemplateFile()
    if (!result.ok) {
      toast({
        title: t('settings:templatesGroup.couldntImportTemplate'),
        body: result.error,
        tone: 'danger'
      })
    } else if (result.value) {
      await load()
      toast({
        title: t('settings:templatesGroup.importedTemplate', { valueName: result.value.name }),
        tone: 'success'
      })
    }
  }

  const exportFile = async (template: ProjectTemplateSummary) => {
    const result = await window.ostlerAPI.exportProjectTemplateFile(template.id)
    if (!result.ok) {
      toast({
        title: t('settings:templatesGroup.couldntExport', { templateName: template.name }),
        body: result.error,
        tone: 'danger'
      })
    } else if (result.value) {
      toast({
        title: t('settings:templatesGroup.exported', { templateName: template.name }),
        body: result.value,
        tone: 'success'
      })
    }
  }

  return (
    <SettingsGroup
      id="project-templates"
      description={t('settings:templatesGroup.templatesSavedProjectSave')}
      actions={
        <Button onClick={() => void importFile()}>
          {t('settings:templatesGroup.importTemplate')}
        </Button>
      }
    >
      {templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title={t('settings:templatesGroup.noSavedTemplates')}
          description={t('settings:templatesGroup.openProjectsMoreMenu')}
        />
      ) : (
        <ul
          className="ostler-settings-project-list"
          aria-label={t('settings:templatesGroup.templates')}
        >
          {templates.map((template) => (
            <li key={template.id} className="ostler-settings-project">
              <Icon icon={TEMPLATE_ICON_GLYPHS[template.icon]} />
              <div className="ostler-settings-project-text">
                <span className="ostler-settings-project-name">{template.name}</span>
                <span className="ostler-settings-project-folder">
                  {templateContents(template)}
                  {template.description ? ` · ${template.description}` : ''}
                </span>
              </div>
              <div className="ostler-settings-project-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRenaming(template)}
                  aria-label={t('settings:templatesGroup.rename2', { templateName: template.name })}
                >
                  {t('settings:templatesGroup.rename')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void exportFile(template)}
                  aria-label={t('settings:templatesGroup.exportFile2', {
                    templateName: template.name
                  })}
                >
                  {t('settings:templatesGroup.exportFile')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void remove(template)}
                  aria-label={t('settings:templatesGroup.delete2', { templateName: template.name })}
                >
                  {t('settings:templatesGroup.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {renaming && (
        <RenameTemplateDialog
          template={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => void load()}
        />
      )}
    </SettingsGroup>
  )
}

function RenameTemplateDialog({
  template,
  onClose,
  onSaved
}: {
  template: ProjectTemplateSummary
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(template.name)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const result = await window.ostlerAPI.renameProjectTemplate(template.id, name)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('settings:templatesGroup.rename2', { templateName: template.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('settings:templatesGroup.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('settings:templatesGroup.renameTemplate')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextField
          label={t('settings:templatesGroup.templateName')}
          value={name}
          maxLength={80}
          error={error ?? undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
      </form>
    </Dialog>
  )
}
