// Tester: checks extracted rows against the spec's sample rows. Samples are copied
// out of documents, so a difference only in whitespace or a trailing slash is a
// warning, not a failure (see SKILL.md, "Spec reader").

// Equal after dropping all whitespace and trailing slashes. Case still counts.
export function loose(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/\/+$/, '');
}

// How a delivered value stands against the spec's sample value:
//   exact, or a warning that names why ('spacing', 'typo'), or a failure.
// Specs are typed by people, so a slip in the sample is a warning, not a failure, but
// only a slip: at most two letters wrong in a value of six or more characters, with
// the same digits and not just a change of case. "2024" against "2025" is a different
// value, never a typo.
function compareValue(expected, actual) {
  const got = actual === undefined || actual === null ? '' : String(actual);
  if (got === expected) return { status: 'exact' };
  if (loose(got) === loose(expected)) return { status: 'warn', why: 'spacing' };
  if (looksMistyped(expected, got)) return { status: 'warn', why: 'typo' };
  return { status: 'fail' };
}

function looksMistyped(expected, got) {
  const a = loose(expected);
  const b = loose(got);
  if (a.length < 6 || b.length < 6) return false;
  if (a.toLowerCase() === b.toLowerCase()) return false; // case is the spec's to decide
  if (a.replace(/\D/g, '') !== b.replace(/\D/g, '')) return false;
  return editDistance(a, b, 2) <= 2;
}

// Edits (insert, delete, substitute, swap two neighbours) between a and b, giving up
// once it's over max.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Cheap agreement, for finding a sample's row among thousands.
const agrees = (expected, actual) => {
  const got = actual === undefined || actual === null ? '' : String(actual);
  return got === expected || loose(got) === loose(expected);
};

// For each sample, finds the row that agrees with it on the most non-empty values,
// then checks every column the sample gives, blanks included. A sample that no row
// agrees with on at least half its non-empty values is "not found". A value that
// differs from its own column but equals another column of the same row was typed
// under the wrong column in the spec: a warning that names the column it belongs to.
export function compareSamples(rows, samples) {
  return samples.map((sample) => {
    const columns = Object.entries(sample.values);
    const filled = columns.filter(([, value]) => value !== '');
    let best = -1;
    let bestScore = 0;
    rows.forEach((row, i) => {
      const score = filled.filter(([column, value]) => agrees(value, row[column])).length;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best === -1 || bestScore < Math.ceil(filled.length / 2)) {
      return { label: sample.label, status: 'not found', row: null, checks: [] };
    }
    const row = rows[best];
    const checks = columns.map(([column, expected]) => {
      const result = compareValue(expected, row[column]);
      if (result.status === 'fail' && expected.trim().length >= 2) {
        const home = Object.keys(row).find((other) => other !== column && !other.startsWith('#') && agrees(expected, row[other]));
        if (home) Object.assign(result, { status: 'warn', why: 'column', belongsTo: home });
      }
      return { column, expected, actual: row[column] ?? '', ...result };
    });
    const status = checks.some((c) => c.status === 'fail')
      ? 'fail'
      : checks.some((c) => c.status === 'warn')
        ? 'warn'
        : 'pass';
    return { label: sample.label, status, row: best, checks };
  });
}

export function formatReport(results) {
  const lines = [];
  for (const r of results) {
    lines.push(`  ${r.status.toUpperCase().padEnd(9)} ${r.label}${r.row === null ? '' : ` (row ${r.row})`}`);
    for (const c of r.checks.filter((check) => check.status !== 'exact')) {
      lines.push(`      ${c.status}${c.why ? ` (${c.why === 'column' ? `belongs under ${c.belongsTo}` : c.why})` : ''} ${c.column}`);
      lines.push(`        expected: ${JSON.stringify(c.expected)}`);
      lines.push(`        got:      ${JSON.stringify(String(c.actual))}`);
    }
  }
  return lines.join('\n');
}
