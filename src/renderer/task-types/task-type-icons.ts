import type { TaskTypeIcon } from '@shared/task-types'
import { t } from '@shared/i18n'
import {
  BookOpen,
  Bug,
  Calendar,
  Car,
  CircleDot,
  ClipboardList,
  Code,
  FileText,
  Flag,
  Flame,
  Gauge,
  GraduationCap,
  Hammer,
  Heart,
  House,
  Leaf,
  Lightbulb,
  ListChecks,
  Lock,
  Mail,
  MessageSquare,
  Package,
  Paintbrush,
  Palette,
  PenTool,
  Phone,
  Plane,
  Rocket,
  Search,
  Server,
  Shield,
  ShoppingCart,
  Sparkles,
  Star,
  Terminal,
  TestTube,
  Truck,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon
} from '../ui/icons'

/**
 * The glyph for each task type icon (N2.7a). A static table: a card looks
 * its type's glyph up once, never builds one, so 500 cards cost 500 lookups.
 */
export const TASK_TYPE_GLYPHS: Record<TaskTypeIcon, LucideIcon> = {
  'circle-dot': CircleDot,
  bug: Bug,
  sparkles: Sparkles,
  wrench: Wrench,
  hammer: Hammer,
  'clipboard-list': ClipboardList,
  'list-checks': ListChecks,
  lightbulb: Lightbulb,
  rocket: Rocket,
  flag: Flag,
  star: Star,
  heart: Heart,
  zap: Zap,
  flame: Flame,
  shield: Shield,
  lock: Lock,
  search: Search,
  gauge: Gauge,
  'test-tube': TestTube,
  code: Code,
  terminal: Terminal,
  server: Server,
  'file-text': FileText,
  'book-open': BookOpen,
  'pen-tool': PenTool,
  paintbrush: Paintbrush,
  palette: Palette,
  phone: Phone,
  mail: Mail,
  'message-square': MessageSquare,
  calendar: Calendar,
  'shopping-cart': ShoppingCart,
  wallet: Wallet,
  house: House,
  car: Car,
  truck: Truck,
  plane: Plane,
  package: Package,
  leaf: Leaf,
  'graduation-cap': GraduationCap
}

/** A type's glyph; an icon this build does not know draws as the default. */
export function taskTypeGlyph(icon: string): LucideIcon {
  return TASK_TYPE_GLYPHS[icon as TaskTypeIcon] ?? CircleDot
}

/** An icon's name for screen readers and search in the picker. */
export function taskTypeIconName(icon: TaskTypeIcon): string {
  return t(`tasks:taskTypes.icons.${icon}`)
}
