"use strict";

const { Fragment, Schema } = require("prosemirror-model");
const { parseWmd, textWithoutLineEnding } = require("./wmd-ast");

const nodeSpecs = {
  doc: { content: "wmd_tab+" },
  text: { group: "inline" },
  hard_break: { inline: true, group: "inline", selectable: false, toDOM: () => ["br"], parseDOM: [{ tag: "br" }] },
  paragraph: {
    group: "block", content: "inline*", attrs: { id: { default: null }, leading: { default: "" }, raw: { default: "" }, sourceText: { default: "" } },
    toDOM: (node) => ["p", { "data-wmd-id": node.attrs.id || "" }, 0], parseDOM: [{ tag: "p" }],
  },
  heading: {
    group: "block", content: "inline*", defining: true,
    attrs: { id: { default: null }, leading: { default: "" }, raw: { default: "" }, sourceText: { default: "" }, level: { default: 1 } },
    toDOM: (node) => [`h${Math.min(6, Math.max(1, Number(node.attrs.level) || 1))}`, { "data-wmd-id": node.attrs.id || "" }, 0],
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, getAttrs: () => ({ level }) })),
  },
  wmd_title: {
    group: "block", content: "inline*", defining: true,
    attrs: { id: { default: null }, leading: { default: "" }, raw: { default: "" }, sourceText: { default: "" } },
    toDOM: (node) => ["h1", { class: "wmd-title", "data-wmd-id": node.attrs.id || "" }, 0], parseDOM: [{ tag: "h1.wmd-title" }],
  },
  wmd_tab: {
    group: "block", content: "block+", isolating: true,
    attrs: { id: { default: null }, name: { default: "Untitled" }, hidden: { default: false }, header: { default: "" }, trailing: { default: "" } },
    toDOM: (node) => ["section", { class: "wmd-tab", "data-wmd-id": node.attrs.id || "", "data-wmd-tab": node.attrs.name, "data-hidden": String(Boolean(node.attrs.hidden)) }, 0],
    parseDOM: [{ tag: "section.wmd-tab" }],
  },
  wmd_raw: rawNodeSpec("rich-raw-block"),
  wmd_callout: rawNodeSpec("rich-callout"),
  wmd_collapse: rawNodeSpec("rich-collapse"),
  wmd_table: rawNodeSpec("rich-table"),
  wmd_checklist: rawNodeSpec("rich-checklist"),
  wmd_list: rawNodeSpec("rich-list"),
};

function rawNodeSpec(className) {
  return {
    group: "block", atom: true, selectable: true,
    attrs: { id: { default: null }, leading: { default: "" }, raw: { default: "" }, kind: { default: "raw" }, title: { default: "" }, calloutType: { default: "note" } },
    toDOM: (node) => ["div", { class: className, "data-wmd-id": node.attrs.id || "", "data-wmd-kind": node.attrs.kind || "raw" },
      node.attrs.title ? ["strong", { class: "rich-raw-title" }, node.attrs.title] : ["span", { class: "rich-raw-label" }, node.attrs.kind || "raw"],
      ["pre", node.attrs.raw || ""]],
    parseDOM: [{ tag: `div.${className}` }],
  };
}

const markSpecs = {
  strong: { toDOM: () => ["strong", 0], parseDOM: [{ tag: "strong" }, { tag: "b" }] },
  em: { toDOM: () => ["em", 0], parseDOM: [{ tag: "em" }, { tag: "i" }] },
  code: { toDOM: () => ["code", 0], parseDOM: [{ tag: "code" }] },
  underline: { toDOM: () => ["u", 0], parseDOM: [{ tag: "u" }] },
  strike: { toDOM: () => ["s", 0], parseDOM: [{ tag: "s" }, { tag: "del" }] },
  highlight: { attrs: { level: { default: 1 } }, toDOM: () => ["mark", 0], parseDOM: [{ tag: "mark" }] },
  link: { attrs: { href: {}, wiki: { default: false } }, inclusive: false, toDOM: (mark) => ["a", { href: mark.attrs.href }, 0], parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: dom.getAttribute("href") || "", wiki: String(dom.getAttribute("href") || "").startsWith("wiki:") }) }] },
};

function getWmdSchema() {
  return new Schema({ nodes: nodeSpecs, marks: markSpecs });
}

function textNodes(schema, text, marks = []) {
  const result = [];
  const emit = (value, activeMarks) => {
    if (value) result.push(schema.text(value, activeMarks));
  };
  const parse = (value, activeMarks) => {
    let index = 0;
    while (index < value.length) {
      const rest = value.slice(index);
      const wiki = rest.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (wiki) {
        parse(wiki[2] || wiki[1], activeMarks.concat(schema.marks.link.create({ href: `wiki:${wiki[1]}`, wiki: true })));
        index += wiki[0].length;
        continue;
      }
      const link = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (link) {
        parse(link[1], activeMarks.concat(schema.marks.link.create({ href: link[2], wiki: false })));
        index += link[0].length;
        continue;
      }
      const pair = [
        ["===", "highlight", { level: 3 }], ["==", "highlight", { level: 2 }], ["++", "underline", {}], ["~~", "strike", {}], ["**", "strong", {}], ["*", "strong", {}], ["_", "em", {}], ["`", "code", {}], ["=", "highlight", { level: 1 }],
      ].find(([marker]) => rest.startsWith(marker) && rest.indexOf(marker, marker.length) > marker.length);
      if (pair) {
        const [marker, markName, attrs] = pair;
        const end = rest.indexOf(marker, marker.length);
        parse(rest.slice(marker.length, end), activeMarks.concat(schema.marks[markName].create(attrs)));
        index += end + marker.length;
        continue;
      }
      if (rest[0] === "\\" && rest.length > 1) {
        emit(rest[1], activeMarks);
        index += 2;
        continue;
      }
      if (rest[0] === "\n") {
        result.push(schema.nodes.hard_break.create());
        index += 1;
        continue;
      }
      const next = rest.search(/\[|\*|_|\+|~|=|`|\\|\n/);
      if (next > 0) {
        emit(rest.slice(0, next), activeMarks);
        index += next;
      } else {
        emit(rest[0], activeMarks);
        index += 1;
      }
    }
  };
  parse(String(text || ""), marks);
  return result;
}

function plainTextFromInline(node) {
  return node.textContent;
}

function wrapMarks(text, marks) {
  return [...marks].sort((left, right) => left.type.name.localeCompare(right.type.name)).reduce((value, mark) => {
    if (mark.type.name === "strong") return `*${value}*`;
    if (mark.type.name === "em") return `_${value}_`;
    if (mark.type.name === "code") return `\`${value}\``;
    if (mark.type.name === "underline") return `++${value}++`;
    if (mark.type.name === "strike") return `~~${value}~~`;
    if (mark.type.name === "highlight") return `${"=".repeat(mark.attrs.level || 1)}${value}${"=".repeat(mark.attrs.level || 1)}`;
    if (mark.type.name === "link") return mark.attrs.wiki ? `[[${String(mark.attrs.href || "").replace(/^wiki:/, "")}|${value}]]` : `[${value}](${mark.attrs.href})`;
    return value;
  }, text);
}

function serializeInline(node) {
  let output = "";
  node.forEach((child) => {
    if (child.type.name === "hard_break") output += "\n";
    else if (child.isText) output += wrapMarks(child.text || "", child.marks || []);
    else output += child.textContent;
  });
  return output;
}

function rawNodeTypeFor(block) {
  return ({ callout: "wmd_callout", collapse: "wmd_collapse", table: "wmd_table", checklist: "wmd_checklist", list: "wmd_list" }[block.type] || "wmd_raw");
}

function blockToNode(block, schema) {
  const common = { id: block.id, leading: block.leading || "", raw: block.raw || "" };
  if (block.type === "paragraph") return schema.nodes.paragraph.create({ ...common, sourceText: block.attrs.text || "" }, textNodes(schema, block.attrs.text || ""));
  if (block.type === "heading") return schema.nodes.heading.create({ ...common, sourceText: block.attrs.text || "", level: block.attrs.level || 1 }, textNodes(schema, block.attrs.text || ""));
  if (block.type === "title") return schema.nodes.wmd_title.create({ ...common, sourceText: block.attrs.text || "" }, textNodes(schema, block.attrs.text || ""));
  const type = schema.nodes[rawNodeTypeFor(block)];
  return type.create({ ...common, kind: block.attrs.kind || block.type, title: block.attrs.title || "", calloutType: block.attrs.calloutType || "note" });
}

function wmdAstToProseMirror(ast, schema = getWmdSchema()) {
  const documentAst = ast && ast.type === "document" ? ast : parseWmd("");
  const tabs = (documentAst.tabs || []).map((tab) => {
    const blocks = (tab.blocks || []).map((block) => blockToNode(block, schema));
    const fallback = schema.nodes.paragraph.create({ id: `${tab.id}-empty`, leading: "\n", raw: "", sourceText: "" });
    return schema.nodes.wmd_tab.create({ id: tab.id, name: tab.attrs.name, hidden: Boolean(tab.attrs.hidden), header: tab.header || "", trailing: tab.trailing || "" }, blocks.length ? blocks : [fallback]);
  });
  const fallbackTab = schema.nodes.wmd_tab.create({ id: "wmd-tab-main", name: "Main", hidden: false, header: "@tab Main\n", trailing: "" }, [schema.nodes.paragraph.create({ id: "wmd-paragraph-empty", leading: "\n", raw: "", sourceText: "" })]);
  return schema.nodes.doc.create(null, tabs.length ? tabs : [fallbackTab]);
}

function nodeToBlock(node) {
  const attrs = node.attrs || {};
  const base = { id: attrs.id, leading: attrs.leading || "", raw: attrs.raw || "", lineEnding: /\r\n$/.test(attrs.raw || "") ? "\r\n" : "\n", attrs: {}, diagnostics: [] };
  if (node.type.name === "paragraph" || node.type.name === "heading" || node.type.name === "wmd_title") {
    const currentText = serializeInline(node);
    const unmodified = currentText === String(attrs.sourceText || "");
    const type = node.type.name === "wmd_title" ? "title" : node.type.name;
    base.type = type;
    base.attrs.text = currentText;
    if (node.type.name === "heading") base.attrs.level = attrs.level || 1;
    if (!unmodified) {
      const prefix = type === "title" ? "@title " : type === "heading" ? `${"#".repeat(base.attrs.level)} ` : "";
      base.raw = `${prefix}${currentText}${base.lineEnding}`;
    }
    return base;
  }
  base.type = ({ wmd_callout: "callout", wmd_collapse: "collapse", wmd_table: "table", wmd_checklist: "checklist", wmd_list: "list" }[node.type.name] || "raw");
  base.attrs = { kind: attrs.kind || base.type, title: attrs.title || "", calloutType: attrs.calloutType || "note" };
  return base;
}

function proseMirrorToWmdAst(doc, metadata = {}) {
  const tabs = [];
  doc.forEach((tab) => {
    if (tab.type.name !== "wmd_tab") return;
    const blocks = [];
    tab.forEach((node) => blocks.push(nodeToBlock(node)));
    tabs.push({
      type: "tab", id: tab.attrs.id, header: tab.attrs.header || `@tab ${tab.attrs.name || "Untitled"}${tab.attrs.hidden ? " {hidden}" : ""}\n`,
      attrs: { name: tab.attrs.name || "Untitled", hidden: Boolean(tab.attrs.hidden) }, blocks, trailing: tab.attrs.trailing || "",
    });
  });
  return { type: "document", version: 1, preamble: metadata.preamble || "", config: metadata.config || { raw: "", values: {}, styles: {} }, tabs, diagnostics: [] };
}

function mapDocumentNodes(doc) {
  const tabs = new Map();
  const blocks = new Map();
  doc.descendants((node, pos) => {
    if (node.type.name === "wmd_tab" && node.attrs.id) tabs.set(node.attrs.id, { node, pos });
    else if (node.attrs && node.attrs.id) blocks.set(node.attrs.id, { node, pos });
  });
  return { tabs, blocks };
}

function applyAstToProseMirror(view, ast, schema = getWmdSchema()) {
  const nextDoc = wmdAstToProseMirror(ast, schema);
  const current = mapDocumentNodes(view.state.doc);
  const next = mapDocumentNodes(nextDoc);
  if (current.tabs.size !== next.tabs.size || [...next.tabs.keys()].some((id) => !current.tabs.has(id))) {
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nextDoc.content));
    return { kind: "document" };
  }
  let transaction = view.state.tr;
  let changed = false;
  for (const [id, nextTab] of next.tabs) {
    const oldTab = current.tabs.get(id);
    const oldBlockIds = [];
    oldTab.node.forEach((node) => oldBlockIds.push(node.attrs.id));
    const nextBlockIds = [];
    nextTab.node.forEach((node) => nextBlockIds.push(node.attrs.id));
    if (oldBlockIds.length !== nextBlockIds.length || oldBlockIds.some((blockId, index) => blockId !== nextBlockIds[index])) {
      const mapped = transaction.mapping.map(oldTab.pos, 1);
      transaction = transaction.replaceWith(mapped, mapped + oldTab.node.nodeSize, nextTab.node);
      changed = true;
    }
  }
  if (!changed) {
    for (const [id, nextBlock] of next.blocks) {
      const oldBlock = current.blocks.get(id);
      if (!oldBlock || oldBlock.node.eq(nextBlock.node)) continue;
      const mapped = transaction.mapping.map(oldBlock.pos, 1);
      transaction = transaction.replaceWith(mapped, mapped + oldBlock.node.nodeSize, nextBlock.node);
      changed = true;
    }
  }
  if (changed) view.dispatch(transaction);
  return { kind: changed ? "targeted" : "none" };
}

module.exports = {
  applyAstToProseMirror,
  getWmdSchema,
  markSpecs,
  nodeSpecs,
  proseMirrorToWmdAst,
  serializeInline,
  wmdAstToProseMirror,
};
