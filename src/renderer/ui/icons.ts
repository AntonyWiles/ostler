import { createElement, type ReactElement } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'
import './icons.css'

/**
 * The one import point for icons (D9: lucide-react only). Add an icon here
 * before using it, so the set the app uses stays visible in one place.
 */
export {
  Menu as AppMenu,
  BookOpen,
  ClipboardCheck,
  SkipForward,
  Signpost,
  Bug,
  CircleHelp,
  Gift,
  Keyboard,
  Code,
  Globe,
  Share2,
  LayoutTemplate,
  Download,
  FileDown,
  FileInput,
  FileSpreadsheet,
  FolderOutput,
  Printer,
  Replace,
  Megaphone,
  PenLine,
  Rocket,
  ArrowDownToLine,
  Bell,
  BellOff,
  CheckCheck,
  Mail,
  MailOpen,
  ArrowLeft,
  ArrowRight,
  ArrowUpToLine,
  File,
  FileCode,
  FolderOpen,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  GripVertical,
  HardDrive,
  History,
  Hourglass,
  Image,
  MessageSquare,
  Repeat,
  ShieldAlert,
  SquareTerminal,
  Upload,
  User,
  Wrench,
  Bookmark,
  ChevronUp,
  Clock,
  Link2,
  List,
  ListChecks,
  ListTodo,
  ListTree,
  Network,
  PanelRightOpen,
  Paperclip,
  SlidersHorizontal,
  Tag,
  Archive,
  ArrowDown,
  ArrowUp,
  Ban,
  Gauge,
  Bot,
  CalendarClock,
  CalendarPlus,
  EyeOff,
  Shapes,
  Waypoints,
  CalendarDays,
  CalendarX2,
  ChartGantt,
  Table2,
  BarChart3,
  TrendingUp,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Columns3,
  Columns3Cog,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  ListFilter,
  Layers,
  FileDiff,
  FileText,
  Flag,
  Folder,
  FolderCode,
  FolderKanban,
  GitBranch,
  Hexagon,
  House,
  Inbox,
  Info,
  LayoutDashboard,
  Grid2x2,
  Library,
  Milestone,
  Minus,
  OctagonX,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  IterationCw,
  Pencil,
  Play,
  Square,
  Volume2,
  Timer,
  UsersRound,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  SquareKanban,
  Target,
  Trash2,
  TriangleAlert,
  Undo2,
  /** Mark up a picture (N4.2b). */
  MousePointer2,
  MoveUpRight,
  Highlighter,
  Type,
  Grid3x3,
  Redo2,
  X,
  Zap,
  Lightbulb,
  ListPlus,
  Sunrise,
  Presentation,
  /** Pins and shortcuts (N5.2a). */
  Pin,
  PinOff,
  /** Quote a comment. */
  Quote,
  /** Contacts (N6.5). */
  BookUser,
  /** Copy ID (N9.8a). */
  Hash,
  /** Open in new window (N5.8a). */
  AppWindow,
  /** Pin to desktop (N5.8b). */
  StickyNote
} from 'lucide-react'
/** The task type icons (N2.7a) not used elsewhere; see task-type-icons.ts. */
export { Calendar, Flame, Lock, PenTool, Phone, Shield, Terminal, TestTube } from 'lucide-react'
// New task put aside, and opened again.
export { Maximize2, Minimize2 } from 'lucide-react'
// Paste picture on a task, and Import from clipboard in the Library.
export { ClipboardPaste } from 'lucide-react'
// Nested projects (MOP-32): Move into a project, Move out of it.
export { FolderInput } from 'lucide-react'
// A whiteboard picture whose Library image is missing.
export { ImageOff } from 'lucide-react'
// The whiteboard editor's Hand tool, zoom and fit.
export { Hand, Scan, ZoomIn, ZoomOut } from 'lucide-react'
// The whiteboard editor's drawing tools and shape picker.
export { Diamond, Eraser, Frame, Pen, RectangleHorizontal, Squircle, Triangle } from 'lucide-react'
// The whiteboard's style controls, grouping and right-click menu.
export {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  CornerDownRight,
  Group,
  PaintBucket,
  Scissors,
  Slash,
  Spline,
  SquareDashed,
  Ungroup
} from 'lucide-react'

/** The curated project icons (N5.1) not used elsewhere; see project-icon-glyphs.ts. */
export {
  Baby,
  Bike,
  Briefcase,
  Building2,
  Cake,
  Camera,
  Car,
  Cat,
  ClipboardList,
  Coffee,
  Database,
  Dog,
  Dumbbell,
  Film,
  FlaskConical,
  Flower2,
  Gamepad2,
  GraduationCap,
  Hammer,
  Heart,
  Key,
  Landmark,
  Laptop,
  Leaf,
  Moon,
  Mountain,
  Music,
  Package,
  Paintbrush,
  PawPrint,
  PiggyBank,
  Plane,
  School,
  Server,
  Shirt,
  Ship,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sprout,
  Star,
  Stethoscope,
  Store,
  Sun,
  Tent,
  TrainFront,
  TreePine,
  Trophy,
  Truck,
  Users,
  Utensils,
  Wallet,
  Map as MapIcon
} from 'lucide-react'
export type { LucideIcon } from 'lucide-react'

export interface IconProps extends Omit<LucideProps, 'ref' | 'size'> {
  icon: LucideIcon
  /** 'md' (16 px, beside text) or 'lg' (20 px, icon-only buttons and empty states). */
  size?: 'md' | 'lg'
  /** Names a meaningful icon for assistive tech; without it the icon is decorative. */
  label?: string
}

/**
 * An icon at the design-system size and stroke. Size comes from the
 * --icon-size tokens (icons.css), so density applies; colour is currentColor.
 */
export function Icon({ icon, size = 'md', label, className, ...rest }: IconProps): ReactElement {
  return createElement(icon, {
    ...rest,
    strokeWidth: 1.75,
    absoluteStrokeWidth: false,
    className: ['ostler-icon', size === 'lg' ? 'ostler-icon--lg' : '', className ?? '']
      .filter(Boolean)
      .join(' '),
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })
  })
}

/**
 * Classes for a disclosure's chevron. Use ChevronRight (ChevronDown with
 * 'down') and let it turn as the disclosure opens (icons.css), instead of
 * swapping icons.
 */
export function chevronClass(open: boolean, points: 'right' | 'down' = 'right'): string {
  return ['ui-chevron', points === 'down' ? 'ui-chevron--down' : '', open ? 'is-open' : '']
    .filter(Boolean)
    .join(' ')
}
