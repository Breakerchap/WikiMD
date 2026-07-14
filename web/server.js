#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { compile, compileIncremental } = require("../wmd-compiler");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4313;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_SOCKET_BUFFER_BYTES = MAX_BODY_BYTES + 32;
const HISTORY_LIMIT = 1_000;
const MAX_HISTORY_BYTES = 2 * 1024 * 1024;
const WEB_ROOT = __dirname;
const PUBLIC_ROOT = path.join(WEB_ROOT, "public");
const DATA_ROOT = path.join(WEB_ROOT, "data");
const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEFAULT_DOCUMENT_SOURCE = [
  "@config",
  "Normal Text: {wmd-formatting: ; keybind: ctrl+shift+0; size: 16px; font: arial; default: true};",
  "Title: {wmd-formatting: @title; keybind: ctrl+shift+`; size: 45px; font: arial};",
  "Heading 1: {wmd-formatting: #; keybind: ctrl+shift+1; size: 38px; font: arial; bold: true};",
  "Heading 2: {wmd-formatting: ##; keybind: ctrl+shift+2; size: 28px; font: arial; bold: true};",
  "Heading 3: {wmd-formatting: ###; keybind: ctrl+shift+3; size: 22px; font: arial; bold: true};",
  "Heading 4: {wmd-formatting: ####; keybind: ctrl+shift+4; size: 18px; font: arial; bold: false; italic: true};",
  "@endconfig",
  "",
  "@tab Test",
  "@title Home",
  "",
  "# Home",
  "",
].join("\n");
const clients = new Set();
const documents = new Map();
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function normalizeDocumentId(value) {
  const raw = String(value || "").toLowerCase().trim();
  const normalized = raw
    .replace(/\.[^./\\]+$/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return DOCUMENT_ID_PATTERN.test(normalized) ? normalized : "untitled";
}

function normalizeColor(value) {
  const color = String(value || "");
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#3f7f6b";
}

function titleFromSource(source, fallback) {
  const match = String(source || "").match(/^@title\s+(.+)$/m);
  return (match && match[1].trim()) || fallback.replace(/[-_]+/g, " ");
}

function createStarterDocument(id) {
  void id;
  return DEFAULT_DOCUMENT_SOURCE;
}

function documentFilePath(id) {
  return path.join(DATA_ROOT, `${normalizeDocumentId(id)}.wmd`);
}

function readDocument(id) {
  const normalizedId = normalizeDocumentId(id);
  const existing = documents.get(normalizedId);
  if (existing) return existing;

  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const filePath = documentFilePath(normalizedId);
  const source = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : createStarterDocument(normalizedId);
  const document = {
    id: normalizedId,
    source,
    revision: 0,
    history: [],
    historyBytes: 0,
    updatedAt: new Date().toISOString(),
    saveTimer: null,
  };

  documents.set(normalizedId, document);
  return document;
}

function persistDocument(document) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const targetPath = documentFilePath(document.id);
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, document.source, "utf8");
  fs.renameSync(temporaryPath, targetPath);
}

function flushDocument(document) {
  clearTimeout(document.saveTimer);
  document.saveTimer = null;
  persistDocument(document);
}

function scheduleSave(document) {
  clearTimeout(document.saveTimer);
  document.saveTimer = setTimeout(() => {
    document.saveTimer = null;
    try {
      persistDocument(document);
    } catch (error) {
      // Keep the in-memory document available so a later edit can retry the save.
      console.error(`Could not save ${document.id}.wmd: ${error.message}`);
    }
  }, 350);
}

function releaseDocumentIfUnused(documentId) {
  if (!documentId || documentClients(documentId).length) return;
  const document = documents.get(documentId);
  if (!document) return;
  try {
    flushDocument(document);
    documents.delete(documentId);
  } catch (error) {
    // Do not discard a document if its final disk write did not succeed.
    console.error(`Could not release ${document.id}.wmd: ${error.message}`);
  }
}

function normalizeOperations(operations) {
  const result = [];

  for (const operation of operations || []) {
    if (typeof operation === "number") {
      if (!Number.isSafeInteger(operation) || operation === 0) {
        throw new Error("Text operations can only contain non-zero integer counts.");
      }

      const previous = result[result.length - 1];
      if (typeof previous === "number" && Math.sign(previous) === Math.sign(operation)) {
        result[result.length - 1] = previous + operation;
      } else {
        result.push(operation);
      }
      continue;
    }

    if (typeof operation === "string") {
      if (!operation) continue;
      const previous = result[result.length - 1];
      if (typeof previous === "string") {
        result[result.length - 1] = previous + operation;
      } else {
        result.push(operation);
      }
      continue;
    }

    throw new Error("Text operations must contain strings or integer counts.");
  }

  return result;
}

function applyOperation(source, operation) {
  const operations = normalizeOperations(operation && operation.ops);
  let sourceIndex = 0;
  let output = "";

  for (const part of operations) {
    if (typeof part === "string") {
      output += part;
    } else if (part > 0) {
      if (sourceIndex + part > source.length) {
        throw new Error("Text operation retains beyond the document end.");
      }
      output += source.slice(sourceIndex, sourceIndex + part);
      sourceIndex += part;
    } else {
      const deletedLength = -part;
      if (sourceIndex + deletedLength > source.length) {
        throw new Error("Text operation deletes beyond the document end.");
      }
      sourceIndex += deletedLength;
    }
  }

  if (sourceIndex !== source.length) {
    throw new Error("Text operation does not cover the complete document.");
  }

  return output;
}

function mapOffsetThroughOperation(offset, operation, affinity = "before") {
  const sourceOffset = Math.max(0, Number(offset) || 0);
  let consumed = 0;
  let produced = 0;

  for (const part of normalizeOperations(operation && operation.ops)) {
    if (typeof part === "string") {
      if (sourceOffset === consumed && affinity !== "after") return produced;
      produced += part.length;
      continue;
    }
    if (part > 0) {
      if (sourceOffset < consumed + part) return produced + Math.max(0, sourceOffset - consumed);
      consumed += part;
      produced += part;
      if (sourceOffset === consumed && affinity !== "after") return produced;
      continue;
    }
    const removed = -part;
    if (sourceOffset < consumed + removed) return produced;
    consumed += removed;
    if (sourceOffset === consumed && affinity !== "after") return produced;
  }

  return produced + Math.max(0, sourceOffset - consumed);
}

function mapSelectionThroughOperation(selection, operation, affinity = "before") {
  const start = Math.max(0, Number(selection && selection.start) || 0);
  const end = Math.max(0, Number(selection && selection.end) || 0);
  const collapsed = start === end;
  return {
    start: mapOffsetThroughOperation(start, operation, collapsed ? affinity : "before"),
    end: mapOffsetThroughOperation(end, operation, collapsed ? affinity : "after"),
  };
}

function mapSelectionThroughHistory(selection, baseRevision, history) {
  let mapped = { ...selection };
  for (const entry of history || []) {
    if (entry.revision > baseRevision) mapped = mapSelectionThroughOperation(mapped, entry.operation);
  }
  return mapped;
}

function appendOperation(target, part) {
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

function consumePart(part, length) {
  if (typeof part === "string") return part.slice(length);
  if (part > 0) return part - length;
  return part + length;
}

function transformOperations(left, right) {
  const leftParts = normalizeOperations(left && left.ops).slice();
  const rightParts = normalizeOperations(right && right.ops).slice();
  let leftPart = leftParts.shift();
  let rightPart = rightParts.shift();
  const leftPrime = [];
  const rightPrime = [];

  while (leftPart !== undefined || rightPart !== undefined) {
    // Deterministic insertion ordering means all connected clients converge.
    if (typeof leftPart === "string") {
      appendOperation(leftPrime, leftPart);
      appendOperation(rightPrime, leftPart.length);
      leftPart = leftParts.shift();
      continue;
    }

    if (typeof rightPart === "string") {
      appendOperation(leftPrime, rightPart.length);
      appendOperation(rightPrime, rightPart);
      rightPart = rightParts.shift();
      continue;
    }

    if (leftPart === undefined || rightPart === undefined) {
      throw new Error("Concurrent text operations have incompatible lengths.");
    }

    const length = Math.min(Math.abs(leftPart), Math.abs(rightPart));

    if (leftPart > 0 && rightPart > 0) {
      appendOperation(leftPrime, length);
      appendOperation(rightPrime, length);
    } else if (leftPart < 0 && rightPart < 0) {
      // Both sides removed the same original content.
    } else if (leftPart < 0) {
      appendOperation(leftPrime, -length);
    } else {
      appendOperation(rightPrime, -length);
    }

    leftPart = consumePart(leftPart, length);
    rightPart = consumePart(rightPart, length);
    if (leftPart === 0) leftPart = leftParts.shift();
    if (rightPart === 0) rightPart = rightParts.shift();
  }

  return [{ ops: leftPrime }, { ops: rightPrime }];
}

function transformAgainstHistory(operation, baseRevision, history) {
  let transformed = { ops: normalizeOperations(operation && operation.ops) };
  for (const entry of history) {
    if (entry.revision > baseRevision) {
      [transformed] = transformOperations(transformed, entry.operation);
    }
  }
  return transformed;
}

function operationByteLength(operation) {
  return Buffer.byteLength(JSON.stringify(operation), "utf8");
}

function sendSocketMessage(client, message) {
  if (!client.socket.writable) return;
  const payload = Buffer.from(JSON.stringify(message));
  const header = [];

  if (payload.length < 126) {
    header.push(0x81, payload.length);
  } else if (payload.length <= 0xffff) {
    header.push(0x81, 126, payload.length >> 8, payload.length & 0xff);
  } else {
    const length = BigInt(payload.length);
    header.push(0x81, 127);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      header.push(Number((length >> shift) & 0xffn));
    }
  }

  client.socket.write(Buffer.concat([Buffer.from(header), payload]));
}

function documentClients(documentId) {
  return [...clients].filter((client) => client.documentId === documentId);
}

function getPresence(documentId) {
  return documentClients(documentId).map((client) => ({
    id: client.clientId || client.id,
    name: client.name,
    color: client.color,
    selection: client.selection || null,
  }));
}

function broadcast(documentId, message) {
  for (const client of documentClients(documentId)) {
    sendSocketMessage(client, message);
  }
}

function broadcastPresence(documentId) {
  broadcast(documentId, { type: "presence", users: getPresence(documentId) });
}

function broadcastSelection(client) {
  broadcast(client.documentId, {
    type: "selection",
    user: {
      id: client.clientId || client.id,
      name: client.name,
      color: client.color,
      selection: client.selection || null,
    },
  });
}

function handleClientMessage(client, message) {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "join") {
    const previousDocumentId = client.documentId;
    const document = readDocument(message.documentId);
    client.documentId = document.id;
    client.name = String(message.name || "Guest").slice(0, 36) || "Guest";
    client.color = normalizeColor(message.color);
    client.clientId = String(message.clientId || client.id).slice(0, 100);
    client.selection = null;
    sendSocketMessage(client, {
      type: "document",
      document: {
        id: document.id,
        source: document.source,
        revision: document.revision,
        updatedAt: document.updatedAt,
      },
    });
    if (previousDocumentId && previousDocumentId !== document.id) {
      broadcastPresence(previousDocumentId);
      releaseDocumentIfUnused(previousDocumentId);
    }
    broadcastPresence(document.id);
    return;
  }

  if (!client.documentId) return;

  if (message.type === "operation") {
    const document = readDocument(client.documentId);
    const baseRevision = Number(message.baseRevision);
    const earliestRevision = document.history[0] ? document.history[0].revision - 1 : document.revision;

    if (!Number.isInteger(baseRevision) || baseRevision < earliestRevision || baseRevision > document.revision) {
      sendSocketMessage(client, {
        type: "resync",
        document: { source: document.source, revision: document.revision },
      });
      return;
    }

    try {
      const operation = transformAgainstHistory(message.operation, baseRevision, document.history);
      const origin = ["wmd", "document", "history"].includes(message.origin) ? message.origin : "remote";
      const nextSource = applyOperation(document.source, operation);
      if (Buffer.byteLength(nextSource, "utf8") > MAX_BODY_BYTES) {
        throw new Error("Documents cannot exceed 12 MB.");
      }
      document.source = nextSource;
      document.revision += 1;
      document.updatedAt = new Date().toISOString();
      // Source-mode cursors use WMD offsets, so keep them attached to their text as edits arrive.
      for (const collaborator of documentClients(document.id)) {
        if (!collaborator.selection || collaborator.selection.mode !== "wmd") continue;
        collaborator.selection = {
          ...collaborator.selection,
          ...mapSelectionThroughOperation(collaborator.selection, operation, collaborator === client ? "after" : "before"),
        };
      }
      const historyEntry = { revision: document.revision, operation, origin, bytes: operationByteLength(operation) };
      document.history.push(historyEntry);
      document.historyBytes += historyEntry.bytes;
      while (document.history.length > HISTORY_LIMIT || document.historyBytes > MAX_HISTORY_BYTES) {
        const expired = document.history.shift();
        document.historyBytes -= expired.bytes;
      }
      scheduleSave(document);
      broadcast(document.id, {
        type: "operation",
        clientId: client.clientId || client.id,
        clientOperationId: String(message.clientOperationId || ""),
        operation,
        origin,
        revision: document.revision,
      });
    } catch (error) {
      sendSocketMessage(client, { type: "error", message: error.message });
    }
    return;
  }

  if (message.type === "selection") {
    const start = Number(message.start);
    const end = Number(message.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) return;
    const mode = message.mode === "canvas" ? "canvas" : "wmd";
    const document = mode === "wmd" ? readDocument(client.documentId) : null;
    let selection = { start, end };
    if (document && Number.isInteger(Number(message.baseRevision))) {
      const baseRevision = Number(message.baseRevision);
      const earliestRevision = document.history[0] ? document.history[0].revision - 1 : document.revision;
      if (baseRevision < earliestRevision || baseRevision > document.revision) return;
      selection = mapSelectionThroughHistory(selection, baseRevision, document.history);
    }
    client.selection = {
      start: document ? Math.min(selection.start, document.source.length) : start,
      end: document ? Math.min(selection.end, document.source.length) : end,
      mode,
    };
    broadcastSelection(client);
    return;
  }

  if (message.type === "profile") {
    client.name = String(message.name || client.name).slice(0, 36) || "Guest";
    client.color = normalizeColor(message.color || client.color);
    broadcastPresence(client.documentId);
  }
}

function parseSocketFrames(client, chunk) {
  if (client.buffer.length + chunk.length > MAX_SOCKET_BUFFER_BYTES) {
    client.socket.destroy();
    return;
  }
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    if (!masked) {
      client.socket.destroy();
      return;
    }
    let offset = 2;
    let payloadLength = second & 0x7f;

    if (payloadLength === 126) {
      if (client.buffer.length < offset + 2) return;
      payloadLength = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (client.buffer.length < offset + 8) return;
      const longLength = client.buffer.readBigUInt64BE(offset);
      if (longLength > BigInt(MAX_BODY_BYTES)) {
        client.socket.destroy();
        return;
      }
      payloadLength = Number(longLength);
      offset += 8;
    }

    if (payloadLength > MAX_BODY_BYTES) {
      client.socket.destroy();
      return;
    }

    const frameLength = offset + (masked ? 4 : 0) + payloadLength;
    if (client.buffer.length < frameLength) return;

    let payloadOffset = offset;
    let mask;
    if (masked) {
      mask = client.buffer.subarray(payloadOffset, payloadOffset + 4);
      payloadOffset += 4;
    }
    const payload = Buffer.from(client.buffer.subarray(payloadOffset, payloadOffset + payloadLength));
    client.buffer = client.buffer.subarray(frameLength);
    if (masked) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) {
      client.socket.end();
      return;
    }
    if (opcode === 0x9) {
      client.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      continue;
    }
    if (opcode !== 0x1) continue;

    try {
      handleClientMessage(client, JSON.parse(payload.toString("utf8")));
    } catch (error) {
      sendSocketMessage(client, { type: "error", message: "Could not read a collaboration message." });
    }
  }
}

function acceptWebSocket(request, socket) {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));

  const client = {
    id: crypto.randomUUID(),
    clientId: null,
    socket,
    documentId: null,
    name: "Guest",
    color: "#3f7f6b",
    selection: null,
    buffer: Buffer.alloc(0),
  };
  clients.add(client);
  socket.on("data", (chunk) => parseSocketFrames(client, chunk));
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    clients.delete(client);
    if (client.documentId) {
      broadcastPresence(client.documentId);
      releaseDocumentIfUnused(client.documentId);
    }
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extension] || "application/octet-stream";
}

function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`) || !fs.existsSync(filePath)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  response.writeHead(200, {
    ...CORS_HEADERS,
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readZipEntry(buffer, filename) {
  let endOffset = -1;
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset === -1) throw new Error("This is not a valid DOCX archive.");

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (entryName === filename) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid DOCX file entry.");
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const contentStart = localOffset + 30 + localNameLength + localExtraLength;
      const content = buffer.subarray(contentStart, contentStart + compressedSize);
      if (compression === 0) return content;
      if (compression === 8) return zlib.inflateRawSync(content, { maxOutputLength: MAX_BODY_BYTES });
      throw new Error("This DOCX uses an unsupported compression method.");
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("This DOCX file does not contain document text.");
}

function docxToWmd(buffer, title = "Imported document") {
  const documentXml = readZipEntry(buffer, "word/document.xml").toString("utf8");
  const paragraphs = documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
  const lines = [];

  for (const paragraph of paragraphs) {
    const styleMatch = paragraph.match(/<w:pStyle\s+[^>]*w:val="([^"]+)"[^>]*\/?\s*>/);
    const isList = /<w:numPr(?:\s[^>]*)?>/.test(paragraph);
    const runs = paragraph.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
    let content = "";

    for (const run of runs) {
      const text = decodeXml((run.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [])
        .map((part) => part.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g, ""))
        .join(""))
        .replace(/<w:tab\s*\/>/g, "\t")
        .replace(/<w:br\s*\/>/g, "\n");
      if (!text) continue;
      const bold = /<w:b(?:\s[^>]*)?\/>/.test(run);
      const italic = /<w:i(?:\s[^>]*)?\/>/.test(run);
      content += bold && italic ? `*_${text}_*` : bold ? `*${text}*` : italic ? `_${text}_` : text;
    }

    content = content.trim();
    if (!content) continue;
    const heading = styleMatch && styleMatch[1].match(/^Heading([1-6])$/i);
    if (heading) {
      lines.push(`${"#".repeat(Number(heading[1]))} ${content}`);
    } else if (isList) {
      lines.push(`- ${content}`);
    } else {
      lines.push(content);
    }
  }

  const safeTitle = String(title || "Imported document").replace(/\.[^.]+$/, "").trim() || "Imported document";
  return `@tab Home\n@title ${safeTitle}\n\n${lines.join("\n\n") || "# Imported document\n"}\n`;
}

function documentSummaryFromSource(id, source, updatedAt = new Date().toISOString()) {
  return { id, title: titleFromSource(source, id), updatedAt };
}

function listDocuments() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const savedDocuments = fs.readdirSync(DATA_ROOT)
    .filter((fileName) => fileName.endsWith(".wmd"))
    .map((fileName) => {
      const id = fileName.slice(0, -4);
      const filePath = path.join(DATA_ROOT, fileName);
      const source = fs.readFileSync(filePath, "utf8");
      const stats = fs.statSync(filePath);
      return documentSummaryFromSource(id, source, stats.mtime.toISOString());
    });
  const loadedOnly = [...documents.values()]
    .filter((document) => !savedDocuments.some((item) => item.id === document.id))
    .map((document) => documentSummaryFromSource(document.id, document.source, document.updatedAt));

  return [...savedDocuments, ...loadedOnly].sort((left, right) => {
    const updatedOrder = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    return updatedOrder || left.title.localeCompare(right.title);
  });
}

function createDocument(payload = {}) {
  const requestedId = normalizeDocumentId(payload.id || payload.title || "untitled");
  const id = requestedId === "untitled" && (payload.id || payload.title) ? normalizeDocumentId(`${payload.id || payload.title}-${Date.now().toString(36)}`) : requestedId;
  const filePath = documentFilePath(id);
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  if (fs.existsSync(filePath) || documents.has(id)) {
    const error = new Error(`A document called ${id} already exists.`);
    error.statusCode = 409;
    throw error;
  }
  const source = createStarterDocument(id);
  const document = {
    id,
    source,
    revision: 0,
    history: [],
    historyBytes: 0,
    updatedAt: new Date().toISOString(),
    saveTimer: null,
  };
  documents.set(id, document);
  persistDocument(document);
  return documentSummaryFromSource(id, source, document.updatedAt);
}

function deleteDocument(id) {
  const normalizedId = normalizeDocumentId(id);
  if (normalizedId === "untitled") {
    const error = new Error("The fallback untitled document cannot be deleted.");
    error.statusCode = 400;
    throw error;
  }
  if (documentClients(normalizedId).length) {
    const error = new Error("Close this document before deleting it.");
    error.statusCode = 409;
    throw error;
  }
  const document = documents.get(normalizedId);
  if (document) {
    clearTimeout(document.saveTimer);
    documents.delete(normalizedId);
  }
  const filePath = documentFilePath(normalizedId);
  if (!fs.existsSync(filePath)) {
    const error = new Error("Document not found.");
    error.statusCode = 404;
    throw error;
  }
  fs.unlinkSync(filePath);
  return { id: normalizedId };
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || HOST}`);

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/documents") {
      sendJson(response, 200, { documents: listDocuments() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/documents") {
      const payload = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      sendJson(response, 201, { document: createDocument(payload) });
      return;
    }

    const deleteMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    if (request.method === "DELETE" && deleteMatch) {
      sendJson(response, 200, { document: deleteDocument(decodeURIComponent(deleteMatch[1])) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/compile") {
      const payload = JSON.parse((await readRequestBody(request)).toString("utf8"));
      const source = String(payload.source || "");
      const canPatch = Object.prototype.hasOwnProperty.call(payload, "previousSource")
        && payload.operation && Array.isArray(payload.operation.ops);
      const result = canPatch
        ? compileIncremental(String(payload.previousSource || ""), source, payload.operation)
        : { mode: "full", ...compile(source) };
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/import") {
      const payload = JSON.parse((await readRequestBody(request)).toString("utf8"));
      const filename = String(payload.filename || "imported-document");
      const extension = path.extname(filename).toLowerCase();
      const buffer = Buffer.from(String(payload.data || ""), "base64");
      if (extension !== ".docx") throw new Error("Only DOCX imports are sent to the server.");
      sendJson(response, 200, {
        source: docxToWmd(buffer, filename),
        suggestedId: normalizeDocumentId(filename),
      });
      return;
    }

    serveStatic(request, response, url.pathname);
  } catch (error) {
    sendJson(response, Number(error.statusCode) || 400, { error: error.message || "Something went wrong." });
  }
}

function localNetworkUrls(port) {
  const urls = new Set();
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) urls.add(`http://${address.address}:${port}`);
    }
  }
  return [...urls];
}

function startServer(port = DEFAULT_PORT, host = HOST, publicUrl = "") {
  const server = http.createServer(handleRequest);
  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url, `http://${request.headers.host || HOST}`);
    if (url.pathname !== "/collaboration") {
      socket.destroy();
      return;
    }
    acceptWebSocket(request, socket);
  });
  server.listen(port, host, () => {
    console.log(`WMD Web Editor running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    if (host === "0.0.0.0") {
      const urls = localNetworkUrls(port);
      if (urls.length) console.log(`LAN address: ${urls.join(" or ")}`);
    }
    if (publicUrl) console.log(`Public editor URL: ${publicUrl}`);
    console.log("Share a document URL such as /?doc=team-notes to collaborate.");
  });
  return server;
}

function parseOptions(argv) {
  const index = argv.indexOf("--port");
  const candidatePort = index === -1 ? DEFAULT_PORT : Number(argv[index + 1]);
  const port = Number.isInteger(candidatePort) && candidatePort > 0 && candidatePort < 65536
    ? candidatePort
    : DEFAULT_PORT;
  const hostIndex = argv.indexOf("--host");
  const host = hostIndex === -1 ? HOST : String(argv[hostIndex + 1] || HOST);
  const publicUrlIndex = argv.indexOf("--public-url");
  let publicUrl = "";
  if (publicUrlIndex !== -1) {
    try {
      const url = new URL(String(argv[publicUrlIndex + 1] || ""));
      if (/^https?:$/.test(url.protocol)) publicUrl = url.origin;
    } catch (_) {
      // The local server remains usable when an optional display URL is invalid.
    }
  }
  return { host, port, publicUrl };
}

if (require.main === module) {
  const options = parseOptions(process.argv.slice(2));
  const server = startServer(options.port, options.host, options.publicUrl);
  const shutdown = () => {
    for (const document of documents.values()) {
      try {
        flushDocument(document);
      } catch (error) {
        console.error(`Could not save ${document.id}.wmd during shutdown: ${error.message}`);
      }
    }
    for (const client of clients) client.socket.destroy();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = {
  applyOperation,
  createStarterDocument,
  DEFAULT_DOCUMENT_SOURCE,
  docxToWmd,
  normalizeDocumentId,
  parseOptions,
  mapOffsetThroughOperation,
  mapSelectionThroughOperation,
  mapSelectionThroughHistory,
  transformOperations,
};
