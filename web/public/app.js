(() => {
  "use strict";

  const SETTINGS_KEY = "wmd-studio-settings-v4";
  const DRAFT_PREFIX = "wmd-studio-draft-v2:";
  const COLORS = ["#3f7f6b", "#b75b4a", "#486f9b", "#a47732", "#765899"];
  const CALLOUT_TYPES = ["note", "tip", "info", "warning", "danger", "rule", "example"];
  const DEFAULT_DOCUMENT_CONFIG = [
    "@config",
    "Normal Text: {wmd-formatting: ; keybind: ctrl+shift+0; size: 16px; font: arial; default: true};",
    "Title: {wmd-formatting: @title; keybind: ctrl+shift+`; size: 45px; font: arial};",
    "Heading 1: {wmd-formatting: #; keybind: ctrl+shift+1; size: 38px; font: arial; bold: true};",
    "Heading 2: {wmd-formatting: ##; keybind: ctrl+shift+2; size: 28px; font: arial; bold: true};",
    "Heading 3: {wmd-formatting: ###; keybind: ctrl+shift+3; size: 22px; font: arial; bold: true};",
    "Heading 4: {wmd-formatting: ####; keybind: ctrl+shift+4; size: 18px; font: arial; bold: false; italic: true};",
    "@endconfig",
  ].join("\n");

  const editor = document.querySelector("#editor");
  const highlightLayer = document.querySelector("#wmdHighlight");
  const highlightCode = document.querySelector("#wmdHighlight code");
  const preview = document.querySelector("#preview");
  const workspace = document.querySelector("#workspace");
  const editorPane = document.querySelector("#editorPane");
  const previewPane = document.querySelector("#previewZone");
  const splitResizer = document.querySelector('[data-resize="split"]');
  const documentName = document.querySelector("#documentName");
  const connectionStatus = document.querySelector("#connectionStatus");
  const saveStatus = document.querySelector("#saveStatus");
  const localSaveStatus = document.querySelector("#localSaveStatus");
  const presence = document.querySelector("#presence");
  const wordCount = document.querySelector("#wordCount");
  const toast = document.querySelector("#toast");
  const panelMenu = document.querySelector("#panelMenu");
  const panelsButton = document.querySelector("#panelsButton");
  const settingsDialog = document.querySelector("#settingsDialog");
  const settingsForm = document.querySelector("#settingsForm");
  const insertDialog = document.querySelector("#insertDialog");
  const insertForm = document.querySelector("#insertForm");
  const insertFields = document.querySelector("#insertFields");
  const insertDialogTitle = document.querySelector("#insertDialogTitle");
  const insertDialogDescription = document.querySelector("#insertDialogDescription");
  const confirmInsertButton = document.querySelector("#confirmInsertButton");
  const renameDialog = document.querySelector("#renameDialog");
  const renameForm = document.querySelector("#renameForm");
  const renameInput = document.querySelector("#renameInput");
  const findDialog = document.querySelector("#findDialog");
  const findForm = document.querySelector("#findForm");
  const findInput = document.querySelector("#findInput");
  const replaceInput = document.querySelector("#replaceInput");
  const findStatus = document.querySelector("#findStatus");
  const shareDialog = document.querySelector("#shareDialog");
  const shareLinkInput = document.querySelector("#shareLinkInput");
  const macroList = document.querySelector("#macroList");
  const importInput = document.querySelector("#importInput");
  const documentModeButton = document.querySelector("#documentModeButton");
  const wmdModeButton = document.querySelector("#wmdModeButton");
  const blockStyleControl = document.querySelector("#blockStyleControl");
  const fontControl = document.querySelector("#fontControl");
  const sizeIndicator = document.querySelector("#sizeIndicator");
  const zoomControl = document.querySelector("#zoomControl");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const documentsPage = document.querySelector("#documentsPage");
  const documentsListPage = document.querySelector("#documentsListPage");
  const documentsCreateForm = document.querySelector("#documentsCreateForm");
  const newDocumentName = document.querySelector("#newDocumentName");

  let settings = loadSettings();
  const state = {
    clientId: createId(),
    documentId: normalizeDocumentId(new URLSearchParams(location.search).get("doc") || "untitled"),
    mode: settings.defaultMode,
    source: "",
    serverSource: "",
    revision: 0,
    ready: false,
    dirty: false,
    pending: [],
    inFlight: null,
    users: [],
    socket: null,
    socketGeneration: 0,
    reconnectTimer: null,
    operationTimer: null,
    compileTimer: null,
    compileController: null,
    compileGeneration: 0,
    localSaveTimer: null,
    selectionTimer: null,
    collaboratorSelectionTimer: null,
    pendingCollaboratorSelection: null,
    canvasSelection: null,
    canvasText: null,
    canvasSource: null,
    canvasExternalOperations: [],
    canvasRenderId: "",
    canvasLastInputAt: 0,
    restoreCanvasSelection: false,
    previewScroll: { left: 0, top: 0 },
    previewFocus: null,
    rawScrollFrame: null,
    rawScrollMap: null,
    lastRawScrollFocus: "",
    dragging: null,
    shuttingDown: false,
    importedSource: null,
    pendingInsert: null,
    findMatch: null,
    activeTab: "",
    activePresetId: "",
    documents: [],
    documentsLoading: false,
    libraryOpen: false,
    history: { undo: [], redo: [], lastAt: 0 },
  };

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `wmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function defaults() {
    return {
      username: `Guest ${Math.floor(100 + Math.random() * 900)}`,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      syncUrl: "",
      theme: "light",
      accent: "green",
      defaultMode: "document",
      zoom: 100,
      macros: [{ trigger: "--", replacement: "\u2013" }],
      stylePresets: defaultStylePresets(),
      panes: { editor: 620 },
      panels: { editor: true, preview: true },
    };
  }

  function loadSettings() {
    const fallback = defaults();
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (!stored || typeof stored !== "object") return fallback;
      return {
        ...fallback,
        ...stored,
        username: String(stored.username || fallback.username).slice(0, 36),
        color: /^#[0-9a-f]{6}$/i.test(stored.color || "") ? stored.color : fallback.color,
        syncUrl: normalizeServerUrl(stored.syncUrl || ""),
        theme: ["light", "dark", "system"].includes(stored.theme) ? stored.theme : fallback.theme,
        accent: ["green", "orange", "blue", "graphite"].includes(stored.accent) ? stored.accent : fallback.accent,
        defaultMode: stored.defaultMode === "wmd" ? "wmd" : "document",
        zoom: clamp(stored.zoom, 60, 160),
        macros: normalizeMacros(stored.macros, fallback.macros),
        stylePresets: normalizeStylePresets(stored.stylePresets, fallback.stylePresets),
        panes: { ...fallback.panes, ...(stored.panes || {}) },
        panels: { ...fallback.panels, ...(stored.panels || {}) },
      };
    } catch (_) {
      return fallback;
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function normalizeMacros(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    return value
      .filter((macro) => macro && typeof macro.trigger === "string" && typeof macro.replacement === "string")
      .map((macro) => ({ trigger: macro.trigger.slice(0, 80), replacement: macro.replacement.slice(0, 200) }))
      .filter((macro) => macro.trigger && macro.replacement);
  }

  function defaultStylePresets() {
    return normalizeStylePresetList(DEFAULT_DOCUMENT_CONFIG.split(/\r?\n/).map(parseStyleConfigLine).filter(Boolean));
  }

  function normalizePresetId(value, fallback = "custom-style") {
    const text = String(value || fallback).trim();
    const lower = text.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (lower === "title") return "title";
    if (lower === "normal" || lower === "normal text" || lower === "paragraph") return "normal-text";
    const heading = lower.match(/^heading\s*([1-6])$/);
    if (heading) return `heading-${heading[1]}`;
    const normalized = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return normalized || fallback;
  }

  function normalizeConfigPropertyName(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  }

  function parseConfigValue(value) {
    const text = String(value || "").trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
    return text;
  }

  function parseStyleBoolean(value) {
    const text = String(value || "").trim().toLowerCase();
    if (["true", "yes", "on", "1"].includes(text)) return true;
    if (["false", "no", "off", "0", ""].includes(text)) return false;
    return true;
  }

  function parseStylePropertyBlock(rawValue) {
    let body = String(rawValue || "").trim().replace(/;\s*$/, "").trim();
    if (!body.startsWith("{") || !body.endsWith("}")) return null;
    body = body.slice(1, -1).trim();
    const props = {};
    for (const part of body.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/);
      if (!match) continue;
      props[normalizeConfigPropertyName(match[1])] = parseConfigValue(match[2]);
    }
    return props;
  }

  function parseStyleConfigLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("//")) return null;
    const match = trimmed.match(/^([^:]+?)\s*:\s*([\s\S]+?)\s*;?\s*$/);
    if (!match) return null;
    const props = parseStylePropertyBlock(match[2]);
    if (!props) return null;
    return { name: match[1].trim(), id: normalizePresetId(match[1]), ...props };
  }

  function normalizeWmdFormatting(value) {
    return String(value ?? "").trim();
  }

  function wmdFormattingInfo(value, name = "") {
    const formatting = normalizeWmdFormatting(value);
    const lower = formatting.toLowerCase();
    const heading = formatting.match(/^(#{1,6})$/);
    const base = { formatting, block: "paragraph", level: "", calloutType: "note", wrapsStyle: false, customMarker: false };
    if (!formatting) return base;
    if (lower === "@title") return { ...base, block: "title", level: 1 };
    if (lower === "@style") return { ...base, wrapsStyle: true };
    if (heading) return { ...base, block: "heading", level: heading[1].length };
    if (/^(?:-|\*|\+)\s*\[\s?\]$/.test(lower) || /^(?:-|\*|\+)\s*\[[x ]\]$/.test(lower) || lower === "checklist") return { ...base, block: "checklist" };
    if (["-", "*", "+", "unordered-list", "bullet-list"].includes(lower)) return { ...base, block: "bullet-list" };
    if (["1.", "1", "ordered-list", "numbered-list"].includes(lower)) return { ...base, block: "numbered-list" };
    const callout = lower.match(/^!([a-z][\w-]*)$/);
    if (callout && callout[1] !== "end") return { ...base, block: "callout", calloutType: callout[1] };
    const headingLike = /^heading\b/i.test(String(name || ""));
    return { ...base, block: headingLike ? "heading" : "paragraph", level: headingLike ? 2 : "", customMarker: true };
  }


  function unshiftedShortcutKey(event) {
    const code = String(event.code || "");
    const codeMap = {
      Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
      Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
      Space: "Space",
    };
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
    if (codeMap[code]) return codeMap[code];
    const key = String(event.key || "");
    return key.length === 1 ? key.toUpperCase() : key;
  }

  function normalizeShortcut(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const parts = text.split("+").map((part) => part.trim()).filter(Boolean);
    const key = parts.pop();
    if (!key || ["ctrl", "control", "alt", "shift", "meta", "cmd", "command"].includes(key.toLowerCase())) return "";
    const modifiers = new Set(parts.map((part) => part.toLowerCase()));
    const canonical = [];
    if (modifiers.has("ctrl") || modifiers.has("control")) canonical.push("Ctrl");
    if (modifiers.has("alt")) canonical.push("Alt");
    if (modifiers.has("shift")) canonical.push("Shift");
    if (modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command")) canonical.push("Meta");
    if (!canonical.length) return "";
    canonical.push(key.length === 1 ? key.toUpperCase() : key.replace(/^space$/i, "Space"));
    return canonical.join("+");
  }

  function shortcutFromEvent(event) {
    const rawKey = unshiftedShortcutKey(event);
    if (!rawKey || ["Control", "Alt", "Shift", "Meta"].includes(rawKey)) return "";
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    if (!parts.length) return "";
    parts.push(rawKey.length === 1 ? rawKey.toUpperCase() : rawKey);
    return parts.join("+");
  }

  function normalizePresetSize(value) {
    const text = String(value || "").trim();
    return /^(?:\d+(?:\.\d+)?)(?:px|rem|em|%|pt)$/i.test(text) ? text : "";
  }

  function normalizePresetFont(value) {
    return String(value || "").replace(/[;{}<>]/g, "").trim().slice(0, 120);
  }

  function normalizeCssValue(value) {
    return String(value || "").replace(/[;{}<>]/g, "").trim().slice(0, 160);
  }

  function normalizeTextValue(value) {
    return String(value || "").replace(/[<>]/g, "").trim().slice(0, 120);
  }

  function normalizeIdentifier(value, fallback = "note") {
    const text = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return text && text !== "end" ? text.slice(0, 48) : fallback;
  }

  function normalizePresetBlock(value, fallback = "keep") {
    return ["keep", "paragraph", "heading", "bullet-list", "numbered-list", "checklist", "callout"].includes(value) ? value : fallback;
  }

  function normalizePresetLevel(value, fallback = "") {
    if (value === "" || value == null) return fallback === undefined ? "" : fallback;
    const level = Math.round(clamp(Number(value), 1, 6));
    return Number.isFinite(level) ? level : fallback;
  }

  function normalizeStylePreset(value, fallback = {}, builtin = false) {
    void builtin;
    const source = value && typeof value === "object" ? value : {};
    const prop = (name) => source[name] ?? source[normalizeConfigPropertyName(name)];
    const sourceId = source.id || source.name;
    const id = normalizePresetId(sourceId, fallback.id || "custom-style");
    if (!id) return null;

    const wmdFormatting = normalizeWmdFormatting(prop("wmd-formatting") ?? prop("wmdFormatting") ?? fallback.wmdFormatting ?? fallback["wmd-formatting"] ?? "@style");
    const info = wmdFormattingInfo(wmdFormatting, source.name || source.id || fallback.name || fallback.id);
    let block = info.block;
    let level = info.level;
    let calloutType = info.calloutType;

    if (wmdFormatting === "@style") {
      block = normalizePresetBlock(String(prop("block") || fallback.block || "paragraph").toLowerCase(), "paragraph");
      level = normalizePresetLevel(prop("level"), fallback.level || "");
      calloutType = CALLOUT_TYPES.includes(String(prop("callout-type") || fallback.calloutType || "").toLowerCase()) ? String(prop("callout-type") || fallback.calloutType).toLowerCase() : "note";
    }

    return {
      id,
      name: String(source.name ?? fallback.name ?? sourceId ?? id).trim().slice(0, 48) || id,
      wmdFormatting,
      font: normalizePresetFont(prop("font") ?? fallback.font),
      size: normalizePresetSize(prop("size") ?? fallback.size),
      bold: prop("bold") !== undefined ? parseStyleBoolean(prop("bold")) : Boolean(fallback.bold),
      italic: prop("italic") !== undefined ? parseStyleBoolean(prop("italic")) : Boolean(fallback.italic),
      underline: prop("underline") !== undefined ? parseStyleBoolean(prop("underline")) : Boolean(fallback.underline),
      strike: prop("strike") !== undefined || prop("strikethrough") !== undefined ? parseStyleBoolean(prop("strike") ?? prop("strikethrough")) : Boolean(fallback.strike),
      highlight: prop("highlight") !== undefined ? parseStyleBoolean(prop("highlight")) : Boolean(fallback.highlight),
      block,
      heading: block === "heading" || block === "title",
      level,
      shortcut: normalizeShortcut(prop("keybind") ?? prop("shortcut") ?? fallback.shortcut),
      calloutType: normalizeIdentifier(prop("callout-type") ?? prop("calloutType") ?? fallback.calloutType ?? calloutType, calloutType),
      calloutTitle: normalizeTextValue(prop("callout-title") ?? prop("calloutTitle") ?? fallback.calloutTitle),
      calloutIcon: normalizeTextValue(prop("callout-icon") ?? prop("icon") ?? fallback.calloutIcon),
      calloutBackground: normalizeCssValue(prop("callout-bg") ?? prop("callout-background") ?? prop("background") ?? prop("background-color") ?? prop("background-colour") ?? fallback.calloutBackground),
      calloutBorder: normalizeCssValue(prop("callout-border") ?? prop("border") ?? prop("border-color") ?? prop("border-colour") ?? prop("accent") ?? prop("accent-color") ?? prop("accent-colour") ?? fallback.calloutBorder),
      calloutText: normalizeCssValue(prop("callout-text") ?? prop("text") ?? prop("text-color") ?? prop("text-colour") ?? fallback.calloutText),
      calloutTitleColor: normalizeCssValue(prop("callout-title-color") ?? prop("callout-title-colour") ?? prop("title-color") ?? prop("title-colour") ?? fallback.calloutTitleColor),
      calloutRadius: normalizeCssValue(prop("callout-radius") ?? prop("radius") ?? prop("border-radius") ?? fallback.calloutRadius),
      default: prop("default") !== undefined || prop("default") !== undefined ? parseStyleBoolean(prop("default") ?? prop("default")) : Boolean(fallback.default),
      builtin: false,
    };
  }

  function normalizeStylePresets(value, fallback = defaultStylePresets()) {
    const incoming = Array.isArray(value) ? value : fallback;
    return normalizeStylePresetList(incoming.length ? incoming : fallback);
  }

  function fallbackPresetFor(source, index = 0) {
    const id = normalizePresetId(source && (source.id || source.name), `custom-style-${index + 1}`);
    return { id, name: source?.name || "Custom style", wmdFormatting: "@style", font: "", size: "", bold: false, italic: false, underline: false, strike: false, highlight: false, block: "paragraph", heading: false, level: "", shortcut: "", calloutType: "note", calloutTitle: "", calloutIcon: "", calloutBackground: "", calloutBorder: "", calloutText: "", calloutTitleColor: "", calloutRadius: "", default: false, builtin: false };
  }

  function normalizeStylePresetList(value) {
    const usedIds = new Set();
    const normalizedPresets = (Array.isArray(value) ? value : []).map((preset, index) => {
      const fallback = fallbackPresetFor(preset, index);
      const normalized = normalizeStylePreset(preset, fallback, false);
      if (!normalized) return null;
      if (usedIds.has(normalized.id)) normalized.id = `custom-style-${index + 1}`;
      usedIds.add(normalized.id);
      return normalized;
    }).filter(Boolean);
    let defaultAssigned = false;
    normalizedPresets.forEach((preset) => {
      if (preset.default && !defaultAssigned) {
        defaultAssigned = true;
        return;
      }
      preset.default = false;
    });
    if (!defaultAssigned) {
      const fallbackDefault = normalizedPresets.find((preset) => preset.id === "normal-text")
        || normalizedPresets.find((preset) => preset.block === "paragraph" && !preset.wmdFormatting)
        || normalizedPresets[0]
        || null;
      if (fallbackDefault) fallbackDefault.default = true;
    }
    return normalizedPresets;
  }

  function normalizeServerUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      if (!/^https?:$/.test(url.protocol)) return "";
      if (location.protocol === "https:" && url.protocol !== "https:") return "";
      return url.origin;
    } catch (_) {
      return "";
    }
  }

  function syncBase() {
    return settings.syncUrl || location.origin;
  }

  function apiUrl(pathname) {
    return `${syncBase()}${pathname}`;
  }

  function collaborationUrl() {
    const base = new URL(syncBase());
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/collaboration`;
    base.search = "";
    base.hash = "";
    return base.toString();
  }

  function shareUrl() {
    const url = new URL(`${syncBase()}/`);
    url.searchParams.set("doc", state.documentId);
    return url.toString();
  }

  function draftKey(documentId = state.documentId) {
    return `${DRAFT_PREFIX}${syncBase()}::${documentId}`;
  }

  function readDraft(documentId = state.documentId) {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(documentId)));
      return draft && typeof draft.source === "string" ? draft : null;
    } catch (_) {
      return null;
    }
  }

  function scheduleDraftSave() {
    clearTimeout(state.localSaveTimer);
    localSaveStatus.textContent = "Saving local copy...";
    state.localSaveTimer = setTimeout(() => persistDraft(), 160);
  }

  function persistDraft() {
    clearTimeout(state.localSaveTimer);
    state.localSaveTimer = null;
    try {
      localStorage.setItem(draftKey(), JSON.stringify({
        source: state.source,
        dirty: state.dirty || Boolean(state.pending.length || state.inFlight),
        updatedAt: Date.now(),
      }));
      localSaveStatus.textContent = "Local copy saved";
    } catch (_) {
      localSaveStatus.textContent = "Local copy unavailable";
    }
  }

  function removeDraft(documentId = state.documentId) {
    try { localStorage.removeItem(draftKey(documentId)); } catch (_) { /* Local storage may be unavailable. */ }
  }

  function normalizeDocumentId(value) {
    const normalized = String(value || "untitled")
      .toLowerCase()
      .trim()
      .replace(/\.[^./\\]+$/, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : "untitled";
  }

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
  }

  function toastMessage(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastMessage.timer);
    toastMessage.timer = setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function appendPart(target, part) {
    if (part === 0 || part === "") return;
    const previous = target[target.length - 1];
    if (typeof part === "number" && typeof previous === "number" && Math.sign(part) === Math.sign(previous)) {
      target[target.length - 1] += part;
    } else if (typeof part === "string" && typeof previous === "string") {
      target[target.length - 1] += part;
    } else {
      target.push(part);
    }
  }

  function applyOperation(source, operation) {
    let index = 0;
    let output = "";
    for (const part of operation.ops) {
      if (typeof part === "string") output += part;
      else if (part > 0) {
        output += source.slice(index, index + part);
        index += part;
      } else {
        index += -part;
      }
    }
    if (index !== source.length) throw new Error("The shared document needs to refresh.");
    return output;
  }

  function operationFromDiff(before, after) {
    if (before === after) return null;
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) suffix += 1;
    const ops = [];
    appendPart(ops, prefix);
    appendPart(ops, -(before.length - prefix - suffix));
    appendPart(ops, after.slice(prefix, after.length - suffix));
    appendPart(ops, suffix);
    return { ops };
  }

  function consumePart(part, length) {
    if (typeof part === "string") return part.slice(length);
    return part > 0 ? part - length : part + length;
  }

  function transformOperations(left, right) {
    const leftParts = left.ops.slice();
    const rightParts = right.ops.slice();
    let leftPart = leftParts.shift();
    let rightPart = rightParts.shift();
    const leftPrime = [];
    const rightPrime = [];

    while (leftPart !== undefined || rightPart !== undefined) {
      if (typeof leftPart === "string") {
        appendPart(leftPrime, leftPart);
        appendPart(rightPrime, leftPart.length);
        leftPart = leftParts.shift();
        continue;
      }
      if (typeof rightPart === "string") {
        appendPart(leftPrime, rightPart.length);
        appendPart(rightPrime, rightPart);
        rightPart = rightParts.shift();
        continue;
      }
      if (leftPart === undefined || rightPart === undefined) throw new Error("Incompatible collaboration operations.");
      const length = Math.min(Math.abs(leftPart), Math.abs(rightPart));
      if (leftPart > 0 && rightPart > 0) {
        appendPart(leftPrime, length);
        appendPart(rightPrime, length);
      } else if (leftPart < 0 && rightPart > 0) {
        appendPart(leftPrime, -length);
      } else if (leftPart > 0 && rightPart < 0) {
        appendPart(rightPrime, -length);
      }
      leftPart = consumePart(leftPart, length);
      rightPart = consumePart(rightPart, length);
      if (leftPart === 0) leftPart = leftParts.shift();
      if (rightPart === 0) rightPart = rightParts.shift();
    }
    return [{ ops: leftPrime }, { ops: rightPrime }];
  }

  function trackCanvasExternalOperation(operation) {
    if (!operation || state.mode !== "document" || typeof state.canvasSource !== "string") return;
    state.canvasExternalOperations.push(operation);
  }

  function rebaseCanvasOperation(operation) {
    let rebased = operation;
    const externalOperations = [];
    for (const external of state.canvasExternalOperations) {
      const [localPrime, externalPrime] = transformOperations(rebased, external);
      rebased = localPrime;
      externalOperations.push(externalPrime);
    }
    return { operation: rebased, externalOperations };
  }

  function resolvedTheme() {
    if (settings.theme !== "system") return settings.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyAppearance() {
    const theme = resolvedTheme();
    document.body.dataset.theme = theme;
    document.body.dataset.accent = settings.accent;
    themeMeta.content = theme === "dark" ? "#101711" : "#f4f1e8";
    updateToolbarValues();
    if (state.ready) scheduleCompile(0);
  }

  function updateToolbarValues() {
    const preset = stylePresetById(state.activePresetId);
    const baseSize = preset ? presetSizeInPixels(preset) : (Number.parseInt(configValue("baseSize", "16px"), 10) || 16);
    const font = preset?.font || configValue("font", "Arial, sans-serif");
    sizeIndicator.textContent = String(Math.round(baseSize));
    zoomControl.textContent = `${settings.zoom}%`;
    fontControl.value = [...fontControl.options].some((option) => option.value === font) ? font : "Arial, sans-serif";
    fontControl.style.fontFamily = fontControl.value;
    const styleValue = preset ? `preset:${preset.id}` : blockStyleControl.value;
    if ([...blockStyleControl.options].some((option) => option.value === styleValue)) blockStyleControl.value = styleValue;
  }

  function documentStylePresets() {
    return normalizeStylePresetList(parseStylePresetConfig(state.source));
  }

  function defaultDocumentPreset() {
    const presets = documentStylePresets();
    return presets.find((preset) => preset.default)
      || presets.find((preset) => preset.block === "paragraph" && !preset.wmdFormatting)
      || presets[0]
      || null;
  }

  function stylePresetById(id) {
    return documentStylePresets().find((preset) => preset.id === id) || null;
  }

  function renderPresetOptions() {
    const selected = blockStyleControl.value;
    blockStyleControl.replaceChildren();
    const presets = documentStylePresets();
    presets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = `preset:${preset.id}`;
      option.textContent = preset.shortcut ? `${preset.name} (${preset.shortcut})` : preset.name;
      option.style.fontFamily = preset.font || "inherit";
      blockStyleControl.append(option);
    });
    const create = document.createElement("option");
    create.value = "preset:new";
    create.textContent = "+ New custom style...";
    blockStyleControl.append(create);
    const fallbackPreset = defaultDocumentPreset() || presets[0] || null;
    const fallback = fallbackPreset ? `preset:${fallbackPreset.id}` : "preset:new";
    blockStyleControl.value = [...blockStyleControl.options].some((option) => option.value === selected) ? selected : fallback;
  }

  function presetStyleDeclarations(preset) {
    const declarations = [
      `font-weight:${preset.bold ? "700" : "400"}`,
      `font-style:${preset.italic ? "italic" : "normal"}`,
      `text-decoration-line:${[preset.underline ? "underline" : "", preset.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none"}`,
    ];
    if (preset.highlight) declarations.push("background:color-mix(in srgb, var(--warm) 50%, transparent)");
    if (preset.font) declarations.push(`font-family:${preset.font}`);
    if (preset.size) declarations.push(`font-size:${preset.size}`);
    if (preset.calloutText) declarations.push(`color:${preset.calloutText}`);
    return declarations.join(";");
  }

  function cssString(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function nativeStyleSelectors(preset) {
    const info = wmdFormattingInfo(preset?.wmdFormatting || "", preset?.name || "");
    const idSelector = `.tab-section [data-wmd-preset="${preset.id}"]`;
    if (info.wrapsStyle || info.customMarker) return [idSelector];
    if (info.block === "title") return [`.tab-section .tab-title`, idSelector];
    if (info.block === "heading" && info.level) return [`.tab-section h${info.level}:not(.tab-title):not([data-wmd-preset])`, idSelector];
    if (info.block === "paragraph") return [`.tab-section p:not([data-wmd-preset])`, idSelector];
    if (info.block === "bullet-list" || info.block === "checklist") return [`.tab-section ul:not([data-wmd-preset])`, idSelector];
    if (info.block === "numbered-list") return [`.tab-section ol:not([data-wmd-preset])`, idSelector];
    if (info.block === "callout") return [`.tab-section .callout-${info.calloutType}:not([data-wmd-preset])`, idSelector];
    return [idSelector];
  }

  function stylePresetCss() {
    return documentStylePresets().map((preset) => {
      const selectors = nativeStyleSelectors(preset);
      const blocks = [`${selectors.join(",")}{${presetStyleDeclarations(preset)}}`];
      if (preset.block === "callout") {
        const callout = [];
        if (preset.calloutBackground) callout.push(`background:${preset.calloutBackground}`);
        if (preset.calloutBorder) callout.push(`border-left-color:${preset.calloutBorder}`);
        if (preset.calloutText) callout.push(`color:${preset.calloutText}`);
        if (preset.calloutRadius) callout.push(`border-radius:${preset.calloutRadius}`);
        if (callout.length) blocks.push(`${selectors.join(",")}{${callout.join(";")}}`);
        if (preset.calloutTitleColor) blocks.push(`${selectors.map((selector) => `${selector} .callout-title`).join(",")}{color:${preset.calloutTitleColor}}`);
        if (preset.calloutIcon) blocks.push(`${selectors.map((selector) => `${selector} .callout-title::before`).join(",")}{content:"${cssString(preset.calloutIcon)}";margin-right:.45em}`);
      }
      return blocks.join("");
    }).join("");
  }


  function presetSizeInPixels(preset) {
    const raw = preset.size || configValue("baseSize", "16px");
    const match = String(raw).match(/^(\d+(?:\.\d+)?)(px|rem|em|%|pt)$/i);
    if (!match) return 16;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "rem" || unit === "em") return amount * 16;
    if (unit === "%") return amount * 0.16;
    if (unit === "pt") return amount * 1.333;
    return amount;
  }

  function setActivePreset(id) {
    state.activePresetId = stylePresetById(id)?.id || "";
    updateToolbarValues();
  }

  function updateStylePreset(id, changes) {
    const existing = stylePresetById(id);
    if (!existing) return;
    const nextPreset = normalizeStylePreset({ ...existing, ...changes }, existing, false);
    changeSource(writeStylePresetConfig(state.source, nextPreset, existing), { compile: true, keepEditor: state.mode === "wmd" });
    renderPresetOptions();
    setActivePreset(id);
    if (state.mode === "document") sendCanvasState();
  }

  function updateActivePresetFormatting(command) {
    const preset = stylePresetById(state.activePresetId);
    if (!preset) return false;
    const property = { bold: "bold", italic: "italic", underline: "underline", strikeThrough: "strike", highlight: "highlight" }[command];
    if (!property) return false;
    updateStylePreset(preset.id, { [property]: !preset[property] });
    return true;
  }

  function openStylePresetDialog() {
    openInsertDialog("preset", stylePresetById(state.activePresetId));
  }

  function customPresetId(name) {
    const base = `custom-${normalizePresetId(name, "style")}`;
    let id = base;
    let suffix = 2;
    while (stylePresetById(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  }

  function saveStylePreset(values, presetId) {
    const existing = stylePresetById(presetId);
    const fallback = existing || { id: customPresetId(values?.name), name: "Custom style", wmdFormatting: "@style", font: "", size: "", bold: false, italic: false, underline: false, strike: false, highlight: false, block: "paragraph", heading: false, level: "", shortcut: "", calloutType: "note", default: false, builtin: false };
    const sourcePreset = { ...fallback, ...values };
    if (existing && values?.name) delete sourcePreset.id;
    const nextPreset = normalizeStylePreset(sourcePreset, fallback, false);
    let nextSource = writeStylePresetConfig(state.source, nextPreset, existing);
    if (existing && existing.id !== nextPreset.id) nextSource = replaceStyleReferences(nextSource, existing, nextPreset);
    changeSource(nextSource, { compile: true, keepEditor: state.mode === "wmd" });
    renderPresetOptions();
    setActivePreset(nextPreset.id);
    if (state.mode === "document") sendCanvasState();
    applyStylePreset(nextPreset);
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function replaceStyleReferences(source, previousPreset, nextPreset) {
    const names = [previousPreset?.name, previousPreset?.id].filter(Boolean).map(escapeRegExp).join("|");
    if (!names) return source;
    return String(source || "").replace(new RegExp(`^@style\\s+(?:${names})\\s*$`, "gmi"), `@style ${nextPreset.name}`);
  }

  function configValue(name, fallback) {
    const match = state.source.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : fallback;
  }

  function parseConfigBlock(source) {
    const match = String(source || "").match(/^@config\s*$([\s\S]*?)^@endconfig\s*$/m);
    return match ? match[1] : "";
  }

  function parseStylePresetConfig(source) {
    return parseConfigBlock(source).split(/\r?\n/).map(parseStyleConfigLine).filter(Boolean);
  }

  function configStyleLineId(line) {
    const style = parseStyleConfigLine(line);
    return style ? style.id : "";
  }

  function configStyleName(id) {
    const preset = stylePresetById(id);
    return preset ? preset.name : id;
  }

  function stylePresetForConfig(preset) {
    const props = [];
    const add = (name, value, includeEmpty = false) => {
      if (!includeEmpty && (value === undefined || value === null || value === "" || value === false)) return;
      props.push(`${name}: ${value ?? ""}`);
    };
    add("wmd-formatting", preset.wmdFormatting || "", true);
    add("keybind", preset.shortcut || "");
    add("size", preset.size || "");
    add("font", preset.font || "");
    add("bold", preset.bold ? "true" : "");
    add("italic", preset.italic ? "true" : "");
    add("underline", preset.underline ? "true" : "");
    add("strike", preset.strike ? "true" : "");
    add("highlight", preset.highlight ? "true" : "");
    add("default", preset.default ? "true" : "");
    add("callout-type", preset.calloutType && preset.block === "callout" ? preset.calloutType : "");
    add("callout-title", preset.calloutTitle || "");
    add("callout-icon", preset.calloutIcon || "");
    add("callout-bg", preset.calloutBackground || "");
    add("callout-border", preset.calloutBorder || "");
    add("callout-text", preset.calloutText || "");
    add("callout-title-color", preset.calloutTitleColor || "");
    add("callout-radius", preset.calloutRadius || "");
    const name = (preset.name || preset.id || "Custom Style").replace(/[\r\n:{};]/g, " ").replace(/\s+/g, " ").trim();
    return `${name}: {${props.join("; ")}};`;
  }

  function clearDefaultFlagFromConfigLine(line) {
    const match = String(line || "").match(/^(\s*[^:]+:\s*\{)([\s\S]*?)(\}\s*;?\s*)$/);
    if (!match) return line;
    const props = match[2]
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^(?:default|default)\s*:/i.test(part));
    return `${match[1]}${props.join("; ")}${match[3]}`;
  }


  function writeStylePresetConfig(source, preset, previousPreset = null) {
    const line = stylePresetForConfig(preset);
    const targetIds = new Set([preset.id, previousPreset?.id].filter(Boolean));
    const configMatch = String(source || "").match(/^@config\s*$[\s\S]*?^@endconfig\s*$/m);

    if (configMatch) {
      const replacementLines = configMatch[0].split(/\r?\n/);
      let replaced = false;
      for (let index = 1; index < replacementLines.length - 1; index += 1) {
        const id = configStyleLineId(replacementLines[index]);
        if (id && targetIds.has(id)) {
          replacementLines[index] = line;
          replaced = true;
          break;
        }
      }
      if (!replaced) replacementLines.splice(Math.max(1, replacementLines.length - 1), 0, line);
      if (preset.default) {
        for (let index = 1; index < replacementLines.length - 1; index += 1) {
          const id = configStyleLineId(replacementLines[index]);
          if (id && id !== preset.id) replacementLines[index] = clearDefaultFlagFromConfigLine(replacementLines[index]);
        }
      }
      return source.replace(configMatch[0], replacementLines.join("\n"));
    }

    return `@config\n${line}\n@endconfig\n\n${source}`;
  }

  function changeConfig(name, value) {
    const pattern = new RegExp(`^${name}:\\s*.*$`, "m");
    let next;
    if (pattern.test(state.source)) next = state.source.replace(pattern, `${name}: ${value}`);
    else if (/^@config\s*$/m.test(state.source)) next = state.source.replace(/^@config\s*$/m, `@config\n${name}: ${value}`);
    else next = `@config\n${name}: ${value}\n@endconfig\n\n${state.source}`;
    changeSource(next, { compile: true });
  }

  function effectivePanels() {
    const panels = {
      editor: state.mode === "wmd" && settings.panels.editor,
      preview: settings.panels.preview,
    };
    // Keep one useful pane visible rather than leaving the workspace blank.
    if (!panels.editor && !panels.preview) panels.preview = true;
    return panels;
  }

  function applyPaneLayout() {
    const visible = effectivePanels();
    editorPane.hidden = !visible.editor;
    previewPane.hidden = !visible.preview;
    const showPreviewHandle = visible.editor && visible.preview;
    splitResizer.hidden = !showPreviewHandle;
    const columns = [];
    if (visible.editor) {
      const maxEditorWidth = Math.max(360, workspace.clientWidth - 468);
      columns.push(`${clamp(settings.panes.editor, 360, maxEditorWidth)}px`);
    }
    if (showPreviewHandle) columns.push("8px");
    if (visible.preview) columns.push("minmax(460px, 1fr)");
    workspace.style.gridTemplateColumns = columns.length ? columns.join(" ") : "1fr";
    document.querySelectorAll("[data-panel-toggle]").forEach((input) => {
      input.checked = Boolean(settings.panels[input.dataset.panelToggle]);
    });
  }

  function setPanelMenu(open) {
    panelMenu.hidden = !open;
    panelsButton.setAttribute("aria-expanded", String(open));
  }

  function updateIdentity() {
    documentName.textContent = documentTitle();
    document.title = `${documentName.textContent} | WMD Studio`;
  }

  function documentTitle() {
    const title = state.source.match(/^@title\s+(.+)$/m);
    return title ? title[1].trim() : state.documentId.replace(/[-_]+/g, " ");
  }

  function openRenameDialog() {
    renameInput.value = documentTitle();
    renameDialog.showModal();
    requestAnimationFrame(() => {
      renameInput.focus();
      renameInput.select();
    });
  }

  function renameDocument(title) {
    const nextTitle = String(title || "").trim().replace(/[\r\n]+/g, " ");
    if (!nextTitle) return;
    const titlePattern = /^@title\s+.*$/m;
    let nextSource;
    if (titlePattern.test(state.source)) nextSource = state.source.replace(titlePattern, `@title ${nextTitle}`);
    else if (/^@tab\s+.+$/m.test(state.source)) nextSource = state.source.replace(/^@tab\s+.+$/m, (tab) => `${tab}\n@title ${nextTitle}`);
    else nextSource = `@title ${nextTitle}\n\n${state.source}`;
    changeSource(nextSource, { compile: true });
    toastMessage("Document renamed.");
  }

  function openShareDialog() {
    shareLinkInput.value = shareUrl();
    shareDialog.showModal();
    requestAnimationFrame(() => {
      shareLinkInput.focus();
      shareLinkInput.select();
    });
  }

  function openFindDialog() {
    const selected = state.mode === "wmd" ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : "";
    if (selected) findInput.value = selected;
    findStatus.textContent = "Searches the WMD source so replacements are safe and shared.";
    findDialog.showModal();
    requestAnimationFrame(() => findInput.focus());
  }

  function selectFindMatch(start, end) {
    setMode("wmd", true);
    requestAnimationFrame(() => {
      editor.setSelectionRange(start, end);
      const line = state.source.slice(0, start).split("\n").length - 1;
      const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 23;
      editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight / 2);
      editor.focus();
      scheduleRawSelection();
    });
  }

  function findNext() {
    const query = findInput.value;
    if (!query) return;
    const prior = state.findMatch && state.findMatch.query === query ? state.findMatch.index + 1 : 0;
    let index = state.source.indexOf(query, prior);
    let wrapped = false;
    if (index === -1 && prior > 0) {
      index = state.source.indexOf(query);
      wrapped = index !== -1;
    }
    if (index === -1) {
      state.findMatch = null;
      findStatus.textContent = `No matches for "${query}".`;
      return;
    }
    state.findMatch = { query, index };
    findStatus.textContent = wrapped ? "Found a match from the start of the document." : "Match found.";
    selectFindMatch(index, index + query.length);
  }

  function replaceCurrentMatch() {
    const query = findInput.value;
    if (!query) return;
    const match = state.findMatch && state.findMatch.query === query ? state.findMatch : null;
    if (!match) {
      findNext();
      return;
    }
    const replacement = replaceInput.value;
    const next = `${state.source.slice(0, match.index)}${replacement}${state.source.slice(match.index + query.length)}`;
    state.findMatch = { query, index: match.index + replacement.length - 1 };
    changeSource(next, { compile: true, keepEditor: true });
    findStatus.textContent = "Replaced one match.";
    findNext();
  }

  function replaceAllMatches() {
    const query = findInput.value;
    if (!query) return;
    const count = state.source.split(query).length - 1;
    if (!count) {
      findStatus.textContent = `No matches for "${query}".`;
      return;
    }
    changeSource(state.source.split(query).join(replaceInput.value), { compile: true, keepEditor: true });
    state.findMatch = null;
    findStatus.textContent = `Replaced ${count} match${count === 1 ? "" : "es"}.`;
  }

  function updateWordCount() {
    const plain = state.source
      .replace(/^@(config|endconfig|tab|title|var|hidden|toc|include|embed|collapse|endcollapse).*$/gm, "")
      .replace(/^!(note|tip|info|warning|danger|rule|example|end).*$/gm, "")
      .replace(/[`*_+=[\]{}()#]/g, " ");
    const words = plain.trim() ? plain.trim().split(/\s+/).length : 0;
    wordCount.textContent = `${words.toLocaleString()} word${words === 1 ? "" : "s"}`;
  }

  function parsedTabs() {
    return [...state.source.matchAll(/^@tab\s+(.+?)(?:\s+\{hidden\})?\s*$/gm)]
      .map((match) => match[1].trim())
      .filter(Boolean);
  }

  function documentLinkTargets() {
    const targets = [];
    let tab = "";
    for (const line of state.source.split("\n")) {
      const tabMatch = line.match(/^@tab\s+(.+?)(?:\s+\{hidden\})?\s*$/);
      if (tabMatch) {
        tab = tabMatch[1].trim();
        targets.push({ value: tab, label: tab });
        continue;
      }
      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (tab && headingMatch) {
        const heading = previewText(headingMatch[1]);
        if (heading) targets.push({ value: `${tab}#${heading}`, label: `${tab} / ${heading}` });
      }
    }
    return targets;
  }

  function renderDocumentTabs() {
    const tabs = parsedTabs();
    if (!tabs.includes(state.activeTab)) state.activeTab = tabs[0] || "";
  }

  function renderSource(options = {}) {
    // Do not reset the raw textarea while its own input event is being handled.
    if (state.mode === "wmd") {
      if (!options.keepEditor && editor.value !== state.source) editor.value = state.source;
      renderHighlight();
    }
    updateIdentity();
    updateWordCount();
    renderDocumentTabs();
    renderPresetOptions();
    updateToolbarValues();
  }

  function mapOffsetThroughOperation(offset, operation) {
    const sourceOffset = Math.max(0, Number(offset) || 0);
    let consumed = 0;
    let produced = 0;

    for (const part of operation && operation.ops || []) {
      if (typeof part === "string") {
        produced += part.length;
        continue;
      }
      if (part > 0) {
        if (sourceOffset <= consumed + part) return produced + Math.max(0, sourceOffset - consumed);
        consumed += part;
        produced += part;
      } else if (part < 0) {
        const removed = -part;
        if (sourceOffset <= consumed + removed) return produced;
        consumed += removed;
      }
    }

    return produced + Math.max(0, sourceOffset - consumed);
  }

  function textOccurrences(source, value, limit = 120) {
    if (!value) return [];
    const positions = [];
    let position = source.indexOf(value);
    while (position !== -1 && positions.length < limit) {
      positions.push(position);
      position = source.indexOf(value, position + 1);
    }
    return positions;
  }

  function mapOffsetBetweenTexts(before, after, offset) {
    const sourceOffset = clamp(Number(offset) || 0, 0, before.length);
    if (before === after) return clamp(sourceOffset, 0, after.length);

    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix
      && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    if (sourceOffset <= prefix) return sourceOffset;
    if (sourceOffset >= before.length - suffix) return after.length - (before.length - sourceOffset);

    const contextSize = 32;
    const left = before.slice(Math.max(0, sourceOffset - contextSize), sourceOffset);
    const right = before.slice(sourceOffset, Math.min(before.length, sourceOffset + contextSize));
    const combined = left + right;
    const combinedMatches = textOccurrences(after, combined);
    if (combinedMatches.length === 1) return combinedMatches[0] + left.length;

    const expected = clamp(sourceOffset + (after.length - before.length), 0, after.length);
    const leftEnds = textOccurrences(after, left).map((position) => position + left.length);
    const rightStarts = textOccurrences(after, right);
    let best = null;
    for (const leftEnd of leftEnds) {
      for (const rightStart of rightStarts) {
        if (leftEnd > rightStart) continue;
        const score = (rightStart - leftEnd) * 4 + Math.abs(rightStart - expected);
        if (!best || score < best.score) best = { offset: rightStart, score };
      }
    }
    if (best) return best.offset;
    if (rightStarts.length) return rightStarts.reduce((nearest, position) => Math.abs(position - expected) < Math.abs(nearest - expected) ? position : nearest);
    if (leftEnds.length) return leftEnds.reduce((nearest, position) => Math.abs(position - expected) < Math.abs(nearest - expected) ? position : nearest);

    return mapOffsetThroughOperation(sourceOffset, operationFromDiff(before, after));
  }

  function remapCanvasSelections(before, after) {
    state.users = state.users.map((user) => {
      if (!user.selection || user.selection.mode !== "canvas") return user;
      return {
        ...user,
        selection: {
          ...user.selection,
          start: mapOffsetBetweenTexts(before, after, user.selection.start),
          end: mapOffsetBetweenTexts(before, after, user.selection.end),
        },
      };
    });
  }

  function transformCollaboratorSelections(operation, mode) {
    if (!operation) return;
    state.users = state.users.map((user) => {
      if (!user.selection || user.selection.mode !== mode) return user;
      return {
        ...user,
        selection: {
          ...user.selection,
          start: mapOffsetThroughOperation(user.selection.start, operation),
          end: mapOffsetThroughOperation(user.selection.end, operation),
        },
      };
    });
  }

  function refreshCollaborators() {
    renderPresence();
    sendCanvasCursors();
    if (state.mode === "wmd") renderHighlight();
  }

  function updateCollaborator(user) {
    if (!user || !user.id) return;
    const index = state.users.findIndex((candidate) => candidate.id === user.id);
    if (index === -1) state.users = [...state.users, user];
    else state.users = state.users.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...user } : candidate);
    refreshCollaborators();
  }

  function captureRawSelection() {
    if (state.mode !== "wmd" || document.activeElement !== editor) return null;
    return {
      start: editor.selectionStart,
      end: editor.selectionEnd,
      source: state.source,
      scrollTop: editor.scrollTop,
      scrollLeft: editor.scrollLeft,
    };
  }

  function restoreRawSelection(selection) {
    if (!selection) return;
    const previousSource = typeof selection.source === "string" ? selection.source : state.source;
    const start = clamp(mapOffsetBetweenTexts(previousSource, state.source, selection.start), 0, state.source.length);
    const end = clamp(mapOffsetBetweenTexts(previousSource, state.source, selection.end), 0, state.source.length);
    editor.setSelectionRange(start, end);
    editor.scrollTop = selection.scrollTop;
    editor.scrollLeft = selection.scrollLeft;
  }

  function setConnectionState(kind, label) {
    connectionStatus.className = `connection-status ${kind}`;
    connectionStatus.textContent = label;
  }

  function send(message) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(message));
  }

  function clearOperationTimeout() {
    clearTimeout(state.operationTimer);
    state.operationTimer = null;
  }

  function watchInFlightOperation(entry) {
    clearOperationTimeout();
    state.operationTimer = setTimeout(() => {
      if (!state.inFlight || state.inFlight.id !== entry.id) return;
      setConnectionState("problem", "Sync delayed - retrying");
      requestRefresh();
    }, 10_000);
  }

  function connect() {
    clearTimeout(state.reconnectTimer);
    const generation = ++state.socketGeneration;
    if (state.socket && state.socket.readyState < WebSocket.CLOSING) state.socket.close();
    setConnectionState("", settings.syncUrl ? "Connecting remote" : "Connecting");

    let socket;
    try {
      socket = new WebSocket(collaborationUrl());
    } catch (_) {
      scheduleReconnect(generation);
      return;
    }
    state.socket = socket;

    socket.addEventListener("open", () => {
      if (generation !== state.socketGeneration || state.shuttingDown) return;
      setConnectionState("connected", settings.syncUrl ? "Remote live" : "Live");
      send({ type: "join", documentId: state.documentId, name: settings.username, color: settings.color, clientId: state.clientId });
    });
    socket.addEventListener("message", (event) => {
      if (generation !== state.socketGeneration) return;
      try { handleSocketMessage(JSON.parse(event.data)); } catch (error) { toastMessage(error.message); requestRefresh(); }
    });
    socket.addEventListener("error", () => {
      if (generation === state.socketGeneration) setConnectionState("problem", "Offline - local copy safe");
    });
    socket.addEventListener("close", () => {
      if (generation !== state.socketGeneration || state.shuttingDown) return;
      clearOperationTimeout();
      setConnectionState("problem", "Reconnecting - local copy safe");
      scheduleReconnect(generation);
    });
  }

  function scheduleReconnect(generation) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      if (!state.shuttingDown && generation === state.socketGeneration) connect();
    }, 1300);
  }

  function requestRefresh() {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      send({ type: "join", documentId: state.documentId, name: settings.username, color: settings.color, clientId: state.clientId });
    }
  }

  function handleSocketMessage(message) {
    if (message.type === "document") {
      receiveDocument(message.document);
      return;
    }
    if (message.type === "operation") {
      receiveOperation(message);
      return;
    }
    if (message.type === "presence") {
      state.users = message.users || [];
      refreshCollaborators();
      return;
    }
    if (message.type === "selection") {
      updateCollaborator(message.user);
      return;
    }
    if (message.type === "resync") {
      state.serverSource = message.document.source;
      state.revision = message.document.revision;
      requestRefresh();
      return;
    }
    if (message.type === "error") {
      toastMessage(message.message || "The server rejected an edit.");
      requestRefresh();
    }
  }

  function receiveDocument(document) {
    const priorLocal = state.source;
    const draft = readDraft();
    const restore = state.importedSource || (state.dirty && priorLocal ? priorLocal : draft && draft.dirty ? draft.source : "");

    state.serverSource = document.source;
    state.revision = document.revision;
    state.pending = [];
    state.inFlight = null;
    clearOperationTimeout();
    state.canvasRenderId = "";
    state.canvasSource = null;
    state.canvasExternalOperations = [];
    state.ready = true;
    state.importedSource = null;
    resetHistory();

    if (restore && restore !== document.source) {
      state.source = restore;
      state.dirty = true;
      const operation = operationFromDiff(document.source, restore);
      if (operation) state.pending.push({ id: createId(), operation });
      saveStatus.textContent = "Restoring local changes...";
    } else {
      state.source = document.source;
      state.dirty = false;
      saveStatus.textContent = "All changes saved";
    }
    renderSource();
    persistDraft();
    scheduleCompile(0);
    flushOperations();
  }

  function receiveOperation(message) {
    transformCollaboratorSelections(message.operation, "wmd");
    state.serverSource = applyOperation(state.serverSource, message.operation);
    state.revision = message.revision;

    if (message.clientId === state.clientId && state.inFlight && message.clientOperationId === state.inFlight.id) {
      state.inFlight = null;
      clearOperationTimeout();
      state.dirty = Boolean(state.pending.length);
      saveStatus.textContent = state.dirty ? "Saving changes..." : "All changes saved";
      persistDraft();
      flushOperations();
      return;
    }

    try {
      const rawSelection = captureRawSelection();
      let incoming = message.operation;
      if (state.inFlight) [state.inFlight.operation, incoming] = transformOperations(state.inFlight.operation, incoming);
      state.pending = state.pending.map((entry) => {
        const [localOperation, remoteOperation] = transformOperations(entry.operation, incoming);
        incoming = remoteOperation;
        return { ...entry, operation: localOperation };
      });
      trackCanvasExternalOperation(incoming);
      state.source = applyOperation(state.source, incoming);
      resetHistory();
      if (state.canvasSelection && state.mode === "document") state.restoreCanvasSelection = true;
      state.dirty = Boolean(state.pending.length || state.inFlight);
      renderSource();
      restoreRawSelection(rawSelection);
      persistDraft();
      if (state.mode === "document") scheduleDocumentCanvasRefresh();
      else scheduleCompile(140);
      saveStatus.textContent = "Updated by a collaborator";
    } catch (_) {
      requestRefresh();
    }
  }

  function changeSource(nextSource, options = {}) {
    if (nextSource === state.source) return;
    const previousSource = state.source;
    const operation = operationFromDiff(previousSource, nextSource);
    if (options.canvas !== true) trackCanvasExternalOperation(operation);
    if (options.history !== false) recordHistory(previousSource, options);
    state.source = nextSource;
    state.dirty = true;
    if (operation && state.ready) state.pending.push({ id: createId(), operation });
    renderSource({ keepEditor: Boolean(options.keepEditor) });
    scheduleDraftSave();
    saveStatus.textContent = state.ready ? "Saving changes..." : "Saved locally - waiting for server";
    flushOperations();
    if (options.compile !== false) scheduleCompile();
  }

  function resetHistory() {
    state.history.undo = [];
    state.history.redo = [];
    state.history.lastAt = 0;
  }

  function recordHistory(source, options = {}) {
    const now = Date.now();
    const coalesce = options.coalesce !== false && now - state.history.lastAt < 750;
    if (!coalesce) {
      state.history.undo.push(source);
      if (state.history.undo.length > 120) state.history.undo.shift();
    }
    state.history.redo = [];
    state.history.lastAt = now;
  }

  function applyHistory(direction) {
    const from = direction === "redo" ? state.history.redo : state.history.undo;
    const to = direction === "redo" ? state.history.undo : state.history.redo;
    if (!from.length) {
      toastMessage(`Nothing to ${direction}.`);
      return;
    }
    const nextSource = from.pop();
    to.push(state.source);
    state.history.lastAt = 0;
    changeSource(nextSource, { compile: true, keepEditor: state.mode === "wmd", history: false });
  }

  function flushOperations() {
    if (!state.ready || state.inFlight || !state.pending.length || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    state.inFlight = state.pending.shift();
    send({
      type: "operation",
      baseRevision: state.revision,
      clientOperationId: state.inFlight.id,
      operation: state.inFlight.operation,
    });
    watchInFlightOperation(state.inFlight);
  }

  function scheduleCompile(delay = 260) {
    clearTimeout(state.compileTimer);
    state.compileController?.abort();
    const generation = ++state.compileGeneration;
    state.compileTimer = setTimeout(() => compilePreview(generation), delay);
  }

  async function compilePreview(generation) {
    if (!state.source) {
      state.canvasRenderId = "";
      state.canvasSource = null;
      state.canvasExternalOperations = [];
      preview.srcdoc = "<!doctype html><body></body>";
      return;
    }
    const controller = new AbortController();
    state.compileController = controller;
    const source = state.source;
    try {
      const response = await fetch(apiUrl("/api/compile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Compilation failed.");
      if (generation !== state.compileGeneration) return;
      if (state.mode === "document" && source !== state.source) {
        scheduleCompile(0);
        return;
      }
      if (state.mode === "document") {
        const canvasRenderId = createId();
        state.canvasRenderId = canvasRenderId;
        state.canvasSource = source;
        state.canvasExternalOperations = [];
        preview.srcdoc = editableCanvasHtml(themedHtml(result.html), canvasRenderId);
      } else {
        preview.srcdoc = themedHtml(result.html);
      }
      renderWarnings(result.warnings || []);
    } catch (error) {
      if (error.name === "AbortError" || generation !== state.compileGeneration) return;
      preview.srcdoc = `<!doctype html><body style="font-family:sans-serif;padding:2rem"><h1>Preview is unavailable</h1><p>${escapeHtml(error.message)}</p><p>Your local source copy is still safe.</p></body>`;
    } finally {
      if (state.compileController === controller) state.compileController = null;
    }
  }

  function themedHtml(html) {
    const accent = {
      green: "#245a46",
      orange: "#a85b2a",
      blue: "#285f8e",
      graphite: "#3e4542",
    }[settings.accent] || "#245a46";
    const className = [resolvedTheme() === "dark" ? "dark" : "", state.mode === "wmd" ? "wmd-studio-static" : ""].filter(Boolean).join(" ");
    const staticZoom = state.mode === "wmd" ? `body.wmd-studio-static .layout{zoom:${settings.zoom}%;}` : "";
    const style = `<style>:root{--link:${accent};--panel-active:${accent}}${stylePresetCss()}${staticZoom}</style>`;
    const themed = html.replace("</head>", `${style}</head>`).replace("<body>", `<body class="${className}">`);
    return state.mode === "wmd" ? themed.replace("</body>", `${staticPreviewBridge()}</body>`) : themed;
  }

  function staticPreviewBridge() {
    return `<script>
(function() {
  function post(type, payload) {
    var message = payload || {};
    message.channel = 'wmd-studio-preview';
    message.type = type;
    parent.postMessage(message, '*');
  }

  function label(value) {
    return String(value || '').replace(/^[v>]|\\s+/g, '').trim();
  }

  function activateSection(section) {
    if (!section) return;
    document.querySelectorAll('main > .tab-section').forEach(function(candidate) {
      candidate.classList.toggle('active', candidate === section);
    });
    document.querySelectorAll('.tab-button').forEach(function(button) {
      var active = button.dataset.tabId === section.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    post('tab', { tab: section.dataset.tabName || '' });
  }

  function activateNamedTab(name) {
    var section = Array.prototype.slice.call(document.querySelectorAll('main > .tab-section')).find(function(candidate) {
      return label(candidate.dataset.tabName) === label(name);
    });
    activateSection(section);
  }

  function reveal(focus) {
    if (!focus) return;
    var sectionForTab = focus.tab && Array.prototype.slice.call(document.querySelectorAll('main > .tab-section')).find(function(section) {
      return label(section.dataset.tabName) === focus.tab;
    });
    var tabChanged = sectionForTab && !sectionForTab.classList.contains('active');
    if (sectionForTab) activateSection(sectionForTab);
    var scope = sectionForTab || document.querySelector('main');
    var blocks = Array.prototype.slice.call(scope.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th'));
    var target = focus.text && blocks.find(function(block) { return label(block.textContent) === focus.text; });
    if (!target && focus.text) target = blocks.find(function(block) { return label(block.textContent).indexOf(focus.text) !== -1; });
    if (!target && focus.heading) target = blocks.find(function(block) { return /^H[1-6]$/.test(block.tagName) && label(block.textContent) === focus.heading; });
    if (!target) {
      if (tabChanged) window.scrollTo(0, 0);
      return;
    }
    activateSection(target.closest('.tab-section'));
    requestAnimationFrame(function() {
      var rect = target.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight) return;
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
  }

  function followAnchor(href) {
    var id = String(href || '').slice(1);
    try { id = decodeURIComponent(id); } catch (_) {}
    var target = document.getElementById(id);
    if (!target) return;
    activateSection(target.closest('.tab-section'));
    requestAnimationFrame(function() {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  document.addEventListener('click', function(event) {
    var target = event.target && (event.target.nodeType === Node.ELEMENT_NODE ? event.target : event.target.parentElement);
    var link = target && target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    var href = link.getAttribute('href') || '';
    if (href.charAt(0) === '#') followAnchor(href);
  }, true);
  document.addEventListener('dblclick', function(event) {
    var target = event.target && (event.target.nodeType === Node.ELEMENT_NODE ? event.target : event.target.parentElement);
    var link = target && target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    var href = link.getAttribute('href') || '';
    if (href.charAt(0) === '#') return followAnchor(href);
    try {
      var destinationUrl = new URL(href, document.baseURI);
      if (['http:', 'https:', 'mailto:', 'tel:'].indexOf(destinationUrl.protocol) !== -1) {
        window.open(destinationUrl.href, '_blank', 'noopener,noreferrer');
      }
    } catch (_) {}
  }, true);

  window.addEventListener('scroll', function() {
    post('scroll', {
      left: window.scrollX,
      top: window.scrollY,
      height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      viewport: window.innerHeight
    });
  }, { passive: true });
  window.addEventListener('message', function(event) {
    var data = event.data || {};
    if (data.channel !== 'wmd-studio-preview') return;
    if (data.type === 'show-tab') {
      activateNamedTab(data.tab);
      return;
    }
    if (data.type === 'focus') {
      reveal(data.focus);
      return;
    }
    if (data.type !== 'state') return;
    var scroll = data.scroll || {};
    window.scrollTo(Number(scroll.left) || 0, Number(scroll.top) || 0);
    reveal(data.focus);
  });
  post('ready', {});
})();
</script>`;
  }

  function editableCanvasHtml(html, canvasRenderId) {
    const bridge = `
<style>
  .layout { min-height: 100vh; }
  .wmd-studio-duplicate-title { display: none !important; }
  main.wmd-studio-editable { min-height: calc(100vh - 32px); outline: none; cursor: text; }
  .wmd-studio-heading-toggle { width: 1.45em; margin: 0 0.18em 0 0; padding: 0; border: 0; color: var(--muted); background: transparent; font: inherit; line-height: 1; cursor: pointer; vertical-align: baseline; }
  .wmd-studio-heading-toggle:hover, .wmd-studio-heading-toggle:focus-visible { color: var(--text); }
  .wmd-studio-cursor { display:inline-block;width:2px;height:1.25em;margin:-0.1em 0;vertical-align:text-bottom;background:var(--wmd-cursor,#b9483c);position:relative;pointer-events:none; }
  .wmd-studio-cursor::after { content:attr(data-name);position:absolute;left:-2px;bottom:100%;padding:2px 5px;border-radius:4px;color:white;background:var(--wmd-cursor,#b9483c);font:700 10px sans-serif;white-space:nowrap; }
</style>
<script>
(function() {
  var main = document.querySelector('main');
  var macros = [];
  var presets = [];
  var presetStyleElement = document.createElement('style');
  presetStyleElement.id = 'wmd-studio-preset-styles';
  document.head.appendChild(presetStyleElement);
  if (!main) return;
  var canvas = main;
  document.body.classList.add('wmd-studio-editing');
  main.contentEditable = 'true';
  main.spellcheck = true;
  main.classList.add('wmd-studio-editable');
  document.querySelectorAll('.tab-title').forEach(function(title) {
    var duplicate = title.nextElementSibling;
    if (duplicate && duplicate.tagName === 'H1' && duplicate.textContent.trim() === title.textContent.trim()) {
      duplicate.classList.add('wmd-studio-duplicate-title');
    }
  });

  function activateSection(section) {
    if (!section) return;
    main.querySelectorAll(':scope > section.tab-section').forEach(function(candidate) { candidate.classList.toggle('active', candidate === section); });
    refreshSidebarNavigation();
  }

  function activateNamedTab(name) {
    var section = Array.prototype.slice.call(main.querySelectorAll(':scope > section.tab-section')).find(function(candidate) {
      return String(candidate.dataset.tabName || '').trim() === String(name || '').trim();
    });
    activateSection(section);
  }

  function headingText(heading) {
    return String(heading.textContent || '').replace(/^[v>]\s*/, '').trim();
  }

  function refreshSidebarNavigation() {
    var sidebar = document.querySelector('.sidebar');
    var search = document.getElementById('headingSearch');
    var headingResults = document.getElementById('headingResults');
    if (!sidebar || !search || !headingResults) return;
    var sections = Array.prototype.slice.call(main.querySelectorAll(':scope > section.tab-section'));
    sidebar.querySelectorAll('.tab-button').forEach(function(button) { button.remove(); });
    sections.filter(function(section) { return section.dataset.tabHidden !== 'true'; }).forEach(function(section, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab-button';
      button.dataset.tabId = section.id;
      button.textContent = section.dataset.tabName || 'Tab ' + (index + 1);
      button.classList.toggle('active', section.classList.contains('active'));
      button.addEventListener('click', function() { activateSection(section); });
      sidebar.insertBefore(button, search);
    });

    headingResults.replaceChildren();
    sections.forEach(function(section) {
      Array.prototype.slice.call(section.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(function(heading) {
        return !heading.classList.contains('tab-title');
      }).forEach(function(heading) {
        var text = headingText(heading);
        if (!text) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'heading-result heading-level-' + heading.tagName.slice(1);
        button.dataset.search = ((section.dataset.tabName || '') + ' ' + text).toLowerCase();
        button.dataset.tabId = section.id;
        button.dataset.headingId = heading.id || '';
        var textLabel = document.createElement('span');
        textLabel.className = 'heading-result-text';
        textLabel.textContent = text;
        var tabLabel = document.createElement('span');
        tabLabel.className = 'heading-result-tab';
        tabLabel.textContent = section.dataset.tabName || '';
        button.append(textLabel, tabLabel);
        button.addEventListener('click', function() {
          activateSection(section);
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        headingResults.append(button);
      });
    });
    if (typeof updateHeadingList === 'function') updateHeadingList();
  }

  function updateEditableHeadingVisibility(section) {
    if (!section) return;
    var stack = [];
    Array.prototype.slice.call(section.children).forEach(function(node) {
      if (/^H[1-6]$/.test(node.tagName) && !node.classList.contains('tab-title')) {
        var level = Number(node.tagName.slice(1));
        stack = stack.filter(function(item) { return item.level < level; });
        var hiddenByParent = stack.some(function(item) { return item.collapsed; });
        node.classList.toggle('heading-hidden-by-collapse', hiddenByParent);
        var collapsed = node.dataset.collapsed === 'true';
        var toggle = node.querySelector('.wmd-studio-heading-toggle');
        if (toggle) {
          toggle.textContent = collapsed ? '>' : 'v';
          toggle.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
        }
        stack.push({ level: level, collapsed: collapsed || hiddenByParent });
        return;
      }
      node.classList.toggle('heading-hidden-by-collapse', stack.some(function(item) { return item.collapsed; }));
    });
  }

  function setupEditableHeadingCollapse(heading, section) {
    if (!heading || !/^H[1-6]$/.test(heading.tagName) || heading.classList.contains('tab-title')) return heading;
    // Clone compiler-rendered headings so their click handlers cannot intercept text editing.
    var editableHeading = heading.cloneNode(true);
    heading.replaceWith(editableHeading);
    editableHeading.classList.remove('collapsible-heading');
    editableHeading.dataset.collapsed = 'false';
    editableHeading.querySelectorAll('.heading-collapse-marker, .wmd-studio-heading-toggle').forEach(function(marker) { marker.remove(); });
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'heading-collapse-marker wmd-studio-heading-toggle';
    toggle.contentEditable = 'false';
    toggle.textContent = 'v';
    toggle.setAttribute('aria-label', 'Collapse section');
    toggle.addEventListener('pointerdown', function(event) { event.preventDefault(); });
    toggle.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      editableHeading.dataset.collapsed = editableHeading.dataset.collapsed === 'true' ? 'false' : 'true';
      updateEditableHeadingVisibility(section || editableHeading.closest('.tab-section'));
    });
    editableHeading.insertBefore(toggle, editableHeading.firstChild);
    return editableHeading;
  }

  function setupEditableHeadingCollapses() {
    var sections = Array.prototype.slice.call(main.querySelectorAll(':scope > section.tab-section'));
    sections.forEach(function(section) {
      Array.prototype.slice.call(section.children).filter(function(node) {
        return /^H[1-6]$/.test(node.tagName) && !node.classList.contains('tab-title');
      }).forEach(function(heading) {
        setupEditableHeadingCollapse(heading, section);
      });
      updateEditableHeadingVisibility(section);
    });
  }
  setupEditableHeadingCollapses();
  refreshSidebarNavigation();

  function post(type, payload) {
    var message = payload || {};
    message.channel = 'wmd-studio-canvas';
    message.canvasRenderId = '${canvasRenderId}';
    message.type = type;
    parent.postMessage(message, '*');
  }

  var CANVAS_IGNORED_SELECTOR = '.wmd-studio-cursor, .heading-collapse-marker, .wmd-studio-duplicate-title, .warning-panel';

  function canvasTextNodes(root) {
    var walker = document.createTreeWalker(root || main, NodeFilter.SHOW_TEXT, { acceptNode: function(node) {
      return node.parentElement && node.parentElement.closest(CANVAS_IGNORED_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    }});
    var nodes = [];
    var node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function canonicalCanvasText() {
    return canvasTextNodes(main).map(function(node) { return node.data; }).join('');
  }

  function offsetFor(node, offset) {
    var range = document.createRange();
    range.selectNodeContents(main);
    try {
      range.setEnd(node, offset);
      var fragment = range.cloneContents();
      fragment.querySelectorAll(CANVAS_IGNORED_SELECTOR).forEach(function(element) { element.remove(); });
      return fragment.textContent.length;
    } catch (_) { return 0; }
  }

  function selectionInfo() {
    var selection = window.getSelection();
    if (!selection || !main.contains(selection.anchorNode)) return { start: 0, end: 0, preset: '' };
    var anchor = offsetFor(selection.anchorNode, selection.anchorOffset);
    var focus = offsetFor(selection.focusNode, selection.focusOffset);
    return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), preset: selectedPresetId() };
  }

  function findMacro(before) {
    return macros.filter(function(macro) { return macro.trigger && before.endsWith(macro.trigger); }).sort(function(a, b) { return b.trigger.length - a.trigger.length; })[0];
  }

  function expandMacro() {
    var selection = window.getSelection();
    if (!selection || !selection.isCollapsed || !main.contains(selection.anchorNode) || selection.anchorNode.nodeType !== Node.TEXT_NODE) return;
    var node = selection.anchorNode;
    var offset = selection.anchorOffset;
    var macro = findMacro(node.data.slice(0, offset));
    if (!macro) return;
    var start = offset - macro.trigger.length;
    node.data = node.data.slice(0, start) + macro.replacement + node.data.slice(offset);
    var range = document.createRange();
    range.setStart(node, start + macro.replacement.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function notifyInput() {
    refreshSidebarNavigation();
    post('input', { html: main.innerHTML, selection: selectionInfo(), text: canonicalCanvasText() });
  }

  function clearCursors() { document.querySelectorAll('.wmd-studio-cursor').forEach(function(cursor) { cursor.remove(); }); }

  function addCursor(user) {
    var nodes = canvasTextNodes(main);
    var textLength = nodes.reduce(function(total, node) { return total + node.data.length; }, 0);
    var target = Math.max(0, Math.min(Number(user.selection.end) || 0, textLength));
    var count = 0;
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (target <= count + node.data.length) {
        var range = document.createRange();
        range.setStart(node, target - count);
        range.collapse(true);
        var cursor = document.createElement('span');
        cursor.className = 'wmd-studio-cursor';
        cursor.contentEditable = 'false';
        cursor.dataset.name = user.name || 'Collaborator';
        cursor.style.setProperty('--wmd-cursor', user.color || '#b9483c');
        range.insertNode(cursor);
        return;
      }
      count += node.data.length;
    }
  }

  function textPosition(target) {
    var nodes = canvasTextNodes(main);
    var textLength = nodes.reduce(function(total, node) { return total + node.data.length; }, 0);
    var offset = Math.max(0, Math.min(Number(target) || 0, textLength));
    var count = 0;
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (offset <= count + node.data.length) return { node: node, offset: offset - count };
      count += node.data.length;
    }
    return { node: main, offset: main.childNodes.length };
  }

  function restoreSelection(info) {
    if (!info) return;
    var start = textPosition(info.start);
    var end = textPosition(info.end);
    var range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      main.focus();
    } catch (_) {}
  }

  function tableSize(value, fallback) {
    var size = Number.parseInt(value, 10);
    return Number.isFinite(size) ? Math.max(1, Math.min(20, size)) : fallback;
  }

  function tableHtml(value) {
    var rows = tableSize(value && value.rows, 3);
    var columns = tableSize(value && value.columns, 3);
    var headers = Array.from({ length: columns }, function(_, index) { return '<th>Header ' + (index + 1) + '</th>'; }).join('');
    var bodyRows = Array.from({ length: Math.max(0, rows - 1) }, function() {
      return '<tr>' + Array.from({ length: columns }, function() { return '<td><br></td>'; }).join('') + '</tr>';
    }).join('');
    return '<table><thead><tr>' + headers + '</tr></thead><tbody>' + bodyRows + '</tbody></table><p><br></p>';
  }

  function calloutHtml(value) {
    var options = value && typeof value === 'object' ? value : { type: value };
    var type = normalizeIdentifier(options.type || 'note', 'note');
    var presetId = /^[A-Za-z][\w-]*$/.test(options.preset || '') ? options.preset : '';
    var preset = presetId ? ' data-wmd-preset="' + presetId + '" class="callout callout-' + type + ' wmd-preset-' + presetId + '"' : ' class="callout callout-' + type + '"';
    var title = escapeHtml(options.title || calloutLabel(type));
    return '<div' + preset + '><div class="callout-title">' + title + '</div><div class="callout-body"><p>Write the ' + type + ' here.</p></div></div><p><br></p>';
  }

  function internalLinkHref(target) {
    var parts = String(target || '').split('#');
    var tabName = parts.shift() || '';
    var headingName = parts.join('#');
    var section = Array.prototype.slice.call(main.querySelectorAll(':scope > section.tab-section')).find(function(candidate) {
      return String(candidate.dataset.tabName || '').trim() === tabName.trim();
    });
    if (!section) return '#';
    if (!headingName) return '#' + section.id;
    var heading = Array.prototype.slice.call(section.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(function(candidate) {
      var text = candidate.textContent.trim();
      if (text.charAt(0) === 'v' || text.charAt(0) === '>') text = text.slice(1).trim();
      return text === headingName.trim();
    });
    return heading ? '#' + heading.id : '#' + section.id;
  }

  function selectedBlock() {
    var selection = window.getSelection();
    if (!selection || !selection.anchorNode) return null;
    var element = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
    return element && element.closest('h1, h2, h3, h4, h5, h6, p, li, ul, ol, blockquote, pre, .callout');
  }

  function presetForNativeBlock(block) {
    if (!block) return null;
    if (block.classList && block.classList.contains('tab-title')) {
      return presets.find(function(preset) { return preset.block === 'title' || preset.wmdFormatting === '@title'; }) || null;
    }
    if (/^H[1-6]$/.test(block.tagName || '')) {
      var level = Number(block.tagName.slice(1));
      return presets.find(function(preset) { return preset.block === 'heading' && Number(preset.level) === level; }) || null;
    }
    if (block.tagName === 'P') return presets.find(function(preset) { return preset.block === 'paragraph' && !preset.wmdFormatting; }) || null;
    if (block.tagName === 'UL') {
      var isChecklist = !!block.querySelector('input.task-checkbox');
      return presets.find(function(preset) { return preset.block === (isChecklist ? 'checklist' : 'bullet-list'); }) || null;
    }
    if (block.tagName === 'OL') return presets.find(function(preset) { return preset.block === 'numbered-list'; }) || null;
    if (block.classList && block.classList.contains('callout')) {
      return presets.find(function(preset) { return preset.block === 'callout' && block.classList.contains('callout-' + (preset.calloutType || 'note')); }) || null;
    }
    return null;
  }

  function selectedPresetId() {
    var block = selectedBlock();
    if (!block) return '';
    var styled = block.closest('[data-wmd-preset]');
    if (styled && styled.dataset.wmdPreset) return styled.dataset.wmdPreset;
    var nativePreset = presetForNativeBlock(block);
    return nativePreset ? nativePreset.id : '';
  }

  function defaultPreset() {
    return presets.find(function(preset) { return preset && preset.default; })
      || presets.find(function(preset) { return preset && preset.block === 'paragraph' && !preset.wmdFormatting; })
      || presets[0]
      || null;
  }

  function humanizeCalloutType(type) {
    return String(type || 'note')
      .replace(/[-_]+/g, ' ')
      .replace(/\b[a-z]/g, function(letter) { return letter.toUpperCase(); });
  }

  function applyPresetAttributes(block, style) {
    if (!block || !style || !style.id) return;
    block.dataset.wmdPreset = style.id;
    block.classList.add('wmd-preset-' + style.id);
  }

  function editableTextNodes(root) {
    if (!root) return [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        var parent = node.parentElement;
        return parent && parent.closest('[contenteditable="false"], .wmd-studio-cursor, .heading-collapse-marker')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    var node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function textOffsetIn(root, node, offset) {
    var nodes = editableTextNodes(root);
    var count = 0;
    for (var index = 0; index < nodes.length; index += 1) {
      if (nodes[index] === node) return count + Math.max(0, Math.min(Number(offset) || 0, nodes[index].data.length));
      count += nodes[index].data.length;
    }
    return count;
  }

  function restoreTextSelection(root, start, end) {
    var nodes = editableTextNodes(root);
    if (!nodes.length) {
      placeCaretAtStart(root);
      return;
    }
    var positionFor = function(offset) {
      var remaining = Math.max(0, Number(offset) || 0);
      for (var index = 0; index < nodes.length; index += 1) {
        if (remaining <= nodes[index].data.length) return { node: nodes[index], offset: remaining };
        remaining -= nodes[index].data.length;
      }
      var last = nodes[nodes.length - 1];
      return { node: last, offset: last.data.length };
    };
    var from = positionFor(start);
    var to = positionFor(end);
    var range = document.createRange();
    var selection = window.getSelection();
    try {
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      selection.removeAllRanges();
      selection.addRange(range);
      main.focus();
    } catch (_) {
      placeCaretAtStart(root);
    }
  }

  function ensureInlineTargetContent(target, fragment) {
    if (!target) return;
    if (fragment && fragment.querySelectorAll) {
      fragment.querySelectorAll('.heading-collapse-marker, .wmd-studio-heading-toggle').forEach(function(node) { node.remove(); });
    }
    if (fragment && fragment.childNodes && fragment.childNodes.length) target.appendChild(fragment);
    if (!target.textContent.replace(/\u200b/g, '').trim() && !target.querySelector('br,img,input,table,hr')) {
      target.appendChild(document.createElement('br'));
    }
  }

  function createBlockFromPreset(style, fragment) {
    var blockKind = style && style.block ? style.block : 'paragraph';
    var level = style && style.level ? Math.max(1, Math.min(6, Number(style.level) || 1)) : '';
    var block;
    var focusTarget;

    if (blockKind === 'title') {
      block = document.createElement('h1');
      block.classList.add('tab-title');
      focusTarget = block;
      ensureInlineTargetContent(block, fragment);
    } else if (blockKind === 'heading') {
      block = document.createElement('h' + (level || 2));
      focusTarget = block;
      ensureInlineTargetContent(block, fragment);
    } else if (blockKind === 'bullet-list' || blockKind === 'numbered-list' || blockKind === 'checklist') {
      block = document.createElement(blockKind === 'numbered-list' ? 'ol' : 'ul');
      var item = document.createElement('li');
      if (blockKind === 'checklist') {
        var checkbox = document.createElement('input');
        checkbox.className = 'task-checkbox';
        checkbox.type = 'checkbox';
        checkbox.contentEditable = 'false';
        item.appendChild(checkbox);
        item.appendChild(document.createTextNode(' '));
      }
      focusTarget = item;
      ensureInlineTargetContent(item, fragment);
      block.appendChild(item);
    } else if (blockKind === 'callout') {
      block = document.createElement('div');
      block.className = 'callout callout-' + (style.calloutType || 'note');
      var title = document.createElement('div');
      title.className = 'callout-title';
      title.textContent = style.calloutTitle || style.name || humanizeCalloutType(style.calloutType || 'note');
      var body = document.createElement('div');
      body.className = 'callout-body';
      var paragraph = document.createElement('p');
      focusTarget = paragraph;
      ensureInlineTargetContent(paragraph, fragment);
      body.appendChild(paragraph);
      block.append(title, body);
    } else {
      block = document.createElement('p');
      focusTarget = block;
      ensureInlineTargetContent(block, fragment);
    }

    applyPresetAttributes(block, style);
    return { block: block, focusTarget: focusTarget || block };
  }

  function placeCaretAtStart(target) {
    if (!target) return;
    var selection = window.getSelection();
    if (!selection) return;
    var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        return node.parentElement && node.parentElement.closest('[contenteditable="false"]')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    var textNode = walker.nextNode();
    var range = document.createRange();
    try {
      if (textNode) range.setStart(textNode, 0);
      else {
        range.selectNodeContents(target);
        range.collapse(true);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      main.focus();
    } catch (_) {}
  }

  function splitHeadingIntoDefaultBlock() {
    var block = selectedBlock();
    var selection = window.getSelection();
    if (!block || !selection || !selection.rangeCount) return false;
    var isHeading = block.classList.contains('tab-title') || /^H[1-6]$/.test(block.tagName || '');
    if (!isHeading) return false;
    var preset = defaultPreset();
    if (!preset || !block.parentNode) return false;
    var range = selection.getRangeAt(0).cloneRange();
    if (!block.contains(range.startContainer) || !block.contains(range.endContainer)) return false;
    if (!range.collapsed) range.deleteContents();
    var caret = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : range;
    if (!block.contains(caret.startContainer)) {
      caret.selectNodeContents(block);
      caret.collapse(false);
    }
    var trailingRange = caret.cloneRange();
    trailingRange.setEnd(block, block.childNodes.length);
    var trailing = trailingRange.extractContents();
    var created = createBlockFromPreset(preset, trailing);
    block.parentNode.insertBefore(created.block, block.nextSibling);
    setupTaskCheckboxes();
    placeCaretAtStart(created.focusTarget);
    return true;
  }

  function replaceSelectedBlockWithPreset(style) {
    var block = selectedBlock();
    var selection = window.getSelection();
    if (!block || !selection || !selection.rangeCount || !block.parentNode) return false;
    // List conversion has its own structure rules; leave it to the browser fallback below.
    if (!/^(H[1-6]|P|BLOCKQUOTE|PRE)$/.test(block.tagName) && !block.classList.contains('tab-title')) return false;
    var range = selection.getRangeAt(0).cloneRange();
    if (!block.contains(range.startContainer) || !block.contains(range.endContainer)) return false;

    var start = textOffsetIn(block, range.startContainer, range.startOffset);
    var end = textOffsetIn(block, range.endContainer, range.endOffset);
    var fragmentRange = document.createRange();
    fragmentRange.selectNodeContents(block);
    var fragment = fragmentRange.extractContents();
    fragment.querySelectorAll('.heading-collapse-marker, .wmd-studio-heading-toggle, .wmd-studio-cursor, input.task-checkbox').forEach(function(node) { node.remove(); });

    var blockKind = style.block || (style.heading ? 'heading' : 'paragraph');
    var effectiveStyle = style;
    if (blockKind === 'heading' && !style.level && /^H[1-6]$/.test(block.tagName)) {
      effectiveStyle = Object.assign({}, style, { level: Number(block.tagName.slice(1)) });
    }
    var created = createBlockFromPreset(effectiveStyle, fragment);
    var section = block.closest('.tab-section');
    block.replaceWith(created.block);

    if (/^H[1-6]$/.test(created.block.tagName) && !created.block.classList.contains('tab-title')) {
      var editableHeading = setupEditableHeadingCollapse(created.block, section);
      created.block = editableHeading;
      created.focusTarget = editableHeading;
    }
    updateEditableHeadingVisibility(section);
    setupTaskCheckboxes();
    restoreTextSelection(created.focusTarget, start, end);
    return true;
  }

  function applyPreset(preset) {
    var style = preset && typeof preset === 'object' ? preset : {};
    var blockKind = style.block || (style.heading ? 'heading' : 'paragraph');
    var level = style.level ? Math.max(1, Math.min(6, Number(style.level) || 1)) : '';

    if (replaceSelectedBlockWithPreset(style)) {
      notifyInput();
      return;
    }

    if (blockKind === 'title') document.execCommand('formatBlock', false, 'h1');
    if (blockKind === 'heading' && level) document.execCommand('formatBlock', false, 'h' + level);
    if (blockKind === 'paragraph') document.execCommand('formatBlock', false, 'p');
    if (blockKind === 'bullet-list') document.execCommand('insertUnorderedList');
    if (blockKind === 'numbered-list') document.execCommand('insertOrderedList');
    if (blockKind === 'checklist') {
      var label = (selectedBlock() && selectedBlock().textContent.trim()) || 'Task';
      document.execCommand('insertHTML', false, '<ul data-wmd-preset="' + style.id + '" class="wmd-preset-' + style.id + '"><li><input class="task-checkbox" type="checkbox" contenteditable="false"> ' + label + '</li></ul><p><br></p>');
      setupTaskCheckboxes();
      notifyInput();
      return;
    }
    if (blockKind === 'callout') {
      document.execCommand('insertHTML', false, calloutHtml({ type: style.calloutType || 'note', preset: style.id || '', title: style.calloutTitle || style.name || '' }));
      notifyInput();
      return;
    }

    var block = selectedBlock();
    if (!block) return;
    if ((blockKind === 'bullet-list' || blockKind === 'numbered-list') && block.closest('ul,ol')) block = block.closest('ul,ol');
    if (blockKind === 'title') block.classList.add('tab-title');
    else block.classList.remove('tab-title');
    Array.prototype.slice.call(block.classList).filter(function(name) { return name.indexOf('wmd-preset-') === 0; }).forEach(function(name) { block.classList.remove(name); });
    if (style.id) {
      block.dataset.wmdPreset = style.id;
      block.classList.add('wmd-preset-' + style.id);
    } else {
      delete block.dataset.wmdPreset;
    }
    notifyInput();
  }

  function unshiftedCanvasShortcutKey(event) {
    var code = String(event.code || '');
    var codeMap = { Backquote: String.fromCharCode(96), Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: String.fromCharCode(92), Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'Space' };
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
    if (codeMap[code]) return codeMap[code];
    var key = String(event.key || '');
    return key.length === 1 ? key.toUpperCase() : key;
  }

  function shortcutFromCanvasEvent(event) {
    var key = unshiftedCanvasShortcutKey(event);
    if (!key || ['Control', 'Alt', 'Shift', 'Meta'].indexOf(key) !== -1) return '';
    var parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    if (!parts.length) return '';
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    return parts.join('+');
  }

  function presetForShortcut(event) {
    var shortcut = shortcutFromCanvasEvent(event);
    return shortcut ? presets.find(function(preset) { return preset.shortcut === shortcut; }) || null : null;
  }


  function command(data) {
    main.focus();
    if (data.command === 'insert') {
      if (data.kind === 'link') {
        var href = data.value && data.value.internalTarget
          ? internalLinkHref(data.value.internalTarget)
          : data.value && data.value.href ? data.value.href : data.value;
        document.execCommand('createLink', false, href || 'https://example.com');
      }
      if (data.kind === 'image') {
        var imageValue = data.value || {};
        var source = imageValue.src || imageValue;
        if (source) {
          var image = document.createElement('img');
          image.src = source;
          image.alt = imageValue.alt || '';
          document.execCommand('insertHTML', false, image.outerHTML);
        }
      }
      if (data.kind === 'list') document.execCommand('insertUnorderedList');
      if (data.kind === 'ordered-list') document.execCommand('insertOrderedList');
      if (data.kind === 'checkbox') document.execCommand('insertHTML', false, '<ul><li><input class="task-checkbox" type="checkbox" contenteditable="false"> Task</li></ul><p><br></p>');
      if (data.kind === 'table') document.execCommand('insertHTML', false, tableHtml(data.value));
      if (data.kind === 'callout') document.execCommand('insertHTML', false, calloutHtml(data.value));
      if (data.kind === 'tab') {
        var section = document.createElement('section');
        section.className = 'tab-section';
        section.id = 'wmd-studio-tab-' + Date.now().toString(36);
        section.dataset.tabName = 'New tab';
        section.dataset.tabHidden = 'false';
        section.innerHTML = '<h1 class="tab-title">New tab</h1><h1>New tab</h1><p>Start writing here.</p>';
        main.appendChild(section);
        activateSection(section);
      }
    } else if (data.command === 'applyPreset') {
      applyPreset(data.value);
    } else if (data.command === 'formatBlock') {
      document.execCommand('formatBlock', false, data.value || 'p');
    } else if (data.command === 'highlight') {
      document.execCommand('hiliteColor', false, data.value || '#fff0a6');
    } else if (data.command) {
      document.execCommand(data.command, false, data.value || null);
    }
    notifyInput();
    setupTaskCheckboxes();
  }

  function setupTaskCheckboxes() {
    main.querySelectorAll('input.task-checkbox').forEach(function(input) {
      if (input.dataset.wmdStudioReady) return;
      input.disabled = false;
      input.contentEditable = 'false';
      input.dataset.wmdStudioReady = 'true';
      input.addEventListener('change', notifyInput);
    });
  }

  main.addEventListener('input', function() { expandMacro(); notifyInput(); });
  setupTaskCheckboxes();
  main.addEventListener('click', function(event) { event.stopPropagation(); post('selection', selectionInfo()); }, true);
  main.addEventListener('dblclick', function(event) {
    var target = event.target && (event.target.nodeType === Node.ELEMENT_NODE ? event.target : event.target.parentElement);
    var link = target && target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    var href = link.getAttribute('href') || '';
    if (href.startsWith('#')) {
      var destination = document.getElementById(href.slice(1));
      var section = destination && destination.closest('.tab-section');
      activateSection(section);
      if (destination) destination.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    try {
      var destinationUrl = new URL(href, document.baseURI);
      if (['http:', 'https:', 'mailto:', 'tel:'].indexOf(destinationUrl.protocol) !== -1) {
        window.open(destinationUrl.href, '_blank', 'noopener,noreferrer');
      }
    } catch (_) {}
  }, true);
  main.addEventListener('keyup', function() { post('selection', selectionInfo()); });
  main.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' && !event.isComposing) {
      if (event.shiftKey) {
        event.preventDefault();
        document.execCommand('insertLineBreak');
        notifyInput();
        return;
      }
      if (splitHeadingIntoDefaultBlock()) {
        event.preventDefault();
        notifyInput();
        return;
      }
      event.preventDefault();
      document.execCommand('insertLineBreak');
      notifyInput();
      return;
    }
    var preset = presetForShortcut(event);
    if (preset) {
      event.preventDefault();
      command({ command: 'applyPreset', value: preset });
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    var key = event.key.toLowerCase();
    if (key === 'z') { event.preventDefault(); post('request-history', { direction: event.shiftKey ? 'redo' : 'undo' }); return; }
    if (key === 'y') { event.preventDefault(); post('request-history', { direction: 'redo' }); return; }
    if (key === 'h') { event.preventDefault(); post('request-find', {}); return; }
    if (key === 'b') { event.preventDefault(); command({ command: 'bold' }); }
    if (key === 'i') { event.preventDefault(); command({ command: 'italic' }); }
    if (key === 'u') { event.preventDefault(); command({ command: 'underline' }); }
    if (key === 'k') { event.preventDefault(); post('request-link', {}); }
  });
  document.addEventListener('selectionchange', function() {
    var selection = window.getSelection();
    if (selection && main.contains(selection.anchorNode)) post('selection', selectionInfo());
  });
  window.addEventListener('scroll', function() {
    post('scroll', { left: window.scrollX, top: window.scrollY });
  }, { passive: true });
  window.addEventListener('message', function(event) {
    var data = event.data || {};
    if (data.channel !== 'wmd-studio-canvas') return;
    if (data.type === 'state') {
      macros = Array.isArray(data.macros) ? data.macros : [];
      presets = Array.isArray(data.presets) ? data.presets : [];
      presetStyleElement.textContent = String(data.presetCss || '');
      canvas.style.zoom = String(Number(data.zoom) || 100) + '%';
      restoreSelection(data.selection);
      if (data.scroll) {
        requestAnimationFrame(function() {
          window.scrollTo(Number(data.scroll.left) || 0, Number(data.scroll.top) || 0);
        });
      }
    }
    if (data.type === 'command' && data.command === 'show-tab') {
      activateNamedTab(data.value);
      return;
    }
    if (data.type === 'command') command(data);
    if (data.type === 'cursors') clearCursors();
  });
  post('ready', { html: main.innerHTML, text: canonicalCanvasText() });
})();
</script>`;
    return html.replace("</body>", `${bridge}</body>`);
  }

  function canvasHtmlToWmd(html, baseSource = state.source) {
    const documentFragment = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
    const root = documentFragment.querySelector("main");
    const sections = [...root.children].filter((child) => child.matches && child.matches("section.tab-section"));
    if (!sections.length) return baseSource;
    const preambleMatch = baseSource.match(/^[\s\S]*?(?=^@tab\b)/m);
    const preamble = preambleMatch ? preambleMatch[0].trim() : "";
    const tabs = sections.map((section) => {
      const name = section.dataset.tabName || "Home";
      const hidden = section.dataset.tabHidden === "true" ? " {hidden}" : "";
      const blocks = [...section.children].map(serializeCanvasBlock).filter(Boolean);
      return `@tab ${name}${hidden}\n${blocks.join("\n\n")}`;
    });
    return `${preamble}${preamble ? "\n\n" : ""}${tabs.join("\n\n")}\n`;
  }

  function wrapCanvasStyle(element, markdown) {
    const id = /^[A-Za-z][\w-]*$/.test(element.dataset.wmdPreset || "") ? element.dataset.wmdPreset : "";
    if (!id) return markdown;
    const preset = stylePresetById(id);
    return preset && wmdFormattingInfo(preset.wmdFormatting, preset.name).wrapsStyle ? `@style ${configStyleName(id)}\n${markdown}\n@end` : markdown;
  }


  function serializeCanvasBlock(element) {
    if (element.classList.contains("wmd-studio-cursor") || element.classList.contains("warning-panel") || element.classList.contains("wmd-studio-duplicate-title")) return "";
    const directPresetId = /^[A-Za-z][\w-]*$/.test(element.dataset.wmdPreset || "") ? element.dataset.wmdPreset : "";
    const directPreset = directPresetId ? stylePresetById(directPresetId) : null;
    const directInfo = directPreset ? wmdFormattingInfo(directPreset.wmdFormatting, directPreset.name) : null;
    if (directInfo && directInfo.customMarker) return `${directInfo.formatting} ${serializeCanvasInline(element)}`;
    if (element.classList.contains("tab-title")) return `@title ${serializeCanvasInline(element)}`;
    if (element.classList.contains("toc")) return "@toc";
    if (element.classList.contains("callout")) {
      const type = [...element.classList].find((name) => name.startsWith("callout-")) || "callout-note";
      const title = element.querySelector(".callout-title");
      const body = element.querySelector(".callout-body");
      const content = body ? [...body.children].map(serializeCanvasBlock).filter(Boolean).join("\n\n") : "";
      return wrapCanvasStyle(element, `!${type.replace("callout-", "")}${title ? ` ${serializeCanvasInline(title)}` : ""}\n${content}\n!end`);
    }
    if (element.matches("details.collapse")) {
      const summary = element.querySelector("summary");
      const body = element.querySelector(".collapse-body");
      const content = body ? [...body.children].map(serializeCanvasBlock).filter(Boolean).join("\n\n") : "";
      return wrapCanvasStyle(element, `@collapse ${summary ? serializeCanvasInline(summary) : "Details"}\n${content}\n@endcollapse`);
    }
    if (/^H[1-6]$/.test(element.tagName)) return wrapCanvasStyle(element, `${"#".repeat(Number(element.tagName.slice(1)))} ${serializeCanvasInline(element)}`);
    if (element.tagName === "P") return wrapCanvasStyle(element, serializeCanvasInline(element));
    if (element.tagName === "BLOCKQUOTE") return wrapCanvasStyle(element, serializeCanvasInline(element).split("\n").map((line) => `> ${line}`).join("\n"));
    if (element.tagName === "UL" || element.tagName === "OL") {
      const markdown = [...element.children].filter((child) => child.tagName === "LI")
        .map((item, index) => `${element.tagName === "OL" ? `${index + 1}.` : "-"} ${serializeCanvasInline(item)}`)
        .join("\n");
      return wrapCanvasStyle(element, markdown);
    }
    if (element.tagName === "PRE") return wrapCanvasStyle(element, `\`\`\`\n${element.textContent.replace(/\n$/, "")}\n\`\`\``);
    if (element.tagName === "TABLE") return wrapCanvasStyle(element, serializeCanvasTable(element));
    if (element.tagName === "HR") return "---";
    if (element.tagName === "DIV") {
      const children = [...element.children].filter((child) => /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|DETAILS)$/.test(child.tagName));
      const markdown = children.length ? children.map(serializeCanvasBlock).filter(Boolean).join("\n\n") : serializeCanvasInline(element);
      return wrapCanvasStyle(element, markdown);
    }
    return wrapCanvasStyle(element, serializeCanvasInline(element));
  }

  function serializeCanvasTable(table) {
    const rows = [...table.rows].map((row) => [...row.cells].map((cell) => serializeCanvasInline(cell)
      .replace(/\r?\n/g, " ")
      .replace(/\|/g, "\\|")
      .trim()));
    if (!rows.length) return "";
    const columns = Math.max(1, ...rows.map((row) => row.length));
    const normalize = (row) => Array.from({ length: columns }, (_, index) => row[index] || "");
    const header = normalize(rows[0]).map((cell, index) => cell || `Column ${index + 1}`);
    const divider = Array.from({ length: columns }, () => "---");
    const body = rows.slice(1).map((row) => `| ${normalize(row).join(" | ")} |`);
    return [`| ${header.join(" | ")} |`, `| ${divider.join(" | ")} |`, ...body].join("\n");
  }

  function serializeCanvasInline(node) {
    const walk = (current) => {
      if (current.nodeType === Node.TEXT_NODE) return current.data;
      if (current.nodeType !== Node.ELEMENT_NODE) return "";
      if (current.classList.contains("wmd-studio-cursor") || current.classList.contains("heading-collapse-marker")) return "";
      const children = [...current.childNodes].map(walk).join("");
      if (current.tagName === "STRONG" || current.tagName === "B") return `*${children}*`;
      if (current.tagName === "EM" || current.tagName === "I") return `_${children}_`;
      if (current.tagName === "U") return `++${children}++`;
      if (current.tagName === "S" || current.tagName === "STRIKE" || current.tagName === "DEL") return `~~${children}~~`;
      if (current.tagName === "MARK") return `=${children}=`;
      if (current.tagName === "SPAN" && /background-color/i.test(current.getAttribute("style") || "")) return `=${children}=`;
      if (current.tagName === "CODE") return `\`${children}\``;
      if (current.tagName === "INPUT" && current.type === "checkbox") return current.checked ? "[x] " : "[ ] ";
      if (current.tagName === "A") return `[${children}](${current.getAttribute("href") || ""})`;
      if (current.tagName === "IMG") return `![${current.getAttribute("alt") || "image"}](${current.getAttribute("src") || ""})`;
      if (current.tagName === "BR") return "\n";
      return children;
    };
    return [...node.childNodes].map(walk).join("").replace(/\u200b/g, "").trim();
  }

  function renderWarnings(warnings) {
    // Warnings live in the compiler sidebar so they are available in both editor modes.
    void warnings;
  }

  function setMode(mode, focus = false) {
    state.mode = mode === "wmd" ? "wmd" : "document";
    const documentMode = state.mode === "document";
    documentModeButton.setAttribute("aria-pressed", String(documentMode));
    wmdModeButton.setAttribute("aria-pressed", String(!documentMode));
    workspace.classList.toggle("show-preview", documentMode);
    editorPane.hidden = documentMode;
    rawEditorVisible(!documentMode);
    applyPaneLayout();
    if (documentMode) scheduleCompile(0);
    else {
      state.canvasRenderId = "";
      state.canvasSource = null;
      state.canvasExternalOperations = [];
      state.canvasText = null;
      renderSource();
      // Canvas edits intentionally avoid an iframe refresh while typing. Recompile when leaving it.
      scheduleCompile(0);
      if (focus) editor.focus();
    }
  }

  function rawEditorVisible(visible) {
    document.querySelector("#rawEditorShell").hidden = !visible;
  }

  function configuredRawLineHighlight(line) {
    const customPresets = documentStylePresets()
      .filter((style) => wmdFormattingInfo(style.wmdFormatting, style.name).customMarker)
      .sort((a, b) => String(b.wmdFormatting || "").length - String(a.wmdFormatting || "").length);

    for (const style of customPresets) {
      const marker = normalizeWmdFormatting(style.wmdFormatting);
      if (!marker) continue;
      const match = String(line || "").match(new RegExp(`^(\\s*)(${escapeRegExp(marker)})(?:\\s+|$)([\\s\\S]*)$`));
      if (!match) continue;
      const info = wmdFormattingInfo(marker, style.name);
      const lead = escapeHtml(match[1]);
      const mark = escapeHtml(match[2]);
      const text = match[3] || "";
      if (info.block === "heading") return `${lead}<span class="syntax-heading-mark">${mark}</span><span class="syntax-heading"> ${escapeHtml(text)}</span>`;
      if (info.block === "callout") return `${lead}<span class="syntax-callout">${mark}${text ? ` ${escapeHtml(text)}` : ""}</span>`;
      if (["bullet-list", "numbered-list", "checklist"].includes(info.block)) return `${lead}<span class="syntax-list">${mark}</span>${text ? ` ${inlineHighlight(text)}` : ""}`;
      return `${lead}<span class="syntax-directive">${mark}</span>${text ? ` ${inlineHighlight(text)}` : ""}`;
    }
    return "";
  }

  function renderHighlight() {
    const users = state.users.filter((user) => user.id !== state.clientId && user.selection && user.selection.mode === "wmd");
    let decorated = state.source;
    const markers = new Map();
    users.sort((left, right) => right.selection.end - left.selection.end).forEach((user, index) => {
      const position = clamp(user.selection.end, 0, decorated.length);
      decorated = `${decorated.slice(0, position)}\u0000${index}\u0000${decorated.slice(position)}`;
      markers.set(index, user);
    });
    let inFence = false;
    let inConfig = false;
    const html = decorated.split("\n").map((line) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; return `<span class="syntax-code">${escapeHtml(line)}</span>`; }
      if (inFence) return `<span class="syntax-code">${escapeHtml(line)}</span>`;
      if (/^\s*@config\b/.test(line)) { inConfig = true; return `<span class="syntax-directive">${escapeHtml(line)}</span>`; }
      if (/^\s*@endconfig\b/.test(line)) { inConfig = false; return `<span class="syntax-directive">${escapeHtml(line)}</span>`; }
      if (inConfig) return highlightConfigLine(line);
      if (/^\s*@(tab|title|var|hidden|include|embed|toc|collapse|endcollapse|style|endstyle|end)\b/.test(line)) return `<span class="syntax-directive">${escapeHtml(line)}</span>`;
      if (/^\s*![A-Za-z][\w-]*(?:\s|$)/.test(line) || /^\s*!end\b/.test(line)) return `<span class="syntax-callout">${escapeHtml(line)}</span>`;
      const configured = configuredRawLineHighlight(line);
      if (configured) return configured;
      const heading = line.match(/^(#{1,6})(\s+.*)$/);
      if (heading) return `<span class="syntax-heading-mark">${escapeHtml(heading[1])}</span><span class="syntax-heading">${escapeHtml(heading[2])}</span>`;
      if (/^\s*([-+*]|\d+\.)\s+/.test(line)) return `<span class="syntax-list">${inlineHighlight(line)}</span>`;
      if (/^\s*>/.test(line)) return `<span class="syntax-quote">${inlineHighlight(line)}</span>`;
      return inlineHighlight(line);
    }).join("\n");
    highlightCode.innerHTML = html.replace(/\u0000(\d+)\u0000/g, (_, index) => {
      const user = markers.get(Number(index));
      return user ? `<span class="remote-source-cursor" style="--cursor-color:${escapeHtml(user.color || "#b9483c")}" data-name="${escapeHtml(user.name)}"></span>` : "";
    });
  }

  function highlightConfigLine(line) {
    const style = String(line || "").match(/^(\s*)([^:\n]+?)(\s*:\s*)(\{)([\s\S]*)(\})(;?)(\s*)$/);
    if (!style) {
      const setting = String(line || "").match(/^(\s*)([^:\n]+?)(\s*:\s*)([\s\S]*?)(;?)(\s*)$/);
      if (!setting) return escapeHtml(line);
      return `${escapeHtml(setting[1])}<span class="syntax-config-name">${escapeHtml(setting[2])}</span><span class="syntax-config-punctuation">${escapeHtml(setting[3])}</span><span class="syntax-config-value">${escapeHtml(setting[4])}</span>${escapeHtml(setting[5] + setting[6])}`;
    }

    const props = style[5];
    let output = `${escapeHtml(style[1])}<span class="syntax-config-style">${escapeHtml(style[2])}</span><span class="syntax-config-punctuation">${escapeHtml(style[3])}</span><span class="syntax-config-brace">${escapeHtml(style[4])}</span>`;
    let position = 0;
    const tokens = /([A-Za-z][\w-]*)(\s*:\s*)([^;]*)(;?)/g;
    for (const match of props.matchAll(tokens)) {
      output += escapeHtml(props.slice(position, match.index));
      output += `<span class="syntax-config-key">${escapeHtml(match[1])}</span><span class="syntax-config-punctuation">${escapeHtml(match[2])}</span><span class="syntax-config-value">${escapeHtml(match[3].trim())}</span>${escapeHtml(match[4])}`;
      position = match.index + match[0].length;
    }
    output += escapeHtml(props.slice(position));
    output += `<span class="syntax-config-brace">${escapeHtml(style[6])}</span>${escapeHtml(style[7] + style[8])}`;
    return output;
  }

  function inlineHighlight(source) {
    const tokens = /(\[\[[^\]]+\]\]|\[[^\]]+\]\([^\)]+\)|\{\{[A-Za-z][\w-]*\}\}|`[^`\n]*`|===[^=\n]+===|==[^=\n]+==|=[^=\n]+=|~~[^~\n]+~~|\+\+[^+\n]+\+\+|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;
    let output = "";
    let position = 0;
    for (const match of source.matchAll(tokens)) {
      output += escapeHtml(source.slice(position, match.index));
      const token = match[0];
      let className = "syntax-link";
      if (token.startsWith("{{")) className = "syntax-variable";
      else if (token.startsWith("`")) className = "syntax-inline-code";
      else if (token.startsWith("=")) className = "syntax-highlight";
      else if (token.startsWith("~~")) className = "syntax-strike";
      else if (token.startsWith("++")) className = "syntax-underline";
      else if (token.startsWith("*")) className = "syntax-bold";
      else if (token.startsWith("_")) className = "syntax-italic";
      output += `<span class="${className}">${escapeHtml(token)}</span>`;
      position = match.index + token.length;
    }
    return output + escapeHtml(source.slice(position));
  }

  function findMacro(beforeText) {
    return settings.macros.filter((macro) => beforeText.endsWith(macro.trigger)).sort((left, right) => right.trigger.length - left.trigger.length)[0] || null;
  }

  function expandRawMacro() {
    if (editor.selectionStart !== editor.selectionEnd) return;
    const cursor = editor.selectionStart;
    const macro = findMacro(editor.value.slice(0, cursor));
    if (!macro) return;
    const start = cursor - macro.trigger.length;
    editor.setRangeText(macro.replacement, start, cursor, "end");
    editor.setSelectionRange(start + macro.replacement.length, start + macro.replacement.length);
  }

  function previewText(value) {
    return String(value || "")
      .replace(/\[\[([^\]|]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
      .replace(/^\s*(?:[-+*]|\d+\.)\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/[`*_+=]/g, "")
      .trim();
  }

  function rawPreviewFocus() {
    return previewFocusAtOffset(editor.value, editor.selectionStart);
  }

  function rawPresetAtSelection() {
    const lineStart = editor.value.lastIndexOf("\n", editor.selectionStart - 1) + 1;
    const lineEnd = editor.value.indexOf("\n", editor.selectionStart);
    const currentLine = editor.value.slice(lineStart, lineEnd === -1 ? editor.value.length : lineEnd);
    if (/^@title\s+/.test(currentLine)) return "title";

    const before = editor.value.slice(0, lineStart).split("\n").reverse();
    for (const line of before) {
      const endStyle = line.match(/^@end(?:style)?\s*$/i);
      if (endStyle) break;
      const style = line.match(/^@style\s+(.+?)\s*$/i);
      if (style) return normalizePresetId(style[1]);
    }

    const heading = currentLine.match(/^#{1,6}\s+/);
    return heading ? `heading-${heading[0].trim().length}` : "";
  }

  function syncRawPreset() {
    setActivePreset(rawPresetAtSelection());
  }

  function previewFocusAtOffset(source, offset) {
    const lines = String(source || "").slice(0, clamp(offset, 0, String(source || "").length)).split("\n");
    const currentLine = lines[lines.length - 1] || "";
    let heading = "";
    let tab = "";

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!heading) {
        const headingMatch = lines[index].match(/^#{1,6}\s+(.+)$/);
        if (headingMatch) heading = previewText(headingMatch[1]);
      }
      const tabMatch = lines[index].match(/^@tab\s+(.+?)(?:\s+\{hidden\})?\s*$/);
      if (tabMatch) {
        tab = previewText(tabMatch[1]);
        break;
      }
    }

    const text = /^\s*[@!]/.test(currentLine) || /^[\s`-]*$/.test(currentLine) ? "" : previewText(currentLine);
    return tab || heading || text ? { heading, tab, text } : null;
  }

  function refreshRawScrollMap() {
    const source = editor.value;
    const width = editor.offsetWidth;
    const height = editor.clientHeight;
    const cached = state.rawScrollMap;
    if (cached && cached.source === source && cached.width === width && cached.height === height) return cached;

    const measure = cached?.element || document.createElement("pre");
    if (!measure.isConnected) {
      measure.className = "raw-scroll-measure";
      measure.setAttribute("aria-hidden", "true");
      document.querySelector("#rawEditorShell").append(measure);
    }
    measure.style.width = `${width}px`;
    measure.style.height = `${height}px`;
    let offset = 0;
    measure.innerHTML = source.split("\n").map((line, index) => {
      const marker = `<span class="raw-scroll-marker" data-raw-line="${index}" data-raw-offset="${offset}"></span>`;
      offset += line.length + 1;
      return `${marker}${escapeHtml(line)}`;
    }).join("\n");

    const entries = [...measure.querySelectorAll(".raw-scroll-marker")].map((marker) => ({
      index: Number(marker.dataset.rawLine),
      offset: Number(marker.dataset.rawOffset),
      top: marker.offsetTop,
    }));
    state.rawScrollMap = { source, width, height, element: measure, entries };
    return state.rawScrollMap;
  }

  function rawPreviewFocusAtScroll() {
    const map = refreshRawScrollMap();
    if (!map.entries.length) return null;
    const paddingTop = Number.parseFloat(getComputedStyle(editor).paddingTop) || 0;
    const target = editor.scrollTop + paddingTop + 2;
    let entry = map.entries[0];
    for (const candidate of map.entries) {
      if (candidate.top > target) break;
      entry = candidate;
    }
    return previewFocusAtOffset(map.source, entry.offset);
  }

  function onRawInput() {
    expandRawMacro();
    syncRawPreset();
    state.previewFocus = rawPreviewFocus();
    changeSource(editor.value, { compile: true, keepEditor: true });
  }

  function wrapRaw(marker) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end) || "text";
    editor.setRangeText(`${marker}${selected}${marker}`, start, end, "end");
    editor.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    onRawInput();
    editor.focus();
  }

  function addInsertField(labelText, name, options = {}) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const control = document.createElement(options.tagName || "input");
    control.name = name;
    control.id = `insert-${name}`;
    if (options.type) control.type = options.type;
    if (options.placeholder) control.placeholder = options.placeholder;
    if (options.value !== undefined) control.value = options.value;
    if (options.min !== undefined) control.min = String(options.min);
    if (options.max !== undefined) control.max = String(options.max);
    if (options.required) control.required = true;
    if (options.options) {
      options.options.forEach((option) => {
        const entry = document.createElement("option");
        entry.value = option.value;
        entry.textContent = option.label;
        control.append(entry);
      });
    }
    label.append(control);
    return { label, control };
  }

  function addInsertCheckbox(labelText, name, checked = false) {
    const label = document.createElement("label");
    const control = document.createElement("input");
    control.type = "checkbox";
    control.name = name;
    control.checked = checked;
    label.append(control, document.createTextNode(` ${labelText}`));
    return { label, control };
  }

  function openInsertDialog(kind, preset = null) {
    state.pendingInsert = {
      kind,
      presetId: preset?.id || "",
      rawSelection: state.mode === "wmd" ? captureRawSelection() : null,
      canvasSelection: state.mode === "document" && state.canvasSelection ? { ...state.canvasSelection } : null,
    };
    insertFields.replaceChildren();
    const options = {
      link: { title: "Insert link", description: "Add a link without leaving the editor." },
      image: { title: "Insert image", description: "Use a public image URL and optional alt text." },
      table: { title: "Insert table", description: "Choose the visible dimensions. The first row is the header." },
      callout: { title: "Insert callout", description: "Choose the style of the note you want to add." },
      preset: { title: preset ? `Edit ${preset.name}` : "New custom style", description: "This style applies to the selected block and every other block using the same preset." },
    }[kind];
    if (!options) return;
    insertDialogTitle.textContent = options.title;
    insertDialogDescription.textContent = options.description;
    confirmInsertButton.textContent = kind === "table" ? "Create table" : kind === "preset" ? "Save style" : "Insert";

    if (kind === "link") {
      const targets = documentLinkTargets();
      const linkType = addInsertField("Link destination", "linkType", {
        tagName: "select",
        options: targets.length
          ? [{ value: "internal", label: "Document tab or heading" }, { value: "external", label: "Web address" }]
          : [{ value: "external", label: "Web address" }],
      });
      const target = addInsertField("Document destination", "target", {
        tagName: "select",
        options: targets.map((item) => ({ value: item.value, label: item.label })),
      });
      const external = addInsertField("Web address", "href", { type: "url", placeholder: "https://example.com", value: "https://" });
      insertFields.append(linkType.label, target.label, external.label);
      const updateLinkFields = () => {
        const internal = linkType.control.value === "internal";
        target.label.hidden = !internal;
        external.label.hidden = internal;
      };
      linkType.control.addEventListener("change", updateLinkFields);
      updateLinkFields();
      insertFields.append(addInsertField("Link text", "label", { placeholder: "Link text" }).label);
    } else if (kind === "image") {
      insertFields.append(addInsertField("Image address", "src", { type: "url", placeholder: "https://example.com/image.png", value: "https://", required: true }).label);
      insertFields.append(addInsertField("Description", "alt", { placeholder: "Describe this image" }).label);
    } else if (kind === "table") {
      const dimensions = document.createElement("div");
      dimensions.className = "dimension-grid";
      dimensions.append(addInsertField("Rows", "rows", { type: "number", value: "3", min: 1, max: 20, required: true }).label);
      dimensions.append(addInsertField("Columns", "columns", { type: "number", value: "3", min: 1, max: 20, required: true }).label);
      insertFields.append(dimensions);
    } else if (kind === "callout") {
      const configuredCallouts = documentStylePresets().filter((preset) => preset.block === "callout");
      insertFields.append(addInsertField(configuredCallouts.length ? "Configured callout" : "Callout type", "type", {
        tagName: "select",
        options: configuredCallouts.length
          ? configuredCallouts.map((preset) => ({ value: `preset:${preset.id}`, label: preset.name }))
          : CALLOUT_TYPES.map((type) => ({ value: type, label: calloutLabel(type) })),
      }).label);
    } else if (kind === "preset") {
      const current = preset || { name: "Custom style", wmdFormatting: "@style", font: "", size: "", shortcut: "", block: "paragraph", level: "", bold: false, italic: false, underline: false, strike: false, highlight: false, calloutType: "note", calloutTitle: "", calloutIcon: "", calloutBackground: "", calloutBorder: "", calloutText: "", calloutTitleColor: "", calloutRadius: "", default: false };
      insertFields.append(addInsertField("Style name", "presetName", { value: current.name, required: true }).label);
      insertFields.append(addInsertField("WMD formatting", "presetWmdFormatting", { value: current.wmdFormatting || "@style", placeholder: "e.g. #, ##, @title, @style, -, 1., - [ ], !warning" }).label);
      insertFields.append(addInsertField("Font family", "presetFont", { value: current.font, placeholder: "Inherit document font" }).label);
      insertFields.append(addInsertField("Size", "presetSize", { value: current.size, placeholder: "e.g. 24px or 1.5rem" }).label);
      const shortcut = addInsertField("Shortcut", "presetShortcut", { value: current.shortcut, placeholder: "Click Record, then press a shortcut" });
      const recordShortcut = document.createElement("button");
      recordShortcut.type = "button";
      recordShortcut.textContent = "Record";
      recordShortcut.addEventListener("click", () => {
        recordShortcut.textContent = "Press keys...";
        const capture = (event) => {
          event.preventDefault();
          const value = shortcutFromEvent(event);
          if (value) shortcut.control.value = value;
          recordShortcut.textContent = "Record";
          window.removeEventListener("keydown", capture, true);
        };
        window.addEventListener("keydown", capture, true);
      });
      shortcut.label.append(recordShortcut);
      insertFields.append(shortcut.label);
      const block = addInsertField("Block type", "presetBlock", {
        tagName: "select",
        options: [
          { value: "paragraph", label: "Paragraph" },
          { value: "heading", label: "Heading" },
          { value: "bullet-list", label: "Bulleted list" },
          { value: "numbered-list", label: "Numbered list" },
          { value: "checklist", label: "Checklist" },
          { value: "callout", label: "Callout" },
        ],
      });
      block.control.value = current.block || (current.heading ? "heading" : "paragraph");
      const level = addInsertField("Heading level", "presetLevel", {
        tagName: "select",
        options: [{ value: "", label: "Keep current level" }, ...[1, 2, 3, 4, 5, 6].map((value) => ({ value: String(value), label: `Heading ${value}` }))],
      });
      level.control.value = current.level ? String(current.level) : "";
      const callout = addInsertField("Callout marker", "presetCalloutType", { value: current.calloutType || "note", placeholder: "warning, lore, boss, etc." });
      const togglePresetFields = () => {
        level.label.hidden = block.control.value !== "heading";
        callout.label.hidden = block.control.value !== "callout";
      };
      block.control.addEventListener("change", togglePresetFields);
      togglePresetFields();
      const calloutTitle = addInsertField("Callout title", "presetCalloutTitle", { value: current.calloutTitle || "", placeholder: "Optional title shown in the callout" });
      const calloutIcon = addInsertField("Callout icon", "presetCalloutIcon", { value: current.calloutIcon || "", placeholder: "Optional emoji/icon" });
      const calloutBg = addInsertField("Callout background", "presetCalloutBackground", { value: current.calloutBackground || "", placeholder: "e.g. #1f2937 or rgba(...)" });
      const calloutBorder = addInsertField("Callout border/accent", "presetCalloutBorder", { value: current.calloutBorder || "", placeholder: "e.g. #f59e0b" });
      const calloutText = addInsertField("Callout text colour", "presetCalloutText", { value: current.calloutText || "", placeholder: "e.g. #f8fafc" });
      const calloutTitleColor = addInsertField("Callout title colour", "presetCalloutTitleColor", { value: current.calloutTitleColor || "", placeholder: "e.g. #fde68a" });
      const calloutRadius = addInsertField("Callout radius", "presetCalloutRadius", { value: current.calloutRadius || "", placeholder: "e.g. 12px" });
      const calloutFields = [callout.label, calloutTitle.label, calloutIcon.label, calloutBg.label, calloutBorder.label, calloutText.label, calloutTitleColor.label, calloutRadius.label];
      const setCalloutHidden = () => calloutFields.forEach((field) => { field.hidden = block.control.value !== "callout"; });
      const previousTogglePresetFields = togglePresetFields;
      const toggleAllPresetFields = () => { previousTogglePresetFields(); setCalloutHidden(); };
      block.control.removeEventListener("change", togglePresetFields);
      block.control.addEventListener("change", toggleAllPresetFields);
      toggleAllPresetFields();
      insertFields.append(block.label, level.label, ...calloutFields);
      insertFields.append(addInsertCheckbox("Default after heading Enter", "presetDefault", current.default).label);
      insertFields.append(addInsertCheckbox("Bold", "presetBold", current.bold).label, addInsertCheckbox("Italic", "presetItalic", current.italic).label, addInsertCheckbox("Underline", "presetUnderline", current.underline).label, addInsertCheckbox("Strikethrough", "presetStrike", current.strike).label, addInsertCheckbox("Highlight", "presetHighlight", current.highlight).label);
    }
    insertDialog.showModal();
    requestAnimationFrame(() => insertFields.querySelector("input, select")?.focus());
  }

  function insertPayload(kind) {
    const form = new FormData(insertForm);
    if (kind === "link") {
      const internalTarget = String(form.get("target") || "").trim();
      const linkType = String(form.get("linkType") || "external");
      const href = String(form.get("href") || "").trim();
      if (linkType === "internal" && internalTarget) return { internalTarget, label: String(form.get("label") || "").trim() };
      if (!href) return null;
      return { href, label: String(form.get("label") || "").trim() };
    }
    if (kind === "image") {
      const src = String(form.get("src") || "").trim();
      if (!src) return null;
      return { src, alt: String(form.get("alt") || "").trim() };
    }
    if (kind === "table") {
      const rows = Number(form.get("rows"));
      const columns = Number(form.get("columns"));
      if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 20 || columns < 1 || columns > 20) {
        toastMessage("Choose whole-number table dimensions from 1 to 20.");
        return null;
      }
      return { rows, columns };
    }
    if (kind === "callout") {
      const raw = String(form.get("type") || "note");
      if (raw.startsWith("preset:")) {
        const preset = stylePresetById(raw.slice("preset:".length));
        if (preset) return { type: preset.calloutType || "note", preset: preset.id, title: preset.calloutTitle || preset.name || calloutLabel(preset.calloutType || "note") };
      }
      return { type: raw };
    }
    if (kind === "preset") {
      const block = String(form.get("presetBlock") || "paragraph");
      const calloutType = String(form.get("presetCalloutType") || "note").trim();
      let wmdFormatting = String(form.get("presetWmdFormatting") || "@style").trim();
      if (block === "callout" && (!wmdFormatting || wmdFormatting === "@style") && calloutType) wmdFormatting = `!${normalizeIdentifier(calloutType, "note")}`;
      return {
      name: String(form.get("presetName") || "").trim(),
      font: String(form.get("presetFont") || "").trim(),
      size: String(form.get("presetSize") || "").trim(),
      shortcut: String(form.get("presetShortcut") || "").trim(),
      wmdFormatting,
      block: String(form.get("presetBlock") || "paragraph"),
      heading: form.get("presetBlock") === "heading",
      level: String(form.get("presetLevel") || ""),
      calloutType: String(form.get("presetCalloutType") || "note"),
      calloutTitle: String(form.get("presetCalloutTitle") || "").trim(),
      calloutIcon: String(form.get("presetCalloutIcon") || "").trim(),
      calloutBackground: String(form.get("presetCalloutBackground") || "").trim(),
      calloutBorder: String(form.get("presetCalloutBorder") || "").trim(),
      calloutText: String(form.get("presetCalloutText") || "").trim(),
      calloutTitleColor: String(form.get("presetCalloutTitleColor") || "").trim(),
      calloutRadius: String(form.get("presetCalloutRadius") || "").trim(),
      default: form.get("presetDefault") === "on",
      bold: form.get("presetBold") === "on",
      italic: form.get("presetItalic") === "on",
      underline: form.get("presetUnderline") === "on",
      strike: form.get("presetStrike") === "on",
      highlight: form.get("presetHighlight") === "on",
      };
    }
    return null;
  }

  function requestInsert(kind, value) {
    if (value === undefined && ["link", "image", "table", "callout"].includes(kind)) {
      openInsertDialog(kind);
      return;
    }
    const pending = state.pendingInsert;
    if (state.mode === "wmd" && pending?.rawSelection) {
      editor.setSelectionRange(pending.rawSelection.start, pending.rawSelection.end);
      editor.scrollTop = pending.rawSelection.scrollTop;
      editor.scrollLeft = pending.rawSelection.scrollLeft;
    }
    if (state.mode === "document" && pending?.canvasSelection) state.canvasSelection = pending.canvasSelection;
    state.pendingInsert = null;
    if (kind === "preset") {
      saveStylePreset(value, pending?.presetId);
      return;
    }
    if (state.mode === "document") insertCanvas(kind, value);
    else insertRaw(kind, value);
  }

  function insertRaw(kind, value) {
    if (kind === "callout") {
      const options = value && typeof value === "object" ? value : { type: value };
      const preset = options.preset ? stylePresetById(options.preset) : null;
      const type = normalizeIdentifier(options.type || preset?.calloutType || "note", "note");
      const title = options.title || preset?.calloutTitle || preset?.name || calloutLabel(type);
      const body = `Write the ${type} here.`;
      const text = `\n!${type} ${title}\n${body}\n!end\n`;
      const start = editor.selectionStart;
      editor.setRangeText(text, start, editor.selectionEnd, "end");
      const bodyStart = start + `\n!${type} ${title}\n`.length;
      editor.setSelectionRange(bodyStart, bodyStart + body.length);
      onRawInput();
      editor.focus();
      return;
    }
    if (kind === "table") {
      const dimensions = value;
      if (!dimensions) return;
      const columns = Array.from({ length: dimensions.columns }, (_, index) => `Header ${index + 1}`);
      const divider = Array.from({ length: dimensions.columns }, () => "---");
      const body = Array.from({ length: Math.max(0, dimensions.rows - 1) }, () => `| ${Array(dimensions.columns).fill("").join(" | ")} |`);
      const text = `\n| ${columns.join(" | ")} |\n| ${divider.join(" | ")} |${body.length ? `\n${body.join("\n")}` : ""}\n`;
      const start = editor.selectionStart;
      editor.setRangeText(text, start, editor.selectionEnd, "end");
      editor.setSelectionRange(start + 3, start + 3 + columns[0].length);
      onRawInput();
      editor.focus();
      return;
    }
    if (kind === "link") {
      const link = value || {};
      const start = editor.selectionStart;
      const selected = editor.value.slice(start, editor.selectionEnd);
      const customLabel = link.label || selected;
      const label = customLabel || "link text";
      const text = link.internalTarget
        ? `[[${link.internalTarget}${customLabel ? `|${label}` : ""}]]`
        : `[${label}](${link.href || "https://example.com"})`;
      editor.setRangeText(text, start, editor.selectionEnd, "end");
      editor.setSelectionRange(start + 1, start + 1 + label.length);
      onRawInput();
      editor.focus();
      return;
    }
    if (kind === "image") {
      const image = value || {};
      const alt = image.alt || "image description";
      const text = `![${alt}](${image.src || "https://example.com/image.png"})`;
      const start = editor.selectionStart;
      editor.setRangeText(text, start, editor.selectionEnd, "end");
      editor.setSelectionRange(start + 2, start + 2 + alt.length);
      onRawInput();
      editor.focus();
      return;
    }
    const templates = {
      heading: ["\n## New heading\n", 4, 15],
      list: ["\n- List item\n", 3, 12],
      "ordered-list": ["\n1. List item\n", 4, 13],
      checkbox: ["\n- [ ] Task\n", 7, 11],
      tab: ["\n@tab New tab\n@title New tab\n\n# New tab\n", 6, 13],
    };
    const [text, startOffset, endOffset] = templates[kind];
    const start = editor.selectionStart;
    editor.setRangeText(text, start, editor.selectionEnd, "end");
    editor.setSelectionRange(start + startOffset, start + endOffset);
    onRawInput();
    editor.focus();
  }

  function rawTextWithoutConfiguredPrefix(line) {
    const native = String(line || "")
      .replace(/^@title\s+/, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*(?:[-+*]|\d+\.)\s+/, "")
      .replace(/^\s*\[[ xX]\]\s+/, "");
    const customPresets = documentStylePresets()
      .filter((style) => wmdFormattingInfo(style.wmdFormatting, style.name).customMarker)
      .sort((a, b) => String(b.wmdFormatting || "").length - String(a.wmdFormatting || "").length);
    for (const style of customPresets) {
      const marker = normalizeWmdFormatting(style.wmdFormatting);
      const match = String(line || "").match(new RegExp(`^\\s*${escapeRegExp(marker)}(?:\\s+|$)([\\s\\S]*)$`));
      if (match) return match[1];
    }
    return native;
  }

  function rawBlockForPreset(preset, text) {
    const label = text || `New ${preset?.name || "text"}`;
    const info = wmdFormattingInfo(preset?.wmdFormatting || "", preset?.name || "");
    if (info.customMarker) return `${info.formatting} ${label}`;
    if (info.block === "title") return `@title ${label}`;
    if (info.block === "heading" && info.level) return `${"#".repeat(Math.round(info.level))} ${label}`;
    if (info.block === "bullet-list") return `- ${label}`;
    if (info.block === "numbered-list") return `1. ${label}`;
    if (info.block === "checklist") return `- [ ] ${label}`;
    if (info.block === "callout") return `!${info.calloutType || "note"} ${preset?.calloutTitle || preset?.name || calloutLabel(info.calloutType || "note")}\n${label}\n!end`;
    return label;
  }

  function applyRawPreset(preset) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIndex = editor.value.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? editor.value.length : lineEndIndex;
    const currentLine = editor.value.slice(lineStart, lineEnd);
    const info = wmdFormattingInfo(preset?.wmdFormatting || "", preset?.name || "");
    if (info.block === "title" && /^@title\s+/.test(currentLine)) {
      setActivePreset(preset.id);
      return;
    }

    const previousLineEnd = lineStart - 1;
    const previousLineStart = previousLineEnd > 0 ? editor.value.lastIndexOf("\n", previousLineEnd - 1) + 1 : 0;
    const previousLine = previousLineEnd >= 0 ? editor.value.slice(previousLineStart, previousLineEnd) : "";
    const previousStyle = previousLine.match(/^@style\s+.+?\s*$/i);
    const nextLineStart = lineEndIndex === -1 ? editor.value.length : lineEndIndex + 1;
    const nextLineEnd = editor.value.indexOf("\n", nextLineStart);
    const nextLine = editor.value.slice(nextLineStart, nextLineEnd === -1 ? editor.value.length : nextLineEnd);
    const nextStyleEnd = /^@end(?:style)?\s*$/i.test(nextLine);

    const replacementStart = previousStyle ? previousLineStart : lineStart;
    const replacementEnd = previousStyle && nextStyleEnd ? (nextLineEnd === -1 ? editor.value.length : nextLineEnd) : lineEnd;
    const sourceText = rawTextWithoutConfiguredPrefix(currentLine) || `New ${preset?.name || "text"}`;

    const block = preset ? rawBlockForPreset(preset, sourceText) : sourceText;
    const marker = preset && info.wrapsStyle ? `@style ${preset.name}\n` : "";
    const endMarker = preset && info.wrapsStyle ? "\n@end" : "";
    const replacement = `${marker}${block}${endMarker}`;
    editor.setRangeText(replacement, replacementStart, replacementEnd, "end");
    const cursorStart = replacementStart + marker.length + Math.min(block.length, block.lastIndexOf(sourceText) >= 0 ? block.lastIndexOf(sourceText) : block.length);
    editor.setSelectionRange(cursorStart, cursorStart + sourceText.length);
    onRawInput();
    editor.focus();
  }


  function applyStylePreset(preset) {
    if (!preset) return;
    blockStyleControl.value = `preset:${preset.id}`;
    if (state.mode === "document") sendCanvasCommand("applyPreset", preset);
    else applyRawPreset(preset);
  }

  function stylePresetForShortcut(event) {
    const shortcut = shortcutFromEvent(event);
    return shortcut ? documentStylePresets().find((preset) => preset.shortcut === shortcut) || null : null;
  }

  function onRawKeydown(event) {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
      const line = editor.value.slice(lineStart, start);
      const orderedItem = start === end && line.match(/^(\s*)(\d+)\.\s+(.+)$/);
      const nextLine = orderedItem
        ? `\n${orderedItem[1]}${Number(orderedItem[2]) + 1}. `
        : "\n";
      editor.setRangeText(nextLine, start, end, "end");
      onRawInput();
      scheduleRawSelection();
      return;
    }
    const preset = stylePresetForShortcut(event);
    if (preset) {
      event.preventDefault();
      applyStylePreset(preset);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); applyHistory(event.shiftKey ? "redo" : "undo"); return; }
      if (key === "y") { event.preventDefault(); applyHistory("redo"); return; }
      if (key === "b") { event.preventDefault(); syncRawPreset(); if (!updateActivePresetFormatting("bold")) wrapRaw("*"); return; }
      if (key === "i") { event.preventDefault(); syncRawPreset(); if (!updateActivePresetFormatting("italic")) wrapRaw("_"); return; }
      if (key === "u") { event.preventDefault(); syncRawPreset(); if (!updateActivePresetFormatting("underline")) wrapRaw("++"); return; }
      if (key === "k") { event.preventDefault(); requestInsert("link"); return; }
    }
    if (!['*', '_', '=', '`'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = editor.value[start - 1] || "";
    const after = editor.value[end] || "";
    if (start !== end) { event.preventDefault(); wrapRaw(event.key); return; }
    if (/\w/.test(before) || /\w/.test(after)) return;
    event.preventDefault();
    editor.setRangeText(`${event.key}${event.key}`, start, end, "end");
    editor.setSelectionRange(start + 1, start + 1);
    onRawInput();
  }

  function scheduleRawSelection() {
    clearTimeout(state.selectionTimer);
    state.selectionTimer = setTimeout(() => {
      if (state.mode === "wmd" && document.activeElement === editor) {
        syncRawPreset();
      }
      if (state.ready && state.mode === "wmd" && document.activeElement === editor) {
        send({ type: "selection", mode: "wmd", start: editor.selectionStart, end: editor.selectionEnd });
      }
    }, 90);
  }

  function scheduleCanvasSelection(start, end) {
    state.pendingCollaboratorSelection = {
      mode: "canvas",
      start: Math.max(0, Number(start) || 0),
      end: Math.max(0, Number(end) || 0),
    };
    clearTimeout(state.collaboratorSelectionTimer);
    state.collaboratorSelectionTimer = setTimeout(() => {
      const selection = state.pendingCollaboratorSelection;
      state.pendingCollaboratorSelection = null;
      if (selection && state.ready && state.mode === "document") send({ type: "selection", ...selection });
    }, 75);
  }

  function postCanvas(message) {
    if (preview.contentWindow) preview.contentWindow.postMessage({ channel: "wmd-studio-canvas", ...message }, "*");
  }

  function postPreview(message) {
    if (preview.contentWindow) preview.contentWindow.postMessage({ channel: "wmd-studio-preview", ...message }, "*");
  }

  function syncPreviewToRawScroll() {
    if (state.mode !== "wmd") return;
    cancelAnimationFrame(state.rawScrollFrame);
    state.rawScrollFrame = requestAnimationFrame(() => {
      state.rawScrollFrame = null;
      const focus = rawPreviewFocusAtScroll();
      if (!focus) return;
      const signature = JSON.stringify(focus);
      const shouldActivateTab = Boolean(focus.tab && focus.tab !== state.activeTab);
      if (signature === state.lastRawScrollFocus && !shouldActivateTab) return;
      state.lastRawScrollFocus = signature;
      if (shouldActivateTab) {
        state.activeTab = focus.tab;
        renderDocumentTabs();
      }
      // A source scroll only reveals a related location in the preview. It never writes a
      // calculated scroll offset back to the textarea, which was causing visible jumping.
      postPreview({ type: "focus", focus });
    });
  }

  function sendPreviewState() {
    if (state.mode !== "wmd") return;
    postPreview({ type: "state", scroll: state.previewScroll, focus: state.previewFocus });
    state.previewFocus = null;
  }

  function sendCanvasState(options = {}) {
    if (state.mode !== "document") return;
    const selection = options.forceSelection || state.restoreCanvasSelection ? state.canvasSelection : null;
    postCanvas({
      type: "state",
      macros: settings.macros,
      presets: documentStylePresets(),
      presetCss: stylePresetCss(),
      zoom: settings.zoom,
      selection,
      scroll: state.previewScroll,
    });
    if (selection) state.restoreCanvasSelection = false;
    sendCanvasCursors();
  }

  function sendCanvasCursors() {
    // Remote cursors must not be inserted into a live contenteditable document. Inserting
    // marker spans splits text nodes and causes the browser to move the local selection.
  }

  function scheduleDocumentCanvasRefresh() {
    if (state.mode !== "document") return;
    const idleFor = Date.now() - state.canvasLastInputAt;
    scheduleCompile(Math.max(80, 650 - idleFor));
  }

  function sendCanvasCommand(command, value = "") {
    sendCanvasState({ forceSelection: true });
    postCanvas({ type: "command", command, value });
  }

  function insertCanvas(kind, value) {
    if (kind === "heading") sendCanvasCommand("formatBlock", "h2");
    else {
      sendCanvasState({ forceSelection: true });
      postCanvas({ type: "command", command: "insert", kind, value });
    }
  }

  function calloutLabel(type) {
    return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  }


  function handleCanvasMessage(event) {
    if (event.source !== preview.contentWindow) return;
    const message = event.data || {};
    if (message.channel !== "wmd-studio-canvas") return;
    if (!message.canvasRenderId || message.canvasRenderId !== state.canvasRenderId) return;
    if (message.type === "ready") {
      const nextText = String(message.text || "");
      const compiledCanvasSource = typeof state.canvasSource === "string" ? state.canvasSource : state.source;
      const serializedCanvasSource = message.html ? canvasHtmlToWmd(String(message.html), compiledCanvasSource) : compiledCanvasSource;
      const canvasBridge = operationFromDiff(serializedCanvasSource, compiledCanvasSource);
      if (canvasBridge) {
        state.canvasSource = serializedCanvasSource;
        state.canvasExternalOperations = [canvasBridge, ...state.canvasExternalOperations];
      }
      const previousText = typeof state.canvasText === "string" ? state.canvasText : null;
      if (previousText !== null && previousText !== nextText) remapCanvasSelections(previousText, nextText);
      if (state.restoreCanvasSelection && state.canvasSelection && previousText !== null) {
        state.canvasSelection = {
          start: mapOffsetBetweenTexts(previousText, nextText, state.canvasSelection.start),
          end: mapOffsetBetweenTexts(previousText, nextText, state.canvasSelection.end),
        };
      }
      state.canvasText = nextText;
      sendCanvasState();
      return;
    }
    if (message.type === "input") {
      state.canvasLastInputAt = Date.now();
      state.canvasText = String(message.text || "");
      if (message.selection) {
        state.canvasSelection = {
          start: Number(message.selection.start) || 0,
          end: Number(message.selection.end) || 0,
        };
        setActivePreset(message.selection.preset);
      }
      const canvasBase = typeof state.canvasSource === "string" ? state.canvasSource : state.source;
      const nextCanvasSource = canvasHtmlToWmd(String(message.html || ""), canvasBase);
      const canvasOperation = operationFromDiff(canvasBase, nextCanvasSource);
      if (canvasOperation) {
        try {
          const rebased = rebaseCanvasOperation(canvasOperation);
          const nextSource = applyOperation(state.source, rebased.operation);
          state.canvasSource = nextCanvasSource;
          state.canvasExternalOperations = rebased.externalOperations;
          changeSource(nextSource, { compile: false, canvas: true });
          if (state.canvasExternalOperations.length) scheduleDocumentCanvasRefresh();
        } catch (_) {
          state.restoreCanvasSelection = true;
          scheduleCompile(0);
          toastMessage("Refreshing the document to keep simultaneous edits aligned.");
        }
      }
      return;
    }
    if (message.type === "selection") {
      state.canvasSelection = {
        start: Number(message.start) || 0,
        end: Number(message.end) || 0,
      };
      setActivePreset(message.preset);
      scheduleCanvasSelection(state.canvasSelection.start, state.canvasSelection.end);
      return;
    }
    if (message.type === "scroll") {
      state.previewScroll = {
        left: Number(message.left) || 0,
        top: Number(message.top) || 0,
      };
      return;
    }
    if (message.type === "request-link") requestInsert("link");
    if (message.type === "request-find") openFindDialog();
    if (message.type === "request-history") applyHistory(message.direction === "redo" ? "redo" : "undo");
    if (message.type === "request-preset-format") {
      setActivePreset(message.preset);
      updateActivePresetFormatting(message.command);
    }
  }

  function handlePreviewMessage(event) {
    if (event.source !== preview.contentWindow) return;
    const message = event.data || {};
    if (message.channel !== "wmd-studio-preview") return;
    if (message.type === "ready") {
      sendPreviewState();
      return;
    }
    if (message.type === "tab") {
      if (message.tab && message.tab !== state.activeTab) {
        state.activeTab = message.tab;
        renderDocumentTabs();
      }
      return;
    }
    if (message.type === "scroll") {
      state.previewScroll = {
        left: Number(message.left) || 0,
        top: Number(message.top) || 0,
      };
    }
  }

  function renderPresence() {
    presence.replaceChildren();
    state.users.slice(0, 8).forEach((user) => {
      const avatar = document.querySelector("#userTemplate").content.firstElementChild.cloneNode(true);
      const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      avatar.textContent = initials || "G";
      avatar.style.background = user.color || "#3f7f6b";
      const self = user.id === state.clientId;
      avatar.disabled = self || !user.selection;
      avatar.title = self ? `${user.name} (you)` : user.selection ? `Jump to ${user.name}` : `${user.name} is viewing`;
      if (!self && user.selection) avatar.addEventListener("click", () => jumpToUser(user));
      presence.append(avatar);
    });
  }

  function jumpToUser(user) {
    const selection = user.selection;
    if (!selection) return;
    if (selection.mode === "wmd") {
      setMode("wmd", true);
      requestAnimationFrame(() => {
        const start = clamp(selection.start, 0, state.source.length);
        const end = clamp(selection.end, 0, state.source.length);
        editor.setSelectionRange(start, end);
        const line = state.source.slice(0, start).split("\n").length - 1;
        const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 23;
        editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight / 2);
        editor.focus();
        scheduleRawSelection();
      });
    } else {
      state.canvasSelection = {
        start: Math.max(0, Number(selection.start) || 0),
        end: Math.max(0, Number(selection.end) || 0),
      };
      state.restoreCanvasSelection = true;
      if (state.mode === "document") sendCanvasState({ forceSelection: true });
      else setMode("document");
    }
    toastMessage(`Jumped to ${user.name}.`);
  }

  function documentUrl(id) {
    const url = new URL(location.href);
    url.searchParams.delete("documents");
    url.searchParams.set("doc", normalizeDocumentId(id));
    return url;
  }

  function documentsUrl() {
    const url = new URL(location.href);
    url.searchParams.set("documents", "1");
    return url;
  }

  function formatDocumentDate(value) {
    if (!value) return "Saved document";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Saved document";
    return `Updated ${date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
  }

  function renderDocumentsPage() {
    if (!documentsListPage) return;
    documentsListPage.replaceChildren();
    if (state.documentsLoading) {
      const loading = document.createElement("div");
      loading.className = "documents-empty";
      loading.textContent = "Loading documents...";
      documentsListPage.append(loading);
      return;
    }
    if (!state.documents.length) {
      const empty = document.createElement("div");
      empty.className = "documents-empty";
      empty.textContent = "No saved documents yet. Create one above.";
      documentsListPage.append(empty);
      return;
    }
    state.documents.forEach((item) => {
      const card = document.createElement("article");
      card.className = `document-card ${item.id === state.documentId ? "document-card-current" : ""}`;
      const main = document.createElement("div");
      main.className = "document-card-main";
      const title = document.createElement("div");
      title.className = "document-card-title";
      title.textContent = item.title || item.id;
      const meta = document.createElement("div");
      meta.className = "document-card-meta";
      meta.textContent = `${item.id}.wmd · ${formatDocumentDate(item.updatedAt)}`;
      main.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "document-card-actions";
      const openButton = document.createElement("button");
      openButton.className = "primary-button";
      openButton.type = "button";
      openButton.textContent = item.id === state.documentId ? "Current" : "Open";
      openButton.disabled = item.id === state.documentId && !state.libraryOpen;
      openButton.addEventListener("click", () => openDocument(item.id));
      const deleteButton = document.createElement("button");
      deleteButton.className = "quiet-button document-delete-button";
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.disabled = item.id === "untitled" || item.id === state.documentId;
      deleteButton.title = item.id === state.documentId ? "Open another document before deleting this one." : "Delete this document";
      deleteButton.addEventListener("click", () => deleteDocumentFromLibrary(item));
      actions.append(openButton, deleteButton);
      card.append(main, actions);
      documentsListPage.append(card);
    });
  }

  async function loadDocumentsPage() {
    if (!documentsListPage) return;
    state.documentsLoading = true;
    renderDocumentsPage();
    try {
      const response = await fetch(apiUrl("/api/documents"));
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load documents.");
      state.documents = Array.isArray(result.documents) ? result.documents : [];
    } catch (error) {
      toastMessage(error.message || "Could not load documents.");
      state.documents = [];
    } finally {
      state.documentsLoading = false;
      renderDocumentsPage();
    }
  }

  function showDocumentsPage(options = {}) {
    state.libraryOpen = true;
    if (documentsPage) documentsPage.hidden = false;
    loadDocumentsPage();
    if (options.pushHistory !== false) history.pushState({}, "", documentsUrl());
  }

  function hideDocumentsPage(options = {}) {
    state.libraryOpen = false;
    if (documentsPage) documentsPage.hidden = true;
    if (options.pushHistory !== false) history.pushState({}, "", documentUrl(state.documentId));
  }

  async function createDocumentFromLibrary(event) {
    event.preventDefault();
    const name = newDocumentName.value.trim();
    if (!name) {
      toastMessage("Name the document first.");
      newDocumentName.focus();
      return;
    }
    try {
      const response = await fetch(apiUrl("/api/documents"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, id: normalizeDocumentId(name) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create document.");
      newDocumentName.value = "";
      state.documents.unshift(result.document);
      renderDocumentsPage();
      openDocument(result.document.id);
      toastMessage("Document created.");
    } catch (error) {
      toastMessage(error.message || "Could not create document.");
    }
  }

  async function deleteDocumentFromLibrary(item) {
    if (!item || !item.id || item.id === state.documentId) return;
    if (!confirm(`Delete ${item.title || item.id}? This removes its .wmd file from web/data.`)) return;
    try {
      const response = await fetch(apiUrl(`/api/documents/${encodeURIComponent(item.id)}`), { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete document.");
      state.documents = state.documents.filter((document) => document.id !== item.id);
      renderDocumentsPage();
      localStorage.removeItem(`${DRAFT_PREFIX}${item.id}`);
      toastMessage("Document deleted.");
    } catch (error) {
      toastMessage(error.message || "Could not delete document.");
    }
  }

  function openDocument(nextId, options = {}) {
    const id = normalizeDocumentId(nextId);
    if (id === state.documentId && state.ready && !state.importedSource) {
      hideDocumentsPage({ pushHistory: options.pushHistory });
      return;
    }
    hideDocumentsPage({ pushHistory: false });
    persistDraft();
    state.documentId = id;
    state.ready = false;
    state.revision = 0;
    state.serverSource = "";
    state.pending = [];
    state.inFlight = null;
    clearOperationTimeout();
    state.dirty = false;
    state.canvasSelection = null;
    state.canvasText = null;
    state.canvasSource = null;
    state.canvasExternalOperations = [];
    state.canvasRenderId = "";
    state.canvasLastInputAt = 0;
    state.restoreCanvasSelection = false;
    state.previewScroll = { left: 0, top: 0 };
    state.previewFocus = null;
    resetHistory();
    const draft = readDraft(id);
    state.source = draft ? draft.source : "";
    renderSource();
    if (options.pushHistory !== false) {
      history.pushState({}, "", documentUrl(id));
    }
    saveStatus.textContent = state.source ? "Local draft loaded - connecting..." : "Loading document...";
    scheduleCompile(0);
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      send({ type: "join", documentId: id, name: settings.username, color: settings.color, clientId: state.clientId });
    } else {
      connect();
    }
  }

  async function importDocument(file) {
    if (!file) return;
    try {
      let source;
      if (/\.(md|markdown|wmd)$/i.test(file.name)) source = await file.text();
      else if (/\.docx$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        const response = await fetch(apiUrl("/api/import"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, data: btoa(binary) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not import DOCX.");
        source = result.source;
      } else throw new Error("Choose a .md, .wmd, or .docx file.");
      state.importedSource = source;
      openDocument(normalizeDocumentId(file.name));
      toastMessage(`Importing ${file.name}`);
    } catch (error) {
      toastMessage(error.message);
    } finally {
      importInput.value = "";
    }
  }

  function downloadDocument() {
    const blob = new Blob([state.source], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.documentId}.wmd`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function openSettings() {
    document.querySelector("#usernameInput").value = settings.username;
    document.querySelector("#syncUrlInput").value = settings.syncUrl;
    document.querySelector("#cursorColorInput").value = settings.color;
    document.querySelector("#themeInput").value = settings.theme;
    document.querySelector("#accentInput").value = settings.accent;
    document.querySelector("#defaultModeInput").value = settings.defaultMode;
    macroList.replaceChildren();
    (settings.macros.length ? settings.macros : [{ trigger: "", replacement: "" }]).forEach(addMacroRow);
    settingsDialog.showModal();
  }

  function addMacroRow(macro = { trigger: "", replacement: "" }) {
    const row = document.querySelector("#macroTemplate").content.firstElementChild.cloneNode(true);
    row.querySelector(".macro-trigger").value = macro.trigger;
    row.querySelector(".macro-replacement").value = macro.replacement;
    row.querySelector(".remove-macro-button").addEventListener("click", () => row.remove());
    macroList.append(row);
  }

  function saveSettingsFromForm() {
    const requestedSyncUrl = document.querySelector("#syncUrlInput").value.trim();
    const syncUrl = normalizeServerUrl(requestedSyncUrl);
    if (requestedSyncUrl && !syncUrl) {
      toastMessage("Enter a full sync server URL. HTTPS pages require an HTTPS server.");
      return false;
    }
    const serverChanged = syncUrl !== settings.syncUrl;
    settings = {
      ...settings,
      username: document.querySelector("#usernameInput").value.trim().slice(0, 36) || settings.username,
      syncUrl,
      color: document.querySelector("#cursorColorInput").value,
      theme: document.querySelector("#themeInput").value,
      accent: document.querySelector("#accentInput").value,
      defaultMode: document.querySelector("#defaultModeInput").value,
      macros: normalizeMacros([...macroList.querySelectorAll(".macro-row")].map((row) => ({
        trigger: row.querySelector(".macro-trigger").value,
        replacement: row.querySelector(".macro-replacement").value,
      })), []),
    };
    saveSettings();
    applyAppearance();
    send({ type: "profile", name: settings.username, color: settings.color });
    if (serverChanged) {
      // Prefer the document currently on screen when moving it to another sync server.
      state.dirty = Boolean(state.source);
      persistDraft();
      state.ready = false;
      state.pending = [];
      state.inFlight = null;
      clearOperationTimeout();
      connect();
      toastMessage("Switching to the selected sync server. Your local draft is safe.");
    } else {
      sendCanvasState();
      toastMessage("Settings saved.");
    }
    return true;
  }

  function startResize(event) {
    if (window.matchMedia("(max-width: 960px)").matches) return;
    state.dragging = event.currentTarget.dataset.resize;
    event.currentTarget.classList.add("dragging");
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
  }

  function moveResize(event) {
    if (!state.dragging) return;
    const rect = workspace.getBoundingClientRect();
    const maxEditorWidth = Math.max(360, rect.width - 468);
    settings.panes.editor = clamp(event.clientX - rect.left, 360, maxEditorWidth);
    applyPaneLayout();
  }

  function endResize() {
    if (!state.dragging) return;
    state.dragging = null;
    document.body.style.userSelect = "";
    document.querySelectorAll(".pane-resizer").forEach((element) => element.classList.remove("dragging"));
    saveSettings();
  }

  function adjustBaseSize(change) {
    const preset = stylePresetById(state.activePresetId);
    if (preset) {
      updateStylePreset(preset.id, { size: `${clamp(presetSizeInPixels(preset) + change, 8, 160)}px` });
      return;
    }
    const current = Number.parseInt(configValue("baseSize", "16px"), 10) || 16;
    changeConfig("baseSize", `${clamp(current + change, 10, 32)}px`);
  }

  function setZoom(value) {
    settings.zoom = clamp(value, 60, 160);
    saveSettings();
    updateToolbarValues();
    if (state.mode === "document") sendCanvasState();
    else scheduleCompile(0);
  }

  function bindEvents() {
    editor.addEventListener("input", onRawInput);
    editor.addEventListener("keydown", onRawKeydown);
    editor.addEventListener("select", scheduleRawSelection);
    editor.addEventListener("keyup", scheduleRawSelection);
    editor.addEventListener("click", scheduleRawSelection);
    editor.addEventListener("scroll", () => {
      highlightLayer.scrollTop = editor.scrollTop;
      highlightLayer.scrollLeft = editor.scrollLeft;
      syncPreviewToRawScroll();
    });

    document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => {
      const command = button.dataset.command;
      if (command === "undo" || command === "redo") {
        applyHistory(command);
      } else if (state.mode === "document") {
        if (command === "highlight") sendCanvasCommand("highlight");
        else sendCanvasCommand(command);
      } else if (updateActivePresetFormatting(command)) {
        return;
      } else if (command === "bold") wrapRaw("*");
      else if (command === "italic") wrapRaw("_");
      else if (command === "underline") wrapRaw("++");
      else if (command === "strikeThrough") wrapRaw("~~");
      else if (command === "highlight") wrapRaw("=");
    }));
    document.querySelectorAll("[data-insert]").forEach((button) => button.addEventListener("click", () => requestInsert(button.dataset.insert)));
    document.querySelectorAll("[data-document-command]").forEach((button) => button.addEventListener("click", () => {
      const command = button.dataset.documentCommand;
      if (command === "size-down") adjustBaseSize(-1);
      if (command === "size-up") adjustBaseSize(1);
      if (command === "zoom-out") setZoom(settings.zoom - 10);
      if (command === "zoom-in") setZoom(settings.zoom + 10);
    }));
    blockStyleControl.addEventListener("change", () => {
      if (blockStyleControl.value === "preset:new") {
        openStylePresetDialog();
        return;
      }
      const preset = stylePresetById(blockStyleControl.value.replace(/^preset:/, ""));
      if (preset) applyStylePreset(preset);
    });
    fontControl.addEventListener("change", () => {
      const preset = stylePresetById(state.activePresetId);
      if (preset) updateStylePreset(preset.id, { font: fontControl.value });
      else changeConfig("font", fontControl.value);
    });
    document.querySelector("#stylePresetButton").addEventListener("click", openStylePresetDialog);
    zoomControl.addEventListener("click", () => setZoom(100));
    window.addEventListener("message", (event) => {
      handleCanvasMessage(event);
      handlePreviewMessage(event);
    });

    documentModeButton.addEventListener("click", () => setMode("document"));
    wmdModeButton.addEventListener("click", () => setMode("wmd", true));
    document.querySelector("#mobilePreviewButton").addEventListener("click", () => workspace.classList.add("show-preview"));
    document.querySelector("#uploadButton").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => importDocument(importInput.files[0]));
    document.querySelector("#documentsButton").addEventListener("click", () => showDocumentsPage());
    document.querySelector("#backToEditorButton").addEventListener("click", () => hideDocumentsPage());
    document.querySelector("#refreshDocumentsButton").addEventListener("click", () => loadDocumentsPage());
    documentsCreateForm.addEventListener("submit", createDocumentFromLibrary);
    document.querySelector("#renameButton").addEventListener("click", openRenameDialog);
    document.querySelector("#downloadButton").addEventListener("click", downloadDocument);
    document.querySelector("#shareButton").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareUrl());
        toastMessage(settings.syncUrl || location.hostname !== "127.0.0.1" ? "Share link copied." : "Link copied. For remote collaborators, use a public sync server in Settings.");
      } catch (_) {
        openShareDialog();
      }
    });
    document.querySelector("#selectShareLinkButton").addEventListener("click", () => {
      shareLinkInput.focus();
      shareLinkInput.select();
    });
    document.querySelector("#copyShareLinkButton").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareLinkInput.value);
        toastMessage("Share link copied.");
        shareDialog.close("copied");
      } catch (_) {
        shareLinkInput.focus();
        shareLinkInput.select();
        toastMessage("Link selected. Copy it with Ctrl+C or Cmd+C.");
      }
    });
    panelsButton.addEventListener("click", (event) => { event.stopPropagation(); setPanelMenu(panelMenu.hidden); });
    document.querySelector("#closePanelsButton").addEventListener("click", () => setPanelMenu(false));
    document.addEventListener("pointerdown", (event) => {
      if (!panelMenu.hidden && !panelMenu.contains(event.target) && !panelsButton.contains(event.target)) setPanelMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "h") {
        event.preventDefault();
        openFindDialog();
        return;
      }
      if (event.key === "Escape") setPanelMenu(false);
    });
    document.querySelectorAll("[data-panel-toggle]").forEach((input) => input.addEventListener("change", () => {
      const nextPanels = { ...settings.panels, [input.dataset.panelToggle]: input.checked };
      const visible = {
        editor: state.mode === "wmd" && nextPanels.editor,
        preview: nextPanels.preview,
      };
      if (!visible.editor && !visible.preview) {
        input.checked = true;
        toastMessage("Keep one workspace panel open.");
        return;
      }
      settings.panels = nextPanels;
      applyPaneLayout();
      saveSettings();
    }));

    document.querySelector("#settingsButton").addEventListener("click", openSettings);
    insertForm.addEventListener("submit", (event) => {
      if (event.submitter?.id !== "confirmInsertButton") return;
      event.preventDefault();
      const pending = state.pendingInsert;
      if (!pending) return;
      const payload = insertPayload(pending.kind);
      if (payload === null) return;
      insertDialog.close("insert");
      requestInsert(pending.kind, payload);
    });
    insertDialog.addEventListener("close", () => {
      if (insertDialog.returnValue !== "insert") state.pendingInsert = null;
    });
    renameForm.addEventListener("submit", (event) => {
      if (event.submitter?.id !== "confirmRenameButton") return;
      event.preventDefault();
      const title = renameInput.value.trim();
      if (!title) return;
      renameDocument(title);
      renameDialog.close("rename");
    });
    document.querySelector("#findReplaceButton").addEventListener("click", openFindDialog);
    findForm.addEventListener("submit", (event) => {
      event.preventDefault();
      findNext();
    });
    document.querySelector("#findNextButton").addEventListener("click", findNext);
    document.querySelector("#replaceButton").addEventListener("click", replaceCurrentMatch);
    document.querySelector("#replaceAllButton").addEventListener("click", replaceAllMatches);
    document.querySelector("#addMacroButton").addEventListener("click", () => addMacroRow());
    settingsForm.addEventListener("submit", (event) => {
      if (event.submitter && event.submitter.id === "saveSettingsButton") {
        event.preventDefault();
        if (saveSettingsFromForm()) settingsDialog.close();
      }
    });

    splitResizer.addEventListener("pointerdown", startResize);
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
    window.addEventListener("resize", applyPaneLayout);
    window.addEventListener("popstate", () => {
      const params = new URLSearchParams(location.search);
      if (params.get("documents") === "1") showDocumentsPage({ pushHistory: false });
      else {
        hideDocumentsPage({ pushHistory: false });
        openDocument(params.get("doc") || "untitled", { pushHistory: false });
      }
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (settings.theme === "system") applyAppearance();
    });
    window.addEventListener("pagehide", shutdown);
  }

  function shutdown() {
    state.shuttingDown = true;
    persistDraft();
    cancelAnimationFrame(state.rawScrollFrame);
    clearTimeout(state.reconnectTimer);
    clearOperationTimeout();
    clearTimeout(state.compileTimer);
    clearTimeout(state.selectionTimer);
    clearTimeout(state.collaboratorSelectionTimer);
    state.compileController?.abort();
    if (state.socket && state.socket.readyState < WebSocket.CLOSING) state.socket.close();
  }

  function start() {
    renderPresetOptions();
    applyAppearance();
    applyPaneLayout();
    bindEvents();
    const draft = readDraft();
    if (draft) {
      state.source = draft.source;
      state.dirty = Boolean(draft.dirty);
      renderSource();
      localSaveStatus.textContent = "Local draft loaded";
      scheduleCompile(0);
    }
    setMode(state.mode);
    connect();
    if (new URLSearchParams(location.search).get("documents") === "1") showDocumentsPage({ pushHistory: false });
  }

  start();
})();
