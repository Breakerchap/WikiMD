const test = require("node:test");
const assert = require("node:assert/strict");

const { compile, parseArgs } = require("../wmd-compiler.js");
const { parseOptions } = require("../web/server.js");

test("parseArgs supports positional files and serve mode", () => {
  const options = parseArgs(["--serve", "notes.wmd", "notes.html", "--port", "4500"]);

  assert.equal(options.serve, true);
  assert.equal(options.watch, true);
  assert.equal(options.inputPath, "notes.wmd");
  assert.equal(options.outputPath, "notes.html");
  assert.equal(options.port, 4500);
});

test("duplicate headings get unique ids and stable link targets", () => {
  const source = `@tab Main
# Main

## Repeat
First section

## Repeat
Second section

[[Main#Repeat]]
`;

  const result = compile(source);

  assert.match(result.html, /id="main-repeat"/);
  assert.match(result.html, /id="main-repeat-2"/);
  assert.match(result.html, /href="#main-repeat">Main#Repeat<\/a>/);
});

test("fenced code headings are not added to navigation", () => {
  const source = `@tab Main
# Real Heading
@toc

\`\`\`md
## Fake Heading
\`\`\`
`;

  const result = compile(source);

  assert.match(result.html, /href="#main-real-heading">Real Heading<\/a>/);
  assert.doesNotMatch(result.html, /href="#main-fake-heading">/);
  assert.doesNotMatch(result.html, /data-heading-id="main-fake-heading"/);
});

test("duplicate tab names are warned about and get unique section ids", () => {
  const source = `@tab Combat
# One

@tab Combat
# Two
`;

  const result = compile(source);

  assert.match(result.html, /<section id="combat"/);
  assert.match(result.html, /<section id="combat-2"/);
  assert.match(result.html, /data-tab-name="Combat"/);
  assert.ok(result.warnings.some((warning) => warning.includes('Duplicate tab name "Combat"')));
});

test("compiled documents leave theme selection to the host application", () => {
  const result = compile("@tab Home\n# Theme test");

  assert.doesNotMatch(result.html, /id="darkToggle"/);
  assert.doesNotMatch(result.html, /localStorage\.getItem\("darkMode"\)/);
});

test("double plus markers compile to persistent underline", () => {
  const result = compile("@tab Home\n++Important++");

  assert.match(result.html, /<u>Important<\/u>/);
});

test("single WMD newlines render as document line breaks", () => {
  const result = compile("@tab Home\nFirst line\nSecond line");

  assert.match(result.html, /First line<br>\s*Second line/);
});

test("web server options support LAN and a public editor URL", () => {
  const options = parseOptions([
    "--host", "0.0.0.0",
    "--port", "4510",
    "--public-url", "https://docs.example.com/workspace",
  ]);

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 4510);
  assert.equal(options.publicUrl, "https://docs.example.com");
});
