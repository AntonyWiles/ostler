import { useState } from 'react'
import type { ProjectLesson, RendererProject } from '@shared/ostler-api'
import {
  editLesson,
  MAX_LESSON_LENGTH,
  moveLessonIntoConventions,
  projectLessons,
  removeLesson
} from '@shared/project-lessons'
import { Button, Section, Switch, TextArea, useToast } from '../ui'
import { t } from '@shared/i18n'
import { formatDate, formatNumber } from '@shared/format'
import './ProjectLessonsGroup.css'

/** "From sending back 'Fix the login', 3 October", or "Added 3 October". */
export function lessonSourceText(lesson: ProjectLesson): string {
  const date = formatDate(lesson.addedAt, { day: 'numeric', month: 'long' })
  return lesson.source?.taskTitle
    ? t('agents:lessons.sourceSendBack', { title: lesson.source.taskTitle, date })
    : t('agents:lessons.sourceAdded', { date })
}

/**
 * Project settings › Agents › Lessons (N9.6a): the lessons saved from
 * sending work back, each with a switch, edit, Move into conventions and
 * delete with undo. Every change is one `updateProject`, checked in main.
 */
export function ProjectLessonsGroup({
  project,
  onSaved,
  setError
}: {
  project: RendererProject
  onSaved: (project: RendererProject) => void
  setError: (error: string | null) => void
}) {
  const { toastUndo } = useToast()
  const lessons = projectLessons(project)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const save = async (updates: Pick<RendererProject, 'agentLessons' | 'agentConventions'>) => {
    const result = await window.ostlerAPI.updateProject(project.id, updates)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    onSaved(result.value)
    return true
  }

  const change = (build: () => Pick<RendererProject, 'agentLessons' | 'agentConventions'>) => {
    try {
      return save(build())
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return Promise.resolve(false)
    }
  }

  const remove = async (lesson: ProjectLesson) => {
    const before = lessons
    if (await change(() => ({ agentLessons: removeLesson(before, lesson.id) }))) {
      toastUndo(t('agents:lessons.deleted'), () => save({ agentLessons: before }))
    }
  }

  const move = async (lesson: ProjectLesson) => {
    const before = { agentLessons: lessons, agentConventions: project.agentConventions ?? '' }
    if (await change(() => moveLessonIntoConventions(project, lesson.id))) {
      toastUndo(t('agents:lessons.moved'), () => save(before))
    }
  }

  const tooLong = (editing?.text.trim().length ?? 0) > MAX_LESSON_LENGTH

  return (
    <Section
      title={t('agents:lessons.groupTitle')}
      description={t('agents:lessons.groupDescription')}
      headingLevel={3}
    >
      {lessons.length === 0 ? (
        <p className="project-lessons__none">{t('agents:lessons.none')}</p>
      ) : (
        <ul className="project-lessons">
          {lessons.map((lesson) => (
            <li key={lesson.id} className="project-lessons__item">
              {editing?.id === lesson.id ? (
                <>
                  <TextArea
                    label={t('agents:lessons.editLabel')}
                    rows={3}
                    autoFocus
                    value={editing.text}
                    error={
                      tooLong
                        ? t('agents:lessons.tooLong', { max: formatNumber(MAX_LESSON_LENGTH) })
                        : undefined
                    }
                    onChange={(event) => setEditing({ id: lesson.id, text: event.target.value })}
                  />
                  <div className="project-lessons__actions">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t('agents:lessons.cancelEdit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={tooLong || !editing.text.trim()}
                      onClick={async () => {
                        const text = editing.text
                        if (
                          await change(() => ({
                            agentLessons: editLesson(lessons, lesson.id, { text })
                          }))
                        ) {
                          setEditing(null)
                        }
                      }}
                    >
                      {t('agents:lessons.saveEdit')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="project-lessons__text">{lesson.text}</p>
                  <p className="project-lessons__source">{lessonSourceText(lesson)}</p>
                  <div className="project-lessons__actions">
                    <Switch
                      label={t('agents:lessons.on')}
                      aria-label={`${t('agents:lessons.on')}: ${lesson.text}`}
                      checked={lesson.enabled}
                      onChange={(event) => {
                        const enabled = event.target.checked
                        void change(() => ({
                          agentLessons: editLesson(lessons, lesson.id, { enabled })
                        }))
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${t('agents:lessons.edit')}: ${lesson.text}`}
                      onClick={() => setEditing({ id: lesson.id, text: lesson.text })}
                    >
                      {t('agents:lessons.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${t('agents:lessons.moveIntoConventions')}: ${lesson.text}`}
                      onClick={() => void move(lesson)}
                    >
                      {t('agents:lessons.moveIntoConventions')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${t('agents:lessons.delete')}: ${lesson.text}`}
                      onClick={() => void remove(lesson)}
                    >
                      {t('agents:lessons.delete')}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
