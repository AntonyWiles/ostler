import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PlanningPriority, PlanningWorkItemStatus } from '@shared/ostler-api'
import { TASK_PRIORITIES, TASK_STATUSES } from '@shared/task-labels'
import { isoDaysBetween, shiftIsoDate, todayIsoDate } from '@shared/dates'
import { PROJECT_COLORS } from '@shared/project-colors'
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  Combobox,
  ContextMenu,
  CalendarGrid,
  TimelineGrid,
  timelineRange,
  type TimelineBarSpec,
  type TimelineZoom,
  DataTable,
  ChartFrame,
  BarChart,
  LineChart,
  StackedAreaChart,
  sortRows,
  type DataTableColumn,
  type DataTableEntry,
  type SortKey,
  DateField,
  Dialog,
  Drawer,
  EmptyState,
  IconButton,
  InlineAlert,
  Kbd,
  Menu,
  NumberField,
  PageHeader,
  Popover,
  PriorityIcon,
  ProgressBar,
  Radio,
  RadioGroup,
  SearchField,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  StatusBadge,
  Switch,
  Tabs,
  TextArea,
  TextField,
  Toolbar,
  Tooltip,
  VisuallyHidden,
  toIsoDate,
  addDays,
  useConfirm,
  useToast,
  type MenuEntry
} from '../../ui'
import { Columns3, Copy, Inbox, Pencil, Plus, Settings, Sparkles, Trash2 } from '../../ui/icons'
import { StaticPeopleProvider } from '../../context/PeopleContext'
import { AssigneeField } from '../planning/AssigneeField'
import { TaskChecklistEditor } from '../planning/TaskChecklistEditor'
import { ActivityList, CommentComposer } from '../planning/ActivityList'
import type { ActivityEntry } from '@shared/ostler-api'
import './UiGallery.css'

type Theme = 'light' | 'dark'
type Density = 'comfortable' | 'compact'

/**
 * Previews a theme and density on <html> while the gallery is open (overlays
 * render into document.body, so a wrapper attribute would miss them), and
 * puts the app's own appearance back on the way out. Nothing is saved.
 */
function usePreviewAppearance(theme: Theme, density: Density) {
  const saved = useRef<{ theme?: string; density?: string; scheme: string } | null>(null)
  useEffect(() => {
    const root = document.documentElement
    saved.current = {
      theme: root.dataset.theme,
      density: root.dataset.density,
      scheme: root.style.colorScheme
    }
    return () => {
      const before = saved.current
      if (!before) return
      if (before.theme) root.dataset.theme = before.theme
      if (before.density) root.dataset.density = before.density
      root.style.colorScheme = before.scheme
    }
  }, [])
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.density = density
    root.style.colorScheme = theme
  }, [theme, density])
}

function Specimen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Section title={name} headingLevel={2} className="ui-gallery__specimen">
      <div className="ui-gallery__row">{children}</div>
    </Section>
  )
}

const MENU_ITEMS: MenuEntry[] = [
  { label: 'Edit', icon: Pencil, shortcut: 'E', onSelect: () => {} },
  { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl+D', onSelect: () => {} },
  {
    label: 'Move to board',
    icon: Columns3,
    disabled: true,
    hint: 'Already on the board',
    onSelect: () => {}
  },
  { type: 'separator' },
  {
    type: 'group',
    label: 'Danger zone',
    items: [{ label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => {} }]
  }
]

const PEOPLE = [
  { name: 'Ada Lovelace' },
  { name: 'Grace Hopper' },
  { name: 'Alan Turing' },
  { name: 'Katherine Johnson' },
  { name: 'Edsger Dijkstra' }
]

const LABEL_OPTIONS = [
  { value: 'design', label: 'Design', description: 'Look and feel' },
  { value: 'bug', label: 'Bug' },
  { value: 'docs', label: 'Documentation' },
  { value: 'perf', label: 'Performance' },
  { value: 'legacy', label: 'Legacy', disabled: true }
]

/**
 * Every component in src/renderer/ui/ in every variant and state. Development
 * builds only (/dev/ui, or "Developer: UI gallery" in Ctrl+K). A package that
 * adds or changes a component adds it here.
 */
export function UiGallery() {
  const [theme, setTheme] = useState<Theme>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  )
  const [density, setDensity] = useState<Density>(
    document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable'
  )
  usePreviewAppearance(theme, density)

  const confirm = useConfirm()
  const { toast, toastUndo } = useToast()
  const [segment, setSegment] = useState<'board' | 'list' | 'calendar'>('board')
  const [tab, setTab] = useState<'overview' | 'tasks' | 'files' | 'archived'>('overview')
  const [text, setText] = useState('Ship the gallery')
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState('Grows as you type, up to a maximum.')
  const [points, setPoints] = useState<number | null>(3)
  const [label, setLabel] = useState<string | null>('design')
  const [labels, setLabels] = useState(LABEL_OPTIONS)
  const [due, setDue] = useState(toIsoDate(addDays(new Date(), 1)))
  const [overdue, setOverdue] = useState(toIsoDate(addDays(new Date(), -2)))
  const [checked, setChecked] = useState(true)
  const [on, setOn] = useState(true)
  const [radio, setRadio] = useState('weekly')
  const [pressed, setPressed] = useState(false)
  const [dialogSize, setDialogSize] = useState<'sm' | 'md' | 'lg' | 'full' | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [chips, setChips] = useState(['Design', 'Frontend', 'Accessibility'])
  const [alertShown, setAlertShown] = useState(true)
  const [lastConfirm, setLastConfirm] = useState<string>('Not asked yet')
  const popoverAnchor = useRef<HTMLButtonElement>(null)

  return (
    <div className="ui-gallery">
      <PageHeader
        title="UI gallery"
        subtitle="Every component in src/renderer/ui/, in every variant and state. Development builds only."
        actions={
          <>
            <SegmentedControl
              label="Theme"
              size="sm"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ]}
            />
            <SegmentedControl
              label="Density"
              size="sm"
              value={density}
              onChange={setDensity}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' }
              ]}
            />
          </>
        }
      />

      <div className="ui-gallery__body">
        <Specimen name="Button">
          <div className="ui-gallery__grid">
            {(['primary', 'secondary', 'ghost', 'danger', 'ai'] as const).map((variant) => (
              <div key={variant} className="ui-gallery__row">
                <Button variant={variant}>
                  {variant === 'ai'
                    ? 'Draft with AI'
                    : `${variant[0].toUpperCase()}${variant.slice(1)}`}
                </Button>
                <Button variant={variant} size="sm" icon={Plus}>
                  Small
                </Button>
                <Button variant={variant} size="lg">
                  Large
                </Button>
                <Button variant={variant} loading>
                  Loading
                </Button>
                <Button variant={variant} disabled>
                  Disabled
                </Button>
                <Button variant={variant} disabled disabledReason="Add a title first">
                  With reason
                </Button>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen name="IconButton">
          <IconButton label="Settings" icon={Settings} />
          <IconButton label="Settings" icon={Settings} size="sm" />
          <IconButton label="Copy" icon={Copy} variant="secondary" />
          <IconButton label="Delete" icon={Trash2} variant="danger" />
          <IconButton
            label="Show AI suggestions"
            icon={Sparkles}
            pressed={pressed}
            onClick={() => setPressed(!pressed)}
          />
          <IconButton label="Disabled" icon={Pencil} disabled />
        </Specimen>

        <Specimen name="SegmentedControl">
          <SegmentedControl
            label="View"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'board', label: 'Board', icon: Columns3 },
              { value: 'list', label: 'List' },
              { value: 'calendar', label: 'Calendar', disabled: true }
            ]}
          />
          <SegmentedControl
            label="View (small)"
            size="sm"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'board', label: 'Board' },
              { value: 'list', label: 'List' },
              { value: 'calendar', label: 'Calendar' }
            ]}
          />
        </Specimen>

        <Specimen name="TextField, TextArea, NumberField, SearchField">
          <div className="ui-gallery__fields">
            <TextField
              label="Title"
              hint="Shown on the card."
              value={text}
              onChange={(event) => setText(event.target.value)}
              clearable
            />
            <TextField label="Budget" prefix="£" suffix="per month" defaultValue="120" />
            <TextField label="Name" error="A name is required." defaultValue="" />
            <TextField label="Disabled" disabled defaultValue="Read only for now" />
            <TextArea
              label="Notes"
              hint="Auto-grows up to six lines."
              maxRows={6}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <TextArea label="With an error" error="Too long." defaultValue="…" rows={2} />
            <NumberField
              label="Estimate"
              unit="pts"
              min={0}
              max={100}
              value={points}
              onChange={setPoints}
            />
            <NumberField label="Disabled number" unit="h" value={2} onChange={() => {}} disabled />
            <SearchField
              label="Search tasks"
              placeholder="Search tasks"
              slashShortcut
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </Specimen>

        <Specimen name="Select, Combobox, DateField">
          <div className="ui-gallery__fields">
            <Select
              label="Priority"
              defaultValue="medium"
              options={TASK_PRIORITIES.map((value) => ({ value, label: value }))}
            />
            <Select label="Small select" size="sm" options={[{ value: 'a', label: 'Option A' }]} />
            <Select label="Error" error="Pick one." options={[{ value: '', label: 'Choose…' }]} />
            <Select
              label="Disabled select"
              disabled
              options={[{ value: 'a', label: 'Option A' }]}
            />
            <Combobox
              label="Label"
              hint="Type to filter, or create a new one."
              options={labels}
              value={label}
              onChange={setLabel}
              onCreate={(name) => {
                const value = name.toLowerCase()
                setLabels((current) => [...current, { value, label: name }])
                setLabel(value)
              }}
            />
            <Combobox
              label="Disabled combobox"
              options={labels}
              value={null}
              onChange={() => {}}
              disabled
            />
            <DateField label="Due date" value={due} onChange={setDue} />
            <DateField label="Overdue" value={overdue} onChange={setOverdue} />
            <DateField label="Disabled date" value="" onChange={() => {}} disabled />
          </div>
        </Specimen>

        <Specimen name="Checkbox, Switch, Radio">
          <div className="ui-gallery__stack">
            <Checkbox
              label="Checked"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <Checkbox label="Indeterminate" indeterminate readOnly checked={false} />
            <Checkbox label="With a hint" hint="Helper text under the label." />
            <Checkbox label="Disabled" disabled />
            <Switch
              label="Run queued tasks automatically"
              checked={on}
              onChange={(event) => setOn(event.target.checked)}
            />
            <Switch label="Disabled switch" disabled />
          </div>
          <RadioGroup legend="Digest">
            {['daily', 'weekly', 'never'].map((value) => (
              <Radio
                key={value}
                name="gallery-digest"
                value={value}
                label={value[0].toUpperCase() + value.slice(1)}
                checked={radio === value}
                onChange={() => setRadio(value)}
              />
            ))}
            <Radio name="gallery-digest" value="hourly" label="Hourly (disabled)" disabled />
          </RadioGroup>
        </Specimen>

        <Specimen name="DataTable (P5.3)">
          <DataTableSpecimen />
        </Specimen>

        <Specimen name="CalendarGrid (P5.4)">
          <CalendarGridSpecimen />
        </Specimen>

        <Specimen name="TimelineGrid (P5.5)">
          <TimelineGridSpecimen />
        </Specimen>

        <Specimen name="Charts (P6.2)">
          <ChartsSpecimen />
        </Specimen>

        <Specimen name="Tabs">
          <Tabs
            label="Project sections"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'overview', label: 'Overview', content: <p>Overview panel.</p> },
              { value: 'tasks', label: 'Tasks', badge: 12, content: <p>Tasks panel.</p> },
              { value: 'files', label: 'Files', content: <p>Files panel.</p> },
              { value: 'archived', label: 'Archived', disabled: true, content: null }
            ]}
          />
        </Specimen>

        <Specimen name="Dialog, Drawer, Popover, confirm">
          {(['sm', 'md', 'lg', 'full'] as const).map((size) => (
            <Button key={size} onClick={() => setDialogSize(size)}>
              Dialog {size}
            </Button>
          ))}
          <Button onClick={() => setDrawerOpen(true)}>Drawer</Button>
          <Button ref={popoverAnchor} onClick={() => setPopoverOpen((open) => !open)}>
            Popover
          </Button>
          <Button
            onClick={async () =>
              setLastConfirm(
                (await confirm({
                  title: 'Delete decision "Use SQLite"?',
                  body: 'This removes the record permanently.',
                  confirmLabel: 'Delete decision',
                  tone: 'danger'
                }))
                  ? 'Confirmed'
                  : 'Cancelled'
              )
            }
          >
            Confirm (danger)
          </Button>
          <Button
            onClick={async () =>
              setLastConfirm(
                (await confirm({
                  title: 'Apply this reconciliation?',
                  body: 'Your folder stays as it is.',
                  confirmLabel: 'Apply reconciliation'
                }))
                  ? 'Confirmed'
                  : 'Cancelled'
              )
            }
          >
            Confirm (default)
          </Button>
          <span className="ui-gallery__note">Last answer: {lastConfirm}</span>
          <Dialog
            open={dialogSize !== null}
            onClose={() => setDialogSize(null)}
            size={dialogSize ?? 'md'}
            title="New milestone"
            description="A dated checkpoint for a group of tasks."
            footer={
              <>
                <Button onClick={() => setDialogSize(null)}>Cancel</Button>
                <Button variant="primary" onClick={() => setDialogSize(null)}>
                  Create milestone
                </Button>
              </>
            }
          >
            <div className="ui-gallery__fields">
              <TextField label="Milestone name" data-autofocus />
              <DateField label="Due date" value={due} onChange={setDue} />
            </div>
          </Dialog>
          <Drawer
            id="gallery"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            headerStart={<StatusBadge status="active" />}
            title="Render planning cards"
            description="Drag the left edge to resize; the width is remembered."
            actions={<Menu label="Task actions" items={MENU_ITEMS} />}
            footer={<Button onClick={() => setDrawerOpen(false)}>Close</Button>}
          >
            <StatusBadge status="active" />
          </Drawer>
          <Popover
            open={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            anchorRef={popoverAnchor}
            label="Filter options"
          >
            <div className="ui-gallery__stack">
              <Checkbox label="Only mine" />
              <Checkbox label="Hide done" />
            </div>
          </Popover>
        </Specimen>

        <Specimen name="Menu, ContextMenu, Tooltip">
          <Menu label="More actions" items={MENU_ITEMS} />
          <Menu
            label="Sort by"
            items={MENU_ITEMS}
            renderTrigger={(props) => <Button {...props}>Custom trigger</Button>}
          />
          <ContextMenu label="Card actions" items={MENU_ITEMS}>
            <Card
              interactive
              tabIndex={0}
              aria-label="Right-click me"
              className="ui-gallery__context"
            >
              Right-click, Shift+F10 or the Menu key
            </Card>
          </ContextMenu>
          <Tooltip content="Opens on hover after 400 ms, at once on focus">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </Specimen>

        <Specimen name="Toast">
          <Button onClick={() => toast({ title: 'Saved', tone: 'success' })}>Success</Button>
          <Button
            onClick={() =>
              toast({ title: 'Heads up', body: 'Something worth knowing.', tone: 'info' })
            }
          >
            Info
          </Button>
          <Button onClick={() => toast({ title: 'Disk almost full', tone: 'warning' })}>
            Warning
          </Button>
          <Button
            onClick={() =>
              toast({
                title: 'Could not sync',
                body: 'The data folder is read-only.',
                tone: 'danger',
                action: { label: 'Retry', onClick: () => {} }
              })
            }
          >
            Danger with action
          </Button>
          <Button
            onClick={() =>
              toastUndo('Moved "Render cards" to the recycle bin', () => {
                toast({ title: 'Restored' })
              })
            }
          >
            Undo (Ctrl+Z)
          </Button>
        </Specimen>

        <Specimen name="InlineAlert">
          <div className="ui-gallery__stack ui-gallery__wide">
            <InlineAlert tone="info" title="Info">
              Agents are off for this project.
            </InlineAlert>
            <InlineAlert tone="success">Backup created.</InlineAlert>
            <InlineAlert
              tone="warning"
              title="Unsaved changes"
              action={{ label: 'Save', onClick: () => {} }}
            >
              Your edits are only in this window.
            </InlineAlert>
            {alertShown && (
              <InlineAlert
                tone="danger"
                title="Could not load the board"
                onDismiss={() => setAlertShown(false)}
              >
                The database is locked by another process.
              </InlineAlert>
            )}
          </div>
        </Specimen>

        <Specimen name="Badge, StatusBadge, PriorityIcon">
          <div className="ui-gallery__stack">
            <div className="ui-gallery__row">
              {(['neutral', 'accent', 'info', 'success', 'warning', 'danger'] as const).map(
                (tone) => (
                  <Badge key={tone} tone={tone}>
                    {tone}
                  </Badge>
                )
              )}
              <Badge tone="accent" icon={Sparkles}>
                With icon
              </Badge>
            </div>
            <div className="ui-gallery__row">
              {TASK_STATUSES.map((status: PlanningWorkItemStatus) => (
                <StatusBadge key={status} status={status} />
              ))}
            </div>
            <div className="ui-gallery__row">
              {TASK_STATUSES.map((status) => (
                <StatusBadge key={status} status={status} iconOnly />
              ))}
            </div>
            <div className="ui-gallery__row">
              {TASK_PRIORITIES.map((priority: PlanningPriority) => (
                <PriorityIcon key={priority} priority={priority} showLabel />
              ))}
              {TASK_PRIORITIES.map((priority) => (
                <PriorityIcon key={`${priority}-icon`} priority={priority} />
              ))}
            </div>
          </div>
        </Specimen>

        <Specimen name="Chip, Avatar, AvatarGroup">
          {chips.map((chip, index) => (
            <Chip
              key={chip}
              color={`var(--chart-${index + 1})`}
              onRemove={() => setChips((current) => current.filter((c) => c !== chip))}
            >
              {chip}
            </Chip>
          ))}
          <Chip selected>Selected</Chip>
          <Avatar name="Ada Lovelace" size="sm" />
          <Avatar name="Grace Hopper" />
          <Avatar name="Ostler" size="lg" />
          <AvatarGroup people={PEOPLE} max={3} />
        </Specimen>

        <Specimen name="AssigneeField, TaskChecklistEditor (P5.1)">
          <TaskEssentialsSpecimen />
        </Specimen>

        <Specimen name="CommentComposer, ActivityList (P5.2)">
          <ActivitySpecimen />
        </Specimen>

        <Specimen name="Card, EmptyState">
          <Card className="ui-gallery__card">A plain card.</Card>
          <Card
            interactive
            className="ui-gallery__card"
            onClick={() => toast({ title: 'Card opened' })}
            aria-label="Open card"
          >
            Interactive: hover, focus, Enter.
          </Card>
          <Card selected className="ui-gallery__card">
            Selected
          </Card>
          <Card className="ui-gallery__wide" padding="none">
            <EmptyState
              icon={Inbox}
              title="No tasks yet"
              description="Tasks are the steps of your project."
              action={
                <Button variant="primary" icon={Plus}>
                  New task
                </Button>
              }
              secondaryAction={<Button variant="ghost">Import from a file</Button>}
            />
          </Card>
        </Specimen>

        <Specimen name="Skeleton, Spinner, ProgressBar">
          <div className="ui-gallery__stack ui-gallery__wide">
            <Skeleton lines={3} />
            <div className="ui-gallery__row">
              <Skeleton shape="circle" />
              <Skeleton shape="block" width="12rem" />
            </div>
            <div className="ui-gallery__row">
              <Spinner size="sm" label="Saving" />
              <Spinner label="Loading" />
              <Spinner size="lg" label="Working" />
            </div>
            <ProgressBar label="Checklist" value={3} max={5} valueText="3 of 5" showLabel />
            <ProgressBar label="Upload" value={80} tone="success" showLabel />
            <ProgressBar label="Over budget" value={100} tone="danger" />
            <ProgressBar label="Indexing" showLabel />
          </div>
        </Specimen>

        <Specimen name="Kbd">
          <Kbd shortcut="Ctrl+K" />
          <Kbd shortcut="Ctrl+Shift+P" />
          <Kbd shortcut="/" />
          <Kbd shortcut="Ctrl++" />
        </Specimen>

        <Specimen name="PageHeader, Toolbar, Section">
          <div className="ui-gallery__stack ui-gallery__wide">
            <Card padding="none">
              <PageHeader
                title="Website relaunch"
                subtitle="12 open tasks · due Friday"
                actions={
                  <Button variant="primary" icon={Plus}>
                    New task
                  </Button>
                }
              />
            </Card>
            <Toolbar
              label="Board filters"
              overflow={MENU_ITEMS}
              end={<span className="ui-gallery__note">12 tasks</span>}
            >
              <SearchField label="Filter tasks" placeholder="Filter tasks" />
              <Button size="sm">Assignee</Button>
              <Button size="sm">Label</Button>
            </Toolbar>
            <Section
              title="Milestones"
              description="Dated checkpoints."
              actions={
                <Button size="sm" variant="ghost" icon={Plus}>
                  Add
                </Button>
              }
              headingLevel={3}
            >
              <p>Section content.</p>
            </Section>
          </div>
        </Specimen>

        <Specimen name="VisuallyHidden, Portal">
          <p>
            Screen readers hear more here:{' '}
            <VisuallyHidden>(this text is visually hidden)</VisuallyHidden>
            Portal renders every overlay above into document.body.
          </p>
        </Specimen>
      </div>
    </div>
  )
}

const GALLERY_PEOPLE = [
  {
    id: 'me',
    name: 'Ada Lovelace',
    initials: 'AL',
    color: PROJECT_COLORS[1],
    isMe: true,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: 'grace',
    name: 'Grace Hopper',
    initials: 'GH',
    color: PROJECT_COLORS[4],
    isMe: false,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 0,
    updatedAt: 0
  }
]

/** The task drawer's assignee picker and tickable checklist, with sample people. */
const GALLERY_ACTIVITY: ActivityEntry[] = [
  ['agent', 'Built-in agent', 'Built-in agent submitted its report', 4],
  ['automation', 'Automation API', 'Automation API added the label design', 60],
  ['system', 'Ostler', 'Ostler archived the task', 60 * 26],
  ['unknown', 'Someone', 'Someone moved the task from Ready to In progress', 60 * 24 * 9]
].map(([kind, name, summary, minutes], index) => ({
  id: `gallery-${index}`,
  kind: kind === 'agent' ? 'agent' : 'change',
  projectId: 'gallery',
  workItemId: 'gallery-task',
  workItemTitle: 'Write the launch post',
  at: Date.now() - Number(minutes) * 60_000,
  actor: { kind: kind as ActivityEntry['actor']['kind'], personId: null, name: String(name) },
  summary: String(summary)
}))

function ActivitySpecimen() {
  const [entries, setEntries] = useState(GALLERY_ACTIVITY)
  return (
    <StaticPeopleProvider people={GALLERY_PEOPLE}>
      <div className="ui-gallery__stack ui-gallery__wide">
        <CommentComposer
          onSubmit={async (body) => {
            setEntries((current) => [
              {
                ...current[0],
                id: `gallery-comment-${current.length}`,
                kind: 'comment',
                at: Date.now(),
                actor: { kind: 'human', personId: null, name: 'You' },
                summary: `You commented: ${body}`
              },
              ...current
            ])
            return true
          }}
        />
        <ActivityList
          entries={entries}
          onChanged={() => {}}
          onError={() => {}}
          onOpenTask={() => {}}
        />
      </div>
    </StaticPeopleProvider>
  )
}

function TaskEssentialsSpecimen() {
  const [assignee, setAssignee] = useState<string | null>(null)
  const [items, setItems] = useState(['Write the brief', 'Review with the team', 'Publish'])
  const [checked, setChecked] = useState(['Write the brief'])
  return (
    <StaticPeopleProvider people={GALLERY_PEOPLE}>
      <div className="ui-gallery__stack ui-gallery__wide">
        <AssigneeField projectId={null} value={assignee} onChange={setAssignee} />
        <TaskChecklistEditor
          items={items}
          onChange={setItems}
          saved={['Write the brief', 'Review with the team', 'Publish']}
          checked={checked}
          onCheck={(text, on) =>
            setChecked((current) =>
              on ? [...current, text] : current.filter((entry) => entry !== text)
            )
          }
        />
      </div>
    </StaticPeopleProvider>
  )
}

interface GalleryRow {
  id: string
  name: string
  team: string
  hours: number
}

const GALLERY_ROWS: GalleryRow[] = Array.from({ length: 500 }, (_, index) => ({
  id: `row-${index}`,
  name: `Task ${index + 1}`,
  team: ['Design', 'Build', 'Launch'][index % 3],
  hours: (index * 7) % 13
}))

const GALLERY_COLUMNS: DataTableColumn<GalleryRow>[] = [
  {
    id: 'name',
    header: 'Name',
    width: 220,
    compare: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    cell: (row) => row.name
  },
  {
    id: 'team',
    header: 'Team',
    compare: (a, b) => a.team.localeCompare(b.team),
    cell: (row) => row.team
  },
  {
    id: 'hours',
    header: 'Hours',
    width: 100,
    align: 'end',
    compare: (a, b) => a.hours - b.hours,
    cell: (row) => `${row.hours} h`
  }
]

/** 500 rows in three collapsible groups, sortable, selectable and rearrangeable. */
function DataTableSpecimen() {
  const [sort, setSort] = useState<SortKey[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [order, setOrder] = useState(GALLERY_COLUMNS.map((column) => column.id))
  const [widths, setWidths] = useState<Record<string, number>>({})
  const comparers = Object.fromEntries(
    GALLERY_COLUMNS.map((column) => [column.id, column.compare && { compare: column.compare }])
  )
  const entries: DataTableEntry<GalleryRow>[] = ['Design', 'Build', 'Launch'].flatMap((team) => {
    const rows = sortRows(
      GALLERY_ROWS.filter((row) => row.team === team),
      sort,
      comparers
    )
    const isCollapsed = collapsed.includes(team)
    return [
      {
        kind: 'group' as const,
        id: team,
        label: team,
        count: rows.length,
        aggregate: `${rows.reduce((sum, row) => sum + row.hours, 0)} h`,
        collapsed: isCollapsed
      },
      ...(isCollapsed
        ? []
        : rows.map((row) => ({ kind: 'row' as const, id: row.id, row, label: row.name })))
    ]
  })
  return (
    <div className="ui-gallery__table">
      <DataTable
        label="Gallery tasks"
        columns={order.map((id) => GALLERY_COLUMNS.find((column) => column.id === id)!)}
        entries={entries}
        sort={sort}
        onSortChange={setSort}
        selectable
        selectedIds={new Set(selected)}
        onSelectionChange={setSelected}
        onToggleGroup={(id) =>
          setCollapsed((current) =>
            current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
          )
        }
        widths={widths}
        onColumnResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
        onColumnMove={(id, to) =>
          setOrder((current) => {
            const next = current.filter((entry) => entry !== id)
            next.splice(to, 0, id)
            return next
          })
        }
      />
    </div>
  )
}

interface GalleryEvent {
  id: string
  start: string
  end: string
  title: string
}

/** A month with single days, a bar across a week boundary and a crowded day. */
function CalendarGridSpecimen() {
  const today = todayIsoDate()
  const [focused, setFocused] = useState(today)
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [events, setEvents] = useState<GalleryEvent[]>(() => [
    {
      id: 'trip',
      start: shiftIsoDate(today, -2),
      end: shiftIsoDate(today, 4),
      title: 'Site visit'
    },
    { id: 'a', start: today, end: today, title: 'Call the venue' },
    { id: 'b', start: today, end: today, title: 'Order badges' },
    { id: 'c', start: today, end: today, title: 'Draft agenda' },
    { id: 'd', start: today, end: today, title: 'Book caterer' },
    { id: 'e', start: shiftIsoDate(today, 9), end: shiftIsoDate(today, 9), title: 'Rehearsal' }
  ])
  return (
    <div className="ui-gallery__calendar">
      <SegmentedControl
        label="Calendar period"
        size="sm"
        options={[
          { value: 'month', label: 'Month' },
          { value: 'week', label: 'Week' }
        ]}
        value={mode}
        onChange={setMode}
      />
      <CalendarGrid<GalleryEvent>
        label="Gallery calendar"
        mode={mode}
        focusedDate={focused}
        onFocusedDateChange={setFocused}
        today={today}
        items={events}
        canDrag={() => true}
        onDrop={(date, drop) =>
          setEvents((current) =>
            current.map((event) => {
              if (event.id !== drop.itemId) return event
              const from = drop.grabbedDate ?? event.end
              const days = isoDaysBetween(from, date)
              return {
                ...event,
                start: shiftIsoDate(event.start, days),
                end: shiftIsoDate(event.end, days)
              }
            })
          )
        }
        renderItem={(event, place) => (
          <button type="button" className="ui-gallery__event" tabIndex={place.tabbable ? 0 : -1}>
            {event.title}
          </button>
        )}
      />
    </div>
  )
}

interface GalleryPhase {
  id: string
  title: string
  bar: TimelineBarSpec
}

/** Three phases with a dependency between each, one starting too early, at any zoom. */
function TimelineGridSpecimen() {
  const today = todayIsoDate()
  const [zoom, setZoom] = useState<TimelineZoom>('week')
  const [phases, setPhases] = useState<GalleryPhase[]>(() => [
    {
      id: 'plan',
      title: 'Plan the day',
      bar: {
        id: 'plan',
        start: shiftIsoDate(today, -3),
        end: shiftIsoDate(today, 2),
        editable: true
      }
    },
    {
      id: 'book',
      title: 'Book the venue',
      bar: {
        id: 'book',
        start: shiftIsoDate(today, 1),
        end: shiftIsoDate(today, 6),
        editable: true
      }
    },
    {
      id: 'invite',
      title: 'Send invitations',
      bar: {
        id: 'invite',
        start: shiftIsoDate(today, 8),
        end: shiftIsoDate(today, 8),
        editable: true
      }
    }
  ])
  const dates = phases.flatMap((phase) => [phase.bar.start, phase.bar.end])
  return (
    <div className="ui-gallery__timeline">
      <SegmentedControl
        label="Timeline zoom"
        size="sm"
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' }
        ]}
        value={zoom}
        onChange={setZoom}
      />
      <TimelineGrid<GalleryPhase, TimelineBarSpec>
        label="Gallery timeline"
        labelHeader="Phase"
        className="ui-gallery__timeline-grid"
        rows={phases}
        getRowId={(phase) => phase.id}
        renderLabel={(phase) => <span className="ui-gallery__timeline-label">{phase.title}</span>}
        barsFor={(phase) => [phase.bar]}
        renderBar={(_bar, box) => (
          <rect
            className="ui-gallery__timeline-bar"
            y={8}
            width={box.width}
            height={box.height - 16}
            rx={4}
          />
        )}
        barLabel={(bar) =>
          `${phases.find((phase) => phase.id === bar.id)?.title}, ${bar.start} to ${bar.end}`
        }
        arrows={[
          {
            id: 'plan->book',
            from: 'plan',
            to: 'book',
            tone: 'warning',
            title: 'Starts before "Plan the day" is due'
          },
          { id: 'book->invite', from: 'book', to: 'invite' }
        ]}
        range={timelineRange(dates, today, zoom)}
        today={today}
        zoom={zoom}
        onZoomChange={setZoom}
        onBarEdit={(bar, edit, days) =>
          setPhases((current) =>
            current.map((phase) =>
              phase.id !== bar.id
                ? phase
                : {
                    ...phase,
                    bar: {
                      ...phase.bar,
                      start: edit === 'end' ? phase.bar.start : shiftIsoDate(phase.bar.start, days),
                      end: edit === 'start' ? phase.bar.end : shiftIsoDate(phase.bar.end, days)
                    }
                  }
            )
          )
        }
      />
    </div>
  )
}

const CHART_DAYS = Array.from({ length: 14 }, (_, index) =>
  shiftIsoDate(todayIsoDate(), index - 13)
)

/** Each chart in its frame, with made-up numbers: the six chart colours in use. */
function ChartsSpecimen() {
  const scope = CHART_DAYS.map((_, index) => 8 + Math.floor(index / 4) * 2)
  const done = CHART_DAYS.map((_, index) => Math.min(scope[index], Math.floor(index * 0.8)))
  const statuses = ['Done', 'In review', 'Blocked', 'In progress', 'Ready', 'Backlog']
  const flow = statuses.map((label, slot) => ({
    id: label,
    label,
    color: [3, 2, 4, 5, 1, 6][slot],
    values: CHART_DAYS.map((_, index) =>
      slot === 0 ? index : Math.max(0, 3 + ((index + slot) % 3) - (slot === 5 ? index / 5 : 0))
    )
  }))
  const weeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4']
  const finished = [3, 5, 2, 6]
  return (
    <div style={{ display: 'grid', gap: 'var(--space-400)' }}>
      <ChartFrame
        title="Burn-up"
        summary="Done is rising slower than scope: 6 tasks added in the last 14 days, 10 finished."
        legend={[
          { label: 'Scope (tasks)', color: 2, dashed: true },
          { label: 'Done (tasks)', color: 3 }
        ]}
        table={{
          columns: [
            { id: 'day', header: 'Day', cell: (row: { day: string }) => row.day },
            { id: 'scope', header: 'Scope', cell: (row: { scope: number }) => String(row.scope) },
            { id: 'done', header: 'Done', cell: (row: { done: number }) => String(row.done) }
          ] as DataTableColumn<{ day: string; scope: number; done: number }>[],
          rows: CHART_DAYS.map((day, index) => ({
            id: day,
            label: day,
            row: { day, scope: scope[index], done: done[index] }
          }))
        }}
      >
        <LineChart
          categories={CHART_DAYS}
          series={[
            { id: 'scope', label: 'Scope', color: 2, values: scope, dashed: true },
            { id: 'done', label: 'Done', color: 3, values: done, area: true }
          ]}
        />
      </ChartFrame>
      <ChartFrame
        title="Cumulative flow"
        summary="Work in progress held at 9 tasks in the last 14 days, while done rose by 13."
        legend={[...flow].reverse().map((item) => ({ label: item.label, color: item.color }))}
        table={{
          columns: [{ id: 'day', header: 'Day', cell: (row: { day: string }) => row.day }],
          rows: CHART_DAYS.map((day) => ({ id: day, label: day, row: { day } }))
        }}
      >
        <StackedAreaChart categories={CHART_DAYS} series={flow} />
      </ChartFrame>
      <ChartFrame
        title="Throughput"
        summary="16 tasks finished in the last 4 weeks, about 4 a week."
        legend={[{ label: 'Tasks finished per week', color: 1 }]}
        table={{
          columns: [
            { id: 'week', header: 'Week', cell: (row: { week: string }) => row.week },
            {
              id: 'count',
              header: 'Finished',
              align: 'end',
              cell: (row: { count: number }) => String(row.count)
            }
          ] as DataTableColumn<{ week: string; count: number }>[],
          rows: weeks.map((week, index) => ({
            id: week,
            label: week,
            row: { week, count: finished[index] }
          }))
        }}
      >
        <BarChart
          categories={weeks}
          series={[{ id: 'finished', label: 'Finished', color: 1, values: finished }]}
        />
      </ChartFrame>
      <ChartFrame
        title="Empty"
        summary="Nothing has been finished yet, so there is no throughput to show."
        empty="Finish a task to start counting tasks done per week."
        table={{ columns: [], rows: [] }}
      >
        {null}
      </ChartFrame>
    </div>
  )
}
