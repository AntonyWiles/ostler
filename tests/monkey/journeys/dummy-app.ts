import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type { OstlerAPI } from '../../../src/shared/ostler-api'
import { AI_PRESETS } from '../../../src/shared/ai-presets'
import { queueOpenFile, readConfig, exportsDir } from '../lib/app'
import type { FakeAi } from '../lib/fake-ai'
import { FAKE_AI_MODEL } from '../lib/fake-ai'
import type { MonkeyOptions } from '../lib/options'
import { SimAgent, type SimSession } from '../lib/sim-agent'
import type { Session, Ui } from '../lib/session'
import {
  GOAL,
  MILESTONES,
  PROJECT_FOLDER,
  PROJECT_NAME,
  readBrief,
  simulatedFiles,
  TASKS
} from '../dummy-app/plan'
import { runPhases, type Phase, type PhaseContext } from './phases'
import {
  attempt,
  conventionsText,
  day,
  friction,
  harness,
  openProject,
  openSettings,
  openTab,
  openTask,
  projects,
  SAMPLE_PROJECT,
  verify,
  waitUntil,
  workItems
} from './steps'
import { COVERAGE_PHASES } from './coverage'

/**
 * The dummy project, Pomodoro Desk, carried from a new install to finished
 * milestones, the way a person would do it: through the window, with the
 * keyboard and mouse, reading what is on screen. The app's own API is only
 * read, to check that what the screen says is true.
 *
 * Each phase is one sitting. A step that fails inside a phase is recorded
 * (with its screenshot) and the phase carries on where it can, so one broken
 * button does not hide everything after it.
 */

// ---------------------------------------------------------------------------
// The phases
// ---------------------------------------------------------------------------

const welcome: Phase = {
  name: 'welcome',
  title: 'First run: the welcome and the sample project',
  skip: ({ session }) => (session.options.fresh ? null : 'not a new install'),
  run: async (context) => {
    const { session, state } = context
    const { ui, hand } = session
    await hand.expect(ui.heading('Welcome to Ostler'), 20_000)
    await hand.fill(ui.textbox('What should we call you?'), 'Robin Monkey')
    await attempt(context, 'Choose the Light theme in the welcome', async () => {
      await hand.click(ui.radio(/^Light/))
      const theme = await session.page.locator('html').getAttribute('data-theme')
      verify(
        context,
        theme === 'light',
        'Choosing Light in the welcome applies it at once',
        `data-theme is ${theme}`,
        'S3'
      )
    })
    await hand.click(ui.button('Continue'))
    await hand.expect(ui.heading('How do you want to start?'))
    await hand.click(ui.button('Start with the demo projects'))
    await hand.expect(ui.tab('Overview'), 15_000)
    const sample = (await projects(session)).find((project) => project.name === SAMPLE_PROJECT)
    verify(
      context,
      !!sample,
      'The welcome creates the sample project',
      'No project named "Welcome to Ostler (Demo Project)" after the welcome.'
    )
    state.sampleProjectId = sample?.id
  }
}

const tour: Phase = {
  name: 'tour',
  title: 'Finding my way around: Home, Inbox, Help, search and shortcuts',
  run: async (context) => {
    const { session } = context
    const { ui, hand } = session
    await hand.click(ui.link('Home'))
    await hand.expect(ui.heading(/^Good (morning|afternoon|evening)/), 8000)
    const checklist = await hand.sees(ui.heading('Getting started'), 3000)
    session.recorder.journal(`- Home shows the getting-started checklist: ${checklist}`)

    await attempt(context, 'Command palette finds a view', async () => {
      await hand.press('Control+K')
      await hand.type('board')
      await hand.wait('reading the palette results', 600)
      await hand.press('Escape')
    })
    await attempt(context, 'The ? key shows the keyboard shortcuts', async () => {
      await hand.click(ui.heading(/^Good (morning|afternoon|evening)/))
      await hand.press('?')
      await hand.expect(ui.dialog('Keyboard shortcuts').heading('Keyboard shortcuts'), 4000)
      await hand.press('Escape')
    })
    await attempt(context, 'Help opens the user guide', async () => {
      await hand.click(ui.button('Help'))
      await hand.click(ui.menuitem('User guide'))
      await hand.expect(ui.heading('Getting started', true), 8000)
    })
    await attempt(context, 'Inbox opens', async () => {
      await hand.click(ui.link(/^Inbox/, false))
      await hand.expect(ui.heading('Inbox'), 8000)
    })
    if (context.state.sampleProjectId) {
      await attempt(context, 'The sample project teaches by doing', async () => {
        await openProject(session, SAMPLE_PROJECT)
        await openTab(session, 'Board')
        await hand.click(ui.button(`More actions for Drag me to In progress`))
        await hand.click(ui.menuitem('In progress'))
        await openTask(session, "Open me to see a task's details")
        await hand.press('Escape')
        await openTab(session, 'List')
        await openTab(session, 'Calendar')
        await openTab(session, 'Timeline')
      })
    }
    await attempt(context, 'Settings › Data shows where backups are', async () => {
      await openSettings(session, 'Data')
    })
  }
}

const aiSetup: Phase = {
  name: 'ai-setup',
  title: 'Setting up Ostler AI',
  skip: ({ session }) =>
    session.options.ai === 'off'
      ? 'AI is off for this run'
      : session.options.ai === 'live' &&
          !session.options.aiKey &&
          session.options.aiPreset !== 'ollama'
        ? 'live AI needs MONKEY_AI_KEY'
        : null,
  run: async (context) => {
    const { session, fakeAi } = context
    const { ui, hand, options } = session
    await openSettings(session, 'AI')
    await hand.click(ui.button(/^(Set up AI|Change)/, false))
    const dialog = ui.dialog(/^Set up Ostler AI/)
    await hand.expect(dialog.heading(/^Set up Ostler AI/, false), 8000)
    if (options.ai === 'fake' && fakeAi) {
      await hand.click(dialog.radio(/Other OpenAI-compatible server/, false))
      await hand.click(dialog.button('Next'))
      await hand.fill(dialog.label('Address'), fakeAi.url)
      await hand.click(dialog.button('Next'))
      const model = dialog.combobox('Model')
      await hand.expect(model, 15_000)
      await hand.fill(model, FAKE_AI_MODEL)
      await hand.press('Enter')
    } else {
      const preset = AI_PRESETS.find((entry) => entry.id === options.aiPreset)
      if (!preset) throw new Error(`No AI preset ${options.aiPreset}`)
      await hand.click(dialog.radio(new RegExp(`^${preset.label}`)))
      await hand.click(dialog.button('Next'))
      if (preset.needsKey)
        await hand.fill(dialog.label(/^API key/, false), options.aiKey, { secret: true })
      await hand.click(dialog.button('Next'))
      const model = dialog.combobox('Model')
      await hand.expect(model, 30_000)
      if (options.aiModel) {
        await hand.fill(model, options.aiModel)
        await hand.press('Enter')
      }
    }
    await hand.click(dialog.button('Next'))
    const works = await hand.sees(dialog.text(/It works/), 60_000)
    verify(
      context,
      works,
      'The AI setup test reaches the model',
      'The Test step did not say "It works" within a minute.'
    )
    await hand.click(dialog.button('Done'))
    await hand.expectGone(dialog.heading(/^Set up Ostler AI/, false), 10_000)
    const configured = await session.api(
      'read AI config',
      async () => {
        const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
        const result = await api.getConfig()
        return result.ok
          ? { model: result.value.ai.model, hasKey: result.value.ai.hasApiKey }
          : null
      },
      null
    )
    session.recorder.journal(
      `- AI configured: model ${configured?.model}, key saved: ${configured?.hasKey}`
    )
  }
}

const agentsSetup: Phase = {
  name: 'agents-setup',
  title: 'Turning on AI agents',
  skip: ({ session }) => (session.options.agents === 'off' ? 'agents are off for this run' : null),
  run: async (context) => {
    const { session } = context
    const { ui, hand } = session
    await openSettings(session, 'Agents')
    const already = await hand.sees(ui.heading('Built-in agent'), 2000)
    if (already) {
      session.recorder.journal('- Agents were already on.')
      return
    }
    await hand.click(ui.switch('Use AI agents for software projects'))
    const dialog = ui.dialog('Turn on AI agents')
    await hand.expect(dialog.heading('Turn on AI agents'), 8000)
    await hand.click(dialog.button('Next'))
    await hand.expect(dialog.text('Git is installed'), 30_000)
    await hand.click(dialog.button('Next'))
    await hand.click(dialog.button('Next'))
    await hand.click(dialog.button('Turn on agents'))
    await hand.expect(ui.heading('Built-in agent'), 15_000)
    const harnessOn = (readConfig(session.options).harness as { enabled?: boolean } | undefined)
      ?.enabled
    verify(
      context,
      harnessOn === true,
      'Turning agents on is saved',
      `config harness.enabled is ${harnessOn}`
    )
  }
}

const createProject: Phase = {
  name: 'create-project',
  title: 'Creating the Pomodoro Desk project in a new folder',
  run: async (context) => {
    const { session, state } = context
    const { ui, hand, options } = session
    const existing = (await projects(session)).find((project) => project.name === PROJECT_NAME)
    if (existing) {
      state.projectId = existing.id
      state.projectPath = existing.path ?? undefined
      session.recorder.journal('- Pomodoro Desk already exists; using it.')
      return
    }
    await hand.click(ui.region('Projects').button('New project'))
    const wizard = ui.dialog('New project')
    await hand.expect(wizard.heading('New project'), 8000)
    await hand.click(wizard.radio('Blank'))
    await hand.click(wizard.button('Next'))
    await hand.click(wizard.radio('A new folder'))
    await hand.fill(wizard.label('Create it in'), options.projectsDir)
    await hand.fill(wizard.label('Folder name'), PROJECT_FOLDER)
    await hand.click(wizard.button('Next'))
    await hand.fill(wizard.label('Project name'), PROJECT_NAME)
    await attempt(context, 'Pick a project colour', () => hand.click(wizard.radio('Amber')))
    await hand.fill(
      wizard.label('Description'),
      'A tiny Windows focus timer. A test vehicle for Ostler: good enough to run is the bar.'
    )
    await hand.fill(wizard.label('Tags'), 'windows, dotnet, dummy')
    await hand.click(wizard.button('Next'))
    // Folder setup: Git, an initial commit, a README, and a .gitignore.
    const gitignore = wizard.combobox('.gitignore')
    const offered = await gitignore.locator
      .evaluate((element) =>
        Array.from((element as HTMLSelectElement).options).map((option) => option.text)
      )
      .catch(() => [] as string[])
    session.recorder.journal(`- .gitignore choices: ${offered.join(', ')}`)
    const dotnet = offered.find((text) => /\.NET|Visual Studio|C#/i.test(text))
    if (dotnet) {
      // A Windows app: keep bin/, obj/ and .vs/ out of Git from the first commit.
      await hand.select(gitignore, { label: dotnet })
    } else {
      friction(
        context,
        'feature',
        'S3',
        'New folder offers no .gitignore for .NET or Visual Studio projects',
        `The choices are ${offered.join(', ')}. A Windows app (C#/.NET) needs bin/, obj/ and .vs/ ignored, or agents' rescue commits and "git add -A" pick up build output.`
      )
    }
    await hand.click(wizard.button('Next'))
    await hand.expect(wizard.text('Ostler will create this folder and add the project:'), 8000)
    await hand.click(wizard.button('Create project'))
    const done = ui.dialog(PROJECT_NAME)
    await hand.expect(done.button('Open project'), 15_000)
    await hand.click(done.button('Open project'))
    await hand.expect(ui.heading(PROJECT_NAME), 10_000)
    const created = (await projects(session)).find((project) => project.name === PROJECT_NAME)
    verify(
      context,
      !!created,
      'The new project is listed',
      'No Pomodoro Desk project after the wizard.'
    )
    state.projectId = created?.id
    state.projectPath = created?.path ?? undefined
    if (state.projectPath) {
      const folder = state.projectPath
      verify(
        context,
        fs.existsSync(path.join(folder, '.git')),
        'The new folder is a Git repository',
        folder
      )
      verify(
        context,
        fs.existsSync(path.join(folder, 'README.md')),
        'The new folder has a README',
        folder,
        'S3'
      )
    }
  }
}

const brief: Phase = {
  name: 'brief',
  title: 'Writing the design brief in the Library',
  needs: ['create-project'],
  run: async (context) => {
    const { session } = context
    const { ui, hand } = session
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Library')
    await hand.click(ui.region('Library items').button('Add'))
    await hand.click(ui.menuitem('New design brief'))
    const editor = ui.dialog('New design brief')
    await hand.fill(editor.label('Title'), 'Pomodoro Desk — design brief')
    await hand.fill(editor.label('Text, in Markdown'), readBrief())
    await hand.click(editor.button('Save'))
    await hand.wait('the brief saves', 800)
    await hand.press('Escape')
    await openTab(session, 'Overview')
    const shown = await hand.sees(ui.region('Project brief').text(/Pomodoro Desk/), 5000)
    verify(
      context,
      shown,
      'The Overview shows the new design brief',
      "After saving a design brief, the Overview's Project brief section does not show it.",
      'S3'
    )
  }
}

const plan: Phase = {
  name: 'plan',
  title: 'Planning by hand: the goal, five milestones, twelve tasks and their dependencies',
  needs: ['create-project'],
  run: async (context) => {
    const { session, state } = context
    const { ui, hand } = session
    const projectId = state.projectId!
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Milestones')

    await hand.click(ui.region('Goals and milestones').button('Goal'))
    const goalDialog = ui.dialog('New goal')
    await hand.fill(goalDialog.label('Goal title'), GOAL.title)
    await hand.fill(goalDialog.label('Outcome'), GOAL.outcome)
    await hand.click(goalDialog.button('Create goal'))
    await hand.expectGone(goalDialog.heading('New goal'))

    for (const milestone of MILESTONES) {
      await attempt(context, `Create milestone ${milestone.name}`, async () => {
        await hand.click(ui.region('Goals and milestones').button('Milestone'))
        const dialog = ui.dialog('New milestone')
        await hand.fill(dialog.label('Milestone name'), milestone.name)
        await hand.fill(dialog.label('Outcome'), milestone.outcome)
        await hand.select(dialog.combobox('Goal'), { label: GOAL.title })
        await hand.fill(dialog.label('Due date'), day(milestone.dueInDays))
        await hand.click(dialog.button('Create milestone'))
        await hand.expectGone(dialog.heading('New milestone'))
      })
    }

    for (const task of TASKS) {
      await attempt(context, `Create task ${task.key}`, async () => {
        await hand.click(ui.button('New task'))
        const dialog = ui.dialog('New task')
        await hand.fill(dialog.label('Title'), task.title)
        await hand.fill(dialog.label('Description'), task.description)
        await hand.select(
          dialog.combobox('Status'),
          task.forAgent && task.dependsOn.length === 0
            ? 'ready'
            : task.forAgent
              ? 'ready'
              : 'backlog'
        )
        await hand.select(dialog.combobox('Priority'), task.priority)
        const milestone = MILESTONES.find((entry) => entry.key === task.milestone)
        if (milestone) await hand.select(dialog.combobox('Milestone'), { label: milestone.name })
        await hand.fill(dialog.label('Labels'), task.labels.join(', '))
        await hand.fill(dialog.label('Checklist'), task.checklist.join('\n'))
        await hand.click(dialog.button('Create task'))
        await hand.expectGone(dialog.heading('New task'))
      })
    }

    const items = await workItems(session, projectId)
    for (const task of TASKS) {
      const item = items.find((entry) => entry.title === task.title)
      if (item) state.tasks[task.key] = item.id
    }
    verify(
      context,
      TASKS.every((task) => state.tasks[task.key]),
      'Every planned task was created',
      `Created ${Object.keys(state.tasks).length} of ${TASKS.length}.`
    )

    await openTab(session, 'Board')
    for (const task of TASKS.filter((entry) => entry.dependsOn.length > 0)) {
      await attempt(context, `Add dependencies to ${task.key}`, async () => {
        await openTask(session, task.title)
        const drawer = ui.dialog(task.title)
        for (const key of task.dependsOn) {
          const dependency = TASKS.find((entry) => entry.key === key)!
          const field = drawer.combobox('Add a task it waits on')
          await hand.fill(field, dependency.title.slice(0, 24))
          await hand.wait('the suggestions open', 300)
          await hand.press('Enter')
        }
        // The drawer saves as you go (R1.5): closing it is all that is left.
        await hand.click(drawer.button('Close', true))
        await hand.expectGone(drawer.heading(task.title), 8000)
      })
    }
    const after = await workItems(session, projectId)
    const chained = TASKS.filter((task) => task.dependsOn.length > 0).every((task) => {
      const item = after.find((entry) => entry.title === task.title)
      return item && task.dependsOn.every((key) => item.dependencyIds.includes(state.tasks[key]))
    })
    verify(
      context,
      chained,
      'Every dependency typed into a drawer was saved',
      JSON.stringify(after.map((i) => [i.title, i.dependencyIds.length]))
    )
    const waiting = await hand.sees(ui.text(/^Waiting on \d/), 5000)
    verify(
      context,
      waiting,
      'Cards say what they are waiting on',
      'No card on the Board says "Waiting on …" although several tasks have open dependencies.',
      'S3'
    )
  }
}

const aiPlan: Phase = {
  name: 'ai-plan',
  title: 'Planning with Ostler AI: break down, suggest, chat, summarise, draft a decision',
  needs: ['create-project'],
  skip: ({ session }) => (session.options.ai === 'off' ? 'AI is off for this run' : null),
  run: async (context) => {
    const { session, state } = context
    const { ui, hand } = session
    const projectId = state.projectId!
    const before = (await workItems(session, projectId)).length
    await openProject(session, PROJECT_NAME)

    await attempt(context, 'Break the goal down with AI', async () => {
      await openTab(session, 'Milestones')
      await hand.click(ui.button('Break down with AI…'), { slowOk: true })
      const review = ui.dialog(/^Break down/)
      await hand.expect(review.checkbox('Include Suggestion 1'), 90_000)
      // Keep the first two; the rest repeat tasks the plan already has.
      for (const index of [3, 4, 5, 6, 7, 8]) {
        const box = review.checkbox(`Include Suggestion ${index}`)
        if (await hand.sees(box, 500)) await hand.click(box)
      }
      await hand.click(review.button(/^Add \d+ tasks?$/, false), { slowOk: true })
      await hand.expectGone(review.heading(/^Break down/, false), 15_000)
    })

    await attempt(context, 'Suggest tasks with AI from the Board', async () => {
      await openTab(session, 'Board')
      await hand.click(ui.region('Board').button('Suggest tasks…'), { slowOk: true })
      const review = ui.dialog('Review the suggested tasks')
      await hand.expect(review.heading('Review the suggested tasks'), 90_000)
      // One review for every AI draft (R1.3): untick what not to add.
      for (const index of [3, 4, 5]) {
        const box = review.checkbox(`Include Suggestion ${index}`)
        if (await hand.sees(box, 500)) await hand.click(box)
      }
      await hand.click(review.button(/^Add \d+ tasks?$/, false), { slowOk: true })
      await hand.expectGone(review.heading('Review the suggested tasks'), 15_000)
    })

    await attempt(context, 'Ask the notes chat and add its proposal', async () => {
      await openTab(session, 'Overview')
      const chat = ui.region('Notes chat')
      if (await hand.sees(chat.button('New chat'), 2000)) await hand.click(chat.button('New chat'))
      const box = chat.role('textbox', /message|ask/i, false)
      await hand.fill(box, 'What should I do first, and is anything missing from the plan?')
      await hand.press('Control+Enter')
      const proposal = chat.button(/^Add/, false)
      const replied = await hand.sees(proposal, 90_000)
      verify(
        context,
        replied,
        'The notes chat answers with a proposal card',
        'No Add button appeared after asking the notes chat.',
        'S3'
      )
      if (replied) await hand.click(proposal)
    })

    await attempt(context, 'Write an AI summary', async () => {
      const summary = ui.region('AI summary')
      await hand.click(summary.button(/^(Write a summary|Refresh|Write again)/, false), {
        slowOk: true
      })
      await hand.wait('the summary is written', 2000)
    })

    await attempt(context, 'Draft a decision with AI and save it', async () => {
      await openTab(session, 'Decisions')
      await hand.click(ui.button('Draft with AI…'), { slowOk: true })
      const review = ui.dialog('Review the drafted decision')
      await hand.expect(review.button('Save decision'), 90_000)
      await hand.click(review.button('Save decision'))
      await hand.expectGone(review.heading('Review the drafted decision'), 10_000)
    })

    const after = (await workItems(session, projectId)).length
    verify(
      context,
      after > before,
      'Accepted AI suggestions became tasks',
      `Tasks before ${before}, after ${after}.`
    )
  }
}

const organise: Phase = {
  name: 'organise',
  title:
    'Day-to-day work: board, filters, views, quick add, the drawer, list, calendar, timeline, search',
  needs: ['plan'],
  run: async (context) => {
    const { session, state } = context
    const { ui, hand } = session
    const projectId = state.projectId!
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Board')
    const human = TASKS.filter((task) => !task.forAgent)

    await attempt(context, 'Move a task to Ready from its card menu', async () => {
      await hand.click(ui.button(`More actions for ${human[0].title}`))
      await hand.click(ui.menuitem('Ready'))
    })
    await attempt(context, 'Drag a card to In progress', async () => {
      const card = ui.css(`article:has-text("${human[1].title}")`, `card "${human[1].title}"`)
      const column = ui.region('In progress')
      await hand.drag(card, { locator: column.locator, description: 'column "In progress"' })
    })
    await attempt(context, 'Filter by priority and clear it', async () => {
      await hand.click(ui.button('Add filter'))
      await hand.click(ui.dialog('Add filter').button('Priority'))
      await hand.click(ui.dialog('Edit filter: Priority').button('Done'))
      await hand.click(ui.button('Clear', true))
    })
    await attempt(context, 'Group the board by milestone and back', async () => {
      await hand.click(ui.button('View options'))
      await hand.select(ui.dialog('View options').label('Group by'), 'milestone')
      await hand.press('Escape')
      await hand.expect(ui.role('region', 'Swimlane: Skeleton builds'), 5000)
      await hand.click(ui.button('View options'))
      await hand.select(ui.dialog('View options').label('Group by'), 'none')
      await hand.press('Escape')
    })
    await attempt(context, 'Save the current view', async () => {
      await hand.click(ui.button(/^Views:/, false))
      await hand.click(ui.menuitem('Save view…'))
      await hand.fill(ui.label('Name'), 'Everything for 1.0')
      await hand.click(ui.button('Save'))
    })
    await attempt(context, 'Quick add a task with shortcuts in the text', async () => {
      await hand.press('Control+N')
      await hand.type('Order tomato stickers tomorrow #design !low')
      await hand.press('Enter')
      await hand.wait('the quick-added task lands', 800)
      const items = await workItems(session, projectId)
      const added = items.find((item) => item.title.startsWith('Order tomato stickers'))
      verify(
        context,
        !!added,
        'Quick add creates the task in the current project',
        'No "Order tomato stickers" task after Quick add.'
      )
      verify(
        context,
        !!added && added.labels.includes('design'),
        'Quick add reads #label',
        JSON.stringify(added),
        'S3'
      )
      verify(
        context,
        !!added?.targetDate,
        'Quick add reads "tomorrow" as a due date',
        JSON.stringify(added),
        'S3'
      )
    })
    await attempt(context, 'Work a task in its drawer: assign, date, tick, comment', async () => {
      await openTask(session, human[0].title)
      const drawer = ui.dialog(human[0].title)
      await hand.click(drawer.button('Assign to me'))
      await hand.fill(drawer.label('Due date'), day(5))
      await hand.click(drawer.role('checkbox', /^Done: /, false))
      await hand.fill(
        drawer.label('Comment'),
        'Looked at three icon packs; the tomato one is MIT licensed.'
      )
      await hand.press('Control+Enter')
      // The drawer saves as you go (R1.5): closing it is all that is left.
      await hand.click(drawer.button('Close', true))
      await hand.expectGone(drawer.heading(human[0].title), 8000)
      const item = (await workItems(session, projectId)).find(
        (entry) => entry.title === human[0].title
      )
      verify(
        context,
        item?.targetDate === day(5),
        'The drawer saves the due date',
        JSON.stringify(item)
      )
    })
    await attempt(context, 'List: group by milestone', async () => {
      await openTab(session, 'List')
      await hand.click(ui.button('View options'))
      await hand.select(ui.dialog('View options').label('Group by'), 'milestone')
      await hand.press('Escape')
    })
    await attempt(context, 'Calendar: today and the next month', async () => {
      await openTab(session, 'Calendar')
      await hand.press('t')
      await hand.click(ui.button(/^Next/, false))
    })
    await attempt(context, 'Timeline: week and month zoom', async () => {
      await openTab(session, 'Timeline')
      const zoom = ui.within(
        session.page.getByRole('radiogroup', { name: 'Timeline zoom' }),
        'the zoom'
      )
      await hand.click(zoom.radio('Week'))
      await hand.click(zoom.radio('Month'))
    })
    await attempt(context, 'Search for a word across the project', async () => {
      await hand.press('Control+K')
      await hand.type('timer')
      await hand.wait('results appear', 800)
      const all = await hand.sees(ui.text(/See all results/), 3000)
      if (all) {
        await hand.click(ui.text(/See all results/))
        await hand.expect(ui.heading(/Search/, false), 5000)
      } else {
        await hand.press('Escape')
      }
    })
  }
}

const decisions: Phase = {
  name: 'decisions',
  title: 'Recording a decision by hand',
  needs: ['plan'],
  run: async (context) => {
    const { session } = context
    const { ui, hand } = session
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Decisions')
    await hand.click(ui.button('New decision'))
    const dialog = ui.dialog('New decision')
    await hand.fill(dialog.label('Title'), 'Default durations are 25, 5 and 15 minutes')
    await hand.fill(
      dialog.label('Context'),
      'People expect the classic Pomodoro timings out of the box.'
    )
    await hand.fill(
      dialog.label('Decision'),
      'Ship 25/5/15 with a long break after every fourth focus period; all four are editable.'
    )
    await hand.fill(dialog.label('Alternatives'), '50/10 blocks; no long break.')
    await hand.fill(
      dialog.label('Consequences'),
      'Matches what most people know; settings cover the rest.'
    )
    await attempt(context, 'Link the decision to its task', () =>
      hand.click(dialog.checkbox(TASKS.find((task) => task.key === 'T6')!.title))
    )
    await hand.click(dialog.button('Save decision'))
    await hand.expect(ui.text('Default durations are 25, 5 and 15 minutes'), 8000)
  }
}

const projectSettings: Phase = {
  name: 'project-settings',
  title: 'Project settings: conventions for agents, workspace setup, estimates',
  needs: ['create-project'],
  run: async (context) => {
    const { session } = context
    const { ui, hand, options } = session
    await openProject(session, PROJECT_NAME)
    await hand.click(ui.button('More project actions'))
    await hand.click(ui.menuitem('Project settings…'))
    const dialog = ui.dialog(`${PROJECT_NAME} settings`)
    await hand.expect(dialog.label('Project name'), 15_000)
    const inside = { recover: false }
    await attempt(
      context,
      'Count estimates in hours',
      () =>
        hand.click(
          ui
            .within(dialog.locator.getByRole('radiogroup', { name: 'Estimate in' }), 'Estimate in')
            .radio('Hours')
        ),
      'S3',
      inside
    )
    if (options.agents !== 'off') {
      await attempt(
        context,
        'Write the agent conventions',
        async () => {
          await hand.fill(dialog.label('Conventions (Markdown)'), conventionsText())
          await hand.press('Tab')
          await hand.wait('the conventions save on leaving the field', 600)
        },
        'S3',
        inside
      )
      await attempt(
        context,
        'Leave workspace setup on Automatic and read what it detects',
        async () => {
          await hand.click(
            ui
              .within(
                dialog.locator.getByRole('radiogroup', { name: 'Workspace setup' }),
                'Workspace setup'
              )
              .radio('Automatic')
          )
          // Before the first task creates the solution there is nothing to
          // restore; afterwards each new workspace runs dotnet restore.
          const preview = dialog.text(/^(Runs .+|No lockfile.+)$/)
          if (await hand.sees(preview, 3000)) {
            session.recorder.journal(`- Workspace setup says: ${await preview.locator.innerText()}`)
          }
        }
      )
    }
    await hand.click(dialog.button('Close'))
    if (options.agents !== 'off') {
      const saved = await session.api(
        'read the project conventions',
        async (name: string) => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const result = await api.getProjects()
          if (!result.ok) return null
          const project = result.value.find((entry) => entry.name === name) as unknown as {
            agentConventions?: string
          }
          return project?.agentConventions ?? null
        },
        PROJECT_NAME
      )
      verify(
        context,
        !!saved && saved.includes('Ostler friction'),
        'The conventions are saved',
        `Saved conventions: ${String(saved).slice(0, 120)}`
      )
    }
  }
}

/**
 * Queues a task for agents from its Board card. With agents on, a Ready task
 * goes to the queue by itself, so the card usually says "Queued" already and
 * its menu offers no "Queue for agent": then there is nothing to do.
 */
async function queueFromBoard(session: Session, title: string): Promise<void> {
  const { ui, hand } = session
  await hand.click(ui.button(`More actions for ${title}`))
  if (!(await hand.sees(ui.menuitem('Queue for agent'), 1500))) {
    session.recorder.journal(`- "${title}" is already in the agent queue.`)
    await hand.press('Escape')
    return
  }
  await hand.click(ui.menuitem('Queue for agent'))
}

/**
 * Opens the review of the finished task `title` from the Agents tab's "Ready
 * for you to review", and returns the review dialog: a person waits for it
 * to open and acts in it, never on the identical buttons in the list behind it.
 */
async function openReview(session: Session, title: string): Promise<Ui> {
  const { ui, hand } = session
  await openTab(session, 'Agents')
  const waiting = session.page.getByRole('list', { name: 'Tasks ready for you to review' })
  const row = ui.within(
    waiting.getByRole('listitem').filter({ hasText: title }).first(),
    `the task "${title}" ready for review`
  )
  await hand.click(row.button('Review…'))
  const review = ui.within(
    session.page.getByRole('dialog').filter({ hasText: title }).last(),
    `the review of "${title}"`
  )
  await hand.expect(review.button(/^(Apply|Nothing changed: Close)$/, false), 15_000)
  return review
}

/** Ostler's agent state as the run's data folder holds it (`<data>/harness/<sha256(project)>/state.json`). */
interface StoredAgentState {
  sessions: {
    id: string
    status: string
    token: string
    taskId?: string | null
    workspace?: SimSession['workspace']
  }[]
  tasks: {
    id: string
    title: string
    details: string
    status: string
    claimedBy: string | null
    copy?: { state: string; worktreePath: string; hasWork?: boolean }
  }[]
}

/**
 * The window never shows a session's token (the copied prompt carries it,
 * and drive mode's clipboard redacts it), so the simulated agent reads its
 * session where Ostler keeps it, as the journey reads other app state.
 */
function storedAgentState(options: MonkeyOptions, projectId: string): StoredAgentState {
  const key = createHash('sha256').update(projectId).digest('hex')
  const file = path.join(options.dataDir, 'harness', key, 'state.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StoredAgentState>
    return { sessions: parsed.sessions ?? [], tasks: parsed.tasks ?? [] }
  } catch {
    return { sessions: [], tasks: [] }
  }
}

function storedTask(options: MonkeyOptions, projectId: string, title: string) {
  return storedAgentState(options, projectId).tasks.find((task) => task.title === title)
}

/** The running session Ostler started for the task `title`, as its prompt describes it. */
function startedSession(
  options: MonkeyOptions,
  projectId: string,
  title: string
): SimSession | null {
  const state = storedAgentState(options, projectId)
  const task = state.tasks.find((entry) => entry.title === title && entry.status === 'claimed')
  const found =
    task && state.sessions.find((entry) => entry.id === task.claimedBy && entry.status !== 'done')
  if (!task || !found) return null
  return { id: found.id, token: found.token, taskId: task.id, workspace: found.workspace ?? null }
}

/** Git in the person's project folder: what they would type in a terminal. */
function folderGit(folder: string, ...args: string[]): string {
  return execFileSync('git', ['-C', folder, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim()
}

/** Polls until `probe` finds something, for at most `minutes`; the wait is recorded. */
async function pollFor<T>(
  session: Session,
  reason: string,
  minutes: number,
  probe: () => T | null | undefined
): Promise<T | null> {
  let found: T | null = null
  await waitUntil(session, reason, minutes, async () => {
    found = probe() ?? null
    return found !== null
  })
  return found
}

/**
 * Starts the queued task `title` through the window, as a person handing it
 * to an external agent: "Start this task" when it is first in the queue, or
 * the row's "Copy prompt and token". Ostler claims the task and starts the
 * session in the task's copy; this returns that session.
 */
async function startTask(
  context: PhaseContext,
  projectId: string,
  title: string,
  via: 'start' | 'menu'
): Promise<SimSession> {
  const { session } = context
  const { ui, hand, options } = session
  await openTab(session, 'Agents')
  const ready = await waitUntil(session, `the copy for "${title}" is ready`, 10, async () => {
    const task = storedTask(options, projectId, title)
    return task?.status === 'pending' && task.copy?.state !== 'preparing'
  })
  if (!ready) throw new Error(`"${title}" never got ready in the agent queue`)
  const page = session.page
  const row = ui.within(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      .first(),
    `the queue row for "${title}"`
  )
  let used = via
  if (via === 'start' && (await hand.sees(row.button('Start this task'), 5000))) {
    await hand.click(row.button('Start this task'), { slowOk: true })
  } else {
    if (via === 'start')
      session.recorder.journal(
        `- "${title}" is not first in the queue; copying its prompt instead.`
      )
    used = 'menu'
    await hand.click(row.button(`More actions for ${title}`))
    await hand.click(ui.menuitem('Copy prompt and token'), { slowOk: true })
  }
  const started = await pollFor(session, `Ostler starts a session for "${title}"`, 2, () =>
    startedSession(options, projectId, title)
  )
  if (!started) throw new Error(`Ostler started no session for "${title}"`)
  if (used === 'start') {
    verify(
      context,
      await hand.sees(ui.text('Agent prompt', true), 5000),
      'Start this task shows the prompt it copied',
      `After "Start this task" on "${title}", the Agents tab shows no "Agent prompt".`,
      'S3'
    )
  }
  verify(
    context,
    await hand.sees(ui.region('Working now').text(title, true), 10_000),
    'A started task shows under Working now',
    `"${title}" has a running session, but the Agents tab's "Working now" does not list it.`,
    'S3'
  )
  return started
}

async function simulatedRun(
  context: PhaseContext,
  base: string,
  name: string,
  started: SimSession,
  plan: {
    question?: string
    blocker?: { description: string; options: string[] }
    noChange?: boolean
    upToDate?: boolean
    files?: { path: string; content: string }[]
  }
): Promise<void> {
  const { session } = context
  const agent = new SimAgent(base, started, session.recorder, name)
  const task = storedAgentState(session.options, context.state.projectId!).tasks.find(
    (entry) => entry.id === started.taskId
  )
  const title = task?.title ?? started.taskId
  await agent.help()
  const own = await agent.read()
  session.recorder.journal(
    `- ${name}: took "${title}" in ${started.workspace?.worktreePath ?? 'no folder'}, setup ${own.session.workspace?.setup?.status ?? 'none'}`
  )
  if (plan.question) {
    const asked = await agent.ask(plan.question)
    const answered = await answerQuestion(context, plan.question)
    const answer = answered ? await agent.waitForAnswer(asked.id, 60_000) : null
    verify(
      context,
      answer !== null,
      'An answer typed in Ostler reaches the agent',
      `Asked: ${plan.question}`
    )
  }
  if (plan.blocker) {
    await agent.blocker(plan.blocker.description, plan.blocker.options)
  }
  if (plan.noChange) {
    await agent.complete(
      [],
      'Nothing to change: the tests this task asks for already exist and pass.'
    )
    return
  }
  if (plan.upToDate) {
    agent.bringUpToDate(plan.files)
    await agent.complete(
      plan.files?.map((file) => file.path) ?? [],
      `Brought "${title}" up to date with the project folder (simulated). Ostler friction: none`
    )
    return
  }
  const files = plan.files ?? simulatedFiles({ title })
  const changed = agent.commitFiles(files, `${title}\n\nSimulated by the Ostler monkey.`)
  await agent.complete(changed, `Did "${title}" (simulated). Ostler friction: none`)
}

/** Answers the open agent question through the window. */
async function answerQuestion(context: PhaseContext, question: string): Promise<boolean> {
  const { session } = context
  const { ui, hand } = session
  return attempt(context, 'Answer an agent question in Ostler', async () => {
    await openTab(session, 'Agents')
    await hand.expect(ui.text(question.slice(0, 40)), 15_000)
    await hand.fill(
      ui.label(/^(Your answer|Answer for)/, false),
      'Yes: keep the remaining time while minimised.'
    )
    await hand.click(ui.button('Answer'))
  })
}

/** A History row by its title, as the History tab lists it. */
function historyRow(session: Session, title: string | RegExp): Ui {
  const page = session.page
  return session.ui.within(
    page
      .getByRole('listitem')
      .filter({ has: page.getByText(title, { exact: typeof title === 'string' }) })
      .first(),
    `the History entry ${String(title)}`
  )
}

const agentsRun: Phase = {
  name: 'agents-run',
  title:
    'Agents build the app: queue, start, ask, block, review, apply, send back, discard, bring back, undo',
  needs: ['plan', 'agents-setup'],
  skip: ({ session }) => (session.options.agents === 'off' ? 'agents are off for this run' : null),
  run: async (context) => {
    const { session, state } = context
    const { ui, hand, options } = session
    const projectId = state.projectId!
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Board')
    const title = (key: string) => TASKS.find((task) => task.key === key)!.title

    if (options.agents === 'simulated') {
      const config = readConfig(options)
      const port = (config.harness as { port?: number } | undefined)?.port ?? 8934
      const base = `http://127.0.0.1:${port}/harness/${projectId}`
      const folder = state.projectPath
      if (!folder) throw new Error('The project has no folder')
      const inFolder = (file: string) => path.join(folder, file)
      const status = async (key: string) =>
        (await workItems(session, projectId)).find((entry) => entry.title === title(key))?.status

      // T1: the happy path, and the version watch. Queue from the Board, start
      // it from the queue, the agent works in its copy; the person switches
      // the folder to another version, so Apply asks first; Wait, switch back,
      // Apply.
      await attempt(context, 'T1: queue, start, agent works, version prompt, apply', async () => {
        await queueFromBoard(session, title('T1'))
        const started = await startTask(context, projectId, title('T1'), 'start')
        await simulatedRun(context, base, 'Agent A', started, {})
        const version = folderGit(folder, 'rev-parse', '--abbrev-ref', 'HEAD')
        folderGit(folder, 'switch', '-c', 'monkey-side-version')
        session.recorder.journal(
          `- Switched the project folder from ${version} to monkey-side-version`
        )
        try {
          const review = await openReview(session, title('T1'))
          await hand.click(review.button('View changes'))
          await hand.expect(review.text(/PomodoroDesk\.Core\.csproj/), 10_000)
          await hand.click(review.button('Apply'))
          const prompt = ui.dialog('Your project folder is on a different version')
          const asked = await hand.sees(prompt.button('Wait'), 8000)
          verify(
            context,
            asked,
            'Apply asks first when the project folder is on a different version',
            'The folder was switched to another version after the task started; Apply went ahead without asking.'
          )
          if (asked) {
            verify(
              context,
              await hand.sees(prompt.button('Apply to the current version'), 1000),
              'The version prompt offers to apply to the current version',
              'The prompt has Wait but no "Apply to the current version".',
              'S3'
            )
            await hand.click(prompt.button('Wait'))
            await hand.wait('the prompt closes', 800)
            verify(
              context,
              (await status('T1')) !== 'done',
              'Wait leaves the task waiting for review',
              `After Wait, T1 is ${await status('T1')}`
            )
          }
          await hand.press('Escape')
        } finally {
          folderGit(folder, 'switch', version)
          folderGit(folder, 'branch', '-D', 'monkey-side-version')
          session.recorder.journal(`- Switched the project folder back to ${version}`)
        }
        const review = await openReview(session, title('T1'))
        await hand.click(review.button('Apply'))
        verify(
          context,
          !(await hand.sees(ui.dialog(/different version/).button('Wait'), 1500)),
          'Apply does not ask about versions when the folder is back on the task’s version',
          'The version prompt showed although the folder was back on the version the task started from.',
          'S3'
        )
        await hand.wait('the work lands in the project folder', 1500)
        verify(
          context,
          (await status('T1')) === 'done',
          'Applying a task marks it done',
          `T1 is ${await status('T1')}`
        )
        verify(
          context,
          fs.existsSync(inFolder('src/PomodoroDesk.Core/PomodoroDesk.Core.csproj')),
          'Apply puts the work in the project folder',
          `No src/PomodoroDesk.Core/PomodoroDesk.Core.csproj in ${folder} after Apply.`
        )
        verify(
          context,
          !started.workspace || !fs.existsSync(started.workspace.worktreePath),
          'Apply removes the task’s copy',
          `${started.workspace?.worktreePath} is still there after Apply.`,
          'S3'
        )
        state.merged.push('T1')
      })

      // T2: the agent asks a question; the person answers; then sends the work
      // back, and the next agent carries on in the same copy.
      await attempt(
        context,
        'T2: question, answer, send back, redo in the same copy, apply',
        async () => {
          await openTab(session, 'Board')
          await queueFromBoard(session, title('T2'))
          await queueFromBoard(session, title('T3'))
          const first = await startTask(context, projectId, title('T2'), 'start')
          await simulatedRun(context, base, 'Agent B', first, {
            question: 'Should Pause keep the remaining time when the window is minimised?'
          })
          const review = await openReview(session, title('T2'))
          await hand.click(review.button('Send back…'))
          await hand.fill(
            review.label('Why are you sending it back?'),
            'The long break after the fourth focus period is missing.'
          )
          await hand.click(review.radio(/^Back in the queue/))
          await hand.click(review.button('Send back'))
          await hand.wait('the task goes back to the queue', 1500)
          const again = storedTask(options, projectId, title('T2'))
          verify(
            context,
            again?.status === 'pending' && !!again.details && again.details.includes('long break'),
            'A task sent back carries the reason to the next agent',
            `Task ${again?.status}; details: ${String(again?.details).slice(0, 200)}`
          )
          const second = await startTask(context, projectId, title('T2'), 'start')
          verify(
            context,
            second.workspace?.worktreePath === first.workspace?.worktreePath,
            'A task sent back carries on in the same copy',
            `First copy ${first.workspace?.worktreePath}, second ${second.workspace?.worktreePath}`,
            'S3'
          )
          await simulatedRun(context, base, 'Agent C', second, {
            files: simulatedFiles({ title: title('T2') }).map((file) => ({
              ...file,
              content: `${file.content}\n// A long break follows the fourth focus period.\n`
            }))
          })
          const redone = await openReview(session, title('T2'))
          await hand.click(redone.button('Apply'))
          await hand.wait('the work lands in the project folder', 1500)
          const timer = inFolder('src/PomodoroDesk.Core/PomodoroTimer.cs')
          verify(
            context,
            fs.existsSync(timer) && fs.readFileSync(timer, 'utf8').includes('long break'),
            'The redone work is what lands in the project folder',
            `${timer} is missing or lacks the second agent's change.`
          )
          state.merged.push('T2')
        }
      )

      // T3: the agent reports a blocker, the person resolves it, and the task
      // needed no change: "Nothing changed: Close".
      await attempt(context, 'T3: blocker reported and resolved; nothing changed', async () => {
        const started = await startTask(context, projectId, title('T3'), 'menu')
        await simulatedRun(context, base, 'Agent D', started, {
          blocker: {
            description: 'The tests for pause and resume already exist from T2. Keep this task?',
            options: ['Close it', 'Add edge cases']
          },
          noChange: true
        })
        await openTab(session, 'Overview')
        // The agent offered two ways out; a person picks one.
        const choice = ui.region('Blockers').button('Close it')
        const shownAt = Date.now()
        if (await hand.sees(choice, 20_000)) {
          const waited = Date.now() - shownAt
          if (waited > 3000) {
            friction(
              context,
              'improve',
              'S4',
              'A reported blocker reaches the Overview late',
              `The blocker the agent reported took ${Math.round(waited / 1000)} s to appear on the Overview: the Blockers panel polls every 15 s instead of updating when a blocker is reported.`
            )
          }
          await hand.click(choice)
        } else {
          friction(
            context,
            'hard',
            'S3',
            'A reported blocker is hard to find',
            'After an agent reported a blocker, the Overview showed no Blockers panel within 20 s.'
          )
        }
        const review = await openReview(session, title('T3'))
        await hand.click(review.button('Nothing changed: Close'))
        await hand.wait('the task closes', 1000)
      })

      // T4 and T6 (both after T2) change the same lines of README.md. The
      // second Apply cannot bring T6 up to date, so it goes back to its agent;
      // the agent brings it up to date in the same copy, keeping both
      // changes; the person discards it, brings it back from History, and
      // applies it, and both changes land in the project folder.
      await attempt(
        context,
        'T4 and T6: the same lines changed; sent back to update, discard, bring back, apply',
        async () => {
          await openTab(session, 'Board')
          await queueFromBoard(session, title('T4'))
          await queueFromBoard(session, title('T6'))
          const left = await startTask(context, projectId, title('T4'), 'start')
          await simulatedRun(context, base, 'Agent E', left, {
            files: [{ path: 'README.md', content: '# Pomodoro Desk\n\nThe window is built.\n' }]
          })
          const right = await startTask(context, projectId, title('T6'), 'menu')
          const readme = [
            { path: 'README.md', content: '# Pomodoro Desk\n\nSettings live in settings.json.\n' }
          ]
          await simulatedRun(context, base, 'Agent F', right, { files: readme })
          const first = await openReview(session, title('T4'))
          await hand.click(first.button('Apply'))
          await hand.wait('the first task lands', 1500)
          state.merged.push('T4')
          const second = await openReview(session, title('T6'))
          await hand.click(second.button('Apply'))
          verify(
            context,
            await hand.sees(ui.text(/went back to its agent/), 8000),
            'Apply says when it sent a clashing task back to its agent',
            'Applying the second README change showed nothing about the task going back to its agent.'
          )
          await hand.wait('the task goes back to the queue', 1000)
          const sentBack = storedTask(options, projectId, title('T6'))
          verify(
            context,
            sentBack?.status === 'pending' &&
              !!sentBack.details?.includes('bring your work up to date'),
            'A clashing task goes back to the queue with a note to bring it up to date',
            `T6 is ${sentBack?.status}; the next agent is handed these details, which end: ` +
              `${String(sentBack?.details).slice(-200)}\n\nThe note is recorded on the task's rejections, ` +
              'but the details the next agent reads do not carry it.'
          )
          verify(
            context,
            fs.readFileSync(inFolder('README.md'), 'utf8').includes('The window is built'),
            'A clash leaves the project folder as it was',
            'README.md lost the first applied task’s change after the second Apply clashed.'
          )
          const update = await startTask(context, projectId, title('T6'), 'start')
          verify(
            context,
            !!update.workspace && update.workspace.worktreePath === right.workspace?.worktreePath,
            'A task sent back to update goes on in its own copy',
            `T6 first ran in ${right.workspace?.worktreePath ?? 'no copy'}, but its update run got ` +
              `${update.workspace?.worktreePath ?? 'no copy'}.`
          )
          verify(
            context,
            !!storedTask(options, projectId, title('T6'))?.details?.includes(
              'bring your work up to date'
            ),
            'The agent that updates the task is handed the note to bring it up to date',
            'When T6 started again, its details no longer carried the send-back note.'
          )
          const both = [
            {
              path: 'README.md',
              content:
                '# Pomodoro Desk\n\nThe window is built.\n\nSettings live in settings.json.\n'
            }
          ]
          await simulatedRun(context, base, 'Agent G', update, { upToDate: true, files: both })

          const discard = await openReview(session, title('T6'))
          await hand.click(discard.button('Discard'))
          const confirm = ui.dialog(/^Discard the work from/)
          await hand.click(confirm.button('Discard'))
          await hand.wait('the copy is set aside', 1500)
          verify(
            context,
            storedTask(options, projectId, title('T6'))?.status === 'pending',
            'Discard puts the task back in the queue',
            `T6 is ${storedTask(options, projectId, title('T6'))?.status} after Discard`
          )

          await openTab(session, 'History')
          await hand.expect(ui.text('Discarded work', true), 8000)
          await hand.click(historyRow(session, title('T6')).button('Bring back'))
          await hand.expect(ui.text(/is back, ready for you to review/), 8000)
          verify(
            context,
            (await harness(session, projectId)).review.some(
              (run) => run.taskId === storedTask(options, projectId, title('T6'))?.id
            ),
            'Bring back puts the discarded work up for review again',
            'After Bring back, T6 is not among the tasks ready for review.'
          )
          const back = await openReview(session, title('T6'))
          await hand.click(back.button('Apply'))
          const clashedAgain = await hand.sees(ui.text(/went back to its agent/), 3000)
          verify(
            context,
            !clashedAgain,
            'Apply takes work its agent brought up to date',
            'The agent merged the project folder into its copy after Apply sent it back ("bring your work up to date") ' +
              'and settled the clash, yet Apply sent it back again.'
          )
          if (clashedAgain) return
          await hand.wait('the work lands in the project folder', 1500)
          const landed = fs.readFileSync(inFolder('README.md'), 'utf8')
          verify(
            context,
            landed.includes('settings.json') && landed.includes('The window is built'),
            'Work brought up to date lands with both changes',
            `After T6 was brought up to date and applied, README.md reads:\n${landed}\n` +
              'It should hold T4’s line and T6’s line, as the agent settled them.'
          )
          verify(
            context,
            folderGit(folder, 'status', '--porcelain') === '',
            'Applying work brought up to date leaves the project folder tidy',
            `The project folder has loose changes after the Apply:\n${folderGit(folder, 'status', '--porcelain')}`
          )
          await openTab(session, 'History')
          verify(
            context,
            await hand.sees(historyRow(session, title('T6')).button('Undo this task'), 8000),
            'Work brought up to date shows in History as one task to undo',
            'After T6 was applied, History lists no entry for it that can be undone.',
            'S3'
          )
          verify(
            context,
            (await status('T6')) === 'done',
            'Applying work brought back marks its task done',
            `T6 is ${await status('T6')}`
          )
          state.merged.push('T6')
        }
      )

      // History: undo one task, then undo the undo.
      await attempt(context, 'History: undo a task, then undo the undo', async () => {
        const timer = inFolder('src/PomodoroDesk.Core/PomodoroTimer.cs')
        await openTab(session, 'History')
        await hand.click(historyRow(session, title('T2')).button('Undo this task'))
        await hand.expect(ui.text(/^Undid /), 8000)
        verify(
          context,
          !fs.existsSync(timer),
          'Undo this task takes its work out of the project folder',
          `${timer} is still there after undoing "${title('T2')}".`
        )
        verify(
          context,
          fs.existsSync(inFolder('src/PomodoroDesk.Core/PomodoroDesk.Core.csproj')),
          'Undoing one task leaves the other tasks’ work alone',
          'Undoing T2 also removed T1’s project file.'
        )
        const undo = session.ui.within(
          session.page
            .getByRole('listitem')
            .filter({ hasText: /^Undo of/ })
            .filter({ hasText: title('T2') })
            .first(),
          `the undo of "${title('T2')}"`
        )
        await hand.click(undo.button('Undo the undo'))
        await hand.wait('the work comes back', 1500)
        verify(
          context,
          fs.existsSync(timer),
          'Undo the undo brings the task’s work back',
          `${timer} is missing after undoing the undo.`
        )
      })

      const final = await harness(session, projectId)
      verify(
        context,
        final.review.length === 0,
        'No finished task is left waiting for review',
        JSON.stringify(final.review),
        'S3'
      )
      verify(
        context,
        final.active.length === 0,
        'No agent session is left open',
        JSON.stringify(final.active),
        'S2'
      )
      return
    }

    // Embedded or external agents do the real work. The monkey queues the first
    // milestone's tasks, lets agents run, and reviews each finished run.
    if (options.agents === 'embedded') {
      await attempt(context, 'Run queued tasks automatically, two at a time', async () => {
        await hand.click(ui.button('More project actions'))
        await hand.click(ui.menuitem('Project settings…'))
        const dialog = ui.dialog(`${PROJECT_NAME} settings`)
        await hand.click(dialog.label('Run queued tasks automatically'))
        await hand.click(dialog.button('Close'))
      })
    }
    for (const key of ['T1', 'T2', 'T3', 'T4']) {
      await attempt(context, `Queue ${key}`, () => queueFromBoard(session, title(key)))
    }
    if (options.agents === 'external') {
      session.recorder.journal(
        '- Waiting for an external agent. Start one from the Agents tab (Start this task, or Copy prompt and token), give it tests/monkey/dummy-project/external-agent.md, and let it work.'
      )
    }
    const deadline = Date.now() + options.minutes * 60_000
    const reviewed = new Set<string>()
    while (Date.now() < deadline && reviewed.size < 4) {
      const ready = await waitUntil(
        session,
        'an agent run waits for review',
        Math.max(1, (deadline - Date.now()) / 60_000),
        async () => {
          const state = await harness(session, projectId)
          return (
            state.review.some((run) => !reviewed.has(run.id)) ||
            state.questions.some((q) => q.status === 'pending')
          )
        }
      )
      if (!ready) break
      const current = await harness(session, projectId)
      const question = current.questions.find((q) => q.status === 'pending')
      if (question) {
        await answerQuestion(context, question.question)
        continue
      }
      const run = current.review.find((entry) => !reviewed.has(entry.id))!
      reviewed.add(run.id)
      const task = current.queue.find((entry) => entry.id === run.taskId)
      await attempt(context, `Review "${run.title}"`, async () => {
        const review = await openReview(session, task?.title ?? run.title)
        if (await hand.sees(review.button('View changes'), 2000))
          await hand.click(review.button('View changes'))
        await hand.wait('reading the changes and the report', 2000)
        await hand.click(review.button(/^(Apply|Nothing changed: Close)$/, false))
        await hand.wait('the work lands in the project folder', 2000)
      })
    }
    session.recorder.journal(`- Reviewed ${reviewed.size} agent run(s).`)
  }
}

const milestones: Phase = {
  name: 'milestones',
  title: 'Milestone review: is "Skeleton builds" ready to close?',
  needs: ['plan'],
  run: async (context) => {
    const { session, state } = context
    const { ui, hand, options } = session
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Milestones')
    const card = ui.within(
      session.page.locator('article, section, li').filter({ hasText: 'Skeleton builds' }).first(),
      'the "Skeleton builds" card'
    )
    if (options.ai !== 'off') {
      await attempt(context, 'Review the milestone with AI', async () => {
        await hand.click(card.button(/^(Review with AI|Review again)$/, false), { slowOk: true })
        await hand.wait('the review is written', 3000)
      })
    }
    const t1Done = state.merged.includes('T1')
    const ready = await hand.sees(card.text(/Ready to close/), 3000)
    verify(
      context,
      ready === t1Done,
      'The milestone says "Ready to close" exactly when its work is done',
      `T1 accepted: ${t1Done}; the card ${ready ? 'says' : 'does not say'} Ready to close.`
    )
    if (ready) {
      await attempt(context, 'Close the finished milestone', async () => {
        await hand.click(card.button('Mark complete'))
        await hand.wait('the milestone completes', 1000)
      })
    }
  }
}

const reportsAndExport: Phase = {
  name: 'export',
  title: 'Reports and sharing: overview charts, PDF, export, CSV, template',
  needs: ['plan'],
  run: async (context) => {
    const { session } = context
    const { ui, hand, options } = session
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Overview')
    await attempt(context, 'Read the charts as tables', async () => {
      await hand.scroll(null, 900)
      const table = ui.button(/as a table|Show table/i, false)
      if (await hand.sees(table, 3000)) await hand.click(table)
    })
    await attempt(context, 'Export the whole project', async () => {
      await hand.click(ui.button('More project actions'))
      await hand.click(ui.menuitem('Export project…'))
      const dialog = ui.dialog(`Export ${PROJECT_NAME}`)
      await hand.click(dialog.button('Choose where…'))
      await hand.wait('the file is written', 2000)
    })
    await attempt(context, 'Export all tasks to CSV', async () => {
      await hand.click(ui.button('More project actions'))
      await hand.click(ui.menuitem('Export all tasks'))
      await hand.wait('the CSV is written', 1500)
    })
    await attempt(context, 'Save the project as a template', async () => {
      await hand.click(ui.button('More project actions'))
      await hand.click(ui.menuitem('Save as template…'))
      const dialog = ui.dialog(/^Save Pomodoro Desk as a template/)
      await hand.fill(dialog.label('Template name'), 'Small Windows app')
      await hand.click(dialog.button('Save template'))
      await hand.wait('the template saves', 800)
    })
    const files = fs.existsSync(exportsDir(options)) ? fs.readdirSync(exportsDir(options)) : []
    session.recorder.journal(`- Exported files: ${files.join(', ') || 'none'}`)
    verify(
      context,
      files.some((file) => /\.csv$/i.test(file)),
      'Export all tasks writes a CSV',
      `Files: ${files.join(', ')}`,
      'S3'
    )
    verify(
      context,
      files.some((file) => !/\.csv$/i.test(file)),
      'Export project writes a project file',
      `Files: ${files.join(', ')}`,
      'S3'
    )
  }
}

const importBack: Phase = {
  name: 'import',
  title: 'Importing the exported project into a new one, then undoing it',
  needs: ['export'],
  run: async (context) => {
    const { session } = context
    const { ui, hand, options } = session
    const exported = fs
      .readdirSync(exportsDir(options))
      .filter((file) => !/\.(csv|pdf)$/i.test(file))
      .map((file) => path.join(exportsDir(options), file))
    if (!exported.length) throw new Error('There is no exported project file to import')
    await queueOpenFile(session.app, [exported[exported.length - 1]])
    await hand.click(ui.region('Projects').button('New project'))
    const wizard = ui.dialog('New project')
    await hand.click(wizard.radio('Import into a new project'))
    await hand.click(wizard.button('Next'))
    const importer = ui.dialog('Import')
    // An export is one file (<name>.ostler-project, D29); a person picks it as one.
    await hand.click(importer.button('Choose a file…'))
    await hand.wait('the file is read', 1000)
    for (let step = 0; step < 4; step += 1) {
      // "Import 3 tasks" for a spreadsheet, "Import project" for a project export.
      const finish = importer.button(/^Import (\d+|project)/, false)
      if (await hand.sees(finish, 1500)) {
        await hand.click(finish)
        break
      }
      await hand.click(importer.button('Next'))
    }
    await hand.wait('the import finishes', 2000)
    await attempt(context, 'Undo the import from the Inbox', async () => {
      await hand.click(ui.link(/^Inbox/, false))
      await hand.click(ui.button('Undo import'))
      await hand.wait('the import is undone', 1500)
    })
  }
}

const backupAndRestart: Phase = {
  name: 'restart',
  title: 'Backing up, restarting, and checking everything survived',
  needs: ['plan'],
  run: async (context) => {
    const { session, state } = context
    const { ui, hand } = session
    const projectId = state.projectId!
    await openSettings(session, 'Data')
    await attempt(context, 'Back up now', async () => {
      await hand.click(ui.button('Back up now'))
      await hand.wait('the backup is written', 2000)
    })
    const before = await workItems(session, projectId)
    await session.restart('checking that everything survives a restart')
    const after = await workItems(session, projectId)
    verify(
      context,
      after.length === before.length,
      'Every task survives a restart',
      `Before ${before.length}, after ${after.length}.`,
      'S1'
    )
    const lost = before.filter((item) => {
      const again = after.find((entry) => entry.id === item.id)
      return (
        !again ||
        again.status !== item.status ||
        again.dependencyIds.length !== item.dependencyIds.length
      )
    })
    verify(
      context,
      lost.length === 0,
      'Task status and dependencies survive a restart',
      JSON.stringify(lost.map((item) => item.title)),
      'S1'
    )
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Decisions')
    const decision = await hand.sees(ui.text('Default durations are 25, 5 and 15 minutes'), 5000)
    verify(
      context,
      decision,
      'Decisions survive a restart',
      'The hand-written decision is gone after a restart.',
      'S1'
    )
  }
}

const cleanup: Phase = {
  name: 'cleanup',
  title: 'Removing the sample project with the removal wizard',
  run: async (context) => {
    const { session, state } = context
    const { ui, hand } = session
    if (!(await projects(session)).some((project) => project.name === SAMPLE_PROJECT)) return
    await hand.click(ui.region('Projects').link(SAMPLE_PROJECT), { button: 'right' })
    await hand.click(ui.menuitem(/^Remove/, false))
    const wizard = ui.dialog(/^Remove Welcome to Ostler \(Demo Project\)/)
    for (let step = 0; step < 5; step += 1) {
      if (await hand.sees(wizard.label('Type the project name to confirm'), 1000)) break
      await hand.click(wizard.button('Next'))
    }
    await hand.fill(wizard.label('Type the project name to confirm'), SAMPLE_PROJECT)
    await hand.click(wizard.button('Remove permanently'))
    await hand.wait('the project is removed', 2000)
    const left = (await projects(session)).some((project) => project.name === SAMPLE_PROJECT)
    verify(
      context,
      !left,
      'The removal wizard removes the project',
      'The sample project is still listed after removal.'
    )
    if (!left) state.sampleProjectId = undefined
  }
}

export const PHASES: Phase[] = [
  welcome,
  tour,
  aiSetup,
  agentsSetup,
  createProject,
  brief,
  plan,
  aiPlan,
  organise,
  decisions,
  projectSettings,
  agentsRun,
  milestones,
  reportsAndExport,
  importBack,
  ...COVERAGE_PHASES,
  backupAndRestart,
  cleanup
]

export async function runJourney(
  session: Session,
  { fakeAi }: { fakeAi: FakeAi | null }
): Promise<void> {
  await runPhases(PHASES, session, fakeAi)
}
