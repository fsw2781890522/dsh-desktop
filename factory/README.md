# Factory agent presets

These directories are copied into the bundled `@deepseek-ai/dsh` package during
`scripts/bundle-runtime.ps1`. Ordinary presets land at
`config/agent-presets/<id>/`, the official shipped (system-trust) roster root.
The factory `anchored-standard` preset is intentionally placed at
`config/agent-presets-custom/anchored-standard/` so it appears in the Custom
section while remaining preinstalled and available to new sessions.

`anchored-standard` is the factory default for new sessions (`dsh-web-app`
`agent-presets.default` is rewritten to this id after the npm install).

Origin: [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
(MIT). See `anchored-standard/SOURCE.txt`.
