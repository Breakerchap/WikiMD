# Milkdown + Yjs migration

## Implemented architecture

`Y.Doc` is now the collaborative authority for each WikiMD document:

```text
Y.Doc
├── XmlFragment("prosemirror")  — Milkdown / ProseMirror document
└── Map("wikimd")               — config, styles, and source preamble
```

The web server gives every document a `wikimd:<document-id>` Yjs WebSocket room. It writes an encoded `.yjs` state as the authoritative persistence format and writes a debounced `.wmd` snapshot for exports and existing tools. A `.wmd` snapshot is converted to structured Yjs state only when that `.yjs` state does not already exist.

The existing two panes are retained. Milkdown owns the document pane. CodeMirror 6 owns the WMD pane and projects its edits into tolerant WikiMD AST changes and targeted ProseMirror transactions. Milkdown/Yjs changes are converted through the same AST and applied to CodeMirror as a minimal prefix/suffix change.

## Conversion surface

- `parseWmd(source)` — lossless, tolerant AST parser
- `stringifyWmd(ast)` — source serializer
- `wmdAstToProseMirror(ast, schema)`
- `proseMirrorToWmdAst(doc, metadata)`
- `renderWmdAst(ast)` — lightweight AST rendering utility

The custom schema includes tab, title, callout, collapse, raw/recovery, table, checklist, and list nodes. Recovery/raw nodes deliberately preserve unfinished directives and unsupported rich editing verbatim.

## Migration limitations

Nested editing inside raw table, checklist, style, and recovery nodes is intentionally performed in WMD mode in this first migration. They remain visible and lossless in Milkdown, while normal text, titles, and headings are structured editable nodes. A future enhancement can promote each remaining raw construct to fully nested ProseMirror content without changing stored Yjs documents.
