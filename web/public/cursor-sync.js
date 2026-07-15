(function initCollaborationCursorLayer(root) {
  "use strict";
  if (!root || !root.document || typeof root.WebSocket !== "function" || !root.WmdEditorSync) return;

  const sync = root.WmdEditorSync;
  const NativeWebSocket = root.WebSocket;
  let clientId = "";
  let users = [];
  let serverSource = "";
  let canvasText = "";
  let rawLayer = null;
  let rawMirror = null;
  let renderFrame = null;
  const sockets = new Set();

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
  }

  function occurrences(source, value, limit) {
    if (!value) return [];
    const positions = [];
    let position = source.indexOf(value);
    while (position !== -1 && positions.length < (limit || 80)) {
      positions.push(position);
      position = source.indexOf(value, position + 1);
    }
    return positions;
  }

  function mapOffsetBetweenTexts(before, after, offset) {
    before = String(before || "");
    after = String(after || "");
    const sourceOffset = clamp(offset, 0, before.length);
    if (before === after) return clamp(sourceOffset, 0, after.length);
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix
      && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    if (sourceOffset <= prefix) return sourceOffset;
    if (sourceOffset >= before.length - suffix) return after.length - (before.length - sourceOffset);
    const size = 28;
    const left = before.slice(Math.max(0, sourceOffset - size), sourceOffset);
    const right = before.slice(sourceOffset, Math.min(before.length, sourceOffset + size));
    const combined = left + right;
    const matches = occurrences(after, combined);
    if (matches.length === 1) return matches[0] + left.length;
    const expected = clamp(sourceOffset + after.length - before.length, 0, after.length);
    const leftEnds = occurrences(after, left).map((position) => position + left.length);
    const rightStarts = occurrences(after, right);
    let best = null;
    for (const leftEnd of leftEnds) {
      for (const rightStart of rightStarts) {
        if (leftEnd > rightStart) continue;
        const score = (rightStart - leftEnd) * 4 + Math.abs(rightStart - expected);
        if (!best || score < best.score) best = { offset: rightStart, score };
      }
    }
    if (best) return best.offset;
    if (rightStarts.length) return rightStarts.reduce((nearest, position) => Math.abs(position - expected) < Math.abs(nearest - expected) ? position : nearest);
    if (leftEnds.length) return leftEnds.reduce((nearest, position) => Math.abs(position - expected) < Math.abs(nearest - expected) ? position : nearest);
    const operation = sync.operationFromTextDiff(before, after);
    return operation ? sync.mapOffsetThroughOperation(sourceOffset, operation, "before") : sourceOffset;
  }

  function updateUser(user) {
    if (!user || !user.id) return;
    const index = users.findIndex((candidate) => candidate.id === user.id);
    if (index === -1) users = users.concat(user);
    else users = users.map((candidate, candidateIndex) => candidateIndex === index ? Object.assign({}, candidate, user) : candidate);
  }

  function transformTrackedSelections(operation, authorId) {
    if (!operation) return;
    users = users.map((user) => {
      if (!user.selection || user.selection.mode !== "wmd") return user;
      const affinity = user.id === authorId ? "after" : "before";
      const selection = sync.mapSelectionThroughOperations(user.selection, [operation], affinity);
      return Object.assign({}, user, { selection: Object.assign({}, user.selection, selection) });
    });
  }

  function scheduleRender() {
    if (renderFrame !== null) return;
    renderFrame = root.requestAnimationFrame(() => {
      renderFrame = null;
      renderRawCanvasCursors();
      const preview = document.querySelector("#preview");
      if (preview && preview.contentWindow) {
        preview.contentWindow.postMessage({
          channel: "wmd-studio-cursor-overlay",
          users: users.filter((user) => user.id !== clientId && user.selection),
          source: serverSource,
        }, "*");
      }
    });
  }

  function ensureParentStyles() {
    if (document.querySelector("#wmd-cursor-overlay-style")) return;
    const style = document.createElement("style");
    style.id = "wmd-cursor-overlay-style";
    style.textContent = [
      ".wmd-cross-cursor-layer{position:absolute;inset:0;z-index:3;overflow:hidden;pointer-events:none}",
      ".wmd-cross-cursor{position:absolute;width:2px;min-height:1.35em;background:var(--cursor-color,#b9483c);pointer-events:none}",
      ".wmd-cross-cursor-label{position:absolute;left:-2px;bottom:100%;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 5px;border-radius:4px;color:#fff;background:var(--cursor-color,#b9483c);font:600 .62rem/1.2 Aptos,sans-serif}",
    ].join("");
    document.head.append(style);
  }

  function ensureRawLayer(shell) {
    ensureParentStyles();
    if (!rawLayer || rawLayer.parentElement !== shell) {
      rawLayer = document.createElement("div");
      rawLayer.className = "wmd-cross-cursor-layer";
      shell.append(rawLayer);
    }
    if (!rawMirror) {
      rawMirror = document.createElement("div");
      rawMirror.setAttribute("aria-hidden", "true");
      rawMirror.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;box-sizing:border-box;";
      document.body.append(rawMirror);
    }
  }

  function mirrorPoint(editor, source, offset) {
    const computed = root.getComputedStyle(editor);
    const properties = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "tabSize"];
    properties.forEach((property) => { rawMirror.style[property] = computed[property]; });
    rawMirror.style.width = editor.clientWidth + "px";
    rawMirror.replaceChildren(document.createTextNode(source.slice(0, offset)));
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    rawMirror.append(marker, document.createTextNode(source.slice(offset)));
    return { left: marker.offsetLeft - editor.scrollLeft, top: marker.offsetTop - editor.scrollTop, height: parseFloat(computed.lineHeight) || 20 };
  }

  function renderRawCanvasCursors() {
    const editor = document.querySelector("#editor");
    const shell = document.querySelector("#rawEditorShell");
    const modeButton = document.querySelector("#wmdModeButton");
    if (!editor || !shell || !modeButton || modeButton.getAttribute("aria-pressed") !== "true" || shell.hidden) {
      if (rawLayer) rawLayer.replaceChildren();
      return;
    }
    ensureRawLayer(shell);
    rawLayer.replaceChildren();
    const source = editor.value || serverSource;
    for (const user of users) {
      if (user.id === clientId || !user.selection || user.selection.mode !== "canvas") continue;
      const offset = mapOffsetBetweenTexts(canvasText, source, user.selection.end);
      const point = mirrorPoint(editor, source, clamp(offset, 0, source.length));
      const cursor = document.createElement("div");
      cursor.className = "wmd-cross-cursor";
      cursor.style.left = point.left + "px";
      cursor.style.top = point.top + "px";
      cursor.style.height = point.height + "px";
      cursor.style.setProperty("--cursor-color", user.color || "#b9483c");
      const label = document.createElement("span");
      label.className = "wmd-cross-cursor-label";
      label.textContent = user.name || "Collaborator";
      cursor.append(label);
      rawLayer.append(cursor);
    }
  }

  function iframeCursorRuntime() {
    "use strict";
    var users = [];
    var source = "";
    var main = document.querySelector("main");
    var layer = document.createElement("div");
    layer.className = "wmd-presence-layer";
    document.body.append(layer);
    var frame = null;
    var ignored = ".wmd-studio-cursor,.heading-collapse-marker,.wmd-studio-duplicate-title,.warning-panel,.wmd-presence-layer";

    function clamp(value, minimum, maximum) {
      var number = Number(value);
      return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
    }

    function textNodes(root) {
      if (!root) return [];
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function(node) {
        return node.parentElement && node.parentElement.closest(ignored) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }});
      var result = [];
      var node = walker.nextNode();
      while (node) { result.push(node); node = walker.nextNode(); }
      return result;
    }

    function textValue(root) {
      return textNodes(root).map(function(node) { return node.data; }).join("");
    }

    function occurrences(haystack, needle) {
      if (!needle) return [];
      var positions = [];
      var position = haystack.indexOf(needle);
      while (position !== -1 && positions.length < 80) { positions.push(position); position = haystack.indexOf(needle, position + 1); }
      return positions;
    }

    function mapOffset(before, after, offset) {
      before = String(before || "");
      after = String(after || "");
      var sourceOffset = clamp(offset, 0, before.length);
      if (before === after) return clamp(sourceOffset, 0, after.length);
      var prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
      var suffix = 0;
      while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
      if (sourceOffset <= prefix) return sourceOffset;
      if (sourceOffset >= before.length - suffix) return after.length - (before.length - sourceOffset);
      var size = 24;
      var left = before.slice(Math.max(0, sourceOffset - size), sourceOffset);
      var right = before.slice(sourceOffset, Math.min(before.length, sourceOffset + size));
      var combined = left + right;
      var matches = occurrences(after, combined);
      if (matches.length === 1) return matches[0] + left.length;
      var expected = clamp(sourceOffset + after.length - before.length, 0, after.length);
      var rightStarts = occurrences(after, right);
      if (rightStarts.length) return rightStarts.reduce(function(nearest, position) { return Math.abs(position - expected) < Math.abs(nearest - expected) ? position : nearest; });
      var leftEnds = occurrences(after, left).map(function(position) { return position + left.length; });
      if (leftEnds.length) return leftEnds.reduce(function(nearest, position) { return Math.abs(position - expected) < Math.abs(nearest - expected) ? position : nearest; });
      return clamp(Math.round(sourceOffset * (after.length / Math.max(1, before.length))), 0, after.length);
    }

    function positionIn(root, offset) {
      var nodes = textNodes(root);
      var remaining = clamp(offset, 0, nodes.reduce(function(total, node) { return total + node.data.length; }, 0));
      for (var index = 0; index < nodes.length; index += 1) {
        if (remaining <= nodes[index].data.length) return { node: nodes[index], offset: remaining };
        remaining -= nodes[index].data.length;
      }
      return nodes.length ? { node: nodes[nodes.length - 1], offset: nodes[nodes.length - 1].data.length } : null;
    }

    function rectForPosition(root, offset) {
      var position = positionIn(root, offset);
      if (!position) return null;
      var range = document.createRange();
      range.setStart(position.node, position.offset);
      range.collapse(true);
      var rect = range.getClientRects()[0] || range.getBoundingClientRect();
      if (rect && rect.height) return { left: rect.left, top: rect.top, height: rect.height };
      if (position.offset > 0) {
        range.setStart(position.node, position.offset - 1);
        range.setEnd(position.node, position.offset);
        rect = range.getClientRects()[range.getClientRects().length - 1] || range.getBoundingClientRect();
        if (rect && rect.height) return { left: rect.right, top: rect.top, height: rect.height };
      }
      if (position.offset < position.node.data.length) {
        range.setStart(position.node, position.offset);
        range.setEnd(position.node, position.offset + 1);
        rect = range.getClientRects()[0] || range.getBoundingClientRect();
        if (rect && rect.height) return { left: rect.left, top: rect.top, height: rect.height };
      }
      return null;
    }

    function mappedBlock(offset) {
      var candidates = Array.prototype.slice.call(document.querySelectorAll("[data-wmd-source-start][data-wmd-source-end]")).filter(function(element) {
        var start = Number(element.dataset.wmdSourceStart);
        var end = Number(element.dataset.wmdSourceEnd);
        return Number.isFinite(start) && Number.isFinite(end) && start <= offset && offset <= end && element.getClientRects().length;
      });
      candidates.sort(function(left, right) {
        return (Number(left.dataset.wmdSourceEnd) - Number(left.dataset.wmdSourceStart)) - (Number(right.dataset.wmdSourceEnd) - Number(right.dataset.wmdSourceStart));
      });
      return candidates[0] || null;
    }

    function rectForUser(user) {
      if (!user.selection || !main) return null;
      if (user.selection.mode === "canvas") return rectForPosition(main, user.selection.end);
      var sourceOffset = clamp(user.selection.end, 0, source.length);
      var block = mappedBlock(sourceOffset);
      if (!block) return rectForPosition(main, mapOffset(source, textValue(main), sourceOffset));
      var start = Number(block.dataset.wmdSourceStart) || 0;
      var end = Number(block.dataset.wmdSourceEnd) || start;
      var sourceSlice = source.slice(start, end);
      var localOffset = mapOffset(sourceSlice, textValue(block), sourceOffset - start);
      return rectForPosition(block, localOffset);
    }

    function schedule() {
      if (frame !== null) return;
      frame = requestAnimationFrame(function() { frame = null; render(); });
    }

    function render() {
      layer.replaceChildren();
      users.forEach(function(user) {
        var rect = rectForUser(user);
        if (!rect) return;
        var cursor = document.createElement("div");
        cursor.className = "wmd-presence-cursor";
        cursor.style.left = rect.left + "px";
        cursor.style.top = rect.top + "px";
        cursor.style.height = Math.max(14, rect.height) + "px";
        cursor.style.setProperty("--wmd-presence-color", user.color || "#b9483c");
        var label = document.createElement("span");
        label.textContent = user.name || "Collaborator";
        cursor.append(label);
        layer.append(cursor);
      });
    }

    window.addEventListener("message", function(event) {
      var data = event.data || {};
      if (data.channel !== "wmd-studio-cursor-overlay") return;
      users = Array.isArray(data.users) ? data.users : [];
      source = String(data.source || "");
      schedule();
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("selectionchange", schedule);
    if (main) new MutationObserver(schedule).observe(main, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  function installIframeCursorBridge() {
    const descriptor = Object.getOwnPropertyDescriptor(root.HTMLIFrameElement.prototype, "srcdoc");
    if (!descriptor || !descriptor.set || descriptor.set.__wmdCursorWrapped) return;
    const frameStyle = "<style>.wmd-presence-layer{position:fixed;inset:0;z-index:2147483646;overflow:hidden;pointer-events:none}.wmd-presence-cursor{position:fixed;width:2px;background:var(--wmd-presence-color,#b9483c);pointer-events:none}.wmd-presence-cursor>span{position:absolute;left:-2px;bottom:100%;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 5px;border-radius:4px;color:#fff;background:var(--wmd-presence-color,#b9483c);font:600 10px/1.2 Arial,sans-serif}</style>";
    const frameScript = "<script>(" + iframeCursorRuntime.toString() + ")();<\/script>";
    const replacement = Object.assign({}, descriptor, {
      set: function(value) {
        let html = String(value || "");
        if (html.includes("wmd-studio-canvas") && !html.includes("wmd-presence-layer")) html = html.replace("</body>", frameStyle + frameScript + "</body>");
        descriptor.set.call(this, html);
      },
    });
    replacement.set.__wmdCursorWrapped = true;
    Object.defineProperty(root.HTMLIFrameElement.prototype, "srcdoc", replacement);
  }

  function instrumentSocket(socket) {
    sockets.add(socket);
    const nativeSend = socket.send.bind(socket);
    const outstanding = new Map();
    let delayedSelection = null;
    let flushTimer = null;

    function flushSelectionSoon() {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        if (!delayedSelection || outstanding.size || socket.readyState !== NativeWebSocket.OPEN) return;
        nativeSend(JSON.stringify(delayedSelection));
        delayedSelection = null;
      }, 0);
    }

    socket.send = function(payload) {
      let message = null;
      try { message = JSON.parse(payload); } catch (_) {}
      if (message && message.type === "join") clientId = String(message.clientId || clientId);
      if (message && message.type === "operation") outstanding.set(String(message.clientOperationId || ""), message.operation);
      if (message && message.type === "selection" && message.mode === "wmd" && outstanding.size) {
        delayedSelection = Object.assign({}, message);
        return;
      }
      nativeSend(payload);
    };

    socket.addEventListener("message", (event) => {
      let message = null;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.type === "document") {
        serverSource = String(message.document && message.document.source || "");
        outstanding.clear();
        if (delayedSelection) delayedSelection.baseRevision = Number(message.document && message.document.revision) || 0;
      } else if (message.type === "presence") {
        users = Array.isArray(message.users) ? message.users : [];
      } else if (message.type === "selection") {
        updateUser(message.user);
      } else if (message.type === "operation") {
        transformTrackedSelections(message.operation, message.clientId);
        try { serverSource = sync.applyOperation(serverSource, message.operation); } catch (_) {}
        if (delayedSelection && Number(message.revision) > Number(delayedSelection.baseRevision || 0)) {
          const affinity = message.clientId === clientId ? "after" : "before";
          const mapped = sync.mapSelectionThroughOperations(delayedSelection, [message.operation], affinity);
          delayedSelection.start = mapped.start;
          delayedSelection.end = mapped.end;
          delayedSelection.baseRevision = Number(message.revision) || delayedSelection.baseRevision;
        }
        if (message.clientId === clientId) outstanding.delete(String(message.clientOperationId || ""));
        flushSelectionSoon();
      } else if (message.type === "resync") {
        serverSource = String(message.document && message.document.source || serverSource);
        outstanding.clear();
        delayedSelection = null;
      }
      scheduleRender();
    });
    socket.addEventListener("close", () => sockets.delete(socket));
    return socket;
  }

  function ObservedWebSocket(url, protocols) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    return instrumentSocket(socket);
  }
  ObservedWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket);
  root.WebSocket = ObservedWebSocket;

  installIframeCursorBridge();

  function setupDomObservers() {
    const editor = document.querySelector("#editor");
    const preview = document.querySelector("#preview");
    if (editor) {
      editor.addEventListener("input", scheduleRender);
      editor.addEventListener("scroll", scheduleRender, { passive: true });
    }
    if (preview) preview.addEventListener("load", scheduleRender);
    document.querySelectorAll("#wmdModeButton,#documentModeButton").forEach((button) => button.addEventListener("click", scheduleRender));
    root.addEventListener("resize", scheduleRender);
    root.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.channel !== "wmd-studio-canvas") return;
      if (typeof data.text === "string") canvasText = data.text;
      scheduleRender();
    });
    scheduleRender();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupDomObservers, { once: true });
  else setupDomObservers();
})(typeof globalThis !== "undefined" ? globalThis : this);
