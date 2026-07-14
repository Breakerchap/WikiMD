import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/core'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import { $markSchema, $nodeSchema } from '@milkdown/utils'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { absolutePositionToRelativePosition, redo, undo, ySyncPluginKey } from 'y-prosemirror'
import { setBlockType, toggleMark } from 'prosemirror-commands'
import WmdAst from '../../wmd-ast.js'
import WmdProse from '../../wmd-prosemirror.js'

const { parseWmd, reconcileAst, stringifyWmd } = WmdAst
const { applyAstToProseMirror, markSpecs, nodeSpecs, proseMirrorToWmdAst, wmdAstToProseMirror } = WmdProse

class RemoteCursorWidget extends WidgetType {
  constructor (name, color) {
    super()
    this.name = name || 'Collaborator'
    this.color = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#b9483c'
  }

  eq (other) { return other.name === this.name && other.color === this.color }

  toDOM () {
    const element = document.createElement('span')
    element.className = 'cm-remote-cursor'
    element.dataset.name = this.name
    element.style.setProperty('--cursor-color', this.color)
    return element
  }

  ignoreEvent () { return true }
}

function remoteSourceCursors (awareness) {
  const setDecorations = StateEffect.define()
  const field = StateField.define({
    create: () => Decoration.none,
    update: (value, transaction) => {
      for (const effect of transaction.effects) if (effect.is(setDecorations)) return effect.value
      return value.map(transaction.changes)
    },
    provide: (stateField) => EditorView.decorations.from(stateField),
  })
  const create = (view) => {
    const decorations = []
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID || !state.wmdCursor) return
      const cursor = state.wmdCursor
      const anchor = Math.max(0, Math.min(view.state.doc.length, Number(cursor.anchor) || 0))
      const head = Math.max(0, Math.min(view.state.doc.length, Number(cursor.head) || 0))
      const user = state.user || {}
      if (anchor !== head) decorations.push(Decoration.mark({ class: 'cm-remote-selection', attributes: { style: `--cursor-color:${user.color || '#b9483c'}` } }).range(Math.min(anchor, head), Math.max(anchor, head)))
      decorations.push(Decoration.widget({ widget: new RemoteCursorWidget(user.name, user.color), side: 1 }).range(head))
    })
    return Decoration.set(decorations, true)
  }
  return [field, ViewPlugin.fromClass(class {
    constructor (view) {
      this.view = view
      this.listener = () => this.refresh()
      awareness.on('change', this.listener)
      this.refresh()
    }

    refresh () {
      this.view.dispatch({ effects: setDecorations.of(create(this.view)) })
    }

    destroy () { awareness.off('change', this.listener) }
  })]
}

function schemaPlugins () {
  return [
    ...Object.entries(nodeSpecs).map(([name, spec]) => $nodeSchema(name, () => spec)),
    ...Object.entries(markSpecs).map(([name, spec]) => $markSchema(name, () => spec)),
  ]
}

function updateText(view, next) {
  const current = view.state.doc.toString()
  if (current === next) return
  let start = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start += 1
  let oldEnd = current.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && current[oldEnd - 1] === next[newEnd - 1]) { oldEnd -= 1; newEnd -= 1 }
  view.dispatch({ changes: { from: start, to: oldEnd, insert: next.slice(start, newEnd) } })
}

function sourceMapFor (ast, source, pmDoc) {
  const pm = new Map()
  pmDoc.descendants((node, pos) => { if (node.attrs && node.attrs.id) pm.set(node.attrs.id, { pos, node }) })
  const entries = []
  let cursor = ast.preamble ? ast.preamble.length : 0
  for (const tab of ast.tabs || []) {
    cursor += (tab.header || '').length
    for (const block of tab.blocks || []) {
      cursor += (block.leading || '').length
      const raw = block.raw || ''
      const from = source.indexOf(raw, cursor)
      const start = from === -1 ? cursor : from
      const prefix = block.type === 'title' ? 7 : block.type === 'heading' ? Number(block.attrs.level || 1) + 1 : 0
      const pmEntry = pm.get(block.id)
      entries.push({ id: block.id, from: start, to: start + raw.length, textStart: start + prefix, pmPos: pmEntry ? pmEntry.pos + 1 : null, pmSize: pmEntry ? pmEntry.node.content.size : 0 })
      cursor = start + raw.length
    }
    cursor += (tab.trailing || '').length
  }
  return entries
}

function sourceToPmPosition (map, offset) {
  const entry = map.find((item) => offset >= item.from && offset <= item.to && item.pmPos != null) || map.find((item) => item.pmPos != null)
  if (!entry) return null
  return entry.pmPos + Math.max(0, Math.min(entry.pmSize, offset - entry.textStart))
}

function pmToSourcePosition (map, position) {
  const entry = map.find((item) => item.pmPos != null && position >= item.pmPos && position <= item.pmPos + item.pmSize) || map.find((item) => item.pmPos != null)
  if (!entry) return 0
  return Math.max(entry.from, Math.min(entry.to, entry.textStart + position - entry.pmPos))
}

function cursorElement (user) {
  const cursor = document.createElement('span')
  cursor.className = 'remote-rich-cursor'
  cursor.dataset.name = user.name || 'Collaborator'
  cursor.style.setProperty('--cursor-color', user.color || '#b9483c')
  return cursor
}

function selectionAttrs (user) {
  return { class: 'remote-rich-selection', style: `--cursor-color:${user.color || '#b9483c'}` }
}

export async function createCollaborativeEditor (options) {
  const initialAst = parseWmd(options.source || '')
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(options.websocketUrl, `wikimd:${options.documentId}`, ydoc, { connect: false })
  const metadata = ydoc.getMap('wikimd')
  const status = (event) => options.onStatus && options.onStatus(event.status)
  provider.on('status', status)
  provider.connect()
  await new Promise((resolve) => {
    const finish = () => resolve()
    provider.once('sync', finish)
    setTimeout(finish, 2500)
  })

  if (!ydoc.getXmlFragment('prosemirror').length && !metadata.get('schemaVersion')) {
    const seed = wmdAstToProseMirror(initialAst)
    const { prosemirrorToYDoc } = await import('y-prosemirror')
    const template = prosemirrorToYDoc(seed)
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(template), 'wikimd-client-migration')
    template.destroy()
    metadata.set('preamble', initialAst.preamble || '')
    metadata.set('config', initialAst.config || { raw: '', values: {}, styles: {} })
    metadata.set('styles', initialAst.config && initialAst.config.styles || {})
    metadata.set('schemaVersion', 1)
  }

  let ast = initialAst
  let source = stringifyWmd(ast)
  let sourceMap = []
  let sourceView
  let milkdown
  let richView
  let applyingSource = false
  let pendingSync = false
  const schema = wmdAstToProseMirror(ast).type.schema

  const publishAwareness = (mode, anchor, head) => {
    const map = sourceMap
    const sync = richView && ySyncPluginKey.getState(richView.state)
    const anchorPosition = sourceToPmPosition(map, anchor)
    const headPosition = sourceToPmPosition(map, head)
    const relative = sync && anchorPosition != null && headPosition != null
      ? { anchor: absolutePositionToRelativePosition(anchorPosition, sync.type, sync.binding.mapping), head: absolutePositionToRelativePosition(headPosition, sync.type, sync.binding.mapping) }
      : null
    provider.awareness.setLocalStateField('mode', mode)
    provider.awareness.setLocalStateField('wmdCursor', { anchor, head })
    if (relative) provider.awareness.setLocalStateField('cursor', relative)
  }

  const syncFromRich = () => {
    if (pendingSync || applyingSource || !richView) return
    pendingSync = true
    requestAnimationFrame(() => {
      pendingSync = false
      const nextAst = proseMirrorToWmdAst(richView.state.doc, {
        preamble: metadata.get('preamble') || '',
        config: metadata.get('config') || { raw: '', values: {}, styles: {} },
      })
      const nextSource = stringifyWmd(nextAst)
      ast = reconcileAst(ast, nextAst)
      source = nextSource
      sourceMap = sourceMapFor(ast, source, richView.state.doc)
      if (sourceView) updateText(sourceView, source)
      if (options.onSource) options.onSource(source, ast)
    })
  }

  milkdown = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.richRoot)
      ctx.set(defaultValueCtx, { type: 'json', value: wmdAstToProseMirror(ast, schema).toJSON() })
      ctx.set(editorViewOptionsCtx, {
        dispatchTransaction (transaction) {
          const view = ctx.get(editorViewCtx)
          view.updateState(view.state.apply(transaction))
          richView = view
          syncFromRich()
          if (view.hasFocus()) {
            const selection = view.state.selection
            publishAwareness('document', pmToSourcePosition(sourceMap, selection.anchor), pmToSourcePosition(sourceMap, selection.head))
          }
        },
      })
    })
    .use(schemaPlugins())
    .use(collab)
    .create()

  milkdown.action((ctx) => {
    richView = ctx.get(editorViewCtx)
    const service = ctx.get(collabServiceCtx)
    service.bindDoc(ydoc).setAwareness(provider.awareness).setOptions({ yCursorOpts: { cursorBuilder: cursorElement, selectionBuilder: selectionAttrs } }).connect()
  })

  sourceMap = sourceMapFor(ast, source, richView.state.doc)
  sourceView = new EditorView({
    state: EditorState.create({
      doc: source,
      extensions: [
        history(), markdown(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), remoteSourceCursors(provider.awareness),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingSource) {
            const candidate = update.state.doc.toString()
            const nextAst = reconcileAst(ast, parseWmd(candidate))
            applyingSource = true
            metadata.set('preamble', nextAst.preamble || '')
            metadata.set('config', nextAst.config || { raw: '', values: {}, styles: {} })
            metadata.set('styles', nextAst.config && nextAst.config.styles || {})
            applyAstToProseMirror(richView, nextAst, richView.state.schema)
            ast = nextAst
            source = candidate
            sourceMap = sourceMapFor(ast, source, richView.state.doc)
            applyingSource = false
            if (options.onSource) options.onSource(source, ast)
          }
          if (update.selectionSet || update.docChanged) publishAwareness('wmd', update.state.selection.main.anchor, update.state.selection.main.head)
        }),
      ],
    }),
    parent: options.sourceRoot,
  })

  metadata.observe(() => syncFromRich())
  provider.awareness.setLocalState({ user: { name: options.user && options.user.name || 'Guest', color: options.user && options.user.color || '#3f7f6b' }, mode: options.mode || 'document', wmdCursor: { anchor: 0, head: 0 } })
  provider.awareness.on('change', () => options.onAwareness && options.onAwareness(provider.awareness.getStates()))
  syncFromRich()

  const command = (fn) => {
    if (!richView) return false
    return fn(richView.state, richView.dispatch, richView)
  }
  return {
    getSource: () => source,
    getAst: () => ast,
    setSource: (next) => {
      const text = String(next || '')
      sourceView.dispatch({ changes: { from: 0, to: sourceView.state.doc.length, insert: text } })
    },
    focus: (mode) => (mode === 'wmd' ? sourceView.focus() : richView.focus()),
    setUser: (user) => provider.awareness.setLocalStateField('user', { name: user.name || 'Guest', color: user.color || '#3f7f6b' }),
    undo: () => command(undo),
    redo: () => command(redo),
    toggleMark: (name) => command(toggleMark(richView.state.schema.marks[name])),
    setHeading: (level) => command(setBlockType(richView.state.schema.nodes.heading, { level })),
    insertRaw: (raw, kind = 'raw') => {
      const node = richView.state.schema.nodes.wmd_raw.create({ id: `wmd-raw-${Date.now().toString(36)}`, leading: '\n\n', raw, kind })
      richView.dispatch(richView.state.tr.replaceSelectionWith(node).scrollIntoView())
    },
    insertText: (text) => richView.dispatch(richView.state.tr.insertText(text)),
    destroy: async () => {
      provider.awareness.setLocalState(null)
      provider.destroy()
      sourceView.destroy()
      await milkdown.destroy()
    },
  }
}
