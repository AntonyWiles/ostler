import type { ProjectTemplateSummary } from '@shared/ostler-api'
import { Icon, Radio, RadioGroup } from '../ui'
import { TEMPLATE_ICON_GLYPHS } from './template-icons'
import './TemplatePicker.css'
import { t } from '@shared/i18n'

/** What a template holds, in words: "3 milestones, 12 tasks". */
export function templateContents(template: ProjectTemplateSummary): string {
  return template.taskCount === 0 && template.milestoneCount === 0
    ? t('projects:templatePicker.empty')
    : t('projects:templatePicker.summary', {
        milestones: t('common:count.milestone', { count: template.milestoneCount }),
        tasks: t('common:count.task', { count: template.taskCount })
      })
}

/**
 * The new-project wizard's template choice (P5.8): each template with its
 * description, and the chosen one's contents, its first few tasks listed.
 */
export function TemplatePicker({
  templates,
  value,
  onChange
}: {
  templates: ProjectTemplateSummary[]
  value: string | null
  onChange: (templateId: string) => void
}) {
  const selected = templates.find((template) => template.id === value) ?? null
  return (
    <div className="ostler-template-picker">
      <RadioGroup
        legend={t('projects:templatePicker.chooseTemplate')}
        className="ostler-template-picker__list"
      >
        {templates.map((template, index) => (
          <Radio
            key={template.id}
            name="new-project-template"
            label={
              <span className="ostler-template-picker__name">
                <Icon icon={TEMPLATE_ICON_GLYPHS[template.icon]} />
                {template.name}
              </span>
            }
            hint={template.description}
            checked={template.id === value}
            onChange={() => onChange(template.id)}
            data-autofocus={index === 0 ? true : undefined}
          />
        ))}
      </RadioGroup>
      {selected && (
        <section
          className="ostler-template-picker__preview"
          aria-label={t('projects:templatePicker.contents', { selectedName: selected.name })}
        >
          <h3 className="ostler-template-picker__title">{selected.name}</h3>
          <p className="ostler-template-picker__counts">{templateContents(selected)}</p>
          {selected.firstTasks.length > 0 && (
            <>
              <p className="ostler-template-picker__label">
                {t('projects:templatePicker.firstTasks')}
              </p>
              <ul className="ostler-template-picker__tasks">
                {selected.firstTasks.map((title, index) => (
                  <li key={`${index}:${title}`}>{title}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}
