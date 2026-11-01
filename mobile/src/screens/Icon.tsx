import Svg, { Circle, Path } from 'react-native-svg'

/**
 * The few icons the phone draws, copied from Lucide (the desktop's icon set, `lucide-react`) so
 * the two look alike. Text glyphs such as ⚙ render as emoji or in odd sizes on Android.
 */
const ICONS = {
  settings: (
    <>
      <Path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  'arrow-left': (
    <>
      <Path d="m12 19-7-7 7-7" />
      <Path d="M19 12H5" />
    </>
  ),
  'ellipsis-vertical': (
    <>
      <Circle cx="12" cy="12" r="1" />
      <Circle cx="12" cy="5" r="1" />
      <Circle cx="12" cy="19" r="1" />
    </>
  ),
  plus: (
    <>
      <Path d="M5 12h14" />
      <Path d="M12 5v14" />
    </>
  ),
  archive: (
    <>
      <Path d="M3 3h18v5H3z" />
      <Path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <Path d="M10 12h4" />
    </>
  ),
  mail: (
    <>
      <Path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <Path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </>
  ),
  'mail-open': (
    <>
      <Path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z" />
      <Path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10" />
    </>
  ),
  'check-check': (
    <>
      <Path d="M18 6 7 17l-5-5" />
      <Path d="m22 10-7.5 7.5L13 16" />
    </>
  ),
  search: (
    <>
      <Path d="m21 21-4.34-4.34" />
      <Circle cx="11" cy="11" r="8" />
    </>
  ),
  x: (
    <>
      <Path d="M18 6 6 18" />
      <Path d="m6 6 12 12" />
    </>
  ),
  'chevron-left': <Path d="m15 18-6-6 6-6" />,
  'chevron-right': <Path d="m9 18 6-6-6-6" />
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </Svg>
  )
}
