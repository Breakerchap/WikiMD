# Wiki Markdown (.wmd) Support

Small local VS Code extension for `.wmd` files.

## Features

- `.wmd` language mode
- Syntax highlighting for:
  - `@tab`
  - `@title`
  - `@config` / `@endconfig`
  - Markdown headings
  - `[[Tab#Heading|Label]]` wiki links
  - `=yellow=`
  - `==orange==`
  - `===red===`
  - `*bold*`
  - `_italic_`
  - inline code and code fences
- Auto-closing pairs:
  - brackets
  - quotes
  - backticks
  - `*`
  - `_`
  - `=`
  - `[[` / `]]`
- Snippets and autocomplete
- Basic document formatter
- Smart delimiter typing for `*`, `_`, `` ` ``, and `=`
- Editor-title live preview button for `.wmd` files

## Install manually

Copy this whole folder to:

```txt
%USERPROFILE%\.vscode\extensions\wmd-support
```

Then reload VS Code.

## Use the included themes

Press `Ctrl+Shift+P`, run `Preferences: Color Theme`, then choose:

- `WMD Dark`
- `WMD Light`

The highlighting still works without these themes, but the highlight colours look better with them.

## Live preview button

Open any `.wmd` file and use the `Open Live Preview` button in the editor title area.

- It starts the local WMD preview server for the current file
- It writes the compiled `.html` next to that file
- It opens the live preview inside VS Code using Simple Browser


## WMD v2 additions

This version also highlights/snippets:

- callouts: `!note`, `!warning`, `!rule`, `!example`, `!tip`, `!danger`, `!info`
- collapses: `@collapse` / `@endcollapse`
- table of contents: `@toc`
- includes/embeds: `@include`, `@embed`
- variables: `@var name = value` and `{{name}}`
- hidden tabs: `@hidden`

## v2.1 note

Actual maths rendering was removed from the compiler, so this support pack no longer highlights `$...$` or `$$...$$` as special WMD maths.
