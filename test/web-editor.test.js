const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createStarterDocument, getCollabDocument, normalizeDocumentId, sourceFromRecord } = require("../web/server");

test("normalizes document names into shareable ids", () => {
  assert.equal(normalizeDocumentId("My Team Notes.docx"), "my-team-notes");
  assert.equal(normalizeDocumentId("***"), "untitled");
});

test("an old .wmd snapshot is migrated into Yjs only when no Yjs state exists", () => {
  const id = `migration-${process.pid}`;
  const dataDirectory = path.join(__dirname, "..", "web", "data");
  const snapshot = path.join(dataDirectory, `${id}.wmd`);
  const state = path.join(dataDirectory, `${id}.yjs`);
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(snapshot, "@tab Home\n\nMigrated text\n", "utf8");
  try {
    const record = getCollabDocument(id);
    assert.equal(fs.existsSync(state), true);
    assert.match(sourceFromRecord(record), /Migrated text/);
    record.ydoc.destroy();
  } finally {
    if (fs.existsSync(snapshot)) fs.unlinkSync(snapshot);
    if (fs.existsSync(state)) fs.unlinkSync(state);
  }
});

test("new documents retain the config-driven WikiMD starter document", () => {
  const source = createStarterDocument();
  assert.match(source, /^@config\nNormal Text:/);
  assert.match(source, /@tab Test\n@title Home\n\n# Home\n$/);
});

test("the existing GUI mounts CodeMirror and Milkdown without iframe editing or execCommand", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "public", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "web", "public", "app.js"), "utf8");
  const collaboration = fs.readFileSync(path.join(__dirname, "..", "web", "client", "collab-editor.js"), "utf8");

  assert.match(html, /id="sourceEditor"/);
  assert.match(html, /id="richEditor"/);
  assert.doesNotMatch(html, /<iframe\b/);
  assert.doesNotMatch(html, /<textarea\b/);
  assert.doesNotMatch(app, /execCommand/);
  assert.match(collaboration, /WebsocketProvider/);
  assert.match(collaboration, /Decoration\.widget/);
  assert.doesNotMatch(collaboration, /range\.insertNode/);
});
