# Semi-MD / WMD

This project compiles `.wmd` files into a single interactive HTML document with tabs, includes, callouts, collapsible sections, and heading search. Theme choice belongs to the editor or host application, not to individual documents.

Generated `.html` preview files are treated as build artifacts and are ignored by git.

## Commands

```bash
npm run build
npm run watch
npm run serve
npm run dev
npm run web
npm test
npm run test:stress
```

- `build` compiles the file you pass in, or defaults to `example.wmd -> output.html`
- `watch` recompiles the file you pass in, or defaults to `example.wmd`
- `serve` starts a local preview server at `http://127.0.0.1:4312`
- `dev` starts the preview server and live reload workflow

If PowerShell blocks `npm.ps1` on your machine, use the direct Node commands instead:

```bash
node wmd-compiler.js
node wmd-compiler.js --watch
node wmd-compiler.js --serve
node --test
```

## WMD workspace

Run `npm run web` and open `http://127.0.0.1:4313` for the WMD source editor and compiled preview. It includes syntax highlighting, formatting shortcuts, style presets, tabs, callouts, find/replace, MD/WMD/DOCX import, document management, local recovery drafts, and `.wmd` downloads.

Switch between the raw WMD source and a Google-Docs-style Document mode. Document mode formats selections through the toolbar or keyboard shortcuts while keeping WMD as the canonical shared source and recompiling as you type.

Up to eight people can edit the same document simultaneously in either mode, with live cursors and reconnect-safe operation replay.

For other people on your local network, run `npm run web:lan`, open the LAN address printed in the terminal, then use **Invite** to copy the current document link. Only share the server on a network you trust; the workspace does not include accounts or permissions.

To share over the internet, keep `npm run web` running in one terminal and run `npm run web:share` in another. Share the HTTPS address printed by ngrok.

You can also point the compiler at another file:

```bash
node wmd-compiler.js my-notes.wmd my-notes.html
node wmd-compiler.js --watch my-notes.wmd my-notes.html
node wmd-compiler.js --serve my-notes.wmd my-notes.html --port 4400
```

## VS Code workflow

The repo now includes workspace tasks in `.vscode/tasks.json`.

- `WMD: Build` compiles the currently focused `.wmd` file to a sibling `.html` file
- `WMD: Watch` watches the currently focused `.wmd` file
- `WMD: Dev Server` starts live preview for the currently focused `.wmd` file on `http://127.0.0.1:4312`
- `WMD: Launch Side Preview` starts the dev server for the currently focused `.wmd` file and opens the preview in a VS Code editor tab

`*.wmd` files are also associated with Markdown in workspace settings, so editing feels natural inside VS Code.

For a live in-editor preview:

1. Run `Terminal: Run Task`
2. Choose `WMD: Launch Side Preview`

Tip:

- Click into the `.wmd` file you want first, then run the task
- `notes.wmd` will compile to `notes.html` in the same folder

Important:

- Open the server URL, not `output.html`, if you want automatic page reloads
- `output.html` still updates on disk, but a file tab or plain file:// browser tab will not live-refresh itself
- If the compiler hits a hard error, the browser view swaps to an error page and the terminal / Problems panel will show the same error

## Supported syntax

### Tabs

```wmd
@tab Home
@title My Document
```

Hidden tabs:

```wmd
@tab GM Notes {hidden}
```

or

```wmd
@tab GM Notes
@hidden
```

### Variables

```wmd
@var baseEnergy = 10
Use it like {{baseEnergy}}.
```

### Includes and embeds

```wmd
@include Combat#Damage
@embed Combat#Damage
```

### Table of contents

```wmd
@toc
@toc depth: 3
```

### Callouts

```wmd
!note Optional title
Content.
!end

!warning Optional title
Content.
!end

!rule Optional title
Content.
!end
```

### Collapsible sections

```wmd
@collapse Optional title
Hidden content.
@endcollapse
```

### Wiki links

```wmd
[[Combat]]
[[Combat#Damage]]
[[Combat#Damage|Read the damage rules]]
```

## Recent fixes

- Added a real CLI with `build`, `watch`, `serve`, and `dev` flows
- Added a VS Code task setup for fast compile and live preview
- Fixed broken text encoding in the generated UI markers and CLI output
- Fixed duplicate heading IDs by generating stable unique anchors
- Fixed heading detection so fenced code block content does not become real document headings
- Added duplicate tab-name warnings instead of silently breaking links and includes
- Replaced `color-mix(...)` styling with simpler compatible surfaces
- Updated the README to match the actual project files and workflow

## License

This project is licensed under the GNU GPL v3.0 or later. See [LICENSE](C:/Users/Remy/Documents/CodingProjects/semi-md/LICENSE).
