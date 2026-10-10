"use strict";

// Shared nesting rules for the compiler and its diagnostics.
function startDirective(line) {
  const text = String(line).trim();
  if (/^@config$/.test(text)) return { kind: "config" };
  if (/^@collapse(?:\s+.+)?$/.test(text)) return { kind: "collapse" };
  if (/^@style\s+.+$/.test(text)) return { kind: "style" };
  if (/^@tabstops(?:\s+.*)?$/.test(text)) return { kind: "tabstops" };
  const numbered = text.match(/^@(figure|table|equation)\s+([A-Za-z][\w-]*)(?:\s*\|\s*(.*))?$/);
  if (numbered) return { kind: numbered[1], label: numbered[2], caption: (numbered[3] || "").trim() };
  if (/^![A-Za-z][\w-]*(?:\s+.*)?$/.test(text) && !/^!end(?:\s|$)/.test(text)) {
    return { kind: "callout" };
  }
  return null;
}

function endDirective(line) {
  const text = String(line).trim();
  if (text === "@end") return { kind: "at" };
  if (text === "!end") return { kind: "callout" };
  const match = text.match(/^@end(config|collapse|style|tabstops|figure|table|equation)$/);
  return match ? { kind: match[1] } : null;
}

function matchesEnd(kind, end) {
  return end.kind === kind || (end.kind === "at" && kind !== "callout");
}

function fenceStart(line) {
  const match = String(line).match(/^ {0,3}(''|`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return { marker: match[1][0], length: match[1].length };
}
function fenceEnd(line, fence) {
  if (!fence) return false;
  const trimmed = String(line).trim();
  return trimmed.length >= fence.length && [...trimmed].every(ch => ch === fence.marker);
}

function findBlockEnd(state, startLine, endLine, expectedKind) {
  const stack = [expectedKind];
  let fence = null;
  for (let line = startLine + 1; line < endLine; line++) {
    const src = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    if (fence) {
      if (fenceEnd(src, fence)) fence = null;
      continue;
    }
    const opener = fenceStart(src);
    if (opener) {
      fence = opener;
      continue;
    }
    // Configuration values are data, not WMD block syntax.
    const top = stack[stack.length - 1];
    const start = top === "config" ? null : startDirective(src);
    const end = endDirective(src);
    if (start) stack.push(start.kind);
    else if (end && matchesEnd(top, end)) {
      stack.pop();
      if (stack.length === 0) return line;
    }
  }
  return -1;
}

function validateBlocks(source, options = {}) {
  const lines = String(source || "").split(/\r?\n/);
  const stack = [];
  const diagnostics = [];
  let fence = null;
  const add = (line, message) => diagnostics.push({ line, severity: "error", message });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (fenceEnd(line, fence)) fence = null;
      continue;
    }
    const openingFence = fenceStart(line);
    if (openingFence) {
      fence = openingFence;
      continue;
    }
    const top = stack[stack.length - 1];
    const start = top && top.kind === "config" ? null : startDirective(line);
    const end = endDirective(line);
    if (start) {
      stack.push({ kind: start.kind, line: i + 1 });
    } else if (end) {
      if (!top) {
        add(i + 1, "Unmatched " + line.trim() + ".");
      } else if (!matchesEnd(top.kind, end)) {
        add(i + 1, line.trim() + " cannot close @" + top.kind + " opened on line " + top.line + ".");
      } else {
        stack.pop();
      }
    }
  }
  for (const open of stack) {
    add(open.line, "Unclosed " + (open.kind === "callout" ? "callout" : "@" + open.kind) + " block.");
  }
  if (options.strict && diagnostics.length) {
    throw new Error("WMD syntax errors:\n" + diagnostics.map(item => "line " + item.line + ": " + item.message).join("\n"));
  }
  return diagnostics;
}

module.exports = { startDirective, endDirective, matchesEnd, findBlockEnd, validateBlocks };
