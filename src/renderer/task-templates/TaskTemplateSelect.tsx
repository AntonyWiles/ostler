import type { TaskTemplate } from '@shared/ostler-api'
import { Select } from '../ui'
import { t } from '@shared/i18n'

/**
 * The "From template" picker (N2.1) for New task and quick add: the
 * templates this project can use, by name, with "every project" ones marked.
 * Shows nothing while the project has none.
 */
export function TaskTemplateSelect({
  templates,
  value,
  onChange,
  hideLabel,
  className,
  size
}: {
  templates: TaskTemplate[]
  value: string
  onChange: (templateId: string) => void
  hideLabel?: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  if (templates.length === 0) return null
  return (
    <Select
      label={t('tasks:taskTemplates.fromTemplate')}
      hideLabel={hideLabel}
      className={className}
      size={size}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: '', label: t('tasks:taskTemplates.noTemplate') },
        ...templates.map((template) => ({
          value: template.id,
          label:
            template.projectId === null
              ? t('tasks:taskTemplates.everyProjectOption', { name: template.name })
              : template.name
        }))
      ]}
    />
  )
}
