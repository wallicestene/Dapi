// Pure helpers for reading captured responses: is it JSON, is it tracking, where are
// the records, what total does the source claim. Ported from spike/network-probe.js.

// Parses a body whatever its content-type says: servers send JSON as text/plain or
// javascript too. Returns undefined if it isn't JSON.
export function parseJson(body) {
  if (!body || body.length === 0) return undefined;
  // Some APIs prefix JSON with )]}' so it can't be run as a script.
  const text = body.toString('utf8').trim().replace(/^\)\]\}',?/, '').trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Hosts that serve analytics, ads, chat and surveys, never the page's own data.
const TRACKER_HOSTS = [
  'doubleclick.net', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com',
  'demdex.net', 'omtrdc.net', 'qualtrics.com', 'visualstudio.com', 'facebook.net',
  'facebook.com', 'linkedin.com', 'licdn.com', 'hotjar.com', 'clarity.ms', 'segment.io',
  'mixpanel.com', 'amplitude.com', 'sentry.io', 'nr-data.net', 'cloudflareinsights.com',
  'zohopublic.com', 'openai.com', 'arcgis.com',
];

export function isTracker(requestUrl) {
  const { hostname, pathname } = new URL(requestUrl);
  if (TRACKER_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h))) return true;
  // Adobe Analytics often runs on the site's own subdomain, e.g. smetrics.worldbank.org.
  if (/^s?metrics\./.test(hostname)) return true;
  return /\/(collect|track|beacon|pixel|telemetry|analytics)\b/.test(pathname);
}

// Finds the biggest list of similar-looking objects anywhere in the JSON, by bytes:
// 100 tiny filter options shouldn't beat 20 full records. Records can be an array or
// an object keyed by ID.
export function findRecords(value, path = '$', depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return null;

  const items = Array.isArray(value) ? value : Object.values(value);
  const objects = items.filter((v) => v && typeof v === 'object' && !Array.isArray(v));
  let best = null;

  // Rows can be arrays of cells, as in a DataTables `data: [[...], ...]`. Their keys
  // are the cell indexes ("0", "1", ...).
  const rows = Array.isArray(value) ? items.filter((v) => Array.isArray(v) && v.length >= 2) : [];
  if (rows.length >= 1 && rows.length === items.length && rows.every((r) => r.length === rows[0].length)) {
    return { path, count: rows.length, bytes: JSON.stringify(value).length, records: rows, tabular: true };
  }

  // An array of one object can be one record (a factory with a single issue); an
  // object of objects needs a few before it reads as records rather than config.
  const minimum = Array.isArray(value) ? 1 : 3;
  if (objects.length >= minimum && objects.length === items.length) {
    const firstKeys = Object.keys(objects[0]);
    const similar = objects.every((o) => firstKeys.filter((k) => k in o).length >= firstKeys.length / 2);
    if (similar) best = { path, count: objects.length, bytes: JSON.stringify(value).length, records: objects };
  }

  for (const [key, child] of Object.entries(value)) {
    const found = findRecords(child, `${path}.${key}`, depth + 1);
    if (found && (!best || found.bytes > best.bytes)) best = found;
  }
  return best;
}

// The source's own claim of how many records exist, which the completeness count
// checks against.
const TOTAL_KEYS = [
  'total', 'totalcount', 'total_count', 'totalresults', 'total_results', 'numfound',
  'recordstotal', 'totalhits', 'totalelements', 'totalitems', 'count',
];

export function findTotal(value, depth = 0) {
  if (depth > 2 || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (TOTAL_KEYS.includes(key.toLowerCase()) && Number.isFinite(Number(child))) {
      return { key, value: Number(child) };
    }
  }
  for (const child of Object.values(value)) {
    const found = findTotal(child, depth + 1);
    if (found) return found;
  }
  return null;
}

// Trims long strings, arrays and deep nesting so sample records fit in a small prompt.
export function shrink(value, depth = 0) {
  if (typeof value === 'string') return value.length > 120 ? value.slice(0, 120) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => shrink(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 2) return '{…}';
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([k, v]) => [k, shrink(v, depth + 1)]));
  }
  return value;
}

// "Data.3.Name" -> value. The same dot paths the frame's trace() uses.
export function at(json, path) {
  return path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), json);
}
