const fs = require("fs");
const http = require("http");
const path = require("path");
const MarkdownIt = require("markdown-it");

const DEFAULT_INPUT_PATH = "example.wmd";
const DEFAULT_OUTPUT_PATH = "output.html";
const DEFAULT_PORT = 4312;
const WATCH_DEBOUNCE_MS = 120;

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function niceLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cleanHeadingText(text) {
  return String(text || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#=]/g, "")
    .trim();
}

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function parseTarget(target) {
  const raw = String(target || "").trim();
  const hashIndex = raw.indexOf("#");

  if (hashIndex === -1) {
    return {
      raw,
      tabName: raw,
      headingName: "",
      tabSlug: slugify(raw),
      headingSlug: "",
    };
  }

  const tabName = raw.slice(0, hashIndex).trim();
  const headingName = raw.slice(hashIndex + 1).trim();

  return {
    raw,
    tabName,
    headingName,
    tabSlug: slugify(tabName),
    headingSlug: slugify(headingName),
  };
}

function wikiLinkPlugin(md) {
  md.inline.ruler.before("link", "wiki_link", (state, silent) => {
    const start = state.pos;

    if (state.src.slice(start, start + 2) !== "[[") return false;

    const end = state.src.indexOf("]]", start + 2);
    if (end === -1) return false;

    const raw = state.src.slice(start + 2, end);
    const [targetRaw, labelRaw] = raw.split("|");
    const target = parseTarget(targetRaw);

    if (!target.tabSlug) return false;

    const tabId = state.env.tabAnchors && state.env.tabAnchors.get(target.tabSlug);
    const headingKey = `${target.tabSlug}-${target.headingSlug}`;
    const headingId = target.headingSlug && state.env.headingAnchors
      ? state.env.headingAnchors.get(headingKey)
      : "";
    const href = target.headingSlug
      ? `#${headingId || headingKey}`
      : `#${tabId || target.tabSlug}`;

    const label = labelRaw || targetRaw;
    const tabExists = Boolean(tabId);
    const headingExists = !target.headingSlug || Boolean(headingId);
    const isBroken = !tabExists || !headingExists;

    if (isBroken && state.env.warnings) {
      if (!tabExists) {
        state.env.warnings.push(`Broken link in ${state.env.currentTabName}: tab does not exist: [[${target.raw}]]`);
      } else {
        state.env.warnings.push(`Broken link in ${state.env.currentTabName}: heading does not exist: [[${target.raw}]]`);
      }
    }

    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrs = isBroken
        ? [["href", href], ["class", "broken-link"], ["title", "Broken WMD link"]]
        : [["href", href]];

      const text = state.push("text", "", 0);
      text.content = label;

      state.push("link_close", "a", -1);
    }

    state.pos = end + 2;
    return true;
  });
}

function customBoldPlugin(md) {
  md.inline.ruler.before("link", "custom_bold", (state, silent) => {
    const start = state.pos;

    if (state.src[start] !== "*") return false;
    if (state.src[start + 1] === "*") return false;

    let end = start + 1;

    while (end < state.src.length) {
      if (state.src[end] === "\\" && end + 1 < state.src.length) {
        end += 2;
        continue;
      }

      if (state.src[end] === "*" && state.src[end + 1] !== "*") break;

      end++;
    }

    if (end >= state.src.length) return false;
    if (end === start + 1) return false;

    if (!silent) {
      const token = state.push("strong_open", "strong", 1);
      token.markup = "*";

      const content = state.src.slice(start + 1, end);
      state.md.inline.parse(content, state.md, state.env, state.tokens);

      const close = state.push("strong_close", "strong", -1);
      close.markup = "*";
    }

    state.pos = end + 1;
    return true;
  });
}

function taskCheckboxPlugin(md) {
  md.inline.ruler.before("link", "wmd_task_checkbox", (state, silent) => {
    const match = state.src.slice(state.pos).match(/^\[([ xX])\]\s+/);
    if (!match) return false;

    if (!silent) {
      const token = state.push("wmd_task_checkbox", "input", 0);
      token.meta = { checked: match[1].toLowerCase() === "x" };
    }

    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.wmd_task_checkbox = (tokens, idx) => {
    return `<input class="task-checkbox" type="checkbox"${tokens[idx].meta.checked ? " checked" : ""} disabled>`;
  };
}

function customItalicPlugin(md) {
  md.inline.ruler.before("link", "custom_italic", (state, silent) => {
    const start = state.pos;

    if (state.src[start] !== "_") return false;
    if (state.src[start + 1] === "_") return false;

    let end = start + 1;

    while (end < state.src.length) {
      if (state.src[end] === "\\" && end + 1 < state.src.length) {
        end += 2;
        continue;
      }

      if (state.src[end] === "_" && state.src[end + 1] !== "_") break;

      end++;
    }

    if (end >= state.src.length) return false;
    if (end === start + 1) return false;

    if (!silent) {
      const token = state.push("em_open", "em", 1);
      token.markup = "_";

      const content = state.src.slice(start + 1, end);
      state.md.inline.parse(content, state.md, state.env, state.tokens);

      const close = state.push("em_close", "em", -1);
      close.markup = "_";
    }

    state.pos = end + 1;
    return true;
  });
}

function underlinePlugin(md) {
  md.inline.ruler.before("link", "underline", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== "++") return false;

    const end = state.src.indexOf("++", start + 2);
    if (end === -1 || end === start + 2) return false;

    if (!silent) {
      state.push("u_open", "u", 1);
      state.md.inline.parse(state.src.slice(start + 2, end), state.md, state.env, state.tokens);
      state.push("u_close", "u", -1);
    }

    state.pos = end + 2;
    return true;
  });
}

function highlightPlugin(md) {
  md.inline.ruler.before("link", "highlight", (state, silent) => {
    const start = state.pos;

    let level = 0;
    let marker = "";

    if (state.src.slice(start, start + 3) === "===") {
      level = 3;
      marker = "===";
    } else if (state.src.slice(start, start + 2) === "==") {
      level = 2;
      marker = "==";
    } else if (state.src[start] === "=") {
      level = 1;
      marker = "=";
    } else {
      return false;
    }

    const end = state.src.indexOf(marker, start + marker.length);
    if (end === -1) return false;
    if (end === start + marker.length) return false;

    if (!silent) {
      const open = state.push("span_open", "span", 1);
      open.attrs = [["class", `highlight highlight-${level}`]];

      const content = state.src.slice(start + marker.length, end);
      state.md.inline.parse(content, state.md, state.env, state.tokens);

      state.push("span_close", "span", -1);
    }

    state.pos = end + marker.length;
    return true;
  });
}

function calloutPlugin(md) {
  const allowed = new Set(["note", "tip", "info", "warning", "danger", "rule", "example"]);

  md.block.ruler.before("paragraph", "wmd_callout", (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max).trim();
    const match = line.match(/^!(\w+)(?:\s+(.*))?$/);

    if (!match) return false;

    const type = match[1].toLowerCase();
    if (!allowed.has(type)) return false;

    let nextLine = startLine + 1;
    const contentLines = [];

    while (nextLine < endLine) {
      const pos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const text = state.src.slice(pos, lineMax);

      if (text.trim() === "!end") break;

      contentLines.push(text);
      nextLine++;
    }

    if (nextLine >= endLine) return false;
    if (silent) return true;

    const open = state.push("wmd_callout_open", "div", 1);
    open.block = true;
    open.map = [startLine, nextLine + 1];
    open.meta = {
      type,
      title: (match[2] || niceLabel(type)).trim(),
    };

    state.md.block.parse(contentLines.join("\n"), state.md, state.env, state.tokens);

    state.push("wmd_callout_close", "div", -1);
    state.line = nextLine + 1;
    return true;
  });

  md.renderer.rules.wmd_callout_open = (tokens, idx) => {
    const meta = tokens[idx].meta || {};
    const type = meta.type || "note";
    const title = meta.title || niceLabel(type);

    return `<div class="callout callout-${escapeHtml(type)}">\n<div class="callout-title">${escapeHtml(title)}</div>\n<div class="callout-body">\n`;
  };

  md.renderer.rules.wmd_callout_close = () => {
    return "</div>\n</div>\n";
  };
}

function collapsePlugin(md) {
  md.block.ruler.before("paragraph", "wmd_collapse", (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max).trim();
    const match = line.match(/^@collapse(?:\s+(.+))?$/);

    if (!match) return false;

    let nextLine = startLine + 1;
    const contentLines = [];

    while (nextLine < endLine) {
      const pos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const text = state.src.slice(pos, lineMax);

      if (text.trim() === "@endcollapse") break;

      contentLines.push(text);
      nextLine++;
    }

    if (nextLine >= endLine) return false;
    if (silent) return true;

    const open = state.push("wmd_collapse_open", "details", 1);
    open.block = true;
    open.map = [startLine, nextLine + 1];
    open.meta = {
      title: (match[1] || "Details").trim(),
    };

    state.md.block.parse(contentLines.join("\n"), state.md, state.env, state.tokens);

    state.push("wmd_collapse_close", "details", -1);
    state.line = nextLine + 1;
    return true;
  });

  md.renderer.rules.wmd_collapse_open = (tokens, idx) => {
    const title = tokens[idx].meta && tokens[idx].meta.title
      ? tokens[idx].meta.title
      : "Details";

    return `<details class="collapse">\n<summary>${escapeHtml(title)}</summary>\n<div class="collapse-body">\n`;
  };

  md.renderer.rules.wmd_collapse_close = () => {
    return "</div>\n</details>\n";
  };
}

function tocPlugin(md) {
  md.block.ruler.before("paragraph", "wmd_toc", (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max).trim();
    const match = line.match(/^@toc(?:\s+depth\s*:\s*([1-6]))?\s*$/);

    if (!match) return false;
    if (silent) return true;

    const token = state.push("wmd_toc", "nav", 0);
    token.block = true;
    token.map = [startLine, startLine + 1];
    token.meta = {
      depth: match[1] ? Number(match[1]) : 6,
    };

    state.line = startLine + 1;
    return true;
  });

  md.renderer.rules.wmd_toc = (tokens, idx, options, env) => {
    const depth = tokens[idx].meta.depth;
    const headings = (env.currentTabHeadings || []).filter((heading) => heading.level <= depth);

    if (!headings.length) {
      return '<nav class="toc"><div class="toc-title">Contents</div><p class="toc-empty">No headings in this tab.</p></nav>\n';
    }

    const items = headings
      .map((heading) => {
        return `<a class="toc-link toc-level-${heading.level}" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`;
      })
      .join("\n");

    return `<nav class="toc">\n<div class="toc-title">Contents</div>\n${items}\n</nav>\n`;
  };
}

function parseConfigLine(line, config) {
  const [key, ...valueParts] = line.split(":");
  const value = valueParts.join(":").trim();

  if (key && value && key.trim() in config) {
    config[key.trim()] = value;
  }
}

function parseVarLine(line, vars) {
  const match = line.trim().match(/^@var\s+([A-Za-z][\w-]*)\s*(?:=|:)\s*(.+)$/);
  if (!match) return false;

  vars[match[1]] = match[2].trim();
  return true;
}

function parseTabLine(line) {
  let name = line.slice("@tab ".length).trim();
  let hidden = false;

  if (/\s+\{hidden\}\s*$/i.test(name)) {
    hidden = true;
    name = name.replace(/\s+\{hidden\}\s*$/i, "").trim();
  }

  if (/\s+\[hidden\]\s*$/i.test(name)) {
    hidden = true;
    name = name.replace(/\s+\[hidden\]\s*$/i, "").trim();
  }

  return { name, hidden };
}

function createTab(name, hidden) {
  return {
    name,
    title: null,
    hidden,
    content: [],
    resolvedContent: "",
    headings: [],
    refSlug: "",
    domId: "",
  };
}

function parseWmd(source) {
  const lines = stripBom(source).split(/\r?\n/);

  const config = {
    font: "Arial, sans-serif",
    monoFont: "Consolas, monospace",
    baseSize: "16px",
    titleSize: "3rem",
    h1Size: "2rem",
    h2Size: "1.5rem",
    h3Size: "1.25rem",
    h4Size: "1.1rem",
    h5Size: "1rem",
    h6Size: "0.9rem",
    lineHeight: "1.6",
    contentWidth: "900px",
  };

  const vars = {};
  const tabs = [];
  let currentTab = null;
  let inConfig = false;

  for (const line of lines) {
    if (line.trim() === "@config") {
      inConfig = true;
      continue;
    }

    if (line.trim() === "@endconfig") {
      inConfig = false;
      continue;
    }

    if (inConfig) {
      parseConfigLine(line, config);
      continue;
    }

    if (parseVarLine(line, vars)) {
      continue;
    }

    if (line.startsWith("@tab ")) {
      const tabInfo = parseTabLine(line);
      currentTab = createTab(tabInfo.name, tabInfo.hidden);
      tabs.push(currentTab);
      continue;
    }

    if (!currentTab) {
      if (line.trim() === "") continue;

      currentTab = createTab("Main", false);
      tabs.push(currentTab);
    }

    if (line.startsWith("@title ")) {
      currentTab.title = line.slice("@title ".length).trim();
      continue;
    }

    if (line.trim() === "@hidden") {
      currentTab.hidden = true;
      continue;
    }

    currentTab.content.push(line);
  }

  return { config, vars, tabs };
}

function finalizeTabs(tabs, warnings) {
  const tabsBySlug = new Map();
  const domIdCounts = new Map();

  tabs.forEach((tab, index) => {
    if (!tab.name.trim()) {
      tab.name = `Tab ${index + 1}`;
      warnings.push(`Unnamed tab detected at position ${index + 1}; using "${tab.name}".`);
    }

    const refSlug = slugify(tab.name) || `tab-${index + 1}`;
    const domCount = (domIdCounts.get(refSlug) || 0) + 1;

    domIdCounts.set(refSlug, domCount);
    tab.refSlug = refSlug;
    tab.domId = domCount === 1 ? refSlug : `${refSlug}-${domCount}`;

    if (tabsBySlug.has(refSlug)) {
      warnings.push(`Duplicate tab name "${tab.name}" detected; links and includes will target the first matching tab.`);
      return;
    }

    tabsBySlug.set(refSlug, tab);
  });

  return tabsBySlug;
}

function inlineTextFromChildren(children) {
  if (!Array.isArray(children)) return "";

  return children
    .map((child) => {
      if (child.type === "text" || child.type === "code_inline") {
        return child.content;
      }

      if (child.type === "softbreak" || child.type === "hardbreak") {
        return " ";
      }

      if (child.type === "image") {
        return child.content || "";
      }

      return "";
    })
    .join("");
}

function createUniqueId(baseId, counts) {
  const count = (counts.get(baseId) || 0) + 1;
  counts.set(baseId, count);
  return count === 1 ? baseId : `${baseId}-${count}`;
}

function collectHeadings(md, tab) {
  const tokens = md.parse(tab.resolvedContent, {});
  const headings = [];
  const idCounts = new Map();

  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open.type !== "heading_open") continue;

    const inline = tokens[i + 1];
    const rawText = cleanHeadingText(inlineTextFromChildren(inline && inline.children));
    const text = rawText || `Section ${headings.length + 1}`;
    const headingSlug = slugify(rawText) || `section-${headings.length + 1}`;
    const anchorKey = `${tab.refSlug}-${headingSlug}`;
    const baseId = `${tab.domId}-${headingSlug}`;
    const id = createUniqueId(baseId, idCounts);

    headings.push({
      tabName: tab.name,
      tabRefSlug: tab.refSlug,
      tabDomId: tab.domId,
      level: Number(open.tag.slice(1)),
      text,
      hidden: tab.hidden,
      anchorKey,
      id,
    });
  }

  return headings;
}

function applyHeadingIdsToTokens(tokens, headings) {
  let headingIndex = 0;

  for (const token of tokens) {
    if (token.type !== "heading_open") continue;

    const heading = headings[headingIndex];
    headingIndex += 1;

    if (heading) {
      token.attrSet("id", heading.id);
    }
  }
}

function extractHeadingSection(markdown, headingName) {
  const lines = markdown.split(/\r?\n/);
  const md = makeMarkdownIt();
  const tokens = md.parse(markdown, {});
  const wantedSlug = slugify(headingName);
  let start = -1;
  let startLevel = 0;
  let end = lines.length;

  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open.type !== "heading_open") continue;

    const inline = tokens[i + 1];
    const level = Number(open.tag.slice(1));
    const text = cleanHeadingText(inlineTextFromChildren(inline && inline.children));
    const lineNumber = open.map ? open.map[0] : -1;

    if (start === -1 && slugify(text) === wantedSlug) {
      start = lineNumber;
      startLevel = level;
      continue;
    }

    if (start !== -1 && level <= startLevel) {
      end = lineNumber;
      break;
    }
  }

  if (start === -1) return null;
  return lines.slice(start, end).join("\n");
}

function getTargetMarkdown(targetRaw, tabsBySlug, warnings, sourceTabName) {
  const target = parseTarget(targetRaw);
  const tab = tabsBySlug.get(target.tabSlug);

  if (!tab) {
    warnings.push(`Broken include in ${sourceTabName}: tab does not exist: ${target.raw}`);
    return "";
  }

  const rawMarkdown = tab.content.join("\n");

  if (!target.headingName) {
    return rawMarkdown;
  }

  const section = extractHeadingSection(rawMarkdown, target.headingName);

  if (section === null) {
    warnings.push(`Broken include in ${sourceTabName}: heading does not exist: ${target.raw}`);
    return "";
  }

  return section;
}

function resolveIncludes(markdown, tabsBySlug, warnings, sourceTabName, stack = []) {
  const lines = markdown.split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    const match = line.trim().match(/^@(include|embed)\s+(.+)$/);

    if (!match) {
      out.push(line);
      continue;
    }

    const targetRaw = match[2].trim();
    const stackKey = `${sourceTabName} -> ${targetRaw}`.toLowerCase();

    if (stack.includes(stackKey)) {
      warnings.push(`Circular include skipped in ${sourceTabName}: ${targetRaw}`);
      continue;
    }

    const targetMarkdown = getTargetMarkdown(targetRaw, tabsBySlug, warnings, sourceTabName);
    const resolved = resolveIncludes(
      targetMarkdown,
      tabsBySlug,
      warnings,
      sourceTabName,
      [...stack, stackKey]
    );

    out.push(resolved);
  }

  return out.join("\n");
}

function applyVars(markdown, vars, warnings, sourceTabName) {
  return markdown.replace(/\{\{([A-Za-z][\w-]*)\}\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name];
    }

    warnings.push(`Unknown variable in ${sourceTabName}: {{${name}}}`);
    return match;
  });
}

function uniqueWarnings(warnings) {
  return [...new Set(warnings)];
}

function makeMarkdownIt() {
  const md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    typographer: true,
  });

  md.disable("emphasis");
  md.enable("strikethrough");
  md.use(wikiLinkPlugin);
  md.use(taskCheckboxPlugin);
  md.use(customBoldPlugin);
  md.use(customItalicPlugin);
  md.use(underlinePlugin);
  md.use(highlightPlugin);
  md.use(calloutPlugin);
  md.use(collapsePlugin);
  md.use(tocPlugin);

  return md;
}

function renderTab(md, tab, env) {
  const tokens = md.parse(tab.resolvedContent, env);
  applyHeadingIdsToTokens(tokens, tab.headings);
  return md.renderer.render(tokens, md.options, env);
}

function buildHtml(config, tabs, warnings) {
  const allHeadings = tabs.flatMap((tab) => tab.headings);
  const visibleTabs = tabs.filter((tab) => !tab.hidden);
  const visibleHeadings = allHeadings.filter((heading) => !heading.hidden);
  const firstActiveTab = visibleTabs[0] || tabs[0];
  const firstActiveTabId = firstActiveTab ? firstActiveTab.domId : "";

  const headingAnchors = new Map();
  const tabAnchors = new Map();

  tabs.forEach((tab) => {
    if (!tabAnchors.has(tab.refSlug)) {
      tabAnchors.set(tab.refSlug, tab.domId);
    }
  });

  allHeadings.forEach((heading) => {
    if (!headingAnchors.has(heading.anchorKey)) {
      headingAnchors.set(heading.anchorKey, heading.id);
    }
  });

  const md = makeMarkdownIt();

  const tabButtons = visibleTabs
    .map((tab) => {
      const active = tab.domId === firstActiveTabId ? "active" : "";
      return `<button class="tab-button ${active}" type="button" data-tab-id="${escapeHtml(tab.domId)}">${escapeHtml(tab.name)}</button>`;
    })
    .join("\n");

  const searchItems = visibleHeadings
    .map((heading) => {
      return `
<button
  class="heading-result heading-level-${heading.level}"
  type="button"
  data-search="${escapeHtml((heading.tabName + " " + heading.text).toLowerCase())}"
  data-tab-id="${escapeHtml(heading.tabDomId)}"
  data-heading-id="${escapeHtml(heading.id)}"
  data-level="${heading.level}"
>
  <span class="heading-result-text">${escapeHtml(heading.text)}</span>
  <span class="heading-result-tab">${escapeHtml(heading.tabName)}</span>
</button>`;
    })
    .join("\n");

  const tabSections = tabs
    .map((tab) => {
      const active = tab.domId === firstActiveTabId ? "active" : "";
      const rendered = renderTab(md, tab, {
        tabAnchors,
        headingAnchors,
        warnings,
        currentTabName: tab.name,
        currentTabSlug: tab.refSlug,
        currentTabHeadings: tab.headings,
      });

      const titleHtml = tab.title
        ? `<h1 class="tab-title">${escapeHtml(tab.title)}</h1>`
        : "";

      return `
<section id="${escapeHtml(tab.domId)}" class="tab-section ${active}" data-hidden="${tab.hidden ? "true" : "false"}" data-tab-name="${escapeHtml(tab.name)}" data-tab-hidden="${tab.hidden ? "true" : "false"}">
${titleHtml}
${rendered}
</section>`;
    })
    .join("\n");

  const finalWarnings = uniqueWarnings(warnings);

  const warningHtml = finalWarnings.length
    ? `<div class="warning-panel">
<h3>Compiler warnings</h3>
${finalWarnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("\n")}
</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WMD Document</title>
<style>
  :root {
    --bg: #ffffff;
    --text: #111111;
    --panel: #f0f0f0;
    --panel-active: #222222;
    --panel-active-text: #ffffff;
    --border: #dddddd;
    --link: #2454d6;
    --code: #eeeeee;
    --muted: #666666;
    --warning-bg: #fff1c2;
    --warning-border: #d79b00;
    --surface-soft: #f7f7f7;
    --surface-raised: #fafafa;

    --font: ${config.font};
    --mono-font: ${config.monoFont};
    --content-base-size: ${config.baseSize};
    --title-size: ${config.titleSize};
    --h1-size: ${config.h1Size};
    --h2-size: ${config.h2Size};
    --h3-size: ${config.h3Size};
    --h4-size: ${config.h4Size};
    --h5-size: ${config.h5Size};
    --h6-size: ${config.h6Size};
    --content-line-height: ${config.lineHeight};
    --content-width: ${config.contentWidth};
  }

  body.dark {
    --bg: #121212;
    --text: #eeeeee;
    --panel: #242424;
    --panel-active: #dddddd;
    --panel-active-text: #111111;
    --border: #444444;
    --link: #8ab4ff;
    --code: #2d2d2d;
    --muted: #aaaaaa;
    --warning-bg: #3a2d00;
    --warning-border: #d79b00;
    --surface-soft: #1c1c1c;
    --surface-raised: #181818;
  }

  body {
    margin: 0;
    font-family: var(--font);
    font-size: 16px;
    background: var(--bg);
    color: var(--text);
  }

  a {
    color: var(--link);
  }

  .broken-link {
    color: #c62828;
    text-decoration: underline wavy;
  }

  .layout {
    display: flex;
    min-height: 100vh;
  }

  .sidebar {
    width: 280px;
    flex-shrink: 0;
    border-right: 2px solid var(--border);
    background: var(--panel);
    padding: 16px;
    box-sizing: border-box;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
  }

  .sidebar-title {
    font-size: 1.1rem;
    margin: 0 0 12px;
  }

  .tab-button {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    padding: 10px;
    margin-bottom: 6px;
    text-align: left;
    cursor: pointer;
    border-radius: 6px;
    font-size: 1rem;
    font-family: inherit;
  }

  .tab-button.active {
    background: var(--panel-active);
    color: var(--panel-active-text);
  }

  .search-box {
    width: 100%;
    box-sizing: border-box;
    margin: 18px 0 10px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 1rem;
    font-family: inherit;
  }

  .heading-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-left: 2px solid var(--border);
    margin-left: 6px;
  }

  .heading-result {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    padding-top: 6px;
    padding-right: 8px;
    padding-bottom: 6px;
    text-align: left;
    cursor: pointer;
    border-radius: 0 6px 6px 0;
    font-size: 0.92rem;
    font-family: inherit;
  }

  .heading-result:hover {
    background: var(--bg);
  }

  .heading-result.heading-level-1 { padding-left: 14px; }
  .heading-result.heading-level-2 { padding-left: 26px; }
  .heading-result.heading-level-3 { padding-left: 38px; }
  .heading-result.heading-level-4 { padding-left: 50px; }
  .heading-result.heading-level-5 { padding-left: 62px; }
  .heading-result.heading-level-6 { padding-left: 74px; }

  .heading-result-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heading-result-tab {
    display: none;
    opacity: 0.65;
    font-size: 0.8rem;
  }

  body.heading-search-active .heading-result-tab {
    display: block;
  }

  .warning-panel {
    margin-top: 20px;
    padding: 10px;
    border-left: 4px solid var(--warning-border);
    background: var(--warning-bg);
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .warning-panel h3 {
    font-size: 0.95rem;
    margin: 0 0 8px;
  }

  .warning-panel p {
    margin: 0 0 8px;
  }

  main {
    width: 100%;
    max-width: var(--content-width);
    margin: 0 auto;
    padding: 40px;
    box-sizing: border-box;
  }

  .tab-section {
    display: none;
    font-size: var(--content-base-size);
    line-height: var(--content-line-height);
  }

  .tab-section.active {
    display: block;
  }

  .tab-title {
    font-size: var(--title-size);
    margin-top: 0;
    margin-bottom: 1rem;
  }

  .tab-section h1 {
    font-size: var(--h1-size);
  }

  .tab-section h2 {
    font-size: var(--h2-size);
  }

  .tab-section h3 {
    font-size: var(--h3-size);
  }

  .tab-section h4 {
    font-size: var(--h4-size);
  }

  .tab-section h5 {
    font-size: var(--h5-size);
  }

  .tab-section h6 {
    font-size: var(--h6-size);
  }

  code,
  pre {
    font-family: var(--mono-font);
  }

  code {
    background: var(--code);
    padding: 0.15em 0.3em;
    border-radius: 4px;
  }

  pre code {
    display: block;
    padding: 1em;
    overflow-x: auto;
  }

  table {
    width: 100%;
    margin: 1.2rem 0;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  th {
    background: var(--panel);
    font-weight: bold;
  }

  .highlight {
    padding: 0.08em 0.25em;
    border-radius: 4px;
  }

  .highlight-1 {
    background: #fff59d;
    color: #111111;
  }

  .highlight-2 {
    background: #ffd59e;
    color: #111111;
  }

  .highlight-3 {
    background: #ffb3b3;
    color: #111111;
  }

  .callout {
    border-left: 5px solid #888888;
    background: var(--surface-soft);
    padding: 0.9rem 1rem;
    margin: 1rem 0;
    border-radius: 8px;
  }

  .callout-title {
    font-weight: bold;
    margin-bottom: 0.4rem;
  }

  .callout-body > :first-child {
    margin-top: 0;
  }

  .callout-body > :last-child {
    margin-bottom: 0;
  }

  .callout-note,
  .callout-info {
    border-left-color: #3f7bd8;
  }

  .callout-tip {
    border-left-color: #2e9d57;
  }

  .callout-warning {
    border-left-color: #d98b00;
  }

  .callout-danger {
    border-left-color: #c62828;
  }

  .callout-rule {
    border-left-color: #7e57c2;
  }

  .callout-example {
    border-left-color: #b9a500;
  }

  .collapse {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 1rem 0;
    background: var(--surface-raised);
  }

  .collapse summary {
    cursor: pointer;
    padding: 0.8rem 1rem;
    font-weight: bold;
  }

  .collapse-body {
    padding: 0 1rem 1rem;
  }

  .toc {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin: 1rem 0;
    background: var(--surface-raised);
  }

  .toc-title {
    font-weight: bold;
    margin-bottom: 0.6rem;
  }

  .toc-link {
    display: block;
    text-decoration: none;
    margin: 0.25rem 0;
  }

  .toc-link:hover {
    text-decoration: underline;
  }

  .toc-level-2 { margin-left: 1rem; }
  .toc-level-3 { margin-left: 2rem; }
  .toc-level-4 { margin-left: 3rem; }
  .toc-level-5 { margin-left: 4rem; }
  .toc-level-6 { margin-left: 5rem; }

  .toc-empty {
    color: var(--muted);
    margin: 0;
  }

  .collapsible-heading {
    cursor: pointer;
    user-select: none;
    scroll-margin-top: 1rem;
  }

  .heading-collapse-marker {
    display: inline-block;
    width: 1.1em;
    color: var(--muted);
    font-size: 0.85em;
  }

  .collapsible-heading:hover .heading-collapse-marker {
    color: var(--text);
  }

  .heading-hidden-by-collapse {
    display: none !important;
  }

  @media (max-width: 900px) {
    .layout {
      display: block;
    }

    .sidebar {
      width: auto;
      height: auto;
      position: static;
      border-right: none;
      border-bottom: 2px solid var(--border);
    }

    main {
      max-width: none;
      padding: 24px 18px 40px;
    }
  }
</style>
</head>
<body>

<div class="layout">
  <aside class="sidebar">
    <h2 class="sidebar-title">Tabs</h2>

    ${tabButtons || "<p>No visible tabs.</p>"}

    <input
      class="search-box"
      id="headingSearch"
      type="search"
      placeholder="Search headings..."
    >

    <div class="heading-results" id="headingResults">
      ${searchItems}
    </div>

    ${warningHtml}
  </aside>

  <main>
    ${tabSections}
  </main>
</div>

<script>
  function getActiveTabId() {
    var active = document.querySelector(".tab-section.active");
    return active ? active.id : "";
  }

  function getHeadingLevel(heading) {
    return Number(heading.tagName.slice(1));
  }

  function isCollapsibleHeading(node) {
    return node && /^H[1-6]$/.test(node.tagName) && node.classList.contains("collapsible-heading");
  }

  function updateHeadingVisibility(section) {
    if (!section) return;

    var stack = [];
    Array.from(section.children).forEach(function(node) {
      if (isCollapsibleHeading(node)) {
        var level = getHeadingLevel(node);

        stack = stack.filter(function(item) {
          return item.level < level;
        });

        var hiddenByParent = stack.some(function(item) {
          return item.collapsed;
        });

        node.classList.toggle("heading-hidden-by-collapse", hiddenByParent);

        var marker = node.querySelector(".heading-collapse-marker");
        var collapsed = node.dataset.collapsed === "true";
        if (marker) marker.textContent = collapsed ? ">" : "v";

        stack.push({ level: level, collapsed: collapsed || hiddenByParent });
        return;
      }

      var hidden = stack.some(function(item) {
        return item.collapsed;
      });

      node.classList.toggle("heading-hidden-by-collapse", hidden);
    });
  }

  function setupCollapsibleHeadings() {
    document.querySelectorAll(".tab-section h1, .tab-section h2, .tab-section h3, .tab-section h4, .tab-section h5, .tab-section h6").forEach(function(heading) {
      if (heading.classList.contains("tab-title")) return;
      if (heading.classList.contains("collapsible-heading")) return;

      heading.classList.add("collapsible-heading");
      heading.dataset.collapsed = "false";

      var marker = document.createElement("span");
      marker.className = "heading-collapse-marker";
      marker.textContent = "v";
      marker.setAttribute("aria-hidden", "true");
      heading.insertBefore(marker, heading.firstChild);

      heading.addEventListener("click", function(event) {
        var link = event.target.closest("a");
        if (link) return;

        heading.dataset.collapsed = heading.dataset.collapsed === "true" ? "false" : "true";
        updateHeadingVisibility(heading.closest(".tab-section"));
      });
    });

    document.querySelectorAll(".tab-section").forEach(updateHeadingVisibility);
  }

  function expandAncestorsForHeading(heading) {
    if (!heading) return;

    var neededLevel = getHeadingLevel(heading);
    var node = heading.previousElementSibling;

    while (node) {
      if (isCollapsibleHeading(node)) {
        var level = getHeadingLevel(node);

        if (level < neededLevel) {
          node.dataset.collapsed = "false";
          neededLevel = level;
        }
      }

      node = node.previousElementSibling;
    }

    updateHeadingVisibility(heading.closest(".tab-section"));
  }

  function updateHeadingList() {
    var search = document.getElementById("headingSearch");
    var query = search ? search.value.trim().toLowerCase() : "";
    var activeTabId = getActiveTabId();
    var searching = query.length > 0;

    document.body.classList.toggle("heading-search-active", searching);

    document.querySelectorAll(".heading-result").forEach(function(item) {
      var matchesSearch = item.dataset.search.includes(query);
      var matchesCurrentTab = item.dataset.tabId === activeTabId;
      item.style.display = (searching ? matchesSearch : matchesCurrentTab) ? "block" : "none";
    });
  }

  function openTab(id, pushHistory) {
    if (pushHistory === undefined) pushHistory = true;

    document.querySelectorAll(".tab-section").forEach(function(section) {
      section.classList.remove("active");
    });

    document.querySelectorAll(".tab-button").forEach(function(button) {
      button.classList.remove("active");
    });

    var section = document.getElementById(id);
    if (!section) return;

    section.classList.add("active");

    var buttons = Array.from(document.querySelectorAll(".tab-button"));
    var button = buttons.find(function(btn) {
      return btn.dataset.tabId === id;
    });

    if (button) button.classList.add("active");

    updateHeadingList();
    updateHeadingVisibility(section);

    if (pushHistory && location.hash !== "#" + id) {
      history.pushState({ tab: id }, "", "#" + id);
    }
  }

  function jumpToHeading(tabId, headingId) {
    openTab(tabId, false);

    if (location.hash !== "#" + headingId) {
      history.pushState({ tab: tabId, heading: headingId }, "", "#" + headingId);
    }

    setTimeout(function() {
      var heading = document.getElementById(headingId);
      if (heading) {
        expandAncestorsForHeading(heading);
        heading.scrollIntoView({ block: "start" });
      }
    }, 0);
  }

  function filterHeadings() {
    updateHeadingList();
  }

  function syncFromHash() {
    var hash = location.hash.slice(1);

    if (!hash) {
      openTab(${JSON.stringify(firstActiveTabId)}, false);
      return;
    }

    var directTab = document.getElementById(hash);
    if (directTab && directTab.classList.contains("tab-section")) {
      openTab(hash, false);
      return;
    }

    var matchingTab = Array.from(document.querySelectorAll(".tab-section")).find(function(section) {
      return hash.startsWith(section.id + "-");
    });

    if (matchingTab) {
      openTab(matchingTab.id, false);

      setTimeout(function() {
        var target = document.getElementById(hash);
        if (target) {
          expandAncestorsForHeading(target);
          target.scrollIntoView({ block: "start" });
        }
      }, 0);
      return;
    }

    openTab(${JSON.stringify(firstActiveTabId)}, false);
  }

  setupCollapsibleHeadings();

  document.querySelectorAll(".tab-button").forEach(function(button) {
    button.addEventListener("click", function() {
      openTab(button.dataset.tabId);
    });
  });

  document.querySelectorAll(".heading-result").forEach(function(button) {
    button.addEventListener("click", function() {
      jumpToHeading(button.dataset.tabId, button.dataset.headingId);
    });
  });

  var headingSearch = document.getElementById("headingSearch");
  if (headingSearch) {
    headingSearch.addEventListener("input", filterHeadings);
  }

  window.addEventListener("popstate", syncFromHash);
  window.addEventListener("hashchange", syncFromHash);
  syncFromHash();
  updateHeadingList();
</script>

</body>
</html>`;

  return { html, warnings: finalWarnings };
}

function compile(source) {
  const md = makeMarkdownIt();
  const { config, vars, tabs } = parseWmd(source);
  const warnings = [];
  const tabsBySlug = finalizeTabs(tabs, warnings);

  for (const tab of tabs) {
    const withIncludes = resolveIncludes(tab.content.join("\n"), tabsBySlug, warnings, tab.name);
    tab.resolvedContent = applyVars(withIncludes, vars, warnings, tab.name);
  }

  for (const tab of tabs) {
    tab.headings = collectHeadings(md, tab);
  }

  return buildHtml(config, tabs, warnings);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function compileFile(inputPath, outputPath) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  const source = fs.readFileSync(resolvedInput, "utf8");
  const result = compile(source);

  ensureParentDirectory(resolvedOutput);
  fs.writeFileSync(resolvedOutput, result.html, "utf8");

  return result;
}

function injectLiveReload(html, liveReloadPath) {
  const snippet = `
<script>
  (function() {
    if (!window.EventSource || location.protocol.indexOf("http") !== 0) return;

    var source = new EventSource(${JSON.stringify(liveReloadPath)});
    source.addEventListener("reload", function() {
      location.reload();
    });
  })();
</script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${snippet}\n</body>`);
  }

  return `${html}\n${snippet}`;
}

function createErrorPage(inputPath, error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WMD Compile Error</title>
<style>
  body {
    margin: 0;
    padding: 24px;
    background: #121212;
    color: #eeeeee;
    font-family: Consolas, monospace;
  }

  h1 {
    margin-top: 0;
    font-family: Arial, sans-serif;
  }

  pre {
    white-space: pre-wrap;
    word-break: break-word;
    background: #1d1d1d;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid #333333;
  }
</style>
</head>
<body>
  <h1>WMD compile error</h1>
  <p>${escapeHtml(formatPathForLog(inputPath))}</p>
  <pre>${escapeHtml(error && error.stack ? error.stack : String(error))}</pre>
</body>
</html>`;
}

function watchFile(options) {
  const {
    inputPath,
    outputPath,
    onSuccess,
    onError,
  } = options;

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  const watchDirectory = path.dirname(resolvedInput);
  const watchedFileName = path.basename(resolvedInput);
  let timer = null;
  let closed = false;

  const triggerCompile = () => {
    if (closed) return;

    try {
      const result = compileFile(resolvedInput, resolvedOutput);
      if (onSuccess) onSuccess(result);
    } catch (error) {
      if (onError) onError(error);
    }
  };

  const watcher = fs.watch(watchDirectory, (eventType, fileName) => {
    const changedName = fileName ? path.basename(String(fileName)) : watchedFileName;
    if (changedName !== watchedFileName) return;

    clearTimeout(timer);
    timer = setTimeout(triggerCompile, WATCH_DEBOUNCE_MS);
  });

  return () => {
    closed = true;
    clearTimeout(timer);
    watcher.close();
  };
}

function startPreviewServer(options) {
  const {
    inputPath,
    outputPath,
    port = DEFAULT_PORT,
  } = options;

  const liveReloadPath = "/__wmd/live";
  const clients = new Set();
  let currentHtml = "";
  let lastError = null;

  const refreshClients = () => {
    for (const client of clients) {
      client.write("event: reload\ndata: ok\n\n");
    }
  };

  const handleSuccess = (result) => {
    currentHtml = result.html;
    lastError = null;
    reportCompile(result, inputPath, outputPath);
    refreshClients();
  };

  const handleError = (error) => {
    currentHtml = createErrorPage(inputPath, error);
    lastError = error;
    reportCompileError(error, inputPath);
    refreshClients();
  };

  try {
    const result = compileFile(inputPath, outputPath);
    currentHtml = result.html;
    reportCompile(result, inputPath, outputPath);
  } catch (error) {
    handleError(error);
  }

  const stopWatching = watchFile({
    inputPath,
    outputPath,
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const server = http.createServer((request, response) => {
    const urlPath = request.url || "/";

    if (urlPath === liveReloadPath) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Connection: "keep-alive",
      });

      response.write("retry: 500\n\n");
      clients.add(response);

      request.on("close", () => {
        clients.delete(response);
      });

      return;
    }

    if (urlPath === "/" || urlPath === `/${path.basename(outputPath)}`) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });

      const html = injectLiveReload(currentHtml || createErrorPage(inputPath, lastError || new Error("No output available")), liveReloadPath);
      response.end(html);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Preview server running at http://127.0.0.1:${port}`);
    console.log(`Watching ${formatPathForLog(inputPath)} -> ${formatPathForLog(outputPath)}`);
  });

  return {
    close() {
      stopWatching();

      for (const client of clients) {
        client.end();
      }

      server.close();
    },
    server,
  };
}

function formatPathForLog(filePath) {
  const relative = path.relative(process.cwd(), path.resolve(filePath));
  return relative || path.resolve(filePath);
}

function reportCompile(result, inputPath, outputPath) {
  console.log(`Compiled ${formatPathForLog(inputPath)} -> ${formatPathForLog(outputPath)}`);

  if (result.warnings.length) {
    for (const warning of result.warnings) {
      console.warn(`warning ${formatPathForLog(inputPath)}: ${warning}`);
    }
  }
}

function reportCompileError(error, inputPath) {
  const message = error && error.message ? error.message : String(error);
  console.error(`error ${formatPathForLog(inputPath)}: ${message}`);
}

function printHelp() {
  console.log(`WMD compiler

Usage:
  node wmd-compiler.js [input] [output]
  node wmd-compiler.js --watch [input] [output]
  node wmd-compiler.js --serve [input] [output] [--port 4312]

Options:
  --input, -i   Input .wmd file (default: ${DEFAULT_INPUT_PATH})
  --output, -o  Output HTML file (default: ${DEFAULT_OUTPUT_PATH})
  --watch, -w   Recompile when the input file changes
  --serve, -s   Start a local preview server with live reload
  --port, -p    Preview server port (default: ${DEFAULT_PORT})
  --help, -h    Show this help text`);
}

function parseArgs(argv) {
  const options = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    watch: false,
    serve: false,
    port: DEFAULT_PORT,
    help: false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--watch" || arg === "-w") {
      options.watch = true;
      continue;
    }

    if (arg === "--serve" || arg === "-s") {
      options.serve = true;
      options.watch = true;
      continue;
    }

    if (arg === "--input" || arg === "-i") {
      i += 1;
      if (i >= argv.length) throw new Error("Missing value for --input.");
      options.inputPath = argv[i];
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      i += 1;
      if (i >= argv.length) throw new Error("Missing value for --output.");
      options.outputPath = argv[i];
      continue;
    }

    if (arg === "--port" || arg === "-p") {
      i += 1;
      if (i >= argv.length) throw new Error("Missing value for --port.");

      const port = Number(argv[i]);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid port: ${argv[i]}`);
      }

      options.port = port;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional[0]) {
    options.inputPath = positional[0];
  }

  if (positional[1]) {
    options.outputPath = positional[1];
  }

  if (positional.length > 2) {
    throw new Error("Too many positional arguments.");
  }

  return options;
}

function runCli(argv = process.argv.slice(2)) {
  let options;

  try {
    options = parseArgs(argv);
  } catch (error) {
    reportCompileError(error, DEFAULT_INPUT_PATH);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  if (options.serve) {
    startPreviewServer({
      inputPath: options.inputPath,
      outputPath: options.outputPath,
      port: options.port,
    });
    return;
  }

  try {
    const result = compileFile(options.inputPath, options.outputPath);
    reportCompile(result, options.inputPath, options.outputPath);
  } catch (error) {
    reportCompileError(error, options.inputPath);
    process.exitCode = 1;

    if (!options.watch) {
      return;
    }
  }

  if (!options.watch) {
    return;
  }

  watchFile({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    onSuccess: (result) => {
      reportCompile(result, options.inputPath, options.outputPath);
    },
    onError: (error) => {
      reportCompileError(error, options.inputPath);
    },
  });

  console.log(`Watching ${formatPathForLog(options.inputPath)} -> ${formatPathForLog(options.outputPath)}`);
}

module.exports = {
  DEFAULT_INPUT_PATH,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_PORT,
  compile,
  compileFile,
  parseArgs,
  startPreviewServer,
  watchFile,
};

if (require.main === module) {
  runCli();
}
