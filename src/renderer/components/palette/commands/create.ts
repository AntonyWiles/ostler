import { keywordList, t } from '@shared/i18n'
import { Camera, Plus, Sparkles, Square, Target, Timer, Trash2 } from '../../../ui/icons'
import { closing, type Command, type PaletteContext } from './types'
import { shortcut } from '../../../navigation/shortcuts'

/** Quick add, snip, Ask Ostler, timer and focus, new and sample projects. */
export function buildCreateCommands(ctx: PaletteContext): Command[] {
  const { currentProject, askOstler, focus, timer, projects } = ctx
  const group = t('navigation:commandPalette.create')
  const list: Command[] = []
  list.push({
    id: 'quick-add',
    group,
    label: t('navigation:commandPalette.quickAddTask'),
    icon: Plus,
    keys: shortcut('quick-add').keys,
    keywords: keywordList('navigation:commandPalette.keywords.quickAdd'),
    run: closing(ctx, () => ctx.quickAdd.open({ projectId: currentProject?.id ?? null }))
  })
  // Snip to task (N4.2a): main hides this window first and waits for it to go.
  list.push({
    id: 'snip-to-task',
    group,
    label: t('navigation:commandPalette.snipToTask'),
    icon: Camera,
    keywords: keywordList('navigation:commandPalette.keywords.snip'),
    run: closing(ctx, () =>
      window.ostlerAPI.startSnip().then((result) => {
        if (!result.ok)
          ctx.toast({
            title: t('tasks:quickAddForm.couldntSnip', { error: result.error }),
            tone: 'danger'
          })
      })
    )
  })
  if (askOstler.available) {
    list.push({
      id: 'ask-ostler',
      group,
      label: t('ai:askOstler.paletteAsk'),
      icon: Sparkles,
      keywords: keywordList('ai:askOstler.keywords'),
      run: closing(ctx, () => askOstler.open())
    })
  }
  list.push({
    id: 'timer:start',
    group,
    label: t('tasks:time.startTimerOn'),
    icon: Timer,
    keywords: keywordList('tasks:time.keywords'),
    run: () => ctx.pick('timer')
  })
  // "Focus on…" (N3.5): the same task picker, then the length.
  list.push({
    id: 'focus:start',
    group,
    label: t('tasks:focus.focusOn'),
    icon: Target,
    keywords: keywordList('tasks:focus.keywords'),
    run: () => ctx.pick('focus')
  })
  if (focus.focus && focus.focus.phase !== 'ended') {
    list.push({
      id: 'focus:stop',
      group,
      label: focus.focus.phase === 'break' ? t('tasks:focus.endBreak') : t('tasks:focus.stopFocus'),
      icon: Square,
      keywords: keywordList('tasks:focus.keywords'),
      run: closing(ctx, () => focus.stop())
    })
  }
  if (timer.running) {
    list.push({
      id: 'timer:stop',
      group,
      label: t('tasks:time.stopTimerOn', { task: timer.running.workItemTitle }),
      icon: Square,
      keywords: keywordList('tasks:time.keywords'),
      run: closing(ctx, () => timer.stop())
    })
  }
  list.push({
    id: 'new-project',
    group,
    label: t('navigation:commandPalette.newProject'),
    icon: Plus,
    keywords: keywordList('navigation:commandPalette.keywords.create'),
    run: closing(ctx, ctx.onNewProject)
  })
  list.push({
    id: 'open-sample-project',
    group,
    label: t('navigation:commandPalette.openSampleProject'),
    icon: Sparkles,
    keywords: keywordList('navigation:commandPalette.keywords.sampleProject'),
    run: closing(ctx, () => ctx.openDemoProject())
  })
  list.push({
    id: 'open-advanced-demo',
    group,
    label: t('navigation:commandPalette.openAdvancedDemo'),
    icon: Sparkles,
    keywords: keywordList('navigation:commandPalette.keywords.sampleProject'),
    run: closing(ctx, () => ctx.openDemoProject('advanced'))
  })
  if (projects.some((project) => project.demo))
    list.push({
      id: 'remove-demo-projects',
      group,
      label: t('projects:demoRemoval.menu'),
      icon: Trash2,
      keywords: keywordList('navigation:commandPalette.keywords.sampleProject'),
      run: closing(ctx, () => ctx.removeDemoProjects())
    })
  return list
}
