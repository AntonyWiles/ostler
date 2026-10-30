import * as fs from 'fs'
import * as path from 'path'

/**
 * The dummy project, Pomodoro Desk: a tiny .NET 8 WinForms focus timer. The
 * brief is the one in tests/monkey/dummy-project/brief.md (read, not copied,
 * so the monkey and the agent prompts never disagree). This file is the
 * reference plan the journey types into Ostler by hand, and the files the
 * simulated agent commits for each task. Nothing here needs to be good: it is
 * a vehicle for testing Ostler.
 */

export const PROJECT_NAME = 'Pomodoro Desk'
export const PROJECT_FOLDER = 'pomodoro-desk'

export function readBrief(): string {
  return fs.readFileSync(path.resolve(__dirname, '../../dummy-project/brief.md'), 'utf8')
}

export const GOAL = {
  title: 'Ship Pomodoro Desk 1.0',
  outcome: 'A small Windows focus timer anyone can start and use without reading a manual.'
}

export interface PlannedMilestone {
  key: string
  name: string
  outcome: string
  /** Days from today. */
  dueInDays: number
  successCriteria: string[]
}

export const MILESTONES: PlannedMilestone[] = [
  {
    key: 'M1',
    name: 'Skeleton builds',
    outcome: 'The solution, app, core library and tests build and run.',
    dueInDays: 3,
    successCriteria: ['dotnet build passes', 'dotnet test passes']
  },
  {
    key: 'M2',
    name: 'Timer works',
    outcome: 'The timer logic is complete and tested without a window.',
    dueInDays: 7,
    successCriteria: ['Every period transition has a test']
  },
  {
    key: 'M3',
    name: 'Usable window',
    outcome: 'A person can start, pause and reset a focus period from the window.',
    dueInDays: 10,
    successCriteria: ['Space starts and pauses', 'The countdown is readable across the room']
  },
  {
    key: 'M4',
    name: 'Settings and notifications',
    outcome: 'Durations can be changed and the end of a period is announced.',
    dueInDays: 14,
    successCriteria: [
      'Settings survive a restart',
      'A tray notification shows at the end of a period'
    ]
  },
  {
    key: 'M5',
    name: 'Release 1.0',
    outcome: 'Anyone can download one exe and use it.',
    dueInDays: 18,
    successCriteria: ['A single-file exe is published', 'The README explains every control']
  }
]

export interface PlannedTask {
  key: string
  title: string
  description: string
  milestone: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  labels: string[]
  checklist: string[]
  dependsOn: string[]
  /** Work for an agent (queued) or for a person (assigned, dated). */
  forAgent: boolean
}

export const TASKS: PlannedTask[] = [
  {
    key: 'T1',
    title: 'Create the solution, app, core library and test project',
    description:
      'Create PomodoroDesk.sln with src/PomodoroDesk (WinForms, net8.0-windows), src/PomodoroDesk.Core (net8.0 class library) and tests/PomodoroDesk.Core.Tests (xUnit). Add bin/ and obj/ to .gitignore.',
    milestone: 'M1',
    priority: 'high',
    labels: ['setup'],
    checklist: ['dotnet build passes', 'dotnet test passes', 'bin/ and obj/ are ignored'],
    dependsOn: [],
    forAgent: true
  },
  {
    key: 'T2',
    title: 'Write the PomodoroTimer state machine with an injected clock',
    description:
      'In PomodoroDesk.Core: Focus 25 min, Short break 5, Long break 15 after every 4th focus. Start, Pause, Reset, Skip break, Tick. Time comes from IClock so tests run instantly.',
    milestone: 'M2',
    priority: 'high',
    labels: ['core'],
    checklist: [
      'Tests cover Focus → Short break',
      'Tests cover the 4th Focus → Long break',
      'Core has no UI reference'
    ],
    dependsOn: ['T1'],
    forAgent: true
  },
  {
    key: 'T3',
    title: 'Test pause, resume and reset',
    description:
      'Unit tests: a paused timer does not advance; resume continues; reset returns to Focus 25:00.',
    milestone: 'M2',
    priority: 'medium',
    labels: ['core', 'tests'],
    checklist: ['Three new tests pass'],
    dependsOn: ['T2'],
    forAgent: true
  },
  {
    key: 'T4',
    title: 'Build the main window: countdown, period, Start/Pause and Reset',
    description:
      'MainForm in src/PomodoroDesk: a large mm:ss label, the period name, Start (Pause while running) and Reset. A WinForms Timer calls PomodoroTimer.Tick every 250 ms.',
    milestone: 'M3',
    priority: 'high',
    labels: ['ui'],
    checklist: ['The countdown moves after Start', 'Pause stops it', 'Reset shows 25:00'],
    dependsOn: ['T2'],
    forAgent: true
  },
  {
    key: 'T5',
    title: 'Keyboard shortcuts: Space, R and S',
    description: 'Space starts or pauses, R resets, S skips a break (ignored during Focus).',
    milestone: 'M3',
    priority: 'medium',
    labels: ['ui'],
    checklist: ['Each key works with the window focused'],
    dependsOn: ['T4'],
    forAgent: true
  },
  {
    key: 'T6',
    title: 'Save durations to settings.json',
    description:
      'Settings in Core: read and write %APPDATA%\\PomodoroDesk\\settings.json. A missing or broken file gives defaults 25/5/15/4.',
    milestone: 'M4',
    priority: 'medium',
    labels: ['core', 'settings'],
    checklist: ['Round-trip test', 'Broken file gives defaults'],
    dependsOn: ['T2'],
    forAgent: true
  },
  {
    key: 'T7',
    title: 'Settings dialog for the durations',
    description:
      'A small dialog with four number boxes, OK and Cancel, opened from a Settings button.',
    milestone: 'M4',
    priority: 'low',
    labels: ['ui', 'settings'],
    checklist: ['OK saves', 'Cancel changes nothing'],
    dependsOn: ['T4', 'T6'],
    forAgent: true
  },
  {
    key: 'T8',
    title: 'Tray notification when a period ends',
    description: 'A NotifyIcon shows "Focus done — take a break" or "Break over — back to it".',
    milestone: 'M4',
    priority: 'medium',
    labels: ['ui'],
    checklist: ['A balloon shows at the end of each period'],
    dependsOn: ['T4'],
    forAgent: true
  },
  {
    key: 'T9',
    title: 'README: install, use, shortcuts and settings',
    description:
      'Rewrite README.md for people: what it is, how to run it, the buttons and keys, where settings live.',
    milestone: 'M5',
    priority: 'low',
    labels: ['docs'],
    checklist: ['Every key is listed', 'The settings path is given'],
    dependsOn: ['T5', 'T7'],
    forAgent: true
  },
  {
    key: 'T10',
    title: 'Publish script for a single-file exe',
    description:
      'publish.ps1 runs dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true.',
    milestone: 'M5',
    priority: 'low',
    labels: ['release'],
    checklist: ['The script produces one exe'],
    dependsOn: ['T4'],
    forAgent: true
  },
  {
    key: 'H1',
    title: 'Pick an app icon',
    description:
      'Choose a simple tomato or clock icon, 256 px, free to use. Save it to the Library.',
    milestone: 'M5',
    priority: 'low',
    labels: ['design'],
    checklist: ['Licence checked', 'Added to the Library'],
    dependsOn: [],
    forAgent: false
  },
  {
    key: 'H2',
    title: 'Try the timer for a full morning',
    description: 'Use the app for four focus periods and note anything annoying.',
    milestone: 'M5',
    priority: 'medium',
    labels: ['testing'],
    checklist: ['Four focus periods done', 'Notes written as comments here'],
    dependsOn: ['T8'],
    forAgent: false
  }
]

/** What the simulated agent commits for a task: small, plausible, never built by anyone. */
export function simulatedFiles(task: { title: string }): { path: string; content: string }[] {
  const title = task.title.toLowerCase()
  const slug = title
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
  if (title.includes('solution')) {
    return [
      {
        path: 'src/PomodoroDesk.Core/PomodoroDesk.Core.csproj',
        content:
          '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n'
      },
      {
        path: 'src/PomodoroDesk/PomodoroDesk.csproj',
        content:
          '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>WinExe</OutputType>\n    <TargetFramework>net8.0-windows</TargetFramework>\n    <UseWindowsForms>true</UseWindowsForms>\n  </PropertyGroup>\n  <ItemGroup>\n    <ProjectReference Include="..\\PomodoroDesk.Core\\PomodoroDesk.Core.csproj" />\n  </ItemGroup>\n</Project>\n'
      },
      { path: '.gitignore', content: 'bin/\nobj/\n*.user\n.vs/\n' }
    ]
  }
  if (title.includes('state machine') || title.includes('timer')) {
    return [
      {
        path: 'src/PomodoroDesk.Core/PomodoroTimer.cs',
        content:
          'namespace PomodoroDesk.Core;\n\npublic enum Period { Focus, ShortBreak, LongBreak }\n\npublic interface IClock { DateTime Now { get; } }\n\npublic sealed class PomodoroTimer\n{\n    public Period Period { get; private set; } = Period.Focus;\n    public TimeSpan Remaining { get; private set; } = TimeSpan.FromMinutes(25);\n    public int FocusDone { get; private set; }\n}\n'
      }
    ]
  }
  if (
    title.includes('window') ||
    title.includes('keyboard') ||
    title.includes('dialog') ||
    title.includes('tray')
  ) {
    return [
      {
        path: `src/PomodoroDesk/${slug
          .split('-')
          .slice(0, 3)
          .map((part) => part[0].toUpperCase() + part.slice(1))
          .join('')}.cs`,
        content: `namespace PomodoroDesk;\n\n// ${task.title}\ninternal static class ${slug
          .split('-')
          .slice(0, 3)
          .map((part) => part[0].toUpperCase() + part.slice(1))
          .join('')}\n{\n}\n`
      }
    ]
  }
  if (title.includes('readme')) {
    return [
      {
        path: 'README.md',
        content:
          '# Pomodoro Desk\n\nA tiny Windows focus timer.\n\n## Use it\n\n- Space: start or pause\n- R: reset\n- S: skip a break\n\nSettings live in `%APPDATA%\\PomodoroDesk\\settings.json`.\n'
      }
    ]
  }
  return [
    { path: `docs/notes/${slug}.md`, content: `# ${task.title}\n\nDone by the simulated agent.\n` }
  ]
}
