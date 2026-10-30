// Resolves the trace syntax for HTML against a cheerio page, for the investigator and
// the frame alike: "css:<selector>" is the first match's text, "css:<selector>@<attr>"
// its attribute, and "css*:..." the same for every match, as an array.

export function select($, locator) {
  const all = locator.startsWith('css*:');
  const body = locator.slice(all ? 5 : 4);
  const at = body.lastIndexOf('@');
  const hasAttr = at > 0 && /^[\w-]+$/.test(body.slice(at + 1));
  const selector = hasAttr ? body.slice(0, at) : body;
  const attr = hasAttr ? body.slice(at + 1) : null;
  const read = (el) => (attr ? ($(el).attr(attr) ?? '').trim() : $(el).text().replace(/\s+/g, ' ').trim());
  const els = $(selector).toArray();
  return all ? els.map(read) : els.length ? read(els[0]) : '';
}
