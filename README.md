# Semi-MD / WMD

This project compiles `.wmd` files into a single interactive HTML document with tabs, includes, callouts, collapsible sections, and heading search. Theme choice belongs to the editor or host application, not to individual documents.

Generated `.html` preview files are treated as build artifacts and are ignored by git.

## Commands

```bash
npm run build
npm run watch
npm run serve
npm run dev
npm test
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

## Web editor branch

The `web-editor` branch adds a local, collaborative browser editor without changing the normal compiler workflow on `main`.

```bash
git switch web-editor
node web/server.js
```

Then open `http://127.0.0.1:4313`. It opens in an editable version of the actual compiled document, with a toggle to syntax-highlighted raw WMD. The Docs-style toolbar provides document style, font, size, zoom, formatting, links, images, headings, lists, callouts, tabs, and undo/redo. The workspace also has resizable/hideable panes, MD/WMD/DOCX import, and `.wmd` downloads.

Settings are stored per browser and include your username, cursor color, global theme, main color palette, default editor mode, and text macros such as `--` becoming an en dash. Collaborators in the same mode see each other's named cursors as they type, and everyone sees live source and document changes. Use `++underlined text++` for persistent WMD underline.

Saved browser documents live in `web/data/`, which is intentionally ignored by Git. The browser also keeps a local recovery copy for every document and sync server, so an edit made while offline is restored after a refresh or reconnect.

For collaborators on your local network, start the server with `node web/server.js --host 0.0.0.0` (or `npm run web:lan`) and share your computer's LAN address, such as `http://192.168.1.20:4313/?doc=team-notes`. This editor intentionally has no sign-in system yet, so only use LAN mode on a network you trust.

For people on different networks, run the same server on an HTTPS-accessible host or behind a secure tunnel, then open and share that public editor URL. The server accepts cross-origin sync requests, so a local editor can also connect through **Settings -> Sync server URL**. When launching behind a public address, this prints the intended share base in the terminal:

```bash
node web/server.js --host 0.0.0.0 --public-url https://docs.example.com
```

The public host must provide its own access control (for example, a VPN, authenticated reverse proxy, or a private tunnel) before it is shared outside a trusted group. WMD Studio does not yet include accounts or document permissions.

### Quick internet sharing

`ngrok` is available on this Windows machine, so you can share a temporary HTTPS link without changing router settings:

```powershell
# Terminal 1: keep the editor running
npm run web

# Terminal 2: create the public URL, then share the https:// address it prints
npm run web:share
```

The link works only while both terminals remain open. If ngrok asks for an auth token, follow its one-time setup prompt, then run `npm run web:share` again. For a longer-lived shared editor, use a named tunnel or an HTTPS host with access control.

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
