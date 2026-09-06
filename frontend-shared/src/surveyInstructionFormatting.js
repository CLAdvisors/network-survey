// This is intentionally not Markdown. The only formatting construct is a
// non-empty, same-line run surrounded by exactly two asterisks. Everything
// else, including HTML and malformed markers, remains ordinary text.
function appendPart(parts, text, bold, sourceStart, sourceEnd) {
  if (!text) return;
  const previous = parts[parts.length - 1];
  if (previous && previous.bold === bold && previous.sourceEnd === sourceStart) {
    previous.text += text;
    previous.sourceEnd = sourceEnd;
    return;
  }
  parts.push({ text, bold, sourceStart, sourceEnd });
}

function parseLine(parts, text, lineStart, lineEnd) {
  const starRuns = [];
  let cursor = lineStart;
  while (cursor < lineEnd) {
    if (text[cursor] !== '*') {
      cursor += 1;
      continue;
    }
    let runEnd = cursor + 1;
    while (runEnd < lineEnd && text[runEnd] === '*') runEnd += 1;
    starRuns.push({ start: cursor, length: runEnd - cursor });
    cursor = runEnd;
  }

  const markers = starRuns.flatMap((run) => {
    if (run.length !== 2 && run.length !== 4) return [];
    return Array.from({ length: run.length / 2 }, (_, index) => ({
      start: run.start + (index * 2),
      length: 2,
    }));
  });
  const pairs = [];
  for (let index = 0; index + 1 < markers.length;) {
    const opening = markers[index];
    const closing = markers[index + 1];
    const hasMalformedInteriorMarker = starRuns.some((run) => (
      run.start > opening.start && run.start < closing.start && run.length > 1
    ));
    if (hasMalformedInteriorMarker) {
      index += 1;
    } else {
      if (closing.start > opening.start + 2) pairs.push([opening.start, closing.start]);
      index += 2;
    }
  }

  cursor = lineStart;
  for (const [markerStart, contentEnd] of pairs) {
    const contentStart = markerStart + 2;
    appendPart(parts, text.slice(cursor, markerStart), false, cursor, markerStart);
    appendPart(parts, text.slice(contentStart, contentEnd), true, contentStart, contentEnd);
    cursor = contentEnd + 2;
  }
  appendPart(parts, text.slice(cursor, lineEnd), false, cursor, lineEnd);
}

function parseWithLocations(value) {
  const text = typeof value === 'string' ? value : '';
  const parts = [];
  let lineStart = 0;

  for (let cursor = 0; cursor < text.length; cursor += 1) {
    if (text[cursor] !== '\r' && text[cursor] !== '\n') continue;
    parseLine(parts, text, lineStart, cursor);
    const lineEnd = text[cursor] === '\r' && text[cursor + 1] === '\n' ? cursor + 2 : cursor + 1;
    appendPart(parts, text.slice(cursor, lineEnd), false, cursor, lineEnd);
    lineStart = lineEnd;
    cursor = lineEnd - 1;
  }
  parseLine(parts, text, lineStart, text.length);
  return parts;
}

/**
 * Parse the deliberately narrow survey-instruction bold grammar.
 *
 * Returned text is always literal text (never HTML) and concatenating it
 * recreates exactly what a respondent should see.
 */
export function parseSurveyInstructionFormatting(value) {
  return parseWithLocations(value).map(({ text, bold }) => ({ text, bold }));
}

function toAtoms(value) {
  const atoms = [];
  for (const part of parseWithLocations(value)) {
    let sourceOffset = part.sourceStart;
    for (const character of part.text) {
      atoms.push({
        character,
        bold: part.bold,
        sourceStart: sourceOffset,
        sourceEnd: sourceOffset + character.length,
      });
      sourceOffset += character.length;
    }
  }
  return atoms;
}

function serialize(atoms) {
  let value = '';
  let bold = false;
  const locations = [];

  for (const atom of atoms) {
    const formattable = atom.character !== '\r' && atom.character !== '\n';
    const nextBold = formattable && atom.bold;
    if (nextBold !== bold) {
      value += '**';
      bold = nextBold;
    }
    const start = value.length;
    value += atom.character;
    locations.push({ start, end: value.length });
  }
  if (bold) value += '**';

  return { value, locations };
}

function hasIntendedFormatting(value, intendedAtoms) {
  const actual = toAtoms(value);
  return actual.length === intendedAtoms.length && actual.every((atom, index) => (
    atom.character === intendedAtoms[index].character
    && atom.bold === intendedAtoms[index].bold
  ));
}

function unchanged(value, start, end, reason) {
  return {
    value,
    selectionStart: start,
    selectionEnd: end,
    changed: false,
    reason,
  };
}

/**
 * Convert a browser textarea offset (where CRLF and lone CR are represented by
 * one LF code unit) to an offset in the exact stored source string.
 */
export function textareaOffsetToSourceOffset(value, textareaOffset) {
  const text = typeof value === 'string' ? value : '';
  const target = Math.max(0, Number.isFinite(textareaOffset) ? textareaOffset : 0);
  let source = 0;
  let textarea = 0;

  while (source < text.length && textarea < target) {
    source += text[source] === '\r' && text[source + 1] === '\n' ? 2 : 1;
    textarea += 1;
  }
  return source;
}

/** Convert an exact stored source offset to its browser textarea offset. */
export function sourceOffsetToTextareaOffset(value, sourceOffset) {
  const text = typeof value === 'string' ? value : '';
  const target = Math.max(0, Math.min(text.length, Number.isFinite(sourceOffset) ? sourceOffset : 0));
  let source = 0;
  let textarea = 0;

  while (source < target) {
    source += text[source] === '\r' && text[source + 1] === '\n' ? 2 : 1;
    textarea += 1;
  }
  return textarea;
}

/**
 * Toggle bold for the visible text intersecting a source-string selection.
 * Selection offsets are UTF-16 offsets in the exact stored value.
 */
export function toggleSurveyInstructionBold(value, selectionStart, selectionEnd) {
  const text = typeof value === 'string' ? value : '';
  const start = Math.max(0, Math.min(text.length, Number.isFinite(selectionStart) ? selectionStart : 0));
  const end = Math.max(start, Math.min(text.length, Number.isFinite(selectionEnd) ? selectionEnd : start));

  if (start === end) return unchanged(text, start, end, 'collapsed-selection');

  const atoms = toAtoms(text);
  const selectedIndexes = [];
  atoms.forEach((atom, index) => {
    if (atom.character !== '\r' && atom.character !== '\n'
      && atom.sourceStart < end && atom.sourceEnd > start) {
      selectedIndexes.push(index);
    }
  });
  if (selectedIndexes.length === 0) return unchanged(text, start, end, 'no-formattable-text');

  const makeBold = selectedIndexes.some((index) => !atoms[index].bold);
  selectedIndexes.forEach((index) => { atoms[index].bold = makeBold; });

  const serialized = serialize(atoms);
  if (!hasIntendedFormatting(serialized.value, atoms)) {
    return unchanged(text, start, end, 'unrepresentable');
  }
  if (serialized.value === text) return unchanged(text, start, end, 'unchanged');

  return {
    value: serialized.value,
    selectionStart: serialized.locations[selectedIndexes[0]].start,
    selectionEnd: serialized.locations[selectedIndexes[selectedIndexes.length - 1]].end,
    changed: true,
    reason: makeBold ? 'bolded' : 'unbolded',
  };
}
