export const start = [{ url: "https://www.greatplacetowork.in/certified-companies/", label: "list", note: "Certified companies list with all size tables", userData: {} }];

function decodeEntities(s) {
  if (typeof s !== "string") return s;
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function cleanText(v) {
  if (typeof v === "string") return decodeEntities(v).trim();
  if (v == null) return v;
  return String(v).trim();
}

function cleanEmp(v) {
  if (v == null) return v;
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

function issuePart(v) {
  if (typeof v !== "string") return v;
  const s = v.trim();
  const parts = s.split(/\s+to\s+|\s*[-\u2013\u2014]\s*/i);
  if (parts.length >= 2) return parts[0].trim();
  return s;
}

function expPart(v) {
  if (typeof v !== "string") return v;
  const s = v.trim();
  const parts = s.split(/\s+to\s+|\s*[-\u2013\u2014]\s*/i);
  if (parts.length >= 2) return parts[parts.length - 1].trim();
  return "";
}

function cleanDetail(v) {
  if (typeof v === "string") return decodeEntities(v).trim();
  if (v == null) return v;
  if (typeof v === "number") return String(v).trim();
  return v;
}

function extractUrl(cell, base) {
  if (typeof cell !== "string") return null;
  const m = cell.match(/href\s*=\s*(['"])(.*?)\1/i);
  if (!m) return null;
  let u = m[2].replace(/\\\//g, "/").trim();
  if (!u) return null;
  u = decodeEntities(u).trim();
  if (!u || u === "#") return null;
  try {
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/")) return "https://www.greatplacetowork.in" + u;
    const abs = new URL(u, base || "https://www.greatplacetowork.in/").toString();
    return abs;
  } catch (e) {
    return u;
  }
}

export async function handle(ctx) {
  const label = ctx.request && ctx.request.label;
  if (label === "list") {
    const defs = [
      { key: "large", size: "Large Organizations" },
      { key: "mid", size: "Mid-size Organizations" },
      { key: "small", size: "Small Organizations" },
      { key: "mega", size: "Mega Organizations" }
    ];
    const byUrl = new Map();
    for (const def of defs) {
      const entry = (ctx.embedded || []).find(e => e.context && e.context.includes("memListTable-" + def.key));
      if (!entry || !entry.value || !Array.isArray(entry.value.data)) continue;
      const data = entry.value.data;
      ctx.expect("companies", data.length);
      for (let i = 0; i < data.length; i++) {
        const base = "embedded:" + entry.name + ".data." + i;
        const org = ctx.trace(base + ".0", cleanText);
        const ind = ctx.trace(base + ".1", cleanText);
        const emp = ctx.trace(base + ".2", cleanEmp);
        const issue = ctx.trace(base + ".3", issuePart);
        const exp = ctx.trace(base + ".3", expPart);
        let rawCell = null;
        try { rawCell = data[i][4]; } catch (e) { rawCell = null; }
        const durl = extractUrl(rawCell, ctx.request.url);
        if (!durl) {
          ctx.emit({
            "Organization name": org,
            "Country": "India",
            "Industry": ind,
            "No. of employees": emp,
            "Issue Date": issue,
            "Expiration Date": exp,
            "Website": "",
            "Facebook URL": "",
            "Instagram URL": "",
            "LinkedIn URL": "",
            "HQ Location": "",
            "Company Description": "",
            "Organization Size": def.size
          }, "companies");
        } else {
          const rec = { org, ind, emp, issue, exp, size: def.size };
          if (!byUrl.has(durl)) byUrl.set(durl, []);
          byUrl.get(durl).push(rec);
        }
      }
    }
    for (const [u, rows] of byUrl) {
      ctx.enqueue({ url: u, label: "detail", note: "Company profile page", userData: { rows } });
    }
    return;
  }
  if (label === "detail") {
    const rows = (ctx.request.userData && ctx.request.userData.rows) || [];
    if (!rows.length) return;
    const websiteT = ctx.trace("css:div.col-lg-4.socialicon ul li a:not([href*='facebook.com']):not([href*='instagram.com']):not([href*='linkedin.com']):not([href*='twitter.com']):not([href*='youtube.com'])@href", cleanDetail);
    const fbT = ctx.trace("css:.socialicon a[href*='facebook.com']@href", cleanDetail);
    const igT = ctx.trace("css:.socialicon a[href*='instagram.com']@href", cleanDetail);
    const liT = ctx.trace("css:.socialicon a[href*='linkedin.com']@href", cleanDetail);
    const hqT = ctx.trace("css:*:contains('HQ LOCATION') + p", cleanDetail);
    const descT = ctx.trace("css:div.why-great-content p", cleanDetail);
    const websiteOut = (websiteT === undefined || websiteT === null) ? "" : websiteT;
    const fbOut = (fbT === undefined || fbT === null) ? "" : fbT;
    const igOut = (igT === undefined || igT === null) ? "" : igT;
    const liOut = (liT === undefined || liT === null) ? "" : liT;
    const hqOut = (hqT === undefined || hqT === null) ? "" : hqT;
    const descOut = (descT === undefined || descT === null) ? "" : descT;
    for (const r of rows) {
      ctx.emit({
        "Organization name": r.org,
        "Country": "India",
        "Industry": r.ind,
        "No. of employees": r.emp,
        "Issue Date": r.issue,
        "Expiration Date": r.exp,
        "Website": websiteOut,
        "Facebook URL": fbOut,
        "Instagram URL": igOut,
        "LinkedIn URL": liOut,
        "HQ Location": hqOut,
        "Company Description": descOut,
        "Organization Size": r.size
      }, "companies");
    }
    return;
  }
}
