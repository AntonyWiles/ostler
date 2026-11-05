import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { RADIUS, SPACE, type Theme } from '../theme'
import { Icon, type IconName } from './Icon'
import { SideMenu, type NavGroup } from './Menus'

/** A button at the right of the bar: an icon, with its name for screen readers. */
export interface BarAction {
  icon: IconName
  label: string
  onPress: () => void
}

/** An entry in the bar's ⋮ menu. */
export interface MenuItem {
  label: string
  onPress: () => void
  /** A destructive entry, shown in the danger colour. */
  danger?: boolean
}

interface Props {
  theme: Theme
  title: string
  /** Shows a back arrow at the left. */
  onBack?: () => void
  actions?: BarAction[]
  menu?: MenuItem[]
  /**
   * The screen's sections, in a side menu a ☰ opens: at the left on a top-level screen, at the
   * right (before ⋮) when there is a back arrow.
   */
  nav?: { title: string; groups: readonly NavGroup[] }
}

/** The bar fixed at the top of every screen: back, the screen's title, its actions and a ⋮ menu. */
export function TopBar({ theme, title, onBack, actions = [], menu = [], nav }: Props) {
  const [open, setOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const navButton = nav !== undefined && (
    <IconButton
      icon="menu"
      label={t('mobile:menus.sections')}
      theme={theme}
      onPress={() => setNavOpen(true)}
    />
  )
  return (
    <View style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {onBack === undefined && navButton}
      {onBack !== undefined && (
        <IconButton
          icon="arrow-left"
          label={t('mobile:task.back')}
          theme={theme}
          onPress={onBack}
        />
      )}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[
          styles.title,
          { color: theme.text },
          onBack === undefined && nav === undefined && styles.titleAlone
        ]}
      >
        {title}
      </Text>
      {actions.map((action) => (
        <IconButton key={action.label} {...action} theme={theme} />
      ))}
      {onBack !== undefined && navButton}
      {menu.length > 0 && (
        <IconButton
          icon="ellipsis-vertical"
          label={t('mobile:nav.menu')}
          theme={theme}
          onPress={() => setOpen(true)}
        />
      )}
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityLabel={t('mobile:nav.closeMenu')}
          style={styles.scrim}
          onPress={() => setOpen(false)}
        >
          <View
            accessibilityRole="menu"
            style={[styles.menu, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            {menu.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="menuitem"
                onPress={() => {
                  setOpen(false)
                  item.onPress()
                }}
                style={({ pressed }) => [
                  styles.item,
                  pressed && { backgroundColor: theme.surfaceSunken }
                ]}
              >
                <Text style={[styles.itemText, { color: item.danger ? theme.danger : theme.text }]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      {nav !== undefined && (
        <SideMenu
          theme={theme}
          title={nav.title}
          groups={nav.groups}
          visible={navOpen}
          onClose={() => setNavOpen(false)}
        />
      )}
    </View>
  )
}

function IconButton({ icon, label, theme, onPress }: BarAction & { theme: Theme }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.icon, pressed && { backgroundColor: theme.surfaceSunken }]}
    >
      <Icon name={icon} color={theme.textSecondary} size={22} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: SPACE.small / 2,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  title: { flex: 1, fontSize: 18, fontWeight: '600', paddingHorizontal: SPACE.small },
  titleAlone: { paddingHorizontal: SPACE.medium },
  icon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center'
  },
  scrim: { flex: 1 },
  menu: {
    position: 'absolute',
    top: 56,
    right: SPACE.small,
    minWidth: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    paddingVertical: SPACE.small / 2,
    elevation: 4
  },
  item: { minHeight: 48, justifyContent: 'center', paddingHorizontal: SPACE.large },
  itemText: { fontSize: 16 }
})
