const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const Y = require("yjs");
const { EditorState } = require("prosemirror-state");
const { EditorView } = require("prosemirror-view");
const { prosemirrorToYDoc, ySyncPlugin } = require("y-prosemirror");
const { parseWmd } = require("../wmd-ast");
const { getWmdSchema, wmdAstToProseMirror } = require("../wmd-prosemirror");

function installDom () {
  const dom = new JSDOM("<!doctype html><html><body><div id='one'></div><div id='two'></div></body></html>", { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.getSelection = dom.window.getSelection.bind(dom.window);
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = clearTimeout;
  return dom;
}

function textEndPosition(document, value) {
  let position = null;
  document.descendants((node, offset) => {
    if (node.isText && node.text === value) position = offset + node.nodeSize;
  });
  assert.notEqual(position, null, `Could not find ${value}`);
  return position;
}

function boundViews (source) {
  const schema = getWmdSchema();
  const initial = wmdAstToProseMirror(parseWmd(source), schema);
  const template = prosemirrorToYDoc(initial);
  const left = new Y.Doc();
  const right = new Y.Doc();
  const update = Y.encodeStateAsUpdate(template);
  Y.applyUpdate(left, update, "bootstrap");
  Y.applyUpdate(right, update, "bootstrap");
  template.destroy();
  const leftView = new EditorView(document.querySelector("#one"), { state: EditorState.create({ schema, doc: initial, plugins: [ySyncPlugin(left.getXmlFragment("prosemirror"))] }) });
  const rightView = new EditorView(document.querySelector("#two"), { state: EditorState.create({ schema, doc: initial, plugins: [ySyncPlugin(right.getXmlFragment("prosemirror"))] }) });
  return { left, right, leftView, rightView };
}

function settle () { return new Promise((resolve) => setTimeout(resolve, 35)); }

test("two document editors converge when they edit the same block at the same position", async () => {
  const dom = installDom();
  const { left, right, leftView, rightView } = boundViews("@tab Home\n\nShared\n");
  const leftUpdates = [];
  const rightUpdates = [];
  left.on("update", (update, origin) => { if (origin !== "bootstrap") leftUpdates.push(update); });
  right.on("update", (update, origin) => { if (origin !== "bootstrap") rightUpdates.push(update); });

  leftView.dispatch(leftView.state.tr.insertText(" A", textEndPosition(leftView.state.doc, "Shared")));
  rightView.dispatch(rightView.state.tr.insertText(" B", textEndPosition(rightView.state.doc, "Shared")));
  leftUpdates.forEach((update) => Y.applyUpdate(right, update, "remote-left"));
  rightUpdates.forEach((update) => Y.applyUpdate(left, update, "remote-right"));
  await settle();

  assert.equal(leftView.state.doc.textContent, rightView.state.doc.textContent);
  assert.match(leftView.state.doc.textContent, /Shared/);
  assert.match(leftView.state.doc.textContent, /A/);
  assert.match(leftView.state.doc.textContent, /B/);
  leftView.destroy(); rightView.destroy(); dom.window.close();
});

test("offline WMD-mode and document-mode edits merge after reconnect without a WMD Y.Text", async () => {
  const dom = installDom();
  const { left, right, leftView, rightView } = boundViews("@tab Home\n\nFirst\n\nSecond\n");
  const leftUpdates = [];
  const rightUpdates = [];
  left.on("update", (update, origin) => { if (origin !== "bootstrap") leftUpdates.push(update); });
  right.on("update", (update, origin) => { if (origin !== "bootstrap") rightUpdates.push(update); });

  // These represent the targeted ProseMirror transactions emitted by the
  // CodeMirror projection and Milkdown respectively while disconnected.
  leftView.dispatch(leftView.state.tr.insertText(" source", textEndPosition(leftView.state.doc, "First")));
  rightView.dispatch(rightView.state.tr.insertText(" rich", textEndPosition(rightView.state.doc, "Second")));
  leftUpdates.forEach((update) => Y.applyUpdate(right, update, "reconnect-left"));
  rightUpdates.forEach((update) => Y.applyUpdate(left, update, "reconnect-right"));
  await settle();

  assert.equal(leftView.state.doc.textContent, rightView.state.doc.textContent);
  assert.match(leftView.state.doc.textContent, /source/);
  assert.match(leftView.state.doc.textContent, /rich/);
  assert.equal([...left.share.keys()].some((key) => key === "wmd"), false, "WMD must not become an authoritative Y.Text");
  leftView.destroy(); rightView.destroy(); dom.window.close();
});
