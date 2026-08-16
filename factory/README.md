# Factory agent presets

These directories are copied into the bundled `@deepseek-ai/dsh` package at
`config/agent-presets/<id>/` during `scripts/bundle-runtime.ps1`. That path is
the official shipped (system-trust) roster root, so a clean install shows them
in the picker without writing `~/.dsh`.

`anchored-standard` is the factory default for new sessions (`dsh-web-app`
`agent-presets.default` is rewritten to this id after the npm install).

Origin: [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
(MIT). See `anchored-standard/SOURCE.txt`.
