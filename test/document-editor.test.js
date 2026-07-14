const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { compile } = require("../wmd-compiler");
const core = require("../web/public/editor-core");
const { applyOperation, transformAgainstHistory, transformOperations } = require("../web/server");

function applyConcurrent(source, operations) {
  const history = [];
  let result = source;
  operations.forEach((operation, index) => {
    const transformed = transformAgainstHistory(operation, 0, history);
    result = applyOperation(result, transformed);
    history.push({ revision: index + 1, operation: transformed });
  });
  return { source: result, history };
}

test("document and WMD mode controls are both wired", () => {
  const html = fs.readFileSync(path.join(__dirname, "../web/public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../web/public/app.js"), "utf8");
  assert.match(html, /id="documentModeButton"/);
  assert.match(html, /id="wmdModeButton"/);
  assert.match(html, /src="\/editor-core\.js"/);
  assert.match(app, /documentModeButton\.addEventListener\("click"/);
  assert.match(app, /handleCanvasMessage\(event\)/);
});

test("multi-hunk document formatting inserts markers without replacing text", () => {
  const operation = core.operationFromDiff("alpha beta", "alpha *beta*");
  assert.deepEqual(operation.ops, [6, "*", 4, "*"]);
  assert.equal(core.applyOperation("alpha beta", operation), "alpha *beta*");
});

test("document bold and concurrent raw typing preserve the exact intended text", () => {
  const rebased = core.rebaseCanvasEdit({
    serializedBase: "alpha beta",
    nextSerialized: "alpha *beta*",
    sourceBase: "alpha beta",
    currentSource: "alpha beXta",
  });
  assert.equal(rebased.source, "alpha *beXta*");
});

test("a visual paragraph edit preserves unrelated WMD directives byte-for-byte", () => {
  const source = `@config\nfont: Arial;\n@endconfig\n@var hero = Ada\n@tab Home\n@include shared.wmd\n{{hero}} writes notes.`;
  const serialized = `@tab Home\nAda writes notes.`;
  const edited = `@tab Home\nAda writes careful notes.`;
  const rebased = core.rebaseCanvasEdit({ serializedBase: serialized, nextSerialized: edited, sourceBase: source, currentSource: source });
  assert.match(rebased.source, /^@config\nfont: Arial;\n@endconfig\n@var hero = Ada\n/);
  assert.ok(rebased.source.includes("@include shared.wmd"));
  assert.ok(rebased.source.includes("{{hero}}"));
  assert.ok(rebased.source.includes("careful"));
});

test("simultaneous bold and italic keep one copy of the selected word", () => {
  const base = "alpha beta";
  const bold = core.operationFromDiff(base, "alpha *beta*");
  const italic = core.operationFromDiff(base, "alpha _beta_");
  const [boldPrime, italicPrime] = transformOperations(bold, italic);
  const left = applyOperation(applyOperation(base, italic), boldPrime);
  const right = applyOperation(applyOperation(base, bold), italicPrime);
  assert.equal(left, right);
  assert.equal(left.replace(/[*_]/g, ""), base);
  assert.equal((left.match(/beta/g) || []).length, 1);
});

test("document formatting markers compile to the intended HTML", () => {
  const result = compile("@tab Home\n*bold* _italic_ ++underline++ ~~strike~~ =highlight= `code`");
  assert.match(result.html, /<strong>bold<\/strong>/);
  assert.match(result.html, /<em>italic<\/em>/);
  assert.match(result.html, /<u>underline<\/u>/);
  assert.match(result.html, /<s>strike<\/s>/);
  assert.match(result.html, /<code>code<\/code>/);
});

test("versioned canvas rebase retains remote source changes", () => {
  const base = "@tab Home\nOne paragraph.";
  const remote = "@tab Home\nOne shared paragraph.";
  const rebased = core.rebaseCanvasEdit({
    serializedBase: base,
    nextSerialized: "@tab Home\nOne paragraph!",
    sourceBase: base,
    currentSource: remote,
  });
  assert.equal(rebased.source, "@tab Home\nOne shared paragraph!");
});

test("eight mixed raw and document operations converge through the shared OT history", () => {
  const base = "alpha beta gamma delta";
  const operations = [
    core.operationFromDiff(base, "*alpha* beta gamma delta"),
    core.operationFromDiff(base, "alpha _beta_ gamma delta"),
    core.operationFromDiff(base, "alpha beta ++gamma++ delta"),
    core.operationFromDiff(base, "alpha beta gamma `delta`"),
    core.operationFromDiff(base, "Xalpha beta gamma delta"),
    core.operationFromDiff(base, "alpha Ybeta gamma delta"),
    core.operationFromDiff(base, "alpha beta Zgamma delta"),
    core.operationFromDiff(base, "alpha beta gamma Qdelta"),
  ];
  const { source, history } = applyConcurrent(base, operations);
  for (let actor = 0; actor < operations.length; actor += 1) {
    let visible = applyOperation(base, operations[actor]);
    let inFlight = operations[actor];
    history.forEach((entry, index) => {
      if (index === actor) inFlight = null;
      else {
        let incoming = entry.operation;
        if (inFlight) [inFlight, incoming] = transformOperations(inFlight, incoming);
        visible = applyOperation(visible, incoming);
      }
    });
    assert.equal(visible, source, `actor ${actor}`);
  }
  for (const token of ["X", "Y", "Z", "Q"]) assert.equal((source.match(new RegExp(token, "g")) || []).length, 1);
});

test("toolbar formatting state is reflected with aria-pressed", () => {
  const app = fs.readFileSync(path.join(__dirname, "../web/public/app.js"), "utf8");
  assert.match(app, /updateToolbarFormatting\(message\.selection\.formats/);
  assert.match(app, /updateToolbarFormatting\(message\.formats/);
  assert.match(app, /setAttribute\("aria-pressed", String\(active\)\)/);
});

test("canvas selections stay in rendered coordinates on the server", () => {
  const server = fs.readFileSync(path.join(__dirname, "../web/server.js"), "utf8");
  assert.match(server, /selection\.mode !== "wmd"\) continue/);
  assert.match(server, /message\.mode === "canvas" \? "canvas" : "wmd"/);
});
