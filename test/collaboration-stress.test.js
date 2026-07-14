const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyOperation,
  mapOffsetBackwardThroughOperation,
  mapOffsetThroughOperation,
  mapSelectionBackwardThroughOperations,
  mapSelectionThroughOperations,
  operationForSerializedRange,
  operationFromTextDiff,
  rebaseOperationThroughExternal,
  transformOperations,
} = require("../web/public/editor-sync");
const {
  mapOffsetThroughOperation: serverMapOffset,
  mapSelectionThroughOperation: serverMapSelection,
  mapSelectionThroughHistory,
} = require("../web/server");

function rng(seed) {
  let value = seed >>> 0;
  return (limit) => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return limit ? value % limit : value;
  };
}

function editOperation(source, random, client, round) {
  const start = random(source.length + 1);
  const removed = Math.min(random(3), source.length - start);
  const inserted = `{${client}:${round}}${random(4) === 0 ? "\n" : ""}`;
  const next = `${source.slice(0, start)}${inserted}${source.slice(start + removed)}`;
  if ((client + round) % 2 === 0) return operationFromTextDiff(source, next);

  const range = { start, end: start + removed };
  return operationForSerializedRange(source, range, source.slice(range.start, range.end), inserted);
}

function createClient(id, source) {
  return {
    id,
    revision: 0,
    serverSource: source,
    source,
    inFlight: null,
  };
}

function receive(client, message) {
  client.serverSource = applyOperation(client.serverSource, message.operation);
  client.revision = message.revision;
  if (client.id === message.clientId && client.inFlight && client.inFlight.id === message.clientOperationId) {
    client.inFlight = null;
    return;
  }
  let incoming = message.operation;
  if (client.inFlight) [client.inFlight.operation, incoming] = transformOperations(client.inFlight.operation, incoming);
  client.source = applyOperation(client.source, incoming);
}

test("stress: six mixed WMD and document editors converge across repeated simultaneous edits", () => {
  for (let seed = 1; seed <= 80; seed += 1) {
    const random = rng(seed);
    const clients = Array.from({ length: 6 }, (_, id) => createClient(`client-${id}`, "@tab Home\n\nStart"));
    let serverSource = "@tab Home\n\nStart";
    let revision = 0;
    const history = [];

    for (let round = 0; round < 18; round += 1) {
      const sent = clients.map((client, clientIndex) => {
        const operation = editOperation(client.source, random, clientIndex, round);
        client.source = applyOperation(client.source, operation);
        client.inFlight = { id: `${round}:${clientIndex}`, operation };
        return { client, clientId: client.id, clientOperationId: client.inFlight.id, baseRevision: client.revision, operation };
      });

      while (sent.length) {
        const message = sent.splice(random(sent.length), 1)[0];
        let accepted = message.operation;
        for (const entry of history) {
          if (entry.revision > message.baseRevision) [accepted] = transformOperations(accepted, entry.operation);
        }
        serverSource = applyOperation(serverSource, accepted);
        revision += 1;
        history.push({ revision, operation: accepted });
        const broadcast = { ...message, operation: accepted, revision };
        clients.forEach((client) => receive(client, broadcast));
      }

      clients.forEach((client) => {
        assert.equal(client.serverSource, serverSource, `seed ${seed}, round ${round}: stale server text`);
        assert.equal(client.source, serverSource, `seed ${seed}, round ${round}: ${client.id} desynchronized`);
        assert.equal(client.inFlight, null, `seed ${seed}, round ${round}: ${client.id} did not acknowledge its operation`);
      });
    }
  }
});

test("stress: a document-range patch rebases over bursts of remote WMD and document edits", () => {
  for (let seed = 1; seed <= 160; seed += 1) {
    const random = rng(seed);
    const source = "@tab Home\n\nOne\n\nTwo\n\nThree\n\nFour";
    const targetStart = random(source.length + 1);
    const targetRemoved = Math.min(random(3), source.length - targetStart);
    const local = operationForSerializedRange(
      source,
      { start: targetStart, end: targetStart + targetRemoved },
      source.slice(targetStart, targetStart + targetRemoved),
      `[canvas:${seed}]`,
    );
    let remoteSource = source;
    const remoteOperations = [];
    for (let index = 0; index < 5; index += 1) {
      const offset = random(remoteSource.length + 1);
      const removed = Math.min(random(3), remoteSource.length - offset);
      const next = `${remoteSource.slice(0, offset)}[remote:${seed}:${index}]${remoteSource.slice(offset + removed)}`;
      const operation = operationFromTextDiff(remoteSource, next);
      remoteOperations.push(operation);
      remoteSource = next;
    }
    const rebased = rebaseOperationThroughExternal(local, remoteOperations);
    const canvasFirst = applyOperation(source, local);
    const remoteAfterCanvas = rebased.externalOperations.reduce(applyOperation, canvasFirst);
    const canvasAfterRemote = applyOperation(remoteSource, rebased.operation);
    assert.equal(canvasAfterRemote, remoteAfterCanvas, `seed ${seed}: canvas patch did not converge over remote burst`);
  }
});

test("cursor affinities keep authors after their own insertion and other WMD cursors before it", () => {
  const operation = { ops: [3, "XY", 2] };
  assert.equal(mapOffsetThroughOperation(3, operation, "before"), 3);
  assert.equal(mapOffsetThroughOperation(3, operation, "after"), 5);
  assert.equal(serverMapOffset(3, operation, "before"), 3);
  assert.equal(serverMapOffset(3, operation, "after"), 5);

  assert.deepEqual(serverMapSelection({ start: 3, end: 3 }, operation, "after"), { start: 5, end: 5 });
  assert.deepEqual(serverMapSelection({ start: 3, end: 5 }, operation), { start: 3, end: 7 });
});

test("an optimistic author cursor waits for its own acknowledgement before being published", () => {
  const source = "abcde";
  const operation = operationFromTextDiff(source, "abcXYde");
  const localCursor = { start: 5, end: 5 };
  const preAcknowledgement = mapSelectionBackwardThroughOperations(localCursor, [operation]);

  assert.deepEqual(preAcknowledgement, { start: 3, end: 3 });
  assert.deepEqual(mapSelectionThroughOperations(preAcknowledgement, [operation], "after"), localCursor);
  assert.deepEqual(mapSelectionThroughOperations(preAcknowledgement, [operation], "before"), { start: 3, end: 3 });
});

test("a stale raw selection is advanced from its declared server revision", () => {
  const history = [
    { revision: 4, operation: { ops: [2, "++", 3] } },
    { revision: 5, operation: { ops: [1, -1, 6] } },
  ];
  assert.deepEqual(mapSelectionThroughHistory({ start: 2, end: 2 }, 3, history), { start: 1, end: 1 });
  assert.deepEqual(mapSelectionThroughHistory({ start: 2, end: 2 }, 4, history), { start: 1, end: 1 });
});

test("optimistic WMD selections convert to server coordinates and back without drift", () => {
  const source = "@tab Home\n\nabcdef";
  const first = operationFromTextDiff(source, source.replace("cd", "cLOCALd"));
  const afterFirst = applyOperation(source, first);
  const second = operationFromTextDiff(afterFirst, `${afterFirst.slice(0, 3)}!${afterFirst.slice(3)}`);
  const operations = [first, second];

  const serverCursor = { start: source.indexOf("e"), end: source.indexOf("e") };
  const displayed = mapSelectionThroughOperations(serverCursor, operations, "before");
  const roundTrip = mapSelectionBackwardThroughOperations(displayed, operations);
  assert.deepEqual(roundTrip, serverCursor);

  const localAfterTyping = { start: afterFirst.indexOf("LOCAL") + "LOCAL".length, end: afterFirst.indexOf("LOCAL") + "LOCAL".length };
  assert.equal(mapOffsetBackwardThroughOperation(localAfterTyping.start, first), source.indexOf("d"));
});

test("raw caret restoration follows the exact remote operation in repeated WMD text", () => {
  const before = "repeat repeat repeat";
  const remote = operationFromTextDiff(before, "REMOTE repeat repeat repeat");
  const caret = { start: before.lastIndexOf("repeat") + 3, end: before.lastIndexOf("repeat") + 3 };
  const restored = mapSelectionThroughOperations(caret, [remote], "before");
  assert.deepEqual(restored, { start: caret.start + "REMOTE ".length, end: caret.end + "REMOTE ".length });
});

test("cursor coordinate stress preserves every surviving server cursor through local optimistic operations", () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const random = rng(seed);
    const source = "0123456789abcdefghijklmnopqrstuvwxyz";
    const operations = [];
    let local = source;
    for (let index = 0; index < 8; index += 1) {
      const position = random(local.length + 1);
      const operation = operationFromTextDiff(local, `${local.slice(0, position)}${String.fromCharCode(65 + index)}${local.slice(position)}`);
      operations.push(operation);
      local = applyOperation(local, operation);
    }
    for (let cursor = 0; cursor <= source.length; cursor += 1) {
      const localCursor = mapSelectionThroughOperations({ start: cursor, end: cursor }, operations, "before");
      const serverCursor = mapSelectionBackwardThroughOperations(localCursor, operations);
      assert.deepEqual(serverCursor, { start: cursor, end: cursor }, `seed ${seed}, cursor ${cursor}`);
    }
  }
});

test("document collaborator cursors use overlays instead of mutating contenteditable text", () => {
  const cursorLayer = fs.readFileSync(path.join(__dirname, "..", "web", "public", "cursor-sync.js"), "utf8");
  assert.match(cursorLayer, /wmd-studio-cursor-overlay/);
  assert.match(cursorLayer, /wmd-presence-layer/);
  assert.doesNotMatch(cursorLayer, /range\.insertNode/);
});

test("raw WMD highlight and textarea use the same border-box text geometry", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "web", "public", "app.css"), "utf8");
  const sharedRule = css.match(/\.wmd-highlight, \.source-editor, \.raw-scroll-measure\s*\{([\s\S]*?)\n\}/);
  assert.ok(sharedRule, "the raw-editor layers need a shared layout rule");
  assert.match(sharedRule[1], /box-sizing:\s*border-box/);
  assert.match(sharedRule[1], /padding:\s*22px 24px 48px/);
  assert.match(sharedRule[1], /font-family:\s*"Cascadia Code"/);
  assert.match(sharedRule[1], /line-height:\s*1\.68/);
});
