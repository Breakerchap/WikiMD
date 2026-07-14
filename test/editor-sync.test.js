const assert = require("node:assert/strict");
const test = require("node:test");
const { EditorState } = require("prosemirror-state");
const { parseWmd, reconcileAst, stringifyWmd } = require("../wmd-ast");
const { applyAstToProseMirror, getWmdSchema, proseMirrorToWmdAst, wmdAstToProseMirror } = require("../wmd-prosemirror");

const COMPLETE_WMD = `@config
Normal Text: {wmd-formatting: ; size: 16px};
Boss Box: {wmd-formatting: !boss; callout-title: Boss};
@endconfig

@var name = Ada
@tab Home
@title Welcome

# Heading

Paragraph with *bold*, _italic_, ++underline++, ==highlight==, [[Other|a wiki link]], and [a link](https://example.com).

- [ ] Pending
- [x] Done

| Name | Score |
| --- | --- |
| Ada | 10 |

!boss Important
This callout is preserved.
!end

@collapse More
Collapsed content
@endcollapse

@tab Hidden [hidden]
@style Normal Text
Temporary custom styled content
@end
`;

test("WikiMD parses and stringifies all custom constructs without changing their source", () => {
  const ast = parseWmd(COMPLETE_WMD);
  const types = ast.tabs.flatMap((tab) => tab.blocks.map((block) => block.type));

  assert.deepEqual(types, ["title", "heading", "paragraph", "checklist", "table", "callout", "collapse", "raw"]);
  assert.equal(ast.tabs[1].attrs.hidden, true);
  assert.equal(stringifyWmd(ast), COMPLETE_WMD);
});

test("WikiMD AST to ProseMirror to AST round-trips stable ids and custom blocks", () => {
  const ast = parseWmd(COMPLETE_WMD);
  const schema = getWmdSchema();
  const document = wmdAstToProseMirror(ast, schema);
  const restored = proseMirrorToWmdAst(document, { preamble: ast.preamble, config: ast.config });

  assert.equal(stringifyWmd(restored), COMPLETE_WMD);
  assert.equal(restored.tabs[0].id, ast.tabs[0].id);
  assert.equal(restored.tabs[0].blocks[5].type, "callout");
  assert.equal(restored.tabs[0].blocks[6].type, "collapse");
});

test("unfinished directives become recovery nodes rather than rejecting the source", () => {
  const source = "@tab Home\n\n!warning unfinished\nText while typing\n";
  const ast = parseWmd(source);
  const block = ast.tabs[0].blocks[0];

  assert.equal(block.type, "raw");
  assert.match(block.diagnostics[0], /Unclosed callout/);
  assert.equal(stringifyWmd(ast), source);
});

test("small source edits become a targeted ProseMirror transaction, not a document replacement", () => {
  const schema = getWmdSchema();
  const before = parseWmd("@tab Home\n\nFirst\n\nEditable\n\nTail\n");
  const document = wmdAstToProseMirror(before, schema);
  const view = {
    state: EditorState.create({ schema, doc: document }),
    dispatch (transaction) { this.state = this.state.apply(transaction); },
  };
  const next = reconcileAst(before, parseWmd("@tab Home\n\nFirst\n\nEditable!\n\nTail\n"));
  const result = applyAstToProseMirror(view, next, schema);

  assert.deepEqual(result, { kind: "targeted" });
  assert.equal(view.state.doc.textContent.includes("Editable!"), true);
  assert.equal(view.state.doc.textContent.includes("Tail"), true);
});
