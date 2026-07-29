# Keybindings

Sigma Code reads keybindings from:

- `~/.sigma/code/keybindings.json`

An explicit `SIGMACODE_HOME` or `--home-dir` changes the base directory. Sigma
Code never reads or writes T3 Code's `~/.t3` keybindings.

The file must be a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

See the full schema for more details:
[`packages/contracts/src/keybindings.ts`](../../packages/contracts/src/keybindings.ts).

## Defaults

```json
[
  { "key": "mod+j", "command": "terminal.toggle" },
  { "key": "mod+d", "command": "terminal.split", "when": "terminalFocus" },
  { "key": "mod+n", "command": "terminal.new", "when": "terminalFocus" },
  { "key": "mod+w", "command": "terminal.close", "when": "terminalFocus" },
  { "key": "mod+shift+j", "command": "preview.toggle" },
  { "key": "mod+r", "command": "preview.refresh", "when": "previewFocus" },
  { "key": "mod+l", "command": "preview.focusUrl", "when": "previewFocus" },
  { "key": "mod+=", "command": "preview.zoomIn", "when": "previewFocus" },
  { "key": "mod+-", "command": "preview.zoomOut", "when": "previewFocus" },
  { "key": "mod+0", "command": "preview.resetZoom", "when": "previewFocus" },
  { "key": "mod+k", "command": "commandPalette.toggle", "when": "!terminalFocus" },
  { "key": "mod+n", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+o", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+n", "command": "chat.newLocal", "when": "!terminalFocus" },
  { "key": "mod+o", "command": "editor.openFavorite" }
]
```

For the most up-to-date defaults, see
[`DEFAULT_KEYBINDINGS` in `apps/server/src/keybindings.ts`](../../apps/server/src/keybindings.ts).

## Configuration

### Rule shape

Each entry supports:

- `key` (required): shortcut string, such as `mod+j`, `ctrl+k`, or
  `cmd+shift+d`
- `command` (required): action ID
- `when` (optional): boolean expression controlling when the shortcut is active

Invalid rules and invalid config files are ignored, with warnings logged by the
server.

### Available commands

- `terminal.toggle`: open or close the terminal drawer
- `terminal.split`: split the focused terminal
- `terminal.new`: create a terminal
- `terminal.close`: close the focused terminal
- `preview.toggle`: open or close the in-app browser preview
- `preview.refresh`: reload the active preview tab
- `preview.focusUrl`: focus the preview URL input
- `preview.zoomIn`: zoom the preview viewport in
- `preview.zoomOut`: zoom the preview viewport out
- `preview.resetZoom`: reset preview zoom to 100%
- `commandPalette.toggle`: open or close the command palette
- `chat.new`: create a thread preserving the active branch/worktree state
- `chat.newLocal`: create a thread in a new environment
- `editor.openFavorite`: open the current project in the last-used editor
- `script.{id}.run`: run a project script by ID

### Key syntax

Supported modifiers:

- `mod` (`cmd` on macOS, `ctrl` elsewhere)
- `cmd` / `meta`
- `ctrl` / `control`
- `shift`
- `alt` / `option`

Examples include `mod+j`, `mod+shift+d`, `ctrl+l`, and `cmd+k`.

### `when` conditions

Available context keys:

- `terminalFocus`
- `terminalOpen`
- `previewFocus`
- `previewOpen`

Supported operators are `!`, `&&`, `||`, and parentheses.

Unknown condition keys evaluate to `false`.

### Precedence

Rules are evaluated in array order. For a key event, the last rule whose `key`
and `when` both match wins, including across different commands.
