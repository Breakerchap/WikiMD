const assert = require("node:assert/strict");
const test = require("node:test");
const { applyOperation, normalizeDocumentId, transformOperations } = require("../web/server");

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
