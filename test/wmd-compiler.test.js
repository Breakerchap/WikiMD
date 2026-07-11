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

test("style markers decorate blocks without rendering the directive", () => {
  const result = compile(`@config
Project Heading: {bold: true; heading: 2};
Tagline: {italic: true};
@endconfig

@tab Home
@style Project Heading
## Project plan
@end

@style Tagline
A styled paragraph
@end`);

  assert.match(result.html, /<h2[^>]*class="wmd-preset-project-heading"[^>]*data-wmd-preset="project-heading"[^>]*>Project plan<\/h2>/);
  assert.match(result.html, /<p[^>]*class="wmd-preset-tagline"[^>]*data-wmd-preset="tagline"[^>]*>A styled paragraph<\/p>/);
  assert.doesNotMatch(result.html, />@style /);
});

test("callout types retain their compiled style classes", () => {
  const result = compile("@tab Home\n!warning Check this\nImportant detail\n!end");

  assert.match(result.html, /class="callout callout-warning"/);
  assert.match(result.html, /<div class="callout-title">Check this<\/div>/);
});

test("task list syntax compiles to checkboxes", () => {
  const result = compile("@tab Home\n- [ ] Pending\n- [x] Complete");

  assert.match(result.html, /class="task-checkbox" type="checkbox" disabled/);
  assert.match(result.html, /class="task-checkbox" type="checkbox" checked disabled/);
});

test("single WMD newlines render as document line breaks", () => {
  const result = compile("@tab Home\nFirst line\nSecond line");

  assert.match(result.html, /First line<br>\s*Second line/);
});

test("WMD tables compile to semantic table markup", () => {
  const result = compile(`@tab Home
| Name | Score |
| --- | --- |
| Ada | 10 |`);

  assert.match(result.html, /<table>/);
  assert.match(result.html, /<th>Name<\/th>/);
  assert.match(result.html, /<td>Ada<\/td>/);
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

test("config-defined custom heading markers compile and style headings", () => {
  const result = compile(`@config
Heading A: {wmd-formatting: $; keybind: ctrl+shift+a; size: 80px; font: arial; bold: true; italic: true};
Heading B: {wmd-formatting: \\\\; keybind: ctrl+shift+b; size: 60px; font: garamond; bold: true};
@endconfig

@tab Test
$ Alpha
\\\\ Beta`);

  assert.match(result.html, /<h2[^>]*id="test-alpha"[^>]*class="wmd-preset-heading-a"[^>]*data-wmd-preset="heading-a"[^>]*>Alpha<\/h2>/);
  assert.match(result.html, /<h2[^>]*id="test-beta"[^>]*class="wmd-preset-heading-b"[^>]*data-wmd-preset="heading-b"[^>]*>Beta<\/h2>/);
  assert.match(result.html, /\[data-wmd-preset="heading-a"\]\{[^}]*font-size:80px/);
  assert.match(result.html, /\[data-wmd-preset="heading-b"\]\{[^}]*font-family:garamond/);
});
