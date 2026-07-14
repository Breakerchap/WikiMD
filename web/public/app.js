(() => {
  'use strict'

  const SETTINGS_KEY = 'wmd-studio-settings-v5'
  const colors = ['#3f7f6b', '#b75b4a', '#486f9b', '#a47732', '#765899']
  const $ = (selector) => document.querySelector(selector)
  const elements = {
    source: $('#sourceEditor'), rich: $('#richEditor'), name: $('#documentName'), connection: $('#connectionStatus'),
    save: $('#saveStatus'), local: $('#localSaveStatus'), words: $('#wordCount'), presence: $('#presence'),
    documentMode: $('#documentModeButton'), wmdMode: $('#wmdModeButton'), editorPane: $('#editorPane'), previewPane: $('#previewZone'),
    documentsPage: $('#documentsPage'), documentsList: $('#documentsListPage'), toast: $('#toast'), panels: $('#panelMenu'),
  }
  let studio = null
  let settings = loadSettings()
  let documentId = normalizeId(new URLSearchParams(location.search).get('doc') || 'untitled')
  let toastTimer = null

  function defaults () {
    return { username: `Guest ${Math.floor(100 + Math.random() * 900)}`, color: colors[Math.floor(Math.random() * colors.length)], syncUrl: '', theme: 'light', accent: 'green', defaultMode: 'document', zoom: 100, panes: { editor: 620 }, panels: { editor: true, preview: true }, macros: [] }
  }

  function loadSettings () {
    try { return { ...defaults(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch (_) { return defaults() }
  }

  function saveSettings () { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) }

  function normalizeId (value) {
    const text = String(value || '').toLowerCase().replace(/\.[^./\\]+$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    return text || 'untitled'
  }

  function toast (message) {
    elements.toast.textContent = message
    elements.toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2800)
  }

  function collaborationUrl () {
    const base = new URL(settings.syncUrl || location.href, location.href)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    base.pathname = `${base.pathname.replace(/\/$/, '')}/collaboration`.replace(/\/\/+/g, '/')
    base.search = ''
    base.hash = ''
    return base.toString().replace(/\/$/, '')
  }

  async function request (url, options) {
    const response = await fetch(url, options)
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || 'Request failed.')
    return value
  }

  function applyTheme () {
    document.body.dataset.theme = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme
    document.body.dataset.accent = settings.accent
    elements.rich.style.fontSize = `${Math.round(16 * (settings.zoom || 100) / 100)}px`
    $('#zoomControl').textContent = `${settings.zoom || 100}%`
  }

  function setMode (mode, focus = false) {
    const documentMode = mode !== 'wmd'
    elements.documentMode.setAttribute('aria-pressed', String(documentMode))
    elements.wmdMode.setAttribute('aria-pressed', String(!documentMode))
    elements.documentMode.classList.toggle('active', documentMode)
    elements.wmdMode.classList.toggle('active', !documentMode)
    elements.editorPane.classList.toggle('active-editor-pane', !documentMode)
    elements.previewPane.classList.toggle('active-editor-pane', documentMode)
    settings.defaultMode = documentMode ? 'document' : 'wmd'
    if (focus && studio) studio.focus(documentMode ? 'document' : 'wmd')
  }

  function updateSourceStatus (source, ast) {
    elements.words.textContent = `${(source.match(/[\p{L}\p{N}_-]+/gu) || []).length} words`
    elements.local.textContent = ast.diagnostics && ast.diagnostics.length ? `${ast.diagnostics.length} recoverable WMD issue${ast.diagnostics.length === 1 ? '' : 's'}` : 'Local copy ready'
    elements.save.textContent = 'Yjs state and .wmd snapshot pending'
    clearTimeout(updateSourceStatus.timer)
    updateSourceStatus.timer = setTimeout(() => { elements.save.textContent = 'Yjs state synced' }, 500)
  }

  function renderPresence (states) {
    elements.presence.replaceChildren()
    states.forEach((state, clientId) => {
      const user = state.user || {}
      const avatar = document.createElement('button')
      avatar.className = 'avatar'
      avatar.disabled = true
      avatar.textContent = String(user.name || `User ${clientId}`).slice(0, 1).toUpperCase()
      avatar.title = `${user.name || 'Collaborator'} (${state.mode || 'document'})`
      avatar.style.background = /^#[0-9a-f]{6}$/i.test(user.color || '') ? user.color : '#3f7f6b'
      elements.presence.append(avatar)
    })
  }

  async function openDocument (id, sourceOverride) {
    documentId = normalizeId(id)
    const url = new URL(location.href)
    url.searchParams.set('doc', documentId)
    history.replaceState({}, '', url)
    if (studio) await studio.destroy()
    elements.source.replaceChildren()
    elements.rich.replaceChildren()
    elements.name.textContent = documentId.replace(/[-_]+/g, ' ')
    elements.connection.textContent = 'Connecting'
    const remote = sourceOverride == null ? await request(`/api/documents/${encodeURIComponent(documentId)}`) : { document: { source: sourceOverride, title: documentId } }
    elements.name.textContent = remote.document.title || documentId
    studio = await globalThis.WmdCollaborativeEditor.createCollaborativeEditor({
      sourceRoot: elements.source,
      richRoot: elements.rich,
      source: remote.document.source,
      documentId,
      websocketUrl: collaborationUrl(),
      user: { name: settings.username, color: settings.color },
      mode: settings.defaultMode,
      onStatus: (status) => { elements.connection.textContent = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'; elements.connection.dataset.status = status },
      onSource: updateSourceStatus,
      onAwareness: renderPresence,
    })
    setMode(settings.defaultMode)
    updateSourceStatus(studio.getSource(), studio.getAst())
  }

  async function refreshDocuments () {
    const { documents } = await request('/api/documents')
    elements.documentsList.replaceChildren()
    documents.forEach((documentInfo) => {
      const row = document.createElement('article')
      row.className = 'document-row'
      const open = document.createElement('button')
      open.className = 'document-open-button'
      open.innerHTML = `<strong>${escapeHtml(documentInfo.title)}</strong><span>${escapeHtml(documentInfo.id)}</span>`
      open.addEventListener('click', async () => { elements.documentsPage.hidden = true; await openDocument(documentInfo.id) })
      const remove = document.createElement('button')
      remove.className = 'quiet-button'
      remove.textContent = 'Delete'
      remove.disabled = documentInfo.id === 'untitled'
      remove.addEventListener('click', async () => {
        if (!confirm(`Delete ${documentInfo.title}?`)) return
        try { await request(`/api/documents/${encodeURIComponent(documentInfo.id)}`, { method: 'DELETE' }); await refreshDocuments() } catch (error) { toast(error.message) }
      })
      row.append(open, remove)
      elements.documentsList.append(row)
    })
  }

  function escapeHtml (value) { return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]) }

  function download () {
    const blob = new Blob([studio.getSource()], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${documentId}.wmd`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 0)
  }

  function showInsert (kind) {
    const templates = {
      link: '[link text](https://example.com)', image: '![image description](https://example.com/image.png)', heading: '\n\n## New heading\n',
      list: '\n\n- First item\n- Second item\n', 'ordered-list': '\n\n1. First item\n2. Second item\n', checkbox: '\n\n- [ ] Task\n',
      table: '\n\n| Column | Value |\n| --- | --- |\n| Item | Text |\n', callout: '\n\n!note Note\nWrite here\n!end\n', tab: '\n@tab New tab\n@title New tab\n\n# New tab\n',
    }
    if (kind === 'heading') return studio.setHeading(2)
    if (kind === 'link') return studio.insertText(templates[kind])
    studio.insertRaw(templates[kind] || '', kind)
  }

  function wireUi () {
    elements.documentMode.addEventListener('click', () => setMode('document', true))
    elements.wmdMode.addEventListener('click', () => setMode('wmd', true))
    $('#downloadButton').addEventListener('click', download)
    $('#documentsButton').addEventListener('click', async () => { elements.documentsPage.hidden = false; await refreshDocuments() })
    $('#backToEditorButton').addEventListener('click', () => { elements.documentsPage.hidden = true })
    $('#refreshDocumentsButton').addEventListener('click', refreshDocuments)
    $('#documentsCreateForm').addEventListener('submit', async (event) => {
      event.preventDefault()
      try { const result = await request('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('#newDocumentName').value }) }); $('#newDocumentName').value = ''; elements.documentsPage.hidden = true; await openDocument(result.document.id) } catch (error) { toast(error.message) }
    })
    $('#uploadButton').addEventListener('click', () => $('#importInput').click())
    $('#importInput').addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0]
      if (!file) return
      try {
        let source
        if (/\.docx$/i.test(file.name)) {
          const data = await file.arrayBuffer()
          const imported = await request('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, data: btoa(String.fromCharCode(...new Uint8Array(data))) }) })
          source = imported.source
        } else source = await file.text()
        studio.setSource(source)
        toast('Imported into the collaborative document.')
      } catch (error) { toast(error.message) }
      event.target.value = ''
    })
    $('#settingsButton').addEventListener('click', () => {
      $('#usernameInput').value = settings.username; $('#syncUrlInput').value = settings.syncUrl; $('#cursorColorInput').value = settings.color; $('#themeInput').value = settings.theme; $('#accentInput').value = settings.accent; $('#defaultModeInput').value = settings.defaultMode; $('#settingsDialog').showModal()
    })
    $('#settingsForm').addEventListener('submit', (event) => {
      event.preventDefault()
      settings = { ...settings, username: $('#usernameInput').value.trim().slice(0, 36) || 'Guest', syncUrl: $('#syncUrlInput').value.trim(), color: $('#cursorColorInput').value, theme: $('#themeInput').value, accent: $('#accentInput').value, defaultMode: $('#defaultModeInput').value === 'wmd' ? 'wmd' : 'document' }
      saveSettings(); applyTheme(); studio.setUser({ name: settings.username, color: settings.color }); $('#settingsDialog').close(); toast('Settings saved.')
    })
    $('#shareButton').addEventListener('click', () => { $('#shareLinkInput').value = location.href; $('#shareDialog').showModal() })
    $('#selectShareLinkButton').addEventListener('click', () => { $('#shareLinkInput').select() })
    $('#copyShareLinkButton').addEventListener('click', async () => { await navigator.clipboard.writeText($('#shareLinkInput').value); toast('Share link copied.') })
    $('#panelsButton').addEventListener('click', () => { elements.panels.hidden = !elements.panels.hidden; $('#panelsButton').setAttribute('aria-expanded', String(!elements.panels.hidden)) })
    $('#closePanelsButton').addEventListener('click', () => { elements.panels.hidden = true })
    document.querySelectorAll('[data-panel-toggle]').forEach((input) => input.addEventListener('change', () => { const pane = input.dataset.panelToggle === 'editor' ? elements.editorPane : elements.previewPane; pane.hidden = !input.checked }))
    document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
      const command = button.dataset.command
      if (command === 'undo') studio.undo(); else if (command === 'redo') studio.redo(); else if (command === 'strikeThrough') studio.toggleMark('strike'); else studio.toggleMark(command)
    }))
    document.querySelectorAll('[data-insert]').forEach((button) => button.addEventListener('click', () => showInsert(button.dataset.insert)))
    $('#blockStyleControl').addEventListener('change', (event) => { const value = event.target.value; const match = value.match(/heading-(\d)/); if (match) studio.setHeading(Number(match[1])) })
    $('#fontControl').addEventListener('change', (event) => { elements.rich.style.fontFamily = event.target.value })
    document.querySelectorAll('[data-document-command]').forEach((button) => button.addEventListener('click', () => {
      const command = button.dataset.documentCommand
      if (command === 'zoom-in') settings.zoom = Math.min(160, (settings.zoom || 100) + 10)
      if (command === 'zoom-out') settings.zoom = Math.max(60, (settings.zoom || 100) - 10)
      if (command === 'size-up') settings.zoom = Math.min(160, (settings.zoom || 100) + 5)
      if (command === 'size-down') settings.zoom = Math.max(60, (settings.zoom || 100) - 5)
      applyTheme(); saveSettings()
    }))
    $('#zoomControl').addEventListener('click', () => { settings.zoom = 100; applyTheme(); saveSettings() })
    $('#findReplaceButton').addEventListener('click', () => $('#findDialog').showModal())
    $('#findNextButton').addEventListener('click', () => { const query = $('#findInput').value; $('#findStatus').textContent = query && studio.getSource().includes(query) ? 'Match found in WMD source.' : 'No match found.' })
    $('#replaceButton').addEventListener('click', () => { const query = $('#findInput').value; if (!query) return; studio.setSource(studio.getSource().replace(query, $('#replaceInput').value)); })
    $('#replaceAllButton').addEventListener('click', () => { const query = $('#findInput').value; if (!query) return; studio.setSource(studio.getSource().split(query).join($('#replaceInput').value)); })
    $('#stylePresetButton').addEventListener('click', () => { setMode('wmd', true); toast('Styles are shared in the @config block and are editable in WMD mode.') })
    $('#renameButton').addEventListener('click', () => toast('Rename is disabled while the Yjs room is active; create a new document from the library to change its id.'))
  }

  window.addEventListener('beforeunload', () => { if (studio) studio.destroy() })
  wireUi(); applyTheme(); openDocument(documentId).catch((error) => { elements.connection.textContent = 'Error'; toast(error.message) })
})()
