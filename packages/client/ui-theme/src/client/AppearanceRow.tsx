/**
 * Appearance preference row registered into the General section item slot
 * (figma 501:30012 'Frame 2117131228'): title + three preference cubes + the
 * sidebar transparency slider. Registered by this package — the theme feature
 * owns its own settings surface. Selection follows the persisted preference,
 * never the resolved active theme; the slider follows the persisted
 * transparency, never the click echo.
 */
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { SIDEBAR_TRANSPARENCY_MAX, SIDEBAR_TRANSPARENCY_MIN } from '../theme-settings.ts'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Set the sidebar transparency percentage (0 = opaque, 100 = no tint). */
  setSidebarTransparency: (value: number) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, setSidebarTransparency, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const transparency = useStore(s => s.transparency)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('appearance.title')}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={() => { setTheme(id) }}
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </div>
      <label className={css.transparencyControl}>
        <span className={css.transparencyHeader}>
          <span>{t('appearance.transparency')}</span>
          <output>{transparency}%</output>
        </span>
        <input
          type="range"
          min={SIDEBAR_TRANSPARENCY_MIN}
          max={SIDEBAR_TRANSPARENCY_MAX}
          step={1}
          value={transparency}
          aria-label={t('appearance.transparency')}
          onChange={(event) => { setSidebarTransparency(Number(event.currentTarget.value)) }}
        />
      </label>
    </div>
  )
}
