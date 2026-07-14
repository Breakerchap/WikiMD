const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { compile } = require("../wmd-compiler");
const {
  applyOperation,
  operationFromTextDiff,
  operationForSerializedRange,
  transformOperations,
  transformSnapshotStack,
} = require("../web/public/editor-sync");

function rangeOf(source, value) {
  const start = source.indexOf(value);
  assert.notEqual(start, -1);
  return { start, end: start + value.length };
}

test("document typing creates a range-local WMD patch and preserves wiki-link syntax", () => {
  const source = "@tab Home\n\nSee [[Other|the link]] here.\n\nUntouched tail.";
  const range = rangeOf(source, "See [[Other|the link]] here.");
  const operation = operationForSerializedRange(
    source,
    range,
    "See [the link](#other) here.",
    "See [the links](#other) here.",
  );

  assert.equal(applyOperation(source, operation), "@tab Home\n\nSee [[Other|the links]] here.\n\nUntouched tail.");
  assert.equal(operation.ops[0], range.start + "See [[Other|the link".length);
  assert.ok(operation.ops.at(-1) > 0, "the operation must retain the untouched document suffix");
});

test("document formatting inserts WMD delimiters only around the selected text", () => {
  const source = "@tab Home\n\nKeep alpha beta and tail.";
  const range = rangeOf(source, "Keep alpha beta and tail.");
  const operation = operationForSerializedRange(source, range, "Keep alpha beta and tail.", "Keep alpha *beta* and tail.");

  assert.equal(applyOperation(source, operation), "@tab Home\n\nKeep alpha *beta* and tail.");
  assert.ok(operation.ops[0] > 0);
  assert.ok(operation.ops.at(-1) > 0);
});

test("block insertion and deletion stay inside the mapped block range", () => {
  const source = "@tab Home\n\nFirst\n\nSecond\n\nThird";
  const first = rangeOf(source, "First");
  const inserted = operationForSerializedRange(source, first, "First", "First\n\nInserted");
  assert.equal(applyOperation(source, inserted), "@tab Home\n\nFirst\n\nInserted\n\nSecond\n\nThird");

  const pair = rangeOf(source, "First\n\nSecond");
  const deleted = operationForSerializedRange(source, pair, "First\n\nSecond", "Second");
  assert.equal(applyOperation(source, deleted), "@tab Home\n\nSecond\n\nThird");
  assert.ok(deleted.ops.at(-1) > 0);
});

test("simultaneous document and WMD edits converge through OT", () => {
  const original = "@tab Home\n\nParagraph here.\n\nTail";
  const paragraph = rangeOf(original, "Paragraph here.");
  const documentEdit = operationForSerializedRange(original, paragraph, "Paragraph here.", "Paragraph here!");
  const remoteEdit = operationFromTextDiff(original, original.replace("Tail", "Remote Tail"));
  const [documentPrime, remotePrime] = transformOperations(documentEdit, remoteEdit);

  assert.equal(
    applyOperation(applyOperation(original, remoteEdit), documentPrime),
    applyOperation(applyOperation(original, documentEdit), remotePrime),
  );
  assert.equal(applyOperation(applyOperation(original, remoteEdit), documentPrime), "@tab Home\n\nParagraph here!\n\nRemote Tail");
});

test("temporarily invalid WMD outside an edited source range is preserved byte-for-byte", () => {
  const invalidPrefix = "@config\nbroken: {{{\n\n";
  const source = `${invalidPrefix}@tab Home\n\nEditable text\n\n!unclosed`;
  const range = rangeOf(source, "Editable text");
  const operation = operationForSerializedRange(source, range, "Editable text", "Editable text!");
  const result = applyOperation(source, operation);

  assert.ok(result.startsWith(invalidPrefix));
  assert.ok(result.endsWith("\n\n!unclosed"));
  assert.equal(result, `${invalidPrefix}@tab Home\n\nEditable text!\n\n!unclosed`);
});

test("undo and redo snapshots retain concurrent remote edits", () => {
  const edited = "alpha beta!";
  const remote = operationFromTextDiff(edited, "Remote alpha beta!");
  const undo = transformSnapshotStack(["alpha beta"], edited, remote);
  assert.deepEqual(undo, ["Remote alpha beta"]);

  const original = "alpha beta";
  const remoteBeforeRedo = operationFromTextDiff(original, "Remote alpha beta");
  const redo = transformSnapshotStack([edited], original, remoteBeforeRedo);
  assert.deepEqual(redo, ["Remote alpha beta!"]);
});

test("ordinary canvas edits never serialize or replace the full document", () => {
  const source = `@config\ninvalid while typing: [\n@endconfig\n\n@tab Home\n\n${"before ".repeat(80)}target${" after".repeat(80)}\n\nFinal block`;
  const range = rangeOf(source, `${"before ".repeat(80)}target${" after".repeat(80)}`);
  const before = source.slice(range.start, range.end);
  const operation = operationForSerializedRange(source, range, before, before.replace("target", "target!"));

  assert.ok(operation.ops[0] > source.length / 4);
  assert.ok(operation.ops.at(-1) > 0);
  assert.equal(operation.ops.filter((part) => typeof part === "number" && part < 0).reduce((sum, part) => sum - part, 0), 0);
});

test("compiler emits source mapping markers for editable blocks", () => {
  const source = "@tab Home\n@title Title\n\n# Heading\n\nParagraph\n\n- one\n- two";
  const result = compile(source);
  const heading = rangeOf(source, "# Heading");
  const paragraph = rangeOf(source, "Paragraph");
  const list = rangeOf(source, "- one\n- two");

  assert.ok(result.html.includes(`<!--wmd-source:${heading.start}:${heading.end}:`));
  assert.ok(result.html.includes(`<!--wmd-source:${paragraph.start}:${paragraph.end}:`));
  assert.ok(result.html.includes(`<!--wmd-source:${list.start}:${list.end}:`));
});

test("both editor previews apply incremental source patches without replacing the iframe", () => {
  const app = fs.readFileSync(path.join(__dirname, "../web/public/app.js"), "utf8");

  assert.match(app, /postCanvas\(\{[\s\S]*type: "source-update",[\s\S]*partial: true/);
  assert.match(app, /postPreview\(\{[\s\S]*type: "source-update",[\s\S]*partial: true/);
  assert.match(app, /if \(data\.type === 'source-update'\)/);
  assert.match(app, /function patchSection\(section, nextSection, bounds, mappingsCurrent\)/);
});
