(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WmdEditorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

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

  function normalizeOperations(parts) {
    const result = [];
    for (const part of parts || []) appendPart(result, part);
    return result;
  }

  function applyOperation(source, operation) {
    let index = 0;
    let output = "";
    for (const part of normalizeOperations(operation && operation.ops)) {
      if (typeof part === "string") output += part;
      else if (part > 0) {
        if (index + part > source.length) throw new Error("Retain exceeds source length.");
        output += source.slice(index, index + part);
        index += part;
      } else {
        if (index - part > source.length) throw new Error("Delete exceeds source length.");
        index -= part;
      }
    }
    if (index !== source.length) throw new Error("Operation does not consume its source.");
    return output;
  }

  function consumePart(part, length) {
    if (typeof part === "string") return part.slice(length);
    return part > 0 ? part - length : part + length;
  }

  function transformOperations(left, right) {
    const leftParts = normalizeOperations(left && left.ops).slice();
    const rightParts = normalizeOperations(right && right.ops).slice();
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
      if (leftPart === undefined || rightPart === undefined) throw new Error("Incompatible operation lengths.");
      const length = Math.min(Math.abs(leftPart), Math.abs(rightPart));
      if (leftPart > 0 && rightPart > 0) {
        appendPart(leftPrime, length);
        appendPart(rightPrime, length);
      } else if (leftPart < 0 && rightPart < 0) {
        // Both operations delete the same source range.
      } else if (leftPart < 0) {
        appendPart(leftPrime, -length);
      } else {
        appendPart(rightPrime, -length);
      }
      leftPart = consumePart(leftPart, length);
      rightPart = consumePart(rightPart, length);
      if (leftPart === 0) leftPart = leftParts.shift();
      if (rightPart === 0) rightPart = rightParts.shift();
    }
    return [{ ops: leftPrime }, { ops: rightPrime }];
  }

  function lcsDiff(before, after) {
    const rows = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
    for (let left = before.length - 1; left >= 0; left -= 1) {
      for (let right = after.length - 1; right >= 0; right -= 1) {
        rows[left][right] = before[left] === after[right]
          ? rows[left + 1][right + 1] + 1
          : Math.max(rows[left + 1][right], rows[left][right + 1]);
      }
    }
    const ops = [];
    let left = 0;
    let right = 0;
    while (left < before.length || right < after.length) {
      if (left < before.length && right < after.length && before[left] === after[right]) {
        appendPart(ops, 1);
        left += 1;
        right += 1;
      } else if (right < after.length && (left === before.length || rows[left][right + 1] > rows[left + 1][right])) {
        appendPart(ops, after[right]);
        right += 1;
      } else {
        appendPart(ops, -1);
        left += 1;
      }
    }
    return ops;
  }

  function operationFromDiff(before, after, maxCells = 4_000_000) {
    if (before === after) return null;
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    const beforeMiddle = before.slice(prefix, before.length - suffix);
    const afterMiddle = after.slice(prefix, after.length - suffix);
    const ops = [];
    appendPart(ops, prefix);
    if (beforeMiddle.length * afterMiddle.length <= maxCells) {
      for (const part of lcsDiff(beforeMiddle, afterMiddle)) appendPart(ops, part);
    } else {
      appendPart(ops, -beforeMiddle.length);
      appendPart(ops, afterMiddle);
    }
    appendPart(ops, suffix);
    return { ops };
  }

  function identityOperation(source) {
    return { ops: source.length ? [source.length] : [] };
  }

  function rebaseCanvasEdit({ serializedBase, nextSerialized, sourceBase, currentSource }) {
    const localOnSerialized = operationFromDiff(serializedBase, nextSerialized);
    if (!localOnSerialized) return { source: currentSource, operation: null };
    const normalization = operationFromDiff(serializedBase, sourceBase);
    let localOnSource = localOnSerialized;
    if (normalization) [localOnSource] = transformOperations(localOnSerialized, normalization);
    const remote = operationFromDiff(sourceBase, currentSource);
    let localOnCurrent = localOnSource;
    if (remote) [localOnCurrent] = transformOperations(localOnSource, remote);
    return { source: applyOperation(currentSource, localOnCurrent), operation: localOnCurrent };
  }

  return { applyOperation, operationFromDiff, rebaseCanvasEdit, transformOperations, identityOperation };
});
