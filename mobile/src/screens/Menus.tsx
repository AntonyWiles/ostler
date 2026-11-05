import { useRef, useState, type ComponentRef } from 'react'
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { t } from '@shared/i18n/index'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Icon } from './Icon'

/**
 * The phone's choosing controls. Choices never sit in a row you swipe sideways: one of many is a
 * dropdown that opens a short list under itself, and a screen's sections sit in a side menu,
 * grouped under headings so the menu stays short as features are added.
 */

/** One choice in a dropdown. `count` shows at the right (waiting items, say). */
export interface DropdownOption<T extends string> {
  value: T
  label: string
  count?: number
}

interface DropdownProps<T extends string> {
  theme: Theme
  /** What is being chosen, read out to screen readers and shown in a field. */
  label: string
  value: T
  options: readonly DropdownOption<T>[]
  onChange: (value: T) => void
  /**
   * `inline` (the default) is the current choice as text with a ▾, for a toolbar. `field` is a
   * full-width row, the name at the left and the choice at the right, for a form.
   */
  variant?: 'inline' | 'field'
  /** Shown instead of the chosen option's label when set, for "Label: all" style summaries. */
  text?: string
}

/** One of many: the current choice, which opens the list of choices under itself. */
export function Dropdown<T extends string>({
  theme,
  label,
  value,
  options,
  onChange,
  variant = 'inline',
  text
}: DropdownProps<T>) {
  const anchor = useRef<ComponentRef<typeof View>>(null)
  const [at, setAt] = useState<{ x: number; y: number; width: number } | null>(null)
  const current = options.find((option) => option.value === value)
  const shown = text ?? current?.label ?? ''
  const open = () => {
    anchor.current?.measureInWindow((x, y, width, height) => setAt({ x, y: y + height, width }))
  }
  const screen = Dimensions.get('window')
  const menuWidth = Math.min(280, screen.width - 2 * SPACE.small)
  const left =
    at === null ? 0 : Math.max(SPACE.small, Math.min(at.x, screen.width - menuWidth - SPACE.small))
  // A list that would run off the bottom opens upwards from the bottom edge instead.
  const roomBelow = at === null ? 0 : screen.height - at.y - SPACE.large
  const menuMax = Math.min(screen.height * 0.6, options.length * 48 + SPACE.small)
  const top = at === null ? 0 : roomBelow >= menuMax ? at.y : Math.max(SPACE.large, at.y - menuMax)
  return (
    <>
      <Pressable
        ref={anchor}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityHint={t('mobile:menus.opensChoices')}
        onPress={open}
        hitSlop={6}
        style={({ pressed }) => [
          variant === 'field' ? [styles.field, { borderColor: theme.border }] : styles.inline,
          pressed && { backgroundColor: theme.surfaceSunken }
        ]}
      >
        {variant === 'field' && (
          <Text style={[styles.fieldName, { color: theme.textSecondary }]}>{label}</Text>
        )}
        <Text
          numberOfLines={1}
          style={[
            variant === 'field' ? styles.fieldValue : styles.inlineText,
            { color: variant === 'field' ? theme.text : theme.accent }
          ]}
        >
          {shown}
        </Text>
        <Icon
          name="chevron-down"
          size={16}
          color={variant === 'field' ? theme.textSecondary : theme.accent}
        />
      </Pressable>
      <Modal
        transparent
        visible={at !== null}
        animationType="fade"
        onRequestClose={() => setAt(null)}
      >
        <Pressable
          accessibilityLabel={t('mobile:nav.closeMenu')}
          style={styles.scrim}
          onPress={() => setAt(null)}
        >
          <View
            accessibilityRole="menu"
            style={[
              styles.menu,
              {
                top,
                left,
                width: menuWidth,
                maxHeight: menuMax,
                backgroundColor: theme.surface,
                borderColor: theme.border
              }
            ]}
          >
            <ScrollView>
              {options.map((option) => (
                <MenuRow
                  key={option.value}
                  theme={theme}
                  label={option.label}
                  count={option.count}
                  selected={option.value === value}
                  onPress={() => {
                    setAt(null)
                    if (option.value !== value) onChange(option.value)
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

/** An entry in the side menu. */
export interface NavItem {
  key: string
  label: string
  count?: number
  selected?: boolean
  danger?: boolean
  onPress: () => void
}

/** A heading in the side menu and the entries under it. No title: entries at the top, unheaded. */
export interface NavGroup {
  title?: string
  items: NavItem[]
}

/** The side menu a ☰ opens: a screen's sections, grouped under headings. */
export function SideMenu({
  theme,
  title,
  groups,
  visible,
  onClose
}: {
  theme: Theme
  title: string
  groups: readonly NavGroup[]
  visible: boolean
  onClose: () => void
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <View
          accessibilityRole="menu"
          style={[styles.drawer, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              styles.drawerTitle,
              // The menu draws under the status bar, so its title starts below it.
              { paddingTop: (StatusBar.currentHeight ?? 24) + SPACE.medium },
              { color: theme.text, borderColor: theme.border }
            ]}
          >
            {title}
          </Text>
          <ScrollView>
            {groups.map((group, index) => (
              <View
                key={group.title ?? `group-${index}`}
                style={[
                  styles.group,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.border
                  }
                ]}
              >
                {group.title !== undefined && (
                  <Text style={[styles.groupTitle, { color: theme.textMuted }]}>{group.title}</Text>
                )}
                {group.items.map((item) => (
                  <MenuRow
                    key={item.key}
                    theme={theme}
                    label={item.label}
                    count={item.count}
                    selected={item.selected === true}
                    danger={item.danger}
                    onPress={() => {
                      onClose()
                      item.onPress()
                    }}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
        <Pressable
          accessibilityLabel={t('mobile:nav.closeMenu')}
          style={styles.drawerScrim}
          onPress={onClose}
        />
      </View>
    </Modal>
  )
}

function MenuRow({
  theme,
  label,
  count,
  selected,
  danger,
  onPress
}: {
  theme: Theme
  label: string
  count?: number
  selected: boolean
  danger?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={count !== undefined && count > 0 ? `${label}, ${count}` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: theme.accentSubtle },
        pressed && { backgroundColor: theme.surfaceSunken }
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.rowText,
          { color: danger ? theme.danger : selected ? theme.accent : theme.text },
          selected && styles.rowTextSelected
        ]}
      >
        {label}
      </Text>
      {count !== undefined && count > 0 && (
        <Text style={[styles.count, { color: theme.textSecondary }]}>{count}</Text>
      )}
      {selected && <Icon name="check" size={18} color={theme.accent} />}
    </Pressable>
  )
}

/** Two or three short choices side by side in one slim bar (System, Light, Dark). */
export function Segmented<T extends string>({
  theme,
  label,
  value,
  options,
  onChange
}: {
  theme: Theme
  label: string
  value: T
  options: readonly DropdownOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.segmented, { borderColor: theme.borderStrong }]}
    >
      {options.map((option, index) => {
        const on = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(option.value)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[
              styles.segment,
              index > 0 && { borderLeftWidth: 1, borderColor: theme.borderStrong },
              on && { backgroundColor: theme.accentSubtle }
            ]}
          >
            <Text style={[styles.segmentText, { color: on ? theme.accent : theme.text }]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 36,
    paddingHorizontal: SPACE.small / 2,
    borderRadius: RADIUS,
    flexShrink: 1
  },
  inlineText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch'
  },
  fieldName: { fontSize: 15, flex: 1 },
  fieldValue: { fontSize: 15, flexShrink: 1, textAlign: 'right' },
  scrim: { flex: 1 },
  menu: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    paddingVertical: SPACE.small / 2,
    elevation: 6
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    minHeight: 48,
    paddingHorizontal: SPACE.large
  },
  rowText: { flex: 1, fontSize: 16 },
  rowTextSelected: { fontWeight: '600' },
  count: { fontSize: 14 },
  drawerRoot: { flex: 1, flexDirection: 'row' },
  drawer: {
    width: '80%',
    maxWidth: 320,
    borderRightWidth: StyleSheet.hairlineWidth,
    elevation: 8
  },
  drawerScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  drawerTitle: {
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: SPACE.large,
    paddingBottom: SPACE.medium,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  group: { paddingVertical: SPACE.small / 2 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: SPACE.large,
    paddingTop: SPACE.small,
    paddingBottom: SPACE.small / 2
  },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: RADIUS,
    overflow: 'hidden'
  },
  segment: { minHeight: 32, justifyContent: 'center', paddingHorizontal: SPACE.medium },
  segmentText: { fontSize: 14 }
})
