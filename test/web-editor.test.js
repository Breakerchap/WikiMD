const assert = require("node:assert/strict");
const test = require("node:test");
const { applyOperation, createStarterDocument, normalizeDocumentId, transformOperations } = require("../web/server");

test("normalizes document names into shareable ids", () => {
  assert.equal(normalizeDocumentId("My Team Notes.docx"), "my-team-notes");
  assert.equal(normalizeDocumentId("***"), "untitled");
});

test("applies a complete text operation", () => {
  assert.equal(applyOperation("Hello world", { ops: [6, -5, "WMD"] }), "Hello WMD");
});

test("transforms simultaneous inserts without losing either edit", () => {
  const original = "Hello";
  const left = { ops: [5, " there"] };
  const right = { ops: [5, "!"] };
  const [leftPrime, rightPrime] = transformOperations(left, right);

  assert.equal(
    applyOperation(applyOperation(original, right), leftPrime),
    applyOperation(applyOperation(original, left), rightPrime),
  );
});

test("transforms a deletion against a simultaneous insertion", () => {
  const original = "abcd";
  const deletion = { ops: [1, -2, 1] };
  const insertion = { ops: [2, "X", 2] };
  const [deletionPrime, insertionPrime] = transformOperations(deletion, insertion);

  assert.equal(
    applyOperation(applyOperation(original, insertion), deletionPrime),
    applyOperation(applyOperation(original, deletion), insertionPrime),
  );
});


test("new documents start with config-driven heading styles", () => {
  const source = createStarterDocument("new-notes");
  assert.ok(source.startsWith("@config\nNormal Text: {wmd-formatting: ; keybind: ctrl+shift+0; size: 16px; font: arial; default: true};\n"));
  assert.ok(source.includes("Title: {wmd-formatting: @title; keybind: ctrl+shift+`; size: 45px; font: arial};"));
  assert.ok(source.includes("Heading 1: {wmd-formatting: #; keybind: ctrl+shift+1; size: 38px; font: arial; bold: true};"));
  assert.ok(source.includes("Heading 4: {wmd-formatting: ####; keybind: ctrl+shift+4; size: 18px; font: arial; bold: false; italic: true};"));
  assert.match(source, /@tab Test\n@title Home\n\n# Home\n$/);
});
