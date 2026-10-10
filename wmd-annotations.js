"use strict";
const { findBlockEnd, startDirective } = require("./wmd-structure.js");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const kindPrefix = { figure: "fig", table: "tbl", equation: "eq" };
const kindNames = { figure: "Figure", table: "Table", equation: "Equation" };
function slug(text) { return String(text).toLowerCase().replace(/[^\w-]/g, "-"); }
function fenceStart(line) {
  const match = String(line).match(/^ {0,3}(''|`{3,}|~{3,})/);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}
function fenceEnd(line, fence) {
  const lineText = String(line).trim();
  return lineText.length >= fence.length && [...lineText].every(x => x === fence.marker);
}

function createTargetRegistry() {
  return { items: new Map(), counts: { figure: 0, table: 0, equation: 0 } };
}
function registerTargets(source, namespace, registry, warnings = []) {
  let fence = null;
  for (const line of String(source).split(/\r?\n/)) {
    if (fence) {
      if (fenceEnd(line, fence)) fence = null;
      continue;
    }
    const opening = fenceStart(line);
    if (opening) { fence = opening; continue; }
    const directive = startDirective(line);
    if (!directive || !kindPrefix[directive.kind]) continue;
    const kind = directive.kind;
    const key = kindPrefix[kind] + ":" + directive.label.toLowerCase();
    if (registry.items.has(key)) {
      warnings.push("Duplicate " + kind + " label: " + directive.label);
      continue;
    }
    const number = ++registry.counts[kind];
    registry.items.set(key, {
      id: "wmd-" + kindPrefix[kind] + "-" + slug(namespace) + "-" + slug(directive.label),
      kind, number, label: directive.label, caption: directive.caption,
      display: kind === "equation" ? "Equation (" + number + ")" : kindNames[kind] + " " + number,
    });
  }
}

function extractNotes(markdown, warnings = []) {
  const lines = String(markdown).split(/\r?\n/), output = [];
  const definitions = new Map();
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      output.push(line);
      if (fenceEnd(line, fence)) fence = null;
      continue;
    }
    const opening = fenceStart(line);
    if (opening) { output.push(line); fence = opening; continue; }
    const match = line.match(/^\[\^((?:end:)?[A-Za-z0-9_-]+)\]:[ \t]*(.*)$/);
    if (!match) { output.push(line); continue; }
    const key = match[1];
    const value = [match[2]];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^(?: {2,}|\t)\S/.test(next)) {
        value.push(next.replace(/^(?: {2,}|\t)/, ""));
        i++;
      } else if (next.trim() === "" && i + 2 < lines.length && /^(?: {2,}|\t)\S/.test(lines[i + 2])) {
        value.push("");
        i++;
      } else break;
    }
    if (definitions.has(key)) warnings.push("Duplicate footnote definition: " + key);
    else definitions.set(key, value.join("\n"));
    // Preserve source line numbers for the surrounding content.
    output.push(...Array(value.length).fill(""));
  }
  return { markdown: output.join("\n"), definitions };
}

function createNoteState(definitions, namespace, warnings) {
  return { definitions, namespace: slug(namespace), warnings,
    entries: new Map(), order: [], counters: { footnote: 0, endnote: 0 } };
}
function noteFor(state, raw) {
  const endnote = raw.startsWith("end:");
  const kind = endnote ? "endnote" : "footnote";
  const key = raw;
  if (!state.definitions.has(key)) {
    state.warnings.push("Undefined " + kind + ": [^" + raw + "]");
    return null;
  }
  let item = state.entries.get(key);
  if (!item) {
    const number = ++state.counters[kind];
    item = { raw, kind, number, id: "wmd-" + (endnote ? "en" : "fn") + "-" + state.namespace + "-" + slug(raw), references: [] };
    state.entries.set(key, item);
    state.order.push(item);
  }
  item.references.push(item.id + "-ref-" + item.references.length);
  return item;
}
function renderNotes(md, env) {
  const notes = env.noteState;
  if (!notes || !notes.order.length) return "";
  // Render definitions as WMD, not raw text, including links and maths.
  const chunks = { footnote: [], endnote: [] };
  for (let index = 0; index < notes.order.length; index++) {
    const item = notes.order[index];
    const value = notes.definitions.get(item.raw) || "";
    const body = md.render(value, env);
    const backlinks = item.references.map((id, idx) =>
      '<a class="wmd-note-backref" href="#' + escapeHtml(id) + '" aria-label="Back to reference ' + (idx + 1) + '">↩</a>').join(" ");
    chunks[item.kind].push('<li id="' + escapeHtml(item.id) + '">' + body + backlinks + '</li>');
  }
  return (["footnote", "endnote"].map(kind => chunks[kind].length ?
    '<section class="wmd-' + kind + 's" aria-label="' + (kind === "footnote" ? "Footnotes" : "Endnotes") + '"><h2>' +
    (kind === "footnote" ? "Footnotes" : "Endnotes") + '</h2><ol>' + chunks[kind].join("\n") + '</ol></section>' : "").join("\n"));
}

function installAnnotations(md) {
  md.inline.ruler.before("link", "wmd_crossref", (state, silent) => {
    const match = state.src.slice(state.pos).match(/^\[\[(fig|tbl|eq):([A-Za-z][\w-]*)\]\]/);
    if (!match) return false;
    const target = state.env.targets && state.env.targets.items.get(match[1] + ":" + match[2].toLowerCase());
    if (!silent) {
      if (!target) {
        if (state.env.warnings) state.env.warnings.push("Unknown cross-reference: " + match[0]);
        state.push("text", "", 0).content = match[0];
      } else {
        const link = state.push("link_open", "a", 1);
        link.attrs = [["href", "#" + target.id], ["class", "wmd-cross-reference"]];
        state.push("text", "", 0).content = target.display;
        state.push("link_close", "a", -1);
      }
    }
    state.pos += match[0].length;
    return true;
  });
  md.inline.ruler.before("link", "wmd_note_ref", (state, silent) => {
    const match = state.src.slice(state.pos).match(/^\[\^((?:end:)?[A-Za-z0-9_-]+)\]/);
    if (!match) return false;
    if (!state.env.noteState) return false;
    if (!silent) {
      const item = noteFor(state.env.noteState, match[1]);
      if (item) {
        const token = state.push("wmd_note_ref", "sup", 0);
        token.meta = { number: item.number, id: item.id,
          refId: item.references[item.references.length - 1], kind: item.kind };
      } else state.push("text", "", 0).content = match[0];
    }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.wmd_note_ref = (tokens, idx) => {
    const item = tokens[idx].meta;
    return '<sup class="wmd-note-ref ' + item.kind + '" id="' + escapeHtml(item.refId) +
      '"><a href="#' + escapeHtml(item.id) + '" aria-label="' +
      (item.kind === "endnote" ? "Endnote " : "Footnote ") + item.number + '">' + item.number + '</a></sup>';
  };

  md.block.ruler.before("paragraph", "wmd_numbered", (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]).trim();
    const directive = startDirective(line);
    if (!directive || !kindPrefix[directive.kind]) return false;
    const ending = findBlockEnd(state, startLine, endLine, directive.kind);
    if (ending < 0) return false;
    if (silent) return true;
    const body = [];
    for (let i = startLine + 1; i < ending; i++) {
      const begin = state.bMarks[i] + state.tShift[i];
      body.push(state.src.slice(begin, state.eMarks[i]));
    }
    const key = kindPrefix[directive.kind] + ":" + directive.label.toLowerCase();
    const target = state.env.targets && state.env.targets.items.get(key);
    const opening = state.push("wmd_numbered_open", "figure", 1);
    opening.block = true;
    opening.map = [startLine, ending + 1];
    opening.meta = target || { kind: directive.kind, caption: directive.caption,
      id: "wmd-" + key.replace(":", "-"), display: kindNames[directive.kind] };
    const nestedStart = state.tokens.length;
    state.md.block.parse(body.join("\n"), state.md, state.env, state.tokens);
    for (const token of state.tokens.slice(nestedStart)) {
      if (token.map) token.map = [token.map[0] + startLine + 1, token.map[1] + startLine + 1];
    }
    state.push("wmd_numbered_close", "figure", -1).block = true;
    state.line = ending + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });

  md.renderer.rules.wmd_numbered_open = (tokens, idx) => {
    const t = tokens[idx].meta;
    const heading = t.display + (t.caption ? ". " + t.caption : "");
    return '<figure id="' + escapeHtml(t.id) + '" class="wmd-numbered wmd-' +
      t.kind + '"><figcaption>' + escapeHtml(heading) + '</figcaption><div class="wmd-numbered-body">\n';
  };
  md.renderer.rules.wmd_numbered_close = () => "</div></figure>\n";
}
module.exports = { createTargetRegistry, registerTargets, extractNotes, createNoteState, renderNotes, installAnnotations };
