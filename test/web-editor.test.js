const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyOperation,
  createStarterDocument,
  findDuplicateOperation,
  hasRoomCapacity,
  mapOffsetThroughOperation,
  MAX_COLLABORATORS,
  normalizeDocumentId,
  parseSocketFrames,
  transformAgainstHistory,
  transformOperations,
} = require("../web/server");

function append(ops, part) {
  if (part === 0 || part === "") return;
  const previous = ops[ops.length - 1];
  if (typeof previous === "number" && typeof part === "number" && Math.sign(previous) === Math.sign(part)) {
    ops[ops.length - 1] += part;
  } else if (typeof previous === "string" && typeof part === "string") {
    ops[ops.length - 1] += part;
  } else {
    ops.push(part);
  }
}

function spliceOperation(source, start, deleteCount, insertion = "") {
  const ops = [];
  append(ops, start);
  append(ops, -deleteCount);
  append(ops, insertion);
  append(ops, source.length - start - deleteCount);
  return { ops };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomOperation(source, random, token = "") {
  const ops = [];
  for (let index = 0; index <= source.length; index += 1) {
    if (random() < 0.18) append(ops, token || String.fromCharCode(97 + Math.floor(random() * 26)));
    if (index < source.length) append(ops, random() < 0.22 ? -1 : 1);
  }
  return { ops };
}

function randomSpliceOperation(source, random, token) {
  const start = Math.floor(random() * (source.length + 1));
  const maxDelete = Math.min(3, source.length - start);
  const deleteCount = Math.floor(random() * (maxDelete + 1));
  const insertion = random() < 0.7 ? token : "";
  return spliceOperation(source, start, deleteCount, insertion);
}

function applyConcurrentBatch(source, operations) {
  const history = [];
  let result = source;
  for (const operation of operations) {
    const transformed = transformAgainstHistory(operation, 0, history);
    result = applyOperation(result, transformed);
    history.push({ revision: history.length + 1, operation: transformed });
  }
  return { source: result, history };
}

function maskedFrame(text, { final = true, opcode = 0x1 } = {}) {
  const payload = Buffer.from(text);
  assert.ok(payload.length < 126);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const encoded = Buffer.from(payload);
  for (let index = 0; index < encoded.length; index += 1) encoded[index] ^= mask[index % 4];
  return Buffer.concat([Buffer.from([(final ? 0x80 : 0) | opcode, 0x80 | payload.length]), mask, encoded]);
}

function parserClient() {
  return {
    buffer: Buffer.alloc(0),
    fragmentOpcode: null,
    fragments: [],
    fragmentBytes: 0,
    documentId: null,
    socket: {
      writable: true,
      destroyed: false,
      writes: [],
      write(value) { this.writes.push(value); },
      end() { this.writable = false; },
      destroy() { this.destroyed = true; this.writable = false; },
    },
  };
}

test("normalizes document names into stable ids", () => {
  assert.equal(normalizeDocumentId("My Team Notes.docx"), "my-team-notes");
  assert.equal(normalizeDocumentId("***"), "untitled");
});

test("new documents retain the WMD starter configuration", () => {
  const source = createStarterDocument("notes");
  assert.match(source, /^@config\n/);
  assert.match(source, /@tab Test\n@title Home/);
});

test("the collaboration room accepts exactly eight editors", () => {
  assert.equal(MAX_COLLABORATORS, 8);
  for (let count = 0; count < 8; count += 1) assert.equal(hasRoomCapacity(count), true);
  assert.equal(hasRoomCapacity(8), false);
  assert.equal(hasRoomCapacity(9), false);
});

test("splice operations produce exactly the requested text", () => {
  const source = "Hello world";
  assert.equal(applyOperation(source, spliceOperation(source, 6, 5, "WMD")), "Hello WMD");
});

test("operations preserve UTF-16 emoji boundaries when replacing emoji", () => {
  const source = "A😀B";
  assert.equal(applyOperation(source, spliceOperation(source, 1, 2, "🙂")), "A🙂B");
});

test("invalid operations never partially mutate source text", () => {
  const source = "abcd";
  const invalid = [
    { ops: [0, 4] },
    { ops: [1.5, 2.5] },
    { ops: [5] },
    { ops: [-5] },
    { ops: [2] },
    { ops: [1, {} , 3] },
  ];
  for (const operation of invalid) assert.throws(() => applyOperation(source, operation));
  assert.equal(source, "abcd");
});

test("same-position inserts converge with deterministic left-first order", () => {
  const source = "ab";
  const left = spliceOperation(source, 1, 0, "L");
  const right = spliceOperation(source, 1, 0, "R");
  const [leftPrime, rightPrime] = transformOperations(left, right);
  assert.equal(applyOperation(applyOperation(source, right), leftPrime), "aLRb");
  assert.equal(applyOperation(applyOperation(source, left), rightPrime), "aLRb");
});

test("overlapping deletes remove the union exactly", () => {
  const source = "abcdef";
  const left = spliceOperation(source, 1, 3);
  const right = spliceOperation(source, 2, 3);
  const [leftPrime, rightPrime] = transformOperations(left, right);
  assert.equal(applyOperation(applyOperation(source, right), leftPrime), "af");
  assert.equal(applyOperation(applyOperation(source, left), rightPrime), "af");
});

test("a deletion and an insertion inside it preserve the inserted text", () => {
  const source = "abcd";
  const deletion = spliceOperation(source, 1, 2);
  const insertion = spliceOperation(source, 2, 0, "X");
  const [deletionPrime, insertionPrime] = transformOperations(deletion, insertion);
  assert.equal(applyOperation(applyOperation(source, insertion), deletionPrime), "aXd");
  assert.equal(applyOperation(applyOperation(source, deletion), insertionPrime), "aXd");
});

test("concurrent replacements preserve both users' inserted text", () => {
  const source = "abc";
  const left = spliceOperation(source, 1, 1, "X");
  const right = spliceOperation(source, 1, 1, "Y");
  const [leftPrime, rightPrime] = transformOperations(left, right);
  assert.equal(applyOperation(applyOperation(source, right), leftPrime), "aXYc");
  assert.equal(applyOperation(applyOperation(source, left), rightPrime), "aXYc");
});

test("multi-hunk replace-all preserves a collaborator's middle insertion", () => {
  const source = "foo KEEP foo";
  const replaceAll = { ops: [-3, "bar", 6, -3, "bar"] };
  const middleInsert = spliceOperation(source, 5, 0, "X");
  const [replacePrime, insertPrime] = transformOperations(replaceAll, middleInsert);
  assert.equal(applyOperation(applyOperation(source, middleInsert), replacePrime), "bar KXEEP bar");
  assert.equal(applyOperation(applyOperation(source, replaceAll), insertPrime), "bar KXEEP bar");
});

test("history transforms a stale operation through every newer revision", () => {
  const source = "abc";
  const first = spliceOperation(source, 1, 0, "X");
  const afterFirst = applyOperation(source, first);
  const secondOriginal = spliceOperation(source, 2, 0, "Y");
  const [second] = transformOperations(secondOriginal, first);
  const stale = spliceOperation(source, 0, 0, "Z");
  const transformed = transformAgainstHistory(stale, 0, [
    { revision: 1, operation: first },
    { revision: 2, operation: second },
  ]);
  assert.equal(applyOperation(applyOperation(afterFirst, second), transformed), "ZaXbYc");
});

test("operation ids are deduplicated per client without suppressing another client", () => {
  const entry = { clientId: "alice", clientOperationId: "op-7", revision: 3, operation: { ops: [1] } };
  assert.equal(findDuplicateOperation([entry], "alice", "op-7"), entry);
  assert.equal(findDuplicateOperation([entry], "alice", "op-8"), null);
  assert.equal(findDuplicateOperation([entry], "bob", "op-7"), null);
});

test("selection offsets follow remote insertions and deletions", () => {
  const source = "abcdef";
  assert.equal(mapOffsetThroughOperation(4, spliceOperation(source, 2, 0, "XY")), 6);
  assert.equal(mapOffsetThroughOperation(4, spliceOperation(source, 1, 3)), 1);
});

test("WebSocket parser accepts a frame split across TCP chunks", () => {
  const client = parserClient();
  const frame = maskedFrame('{"type":"noop"}');
  parseSocketFrames(client, frame.subarray(0, 5));
  parseSocketFrames(client, frame.subarray(5));
  assert.equal(client.socket.destroyed, false);
  assert.equal(client.buffer.length, 0);
});

test("WebSocket parser reassembles fragmented text and consecutive frames", () => {
  const client = parserClient();
  const fragmented = Buffer.concat([
    maskedFrame('{"type":', { final: false, opcode: 0x1 }),
    maskedFrame('"noop"}', { final: true, opcode: 0x0 }),
    maskedFrame('{"type":"noop"}'),
  ]);
  parseSocketFrames(client, fragmented);
  assert.equal(client.socket.destroyed, false);
  assert.equal(client.fragmentOpcode, null);
  assert.equal(client.fragmentBytes, 0);
  assert.equal(client.buffer.length, 0);
});

test("eight simultaneous inserts have an exact server-order result", () => {
  const operations = Array.from({ length: 8 }, (_, index) => spliceOperation("", 0, 0, String(index)));
  assert.equal(applyConcurrentBatch("", operations).source, "76543210");
});

test("random simultaneous inserts match an independent gap oracle", () => {
  const base = "abcdef";
  for (let seed = 1; seed <= 100; seed += 1) {
    const random = seededRandom(seed);
    const edits = Array.from({ length: 8 }, (_, actor) => ({ actor, gap: Math.floor(random() * (base.length + 1)) }));
    const operations = edits.map(({ actor, gap }) => spliceOperation(base, gap, 0, `[${actor}]`));
    let expected = "";
    for (let gap = 0; gap <= base.length; gap += 1) {
      expected += edits.filter((edit) => edit.gap === gap).reverse().map((edit) => `[${edit.actor}]`).join("");
      if (gap < base.length) expected += base[gap];
    }
    assert.equal(applyConcurrentBatch(base, operations).source, expected, `seed ${seed}`);
  }
});

test("random simultaneous deletes match an independent union oracle", () => {
  const base = "abcdefghijklmnopqrst";
  for (let seed = 1; seed <= 100; seed += 1) {
    const random = seededRandom(seed * 17);
    const removed = new Set();
    const operations = Array.from({ length: 8 }, () => {
      const start = Math.floor(random() * base.length);
      const count = 1 + Math.floor(random() * (base.length - start));
      for (let index = start; index < start + count; index += 1) removed.add(index);
      return spliceOperation(base, start, count);
    });
    const expected = [...base].filter((_, index) => !removed.has(index)).join("");
    assert.equal(applyConcurrentBatch(base, operations).source, expected, `seed ${seed}`);
  }
});

test("20,000 seeded random operation pairs always converge", () => {
  const source = "@tab Home\n# Alpha\nParagraph 😀 with *WMD* markers.\n";
  const random = seededRandom(0x5eedc0de);
  for (let iteration = 0; iteration < 20_000; iteration += 1) {
    const left = randomOperation(source, random);
    const right = randomOperation(source, random);
    const [leftPrime, rightPrime] = transformOperations(left, right);
    const leftResult = applyOperation(applyOperation(source, right), leftPrime);
    const rightResult = applyOperation(applyOperation(source, left), rightPrime);
    assert.equal(leftResult, rightResult, `iteration ${iteration}`);
  }
});

test("eight-client protocol model converges after repeated edit bursts", () => {
  for (let seed = 1; seed <= 64; seed += 1) {
    const random = seededRandom(seed * 0x9e3779b1);
    let source = "@tab Home\n# Shared\nabcdef012345\n";
    for (let round = 0; round < 25; round += 1) {
      const operations = Array.from({ length: 8 }, (_, actor) => randomSpliceOperation(source, random, `[${actor}]`));
      const { source: serverSource, history } = applyConcurrentBatch(source, operations);

      for (let actor = 0; actor < 8; actor += 1) {
        let visible = applyOperation(source, operations[actor]);
        let confirmed = source;
        let inFlight = operations[actor];
        for (let index = 0; index < history.length; index += 1) {
          confirmed = applyOperation(confirmed, history[index].operation);
          if (index === actor) {
            inFlight = null;
          } else {
            let incoming = history[index].operation;
            if (inFlight) [inFlight, incoming] = transformOperations(inFlight, incoming);
            visible = applyOperation(visible, incoming);
          }
        }
        assert.equal(confirmed, serverSource, `confirmed seed ${seed}, round ${round}, actor ${actor}`);
        assert.equal(visible, serverSource, `visible seed ${seed}, round ${round}, actor ${actor}`);
      }
      source = serverSource;
    }
  }
});
