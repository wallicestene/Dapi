// Tester: checks extracted rows against the spec's sample rows. Samples are copied
// out of documents, so a difference only in whitespace or a trailing slash is a
// warning, not a failure (see SKILL.md, "Spec reader").

// Equal after dropping all whitespace and trailing slashes. Case still counts.
export function loose(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/\/+$/, '');
}

function compareValue(expected, actual) {
  const got = actual === undefined || actual === null ? '' : String(actual);
  if (got === expected) return 'exact';
  if (loose(got) === loose(expected)) return 'warn';
  return 'fail';
}

// For each sample, finds the row that agrees with it on the most non-empty values,
// then checks every column the sample gives, blanks included. A sample that no row
// agrees with on at least half its non-empty values is "not found".
export function compareSamples(rows, samples) {
  return samples.map((sample) => {
    const columns = Object.entries(sample.values);
    const filled = columns.filter(([, value]) => value !== '');

    let best = -1;
    let bestScore = 0;
    rows.forEach((row, i) => {
      const score = filled.filter(([column, value]) => compareValue(value, row[column]) !== 'fail').length;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best === -1 || bestScore < Math.ceil(filled.length / 2)) {
      return { label: sample.label, status: 'not found', row: null, checks: [] };
    }

    const checks = columns.map(([column, expected]) => ({
      column,
      expected,
      actual: rows[best][column] ?? '',
      status: compareValue(expected, rows[best][column]),
    }));
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
      lines.push(`      ${c.status} ${c.column}`);
      lines.push(`        expected: ${JSON.stringify(c.expected)}`);
      lines.push(`        got:      ${JSON.stringify(String(c.actual))}`);
    }
  }
  return lines.join('\n');
}
