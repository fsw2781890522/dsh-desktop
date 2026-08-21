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

## Factory web plugins

`factory/web-plugins.json` names npm packages copied into `bundle-runtime/node_modules`
without replacing packages the official dsh tree already ships (`commander`, `undici`,
and other shared libraries stay on the harness versions). The pack step also writes
`bundle-runtime/factory-web-plugins.json` (a JSON string array of package names). On
launch the shell appends any missing names to `~/.dsh/profiles/web` `dsh.profile.bundles`
so a fresh install loads the plugins; it never rewrites the user `cordis.patch.yml`.

Current pin: `dsh-better-sidebar@0.13.1`. The official dsh `0.1.1-rc.1` baseline
provides native multimodal DeepSeek input and the attachment-gated `read_image`
tool, so the former ModLens plugin is intentionally not bundled. Do not also
insert `id: better-sidebar` in the profile patch — that id already comes from
the package's own `dsh.bundle.patch`.
