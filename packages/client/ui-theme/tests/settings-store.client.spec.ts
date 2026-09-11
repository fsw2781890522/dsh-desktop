/** Appearance and font-size row stores: snapshot-mirror actions and the revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createFontSizeRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference and the default transparency, revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', transparency: 40, revision: -1 })
  })

  it('sync mirrors the preference and transparency and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 55, 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', transparency: 55, revision: 0 })
    store.actions.sync('light', 35, 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().transparency).toBe(35)
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 55, 3)
    store.actions.sync('system', 20, 2)
    store.actions.sync('system', 20, 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().transparency).toBe(55)
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createFontSizeRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontSizeRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSize: 14, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontSizeRowStore().create()
    store.actions.sync(16, 3)
    expect(store.getSnapshot()).toEqual({ fontSize: 16, revision: 3 })
    store.actions.sync(12, 2)
    store.actions.sync(12, 3)
    expect(store.getSnapshot().fontSize).toBe(16)
    expect(store.getSnapshot().revision).toBe(3)
  })
})
