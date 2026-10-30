export const config = { maxConcurrency: 10, maxRequestsPerMinute: 480, maxRetries: 3 };
export const start = [{ url: "https://www.greatplacetowork.in/certified-companies/", label: "list", note: "certified companies list (all sizes)" }];
export async function handle(ctx) {
  const decodeEnt = (v) => {
    if (typeof v !== "string") return "";
    let s = v;
    s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
    s = s.replace(/&#(\d+);/g, (m, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return m; } });
    s = s.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; } });
    return s.trim();
  };
  const splitFirst = (v) => {
    if (typeof v !== "string") return "";
    let parts = v.split(" - ");
    if (parts.length < 2) parts = v.split(/\s*[\u2013\u2014]\s*|\s+to\s+/i);
    if (parts.length < 2) parts = v.split(/\s*-\s*/);
    return (parts[0] || "").trim();
  };
  const splitSecond = (v) => {
    if (typeof v !== "string") return "";
    let parts = v.split(" - ");
    if (parts.length < 2) parts = v.split(/\s*[\u2013\u2014]\s*|\s+to\s+/i);
    if (parts.length < 2) parts = v.split(/\s*-\s*/);
    if (parts.length < 2) return "";
    return parts.slice(1).join(" - ").trim();
  };
  const extractHref = (v) => {
    if (typeof v !== "string") return "";
    const m = v.match(/href\s*=\s*(['"])(.*?)\1/i);
    if (!m) return "";
    let u = (m[2] || "").trim();
    if (u.indexOf("//") === 0) u = "https:" + u;
    return u;
  };
  const fixUrl = (v) => {
    if (typeof v !== "string") return "";
    let u = v.trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) u = "https:" + u;
    return u;
  };
  const pickWebsite = (v) => {
    if (!Array.isArray(v)) return fixUrl(v);
    for (let i = 0; i < v.length; i++) {
      let u = (typeof v[i] === "string" ? v[i] : "").trim();
      if (!u) continue;
      const low = u.toLowerCase();
      if (low.indexOf("facebook.com") !== -1) continue;
      if (low.indexOf("instagram.com") !== -1) continue;
      if (low.indexOf("linkedin.com") !== -1) continue;
      if (low.indexOf("twitter") !== -1) continue;
      if (low.indexOf("youtube.com") !== -1) continue;
      if (low.indexOf("youtu.be") !== -1) continue;
      if (u.indexOf("//") === 0) u = "https:" + u;
      return u;
    }
    return "";
  };
  const cleanText = (v) => {
    if (typeof v !== "string") return "";
    return v.replace(/\s+/g, " ").trim();
  };
  const label = ctx.request && ctx.request.label;
  if (!label || label === "list") {
    const tables = [
      { needle: "memListTable-large", size: "Large Organizations" },
      { needle: "memListTable-mid", size: "Mid-size Organizations" },
      { needle: "memListTable-small", size: "Small Organizations" },
      { needle: "memListTable-mega", size: "Mega Organizations" }
    ];
    const embedded = ctx.embedded || [];
    const found = [];
    let total = 0;
    for (let t = 0; t < tables.length; t++) {
      const needle = tables[t].needle;
      let entry = null;
      for (let e = 0; e < embedded.length; e++) {
        const c = embedded[e].context || "";
        if (c.indexOf(needle) !== -1) { entry = embedded[e]; break; }
      }
      if (!entry) continue;
      let data = null;
      if (entry.value && Array.isArray(entry.value.data)) data = entry.value.data;
      else if (Array.isArray(entry.value)) data = entry.value;
      else data = [];
      total += data.length;
      found.push({ table: tables[t], entry: entry, data: data });
    }
    ctx.expect("companies", total);
    const byUrl = new Map();
    for (let f = 0; f < found.length; f++) {
      const table = found[f].table;
      const entry = found[f].entry;
      const data = found[f].data;
      for (let i = 0; i < data.length; i++) {
        const base = "embedded:" + entry.name + ".data." + i;
        const orgT = ctx.trace(base + ".0");
        const indT = ctx.trace(base + ".1", decodeEnt);
        const empT = ctx.trace(base + ".2");
        const issueT = ctx.trace(base + ".3", splitFirst);
        const expT = ctx.trace(base + ".3", splitSecond);
        const linkT = ctx.trace(base + ".4", extractHref);
        let detailUrl = "";
        try { detailUrl = linkT && linkT.value ? String(linkT.value).trim() : ""; } catch (e) { detailUrl = ""; }
        if (detailUrl.indexOf("//") === 0) detailUrl = "https:" + detailUrl;
        const baseObj = { org: orgT, ind: indT, emp: empT, issue: issueT, exp: expT, size: table.size };
        if (detailUrl) {
          if (!byUrl.has(detailUrl)) byUrl.set(detailUrl, []);
          byUrl.get(detailUrl).push(baseObj);
        } else {
          ctx.emit({
            "Organization name": orgT,
            "Country": "India",
            "Industry": indT,
            "No. of employees": empT,
            "Issue Date": issueT,
            "Expiration Date": expT,
            "Website": "",
            "Facebook URL": "",
            "Instagram URL": "",
            "LinkedIn URL": "",
            "HQ Location": "",
            "Company Description": "",
            "Organization Size": table.size
          }, "companies");
        }
      }
    }
    for (const [url, bases] of byUrl) {
      let firstName = url;
      try { if (bases[0] && bases[0].org && bases[0].org.value) firstName = String(bases[0].org.value); } catch (e) {}
      const fallbacks = bases.map((b) => ({
        row: {
          "Organization name": b.org,
          "Country": "India",
          "Industry": b.ind,
          "No. of employees": b.emp,
          "Issue Date": b.issue,
          "Expiration Date": b.exp,
          "Website": "",
          "Facebook URL": "",
          "Instagram URL": "",
          "LinkedIn URL": "",
          "HQ Location": "",
          "Company Description": "",
          "Organization Size": b.size
        },
        kind: "companies"
      }));
      const userBases = bases.map((b) => ({ org: b.org, ind: b.ind, emp: b.emp, issue: b.issue, exp: b.exp, size: b.size }));
      ctx.enqueue({
        url: url,
        label: "profile",
        note: "profile of " + firstName,
        userData: { bases: userBases },
        fallback: fallbacks
      });
    }
    return;
  }
  if (label === "profile") {
    const ud = (ctx.request && ctx.request.userData) || {};
    const bases = Array.isArray(ud.bases) ? ud.bases : [];
    if (bases.length === 0) return;
    let websiteT = ctx.trace("css:.socialicon ul li a:not([href*='facebook.com']):not([href*='instagram.com']):not([href*='linkedin.com']):not([href*='twitter']):not([href*='youtube.com'])@href", fixUrl);
    try { if (!websiteT.value) websiteT = ctx.trace("css*:.socialicon ul li a@href", pickWebsite); } catch (e) {}
    const fbT = ctx.trace("css:.socialicon a[href*='facebook.com']@href", fixUrl);
    const igT = ctx.trace("css:.socialicon a[href*='instagram.com']@href", fixUrl);
    const liT = ctx.trace("css:.socialicon a[href*='linkedin.com']@href", fixUrl);
    const hqT = ctx.trace("css:h6:contains('HQ LOCATION') + p", cleanText);
    const descT = ctx.trace("css:.why-great-content p", cleanText);
    for (let i = 0; i < bases.length; i++) {
      const b = bases[i];
      ctx.emit({
        "Organization name": b.org,
        "Country": "India",
        "Industry": b.ind,
        "No. of employees": b.emp,
        "Issue Date": b.issue,
        "Expiration Date": b.exp,
        "Website": websiteT,
        "Facebook URL": fbT,
        "Instagram URL": igT,
        "LinkedIn URL": liT,
        "HQ Location": hqT,
        "Company Description": descT,
        "Organization Size": b.size
      }, "companies");
    }
    return;
  }
}
