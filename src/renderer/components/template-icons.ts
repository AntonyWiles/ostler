import type { TemplateIcon } from '@shared/project-package'
import {
  BookOpen,
  CalendarDays,
  Code,
  File,
  Globe,
  House,
  Megaphone,
  PenLine,
  Rocket,
  Sparkles,
  type LucideIcon
} from '../ui/icons'

/** The glyph for each icon a template may name (P5.8). */
export const TEMPLATE_ICON_GLYPHS: Record<TemplateIcon, LucideIcon> = {
  file: File,
  code: Code,
  globe: Globe,
  megaphone: Megaphone,
  calendar: CalendarDays,
  pen: PenLine,
  rocket: Rocket,
  home: House,
  book: BookOpen,
  sparkles: Sparkles
}
