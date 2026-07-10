(() => {
  "use strict";

  const editor = document.querySelector("#editor");
  const preview = document.querySelector("#preview");
  const documentList = document.querySelector("#documentList");
  const documentName = document.querySelector("#documentName");
  const connectionStatus = document.querySelector("#connectionStatus");
  const saveStatus = document.querySelector("#saveStatus");
  const previewState = document.querySelector("#previewState");
  const warningList = document.querySelector("#warningList");
  const presence = document.querySelector("#presence");
  const importInput = document.querySelector("#importInput");
  const workspace = document.querySelector(".workspace");
  const toast = document.querySelector("#toast");
  const randomColor = ["#3f7f6b", "#b75b4a", "#486f9b", "#a47732", "#765899"][Math.floor(Math.random() * 5)];
  const clientId = crypto.randomUUID();
  const userName = sessionStorage.getItem("wmd-studio-name") || `Guest ${Math.floor(100 + Math.random() * 900)}`;
  sessionStorage.setItem("wmd-studio-name", userName);
  let documentId = normalizeDocumentId(new URLSearchParams(location.search).get("doc") || "untitled");
  let socket;
  let reconnectTimer;
  let revision = 0;
  let serverText = "";
  let localText = "";
  let pending = [];
  let inFlight = null;
  let compileTimer;
  let selectionTimer;
  let newestCompileRequest = 0;
  let documentReady = false;

  function normalizeDocumentId(value) {
    const normalized = String(value || "untitled")
      .toLowerCase()
      .trim()
      .replace(/\.[^./\\]+$/, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : "untitled";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
  }

  function documentTitle(source, fallback) {
    const match = source.match(/^@title\s+(.+)$/m);
    return (match && match[1].trim()) || fallback.replace(/[-_]+/g, " ");
  }

  function toastMessage(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastMessage.timer);
    toastMessage.timer = setTimeout(() => toast.classList.remove("visible"), 2400);
  }

  function appendPart(target, part) {
    if (part === 0 || part === "") return;
    const previous = target[target.length - 1];
    if (typeof part === "number" && typeof previous === "number" && Math.sign(part) === Math.sign(previous)) {
      target[target.length - 1] += part;
    } else if (typeof part === "string" && typeof previous === "string") {
      target[target.length - 1] += part;
    } else {
      target.push(part);
    }
  }

  function applyOperation(source, operation) {
    let sourceIndex = 0;
    let output = "";
    for (const part of operation.ops) {
      if (typeof part === "string") output += part;
      else if (part > 0) {
        output += source.slice(sourceIndex, sourceIndex + part);
        sourceIndex += part;
      } else sourceIndex += -part;
    }
    if (sourceIndex !== source.length) throw new Error("The collaboration state needs to resync.");
    return output;
  }

  function consumePart(part, length) {
    if (typeof part === "string") return part.slice(length);
    return part > 0 ? part - length : part + length;
  }

  // Returns two operations that preserve both people's edits after a collision.
  function transformOperations(left, right) {
    const leftParts = left.ops.slice();
    const rightParts = right.ops.slice();
    let leftPart = leftParts.shift();
    let rightPart = rightParts.shift();
    const leftPrime = [];
    const rightPrime = [];

    while (leftPart !== undefined || rightPart !== undefined) {
      if (typeof leftPart === "string") {
        appendPart(leftPrime, leftPart);
        appendPart(rightPrime, leftPart.length);
        leftPart = leftParts.shift();
        continue;
      }
      if (typeof rightPart === "string") {
        appendPart(leftPrime, rightPart.length);
        appendPart(rightPrime, rightPart);
        rightPart = rightParts.shift();
        continue;
      }
      if (leftPart === undefined || rightPart === undefined) throw new Error("Incompatible collaboration operations.");
      const length = Math.min(Math.abs(leftPart), Math.abs(rightPart));
      if (leftPart > 0 && rightPart > 0) {
        appendPart(leftPrime, length);
        appendPart(rightPrime, length);
      } else if (leftPart < 0 && rightPart > 0) {
        appendPart(leftPrime, -length);
      } else if (leftPart > 0 && rightPart < 0) {
        appendPart(rightPrime, -length);
      }
      leftPart = consumePart(leftPart, length);
      rightPart = consumePart(rightPart, length);
      if (leftPart === 0) leftPart = leftParts.shift();
      if (rightPart === 0) rightPart = rightParts.shift();
    }
    return [{ ops: leftPrime }, { ops: rightPrime }];
  }

  function operationFromDiff(before, after) {
    if (before === after) return null;
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) suffix += 1;

    const operations = [];
    appendPart(operations, prefix);
    appendPart(operations, -(before.length - prefix - suffix));
    appendPart(operations, after.slice(prefix, after.length - suffix));
    appendPart(operations, suffix);
    return { ops: operations };
  }

  function transformIndex(index, operation) {
    let sourceIndex = 0;
    let targetIndex = 0;
    for (const part of operation.ops) {
      if (typeof part === "string") {
        targetIndex += part.length;
      } else if (part > 0) {
        if (index <= sourceIndex + part) return targetIndex + index - sourceIndex;
        sourceIndex += part;
        targetIndex += part;
      } else {
        const deleted = -part;
        if (index <= sourceIndex + deleted) return targetIndex;
        sourceIndex += deleted;
      }
    }
    return targetIndex;
  }

  function updateDocumentIdentity() {
    documentName.textContent = documentTitle(localText, documentId);
    document.title = `${documentName.textContent} | WMD Studio`;
  }

  function setConnectionState(state, label) {
    connectionStatus.textContent = label;
    connectionStatus.className = `connection-status ${state}`;
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    setConnectionState("", "Connecting");
    socket = new WebSocket(`${protocol}//${location.host}/collaboration`);
    socket.addEventListener("open", () => {
      setConnectionState("connected", "Live");
      send({ type: "join", documentId, name: userName, color: randomColor, clientId });
    });
    socket.addEventListener("message", (event) => {
      try { handleMessage(JSON.parse(event.data)); } catch (error) { toastMessage(error.message); requestResync(); }
    });
    socket.addEventListener("close", () => {
      setConnectionState("problem", "Reconnecting");
      reconnectTimer = setTimeout(connect, 1200);
    });
    socket.addEventListener("error", () => setConnectionState("problem", "Offline"));
  }

  function requestResync() {
    pending = [];
    inFlight = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      send({ type: "join", documentId, name: userName, color: randomColor, clientId });
    }
  }

  function handleMessage(message) {
    if (message.type === "document") {
      documentReady = true;
      revision = message.document.revision;
      serverText = message.document.source;
      localText = serverText;
      pending = [];
      inFlight = null;
      editor.value = localText;
      updateDocumentIdentity();
      saveStatus.textContent = "All changes saved";
      scheduleCompile(true);
      refreshDocuments();
      return;
    }

    if (message.type === "operation") {
      serverText = applyOperation(serverText, message.operation);
      revision = message.revision;
      if (message.clientId === clientId && inFlight && message.clientOperationId === inFlight.id) {
        inFlight = null;
        saveStatus.textContent = pending.length ? "Saving changes..." : "All changes saved";
        flushOperations();
      } else {
        const selectionStart = editor.selectionStart;
        const selectionEnd = editor.selectionEnd;
        let remoteOperation = message.operation;
        if (inFlight) {
          [inFlight.operation, remoteOperation] = transformOperations(inFlight.operation, remoteOperation);
        }
        pending = pending.map((entry) => {
          const [localOperation, nextRemoteOperation] = transformOperations(entry.operation, remoteOperation);
          remoteOperation = nextRemoteOperation;
          return { ...entry, operation: localOperation };
        });
        localText = applyOperation(localText, remoteOperation);
        editor.value = localText;
        editor.setSelectionRange(transformIndex(selectionStart, remoteOperation), transformIndex(selectionEnd, remoteOperation));
        saveStatus.textContent = "Updated by a collaborator";
        scheduleCompile();
      }
      updateDocumentIdentity();
      return;
    }

    if (message.type === "presence") {
      renderPresence(message.users);
      return;
    }

    if (message.type === "resync") {
      serverText = message.document.source;
      localText = serverText;
      revision = message.document.revision;
      pending = [];
      inFlight = null;
      editor.value = localText;
      toastMessage("The document was refreshed from the shared version.");
      scheduleCompile(true);
      return;
    }

    if (message.type === "error") toastMessage(message.message);
  }

  function flushOperations() {
    if (!documentReady || inFlight || !pending.length || !socket || socket.readyState !== WebSocket.OPEN) return;
    inFlight = pending.shift();
    send({
      type: "operation",
      baseRevision: revision,
      clientOperationId: inFlight.id,
      operation: inFlight.operation,
    });
  }

  function scheduleCompile(immediate = false) {
    clearTimeout(compileTimer);
    compileTimer = setTimeout(compilePreview, immediate ? 0 : 220);
  }

  async function compilePreview() {
    if (!documentReady) return;
    const requestId = ++newestCompileRequest;
    previewState.textContent = "Compiling";
    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: localText }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Compilation failed.");
      if (requestId !== newestCompileRequest) return;
      preview.srcdoc = result.html;
      renderWarnings(result.warnings || []);
      previewState.textContent = result.warnings && result.warnings.length ? "Warnings" : "Up to date";
    } catch (error) {
      if (requestId !== newestCompileRequest) return;
      previewState.textContent = "Error";
      preview.srcdoc = `<!doctype html><body style="font-family: sans-serif; padding: 2rem; color: #8f3029"><h1>Could not compile this document</h1><pre>${escapeHtml(error.message)}</pre></body>`;
      renderWarnings([error.message]);
    }
  }

  function renderWarnings(warnings) {
    warningList.hidden = warnings.length === 0;
    warningList.innerHTML = warnings.length ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "";
  }

  function renderPresence(users) {
    presence.replaceChildren();
    users.slice(0, 8).forEach((user) => {
      const avatar = document.querySelector("#userTemplate").content.firstElementChild.cloneNode(true);
      const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      avatar.textContent = initials || "G";
      avatar.title = user.id === clientId ? `${user.name} (you)` : `${user.name} is editing`;
      avatar.style.background = user.color || "#3f7f6b";
      presence.append(avatar);
    });
  }

  async function refreshDocuments() {
    try {
      const response = await fetch("/api/documents");
      const { documents } = await response.json();
      documentList.replaceChildren();
      documents.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.title;
        button.title = item.id;
        if (item.id === documentId) button.classList.add("active");
        button.addEventListener("click", () => openDocument(item.id));
        documentList.append(button);
      });
    } catch (_) {
      // Collaboration still works if the document list briefly cannot refresh.
    }
  }

  function openDocument(nextId) {
    const normalizedId = normalizeDocumentId(nextId);
    if (normalizedId === documentId) return;
    documentId = normalizedId;
    documentReady = false;
    pending = [];
    inFlight = null;
    const url = new URL(location.href);
    url.searchParams.set("doc", documentId);
    history.pushState({}, "", url);
    editor.value = "";
    documentName.textContent = "Loading...";
    saveStatus.textContent = "Loading shared document...";
    send({ type: "join", documentId, name: userName, color: randomColor, clientId });
  }

  function replaceSelection(before, selected, after, selectionOffset = 0) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const replacement = `${before}${selected}${after}`;
    editor.setRangeText(replacement, start, end, "end");
    const cursor = start + before.length + selected.length + selectionOffset;
    editor.setSelectionRange(cursor, cursor);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
  }

  function wrapSelection(marker) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) {
      editor.setRangeText(`${marker}text${marker}`, start, end, "end");
      editor.setSelectionRange(start + marker.length, start + marker.length + 4);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.focus();
      return;
    }
    replaceSelection(marker, editor.value.slice(start, end), marker);
  }

  function insertTemplate(type) {
    const templates = {
      link: ["[link text](https://example.com)", 1, 10],
      heading: ["\n## New heading\n", 4, 15],
      list: ["\n- List item\n", 3, 12],
      callout: ["\n!note A helpful note\nWrite the note here.\n!end\n", 7, 20],
      tab: ["\n---\n\n@tab New tab\n@title New tab\n\n# New tab\n", 10, 17],
    };
    const [text, startOffset, endOffset] = templates[type];
    const start = editor.selectionStart;
    editor.setRangeText(text, start, editor.selectionEnd, "end");
    editor.setSelectionRange(start + startOffset, start + endOffset);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
  }

  function handleSmartDelimiter(event) {
    if (!["*", "_", "=", "`"].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return false;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = editor.value[start - 1] || "";
    const after = editor.value[end] || "";
    if (start !== end) {
      event.preventDefault();
      replaceSelection(event.key, editor.value.slice(start, end), event.key);
      return true;
    }
    if (/\w/.test(before) || /\w/.test(after)) return false;
    event.preventDefault();
    replaceSelection(event.key, "", event.key);
    return true;
  }

  function downloadDocument() {
    const blob = new Blob([localText], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${documentId}.wmd`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  async function importDocument(file) {
    if (!file) return;
    const id = normalizeDocumentId(file.name);
    try {
      let source;
      if (/\.(md|markdown|wmd)$/i.test(file.name)) {
        source = await file.text();
      } else if (/\.docx$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        const response = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, data: btoa(binary) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not import this DOCX file.");
        source = result.source;
      } else {
        throw new Error("Choose a .md, .wmd, or .docx file.");
      }
      openDocument(id);
      const waitForDocument = () => {
        if (!documentReady) return setTimeout(waitForDocument, 30);
        const operation = operationFromDiff(localText, source);
        if (!operation) return;
        localText = source;
        editor.value = source;
        pending.push({ id: crypto.randomUUID(), operation });
        saveStatus.textContent = "Importing document...";
        updateDocumentIdentity();
        flushOperations();
        scheduleCompile(true);
      };
      waitForDocument();
      toastMessage(`Imported ${file.name}`);
    } catch (error) {
      toastMessage(error.message);
    } finally {
      importInput.value = "";
    }
  }

  editor.addEventListener("input", () => {
    if (!documentReady) return;
    const nextText = editor.value;
    const operation = operationFromDiff(localText, nextText);
    if (!operation) return;
    localText = nextText;
    pending.push({ id: crypto.randomUUID(), operation });
    saveStatus.textContent = "Saving changes...";
    updateDocumentIdentity();
    flushOperations();
    scheduleCompile();
  });

  editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "b") {
      event.preventDefault();
      wrapSelection("*");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "i") {
      event.preventDefault();
      wrapSelection("_");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "`") {
      event.preventDefault();
      wrapSelection("`");
      return;
    }
    handleSmartDelimiter(event);
  });

  editor.addEventListener("select", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => send({ type: "selection", start: editor.selectionStart, end: editor.selectionEnd }), 90);
  });
  editor.addEventListener("keyup", () => editor.dispatchEvent(new Event("select")));
  editor.addEventListener("click", () => editor.dispatchEvent(new Event("select")));

  document.querySelectorAll("[data-wrap]").forEach((button) => button.addEventListener("click", () => wrapSelection(button.dataset.wrap)));
  document.querySelectorAll("[data-insert]").forEach((button) => button.addEventListener("click", () => insertTemplate(button.dataset.insert)));
  document.querySelector("#newDocumentButton").addEventListener("click", () => {
    const name = window.prompt("Name your new document", "team-notes");
    if (name) openDocument(name);
  });
  document.querySelector("#importButton").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => importDocument(importInput.files[0]));
  document.querySelector("#downloadButton").addEventListener("click", downloadDocument);
  document.querySelector("#shareButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toastMessage("Share link copied. Anyone with it can edit this document.");
    } catch (_) {
      window.prompt("Copy this link to collaborate", location.href);
    }
  });
  document.querySelector("#homeButton").addEventListener("click", () => document.querySelector("#documentSidebar").scrollIntoView({ behavior: "smooth" }));
  document.querySelector("#mobilePreviewButton").addEventListener("click", () => {
    workspace.classList.toggle("show-preview");
    document.querySelector("#mobilePreviewButton").textContent = workspace.classList.contains("show-preview") ? "Edit" : "Preview";
  });
  document.querySelector("#mobileEditButton").addEventListener("click", () => {
    workspace.classList.remove("show-preview");
  });
  window.addEventListener("popstate", () => openDocument(new URLSearchParams(location.search).get("doc") || "untitled"));

  refreshDocuments();
  connect();
})();
