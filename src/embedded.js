// Finds structured data embedded in a page's HTML: JSON-LD, __NEXT_DATA__, and large
// array or object literals inside scripts (e.g. a DataTables `data: [[...]]`). Used
// by the investigator to find it and by the frame to trace values out of it.
// Each entry gets a stable name (script index + literal index) and the text just
// before it, which often says what it is (`$("#memListTable-large").DataTable({ data:`).

import vm from 'node:vm';

// Literals smaller than this are config, not data.
const MIN_LITERAL = 2000;

export function extractEmbedded(html) {
  const found = [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

  scripts.forEach(([, attrs, text], s) => {
    if (/application\/ld\+json/i.test(attrs) || /id=["']__NEXT_DATA__["']/i.test(attrs)) {
      const value = parse(text.trim());
      if (value !== undefined) found.push({ name: `s${s}.0`, context: attrs.trim(), value });
      return;
    }

    // Array literals of rows ([[ or [{) anywhere, and object literals assigned to a
    // variable or property. Skip past each one so nested literals aren't found twice.
    const starts = /(?:[=:(,]\s*)(\[\s*[[{]|\{)/g;
    let literal = 0;
    let match;
    while ((match = starts.exec(text))) {
      const start = match.index + match[0].length - match[1].length;
      const end = literalEnd(text, start);
      if (end === -1) continue;
      starts.lastIndex = end;
      if (end - start < MIN_LITERAL) continue;

      const value = parse(text.slice(start, end));
      if (value === undefined) continue;
      const context = text.slice(Math.max(0, start - 120), start).replace(/\s+/g, ' ').trim();
      found.push({ name: `s${s}.${literal++}`, context, value });
    }
  });
  return found;
}

// Index just past the bracket that closes the one at `start`, or -1.
function literalEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// JSON first. A JavaScript literal (single quotes, unquoted keys) is evaluated alone
// in an empty sandbox with a time limit, never with the page's other code.
function parse(source) {
  try {
    return JSON.parse(source);
  } catch {
    try {
      return vm.runInNewContext(`(${source})`, Object.create(null), { timeout: 1000 });
    } catch {
      return undefined;
    }
  }
}
