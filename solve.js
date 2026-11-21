// A fast drop-in for csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for the same
// {text, header}: {columns, rows, errors}. The reading policy, in short:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and
// an empty line is no record; a CR outside quotes that is not followed by
// LF is dropped (stray_cr); a field that opens with a quote runs to the
// next quote that is not doubled, "" inside it is one quote and each CRLF
// or lone CR inside it reads as LF; what follows the closing quote up to
// the next comma or line break is appended as it stands (quote_junk);
// a quote that never closes is a literal character and the text after it
// is read again as unquoted (unterminated_quote); a quote inside an
// unquoted field is a literal character; fields stay strings, never
// trimmed or converted. columns is the first record when header is true,
// else null; rows are padded with "" (short_row, with fields) or cut
// (long_row, with extra) to the first record's width. Each error is
// {code, line, row} in the order met, line the 1-based line its record
// starts on, row its record's index in rows (null for the header).
//
// Speed comes from never building a field one character at a time. The
// hot paths jump with indexOf straight to the next interesting character
// and cut fields out with slice; the slow, character-by-character paths
// (a quoted field holding a line break, a lone CR, junk after a closing
// quote, a quote that never closes) live in the helpers below and only
// run where the text actually needs them, which the drawn cases do
// rarely. Everything runs in one function scope so the position and the
// line stay plain locals, not context slots behind a closure.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/**
 * Read an unquoted field starting at pos, appending onto `value`.
 * Stops at a comma, at LF or CRLF, or at the end of the text; a CR not
 * followed by LF is dropped and reported as stray_cr. Returns
 * [value, ended, pos, line, added] where added counts the characters
 * this call kept (not the ones already in `value`).
 */
function scanUnquoted(text, pos, line, value, errors, recordLine, recordRow) {
  const n = text.length;
  const parts = [value];
  let added = 0;
  let seg = pos;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 44) { // ,
      if (pos > seg) { parts.push(text.slice(seg, pos)); added += pos - seg; }
      return [parts.length === 1 ? value : parts.join(''), COMMA, pos + 1, line, added];
    }
    if (c === 10) { // \n
      if (pos > seg) { parts.push(text.slice(seg, pos)); added += pos - seg; }
      return [parts.length === 1 ? value : parts.join(''), LINE_BREAK, pos + 1, line + 1, added];
    }
    if (c === 13) { // \r
      if (text.charCodeAt(pos + 1) === 10) {
        if (pos > seg) { parts.push(text.slice(seg, pos)); added += pos - seg; }
        return [parts.length === 1 ? value : parts.join(''), LINE_BREAK, pos + 2, line + 1, added];
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (pos > seg) { parts.push(text.slice(seg, pos)); added += pos - seg; }
      pos += 1;
      seg = pos;
      continue;
    }
    pos += 1;
  }
  if (pos > seg) { parts.push(text.slice(seg, pos)); added += pos - seg; }
  return [parts.length === 1 ? value : parts.join(''), END, pos, line, added];
}

/**
 * Read a quoted field whose opening quote is at `open`, the slow way:
 * the field holds a line break, doubled quotes and line breaks together,
 * or its quote never closes. Doubled quotes collapse to one quote, each
 * CRLF or lone CR inside reads as LF, and the line counts every LF,
 * CRLF and lone CR inside. When the quote never closes it is a literal
 * character and the text after it is read again as unquoted. Returns
 * [value, ended, pos, line, added] like scanUnquoted.
 */
function scanQuotedSlow(text, open, openLine, errors, recordLine, recordRow) {
  const n = text.length;
  let pos = open + 1;
  let line = openLine;
  const parts = [];
  let seg = pos;
  let closed = false;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 34) { // "
      if (text.charCodeAt(pos + 1) === 34) {
        if (pos > seg) parts.push(text.slice(seg, pos));
        parts.push('"');
        pos += 2;
        seg = pos;
        continue;
      }
      if (pos > seg) parts.push(text.slice(seg, pos));
      pos += 1;
      closed = true;
      break;
    }
    if (c === 13) { // \r -> \n, one line either way
      if (pos > seg) parts.push(text.slice(seg, pos));
      parts.push('\n');
      line += 1;
      pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
      seg = pos;
      continue;
    }
    if (c === 10) line += 1; // \n stays in the current segment
    pos += 1;
  }
  if (!closed) {
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    return scanUnquoted(text, open + 1, openLine, '"', errors, recordLine, recordRow);
  }
  const value = parts.join('');
  if (pos >= n) return [value, END, pos, line, 0];
  const c = text.charCodeAt(pos);
  if (c === 44) return [value, COMMA, pos + 1, line, 0];
  if (c === 10) return [value, LINE_BREAK, pos + 1, line + 1, 0];
  if (c === 13 && text.charCodeAt(pos + 1) === 10) return [value, LINE_BREAK, pos + 2, line + 1, 0];
  // Junk after the closing quote: appended as it stands.
  const r = scanUnquoted(text, pos, line, value, errors, recordLine, recordRow);
  if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  return r;
}

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;

    do {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      let endedCode;
      if (quoted) {
        const open = pos;
        const openLine = line;
        const q = text.indexOf('"', pos + 1);
        if (q === -1) {
          // No closing quote anywhere ahead.
          const r = scanQuotedSlow(text, open, openLine, errors, recordLine, recordRow);
          value = r[0]; endedCode = r[1]; pos = r[2]; line = r[3];
        } else if (text.charCodeAt(q + 1) === 34) {
          // Doubled quotes: walk the quote pairs, then check for a
          // line break inside before joining the pieces.
          const segs = [];
          let segStart = pos + 1;
          let qq = q;
          let closeQ = -1;
          while (true) {
            if (text.charCodeAt(qq + 1) === 34) {
              segs.push(text.slice(segStart, qq));
              segStart = qq + 2;
              qq = text.indexOf('"', segStart);
              if (qq === -1) break;
              continue;
            }
            closeQ = qq;
            break;
          }
          if (closeQ === -1) {
            const r = scanQuotedSlow(text, open, openLine, errors, recordLine, recordRow);
            value = r[0]; endedCode = r[1]; pos = r[2]; line = r[3];
          } else {
            const ni = text.indexOf('\n', pos + 1);
            const ri = text.indexOf('\r', pos + 1);
            if ((ni !== -1 && ni < closeQ) || (ri !== -1 && ri < closeQ)) {
              const r = scanQuotedSlow(text, open, openLine, errors, recordLine, recordRow);
              value = r[0]; endedCode = r[1]; pos = r[2]; line = r[3];
            } else {
              segs.push(text.slice(segStart, closeQ));
              value = segs.join('"');
              pos = closeQ + 1;
            }
          }
        } else {
          const ni = text.indexOf('\n', pos + 1);
          const ri = text.indexOf('\r', pos + 1);
          if ((ni !== -1 && ni < q) || (ri !== -1 && ri < q)) {
            const r = scanQuotedSlow(text, open, openLine, errors, recordLine, recordRow);
            value = r[0]; endedCode = r[1]; pos = r[2]; line = r[3];
          } else {
            value = text.slice(pos + 1, q);
            pos = q + 1;
          }
        }
        if (endedCode === undefined) {
          // Just past the closing quote: comma, line break, end, or junk.
          if (pos >= n) {
            endedCode = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              endedCode = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              endedCode = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              endedCode = LINE_BREAK;
            } else {
              const r = scanUnquoted(text, pos, line, value, errors, recordLine, recordRow);
              value = r[0]; endedCode = r[1]; pos = r[2]; line = r[3];
              if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      } else {
        // Unquoted field: walk the characters; fields here are short,
        // so a tight charCode loop beats three indexOf calls, and a
        // long field falls back to indexOf jumps.
        let end = pos;
        let endKind = END;
        let advance = 0;
        const walkTo = Math.min(n, pos + 64);
        while (end < walkTo) {
          const c = text.charCodeAt(end);
          if (c === 44) { endKind = COMMA; advance = 1; break; }
          if (c === 10) { endKind = LINE_BREAK; advance = 1; break; }
          if (c === 13) {
            if (text.charCodeAt(end + 1) === 10) { endKind = LINE_BREAK; advance = 2; }
            else endKind = 3; // lone CR: slow continuation below
            break;
          }
          end += 1;
        }
        if (endKind === END && end < n) {
          // Walked 64 characters with no terminator: jump with indexOf.
          const ci = text.indexOf(',', end);
          const ni = text.indexOf('\n', end);
          const ri = text.indexOf('\r', end);
          let e2 = n;
          let k2 = END;
          let a2 = 0;
          if (ci !== -1) { e2 = ci; k2 = COMMA; a2 = 1; }
          if (ni !== -1 && ni < e2) { e2 = ni; k2 = LINE_BREAK; a2 = 1; }
          if (ri !== -1 && ri < e2) {
            if (text.charCodeAt(ri + 1) === 10) { e2 = ri; k2 = LINE_BREAK; a2 = 2; }
            else { e2 = ri; k2 = 3; a2 = 0; }
          }
          end = e2; endKind = k2; advance = a2;
        }
        if (endKind === 3) {
          // A lone CR inside the field: drop it, report it, carry on.
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          const r = scanUnquoted(text, end + 1, line, text.slice(pos, end), errors, recordLine, recordRow);
          value = r[0]; endedCode = r[1]; pos = r[2]; line = r[3];
        } else {
          value = text.slice(pos, end);
          pos = end + advance;
          if (endKind === LINE_BREAK) line += 1;
          endedCode = endKind;
        }
      }
      fields.push(value);
      ended = endedCode;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
