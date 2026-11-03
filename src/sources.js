// Sources we may use (AGENTS.md): sites whose data is public and whose terms let us
// collect and show it, each reviewed before use. The public demo runs jobs only on
// these; Dapi run by its owner reads AGENTS.md's rule instead.

export const REVIEWED = [
  { host: 'www.arbeidstilsynet.no', name: "Arbeidstilsynet's approved occupational health services", why: 'released as Norwegian open government data (NLOD 2.0)' },
  { host: 'portal.betterwork.org', name: 'Better Work Transparency Portal', why: 'published so anyone can see factory findings' },
  { host: 'www.fda.gov', name: 'FDA warning letters', why: "public domain under FDA's website policy" },
  { host: 'books.toscrape.com', name: 'Books to Scrape', why: 'made for practising extraction' },
  { host: 'quotes.toscrape.com', name: 'Quotes to Scrape', why: 'made for practising extraction' },
  { host: 'en.wikipedia.org', name: 'Wikipedia', why: 'CC BY-SA' },
];

export function reviewed(url) {
  try {
    const host = new URL(url).host.replace(/^www\./, '');
    return REVIEWED.find((s) => s.host.replace(/^www\./, '') === host) ?? null;
  } catch {
    return null;
  }
}
