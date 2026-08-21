/**
 * Compatibility face for personal rc.7-era profile plugins.
 *
 * Official rc.1 moved these helpers into the UI renderer package and stopped
 * publishing `@deepseek-ai/dsh-client-web-react` as a platform module. The
 * 0.3.2 desktop keeps a deliberately small bridge for already-installed
 * personal bundles; new official bundles must use the rc.1 renderer API.
 */
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-client-web-react',
  factory: (require) => {
    const React = require('react')

    const identity = (value) => value

    /** Bind a bare observable snapshot source to the old selector-hook shape. */
    function bindSnapshotSelector(source) {
      const subscribe = (listener) => source.subscribe(listener)
      const getSnapshot = () => source.getSnapshot()
      return function useSelector(selector = identity, equality = Object.is) {
        const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
        const selected = selector(snapshot)
        const previous = React.useRef()
        if (previous.current !== undefined && equality(previous.current.value, selected)) {
          previous.current = { snapshot, value: previous.current.value }
          return previous.current.value
        }
        previous.current = { snapshot, value: selected }
        return selected
      }
    }

    /** Keep the rc.7 async-action hook available to older personal bundles. */
    function useInvoke(fn) {
      const ref = React.useRef()
      if (ref.current === undefined) {
        const cell = {
          inflight: 0,
          listeners: new Set(),
          fn,
        }
        cell.subscribe = (listener) => {
          cell.listeners.add(listener)
          return () => cell.listeners.delete(listener)
        }
        cell.getPending = () => cell.inflight > 0
        cell.invoke = () => {
          cell.inflight += 1
          for (const listener of [...cell.listeners]) listener()
          Promise.resolve().then(() => cell.fn()).catch((error) => {
            console.error('[dsh-client-web-react-compat] invoke failed:', error)
          }).finally(() => {
            cell.inflight -= 1
            for (const listener of [...cell.listeners]) listener()
          })
        }
        ref.current = cell
      }
      ref.current.fn = fn
      const pending = React.useSyncExternalStore(
        ref.current.subscribe,
        ref.current.getPending,
        ref.current.getPending,
      )
      return [ref.current.invoke, pending]
    }

    // The compatibility row is also a normal rc.1 client plugin entry. Its
    // host/browser plugin face is intentionally inert; the legacy helpers are
    // consumed through the module-table exports above.
    return { apply() {}, bindSnapshotSelector, useInvoke }
  },
})
