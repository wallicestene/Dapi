function decodeHtml(s) {
  if (s == null) return "";
  if (typeof s !== "string") s = String(s);
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === "#") {
      let code;
      if (ent[1] === "x" || ent[1] === "X") code = parseInt(ent.slice(2), 16);
      else code = parseInt(ent.slice(1), 10);
      if (!isNaN(code)) return String.fromCharCode(code);
      return m;
    }
    switch (ent) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      case "nbsp": return " ";
      default: return m;
    }
  });
}
function formatDotNetDate(v) {
  if (v == null) return "";
  if (typeof v !== "string") v = String(v);
  const m = /\/Date\((-?\d+)\)\//.exec(v);
  if (!m) return "";
  const ms = parseInt(m[1], 10);
  if (ms === -62135596800000) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear();
}
function textVal(v) {
  if (v == null) return "";
  return decodeHtml(String(v));
}
function numVal(v) {
  if (v == null || v === "") return "";
  return String(v);
}
export const start = [
  {
    url: "https://portal.betterwork.org/Transparency/GetSuppliersComplianceData",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    payload: "countryId=&clusterId=&issueId=&factoryName=&assessmentStart=&assessmentEnd=&sort=&group=&filter=",
    label: "list",
    note: "factory compliance list",
    userData: {}
  }
];
export async function handle(ctx) {
  const label = ctx.request.label;
  if (label === "list") {
    const data = (ctx.json && Array.isArray(ctx.json.Data)) ? ctx.json.Data : [];
    for (let i = 0; i < data.length; i++) {
      const rec = data[i] || {};
      const rawIssues = rec.NumberOfNonCompliances;
      let issuesCount = 0;
      if (typeof rawIssues === "number") issuesCount = rawIssues;
      else if (rawIssues != null && rawIssues !== "") issuesCount = parseInt(String(rawIssues), 10);
      if (isNaN(issuesCount)) issuesCount = 0;
      const rawAid = rec.LastAssessmentId;
      const tFactory = ctx.trace("Data." + i + ".Name", textVal);
      const tType = ctx.trace("Data." + i + ".FactoryType", textVal);
      const tCountry = ctx.trace("Data." + i + ".Country", textVal);
      const tAssess = ctx.trace("Data." + i + ".AssessmentDate", (v) => formatDotNetDate(v));
      const tModality = ctx.trace("Data." + i + ".Modality", textVal);
      const tCycle = ctx.trace("Data." + i + ".CycleNumber", numVal);
      const tIssues = ctx.trace("Data." + i + ".NumberOfNonCompliances", numVal);
      const tResponses = ctx.trace("Data." + i + ".NumberOfResponse", numVal);
      if (!issuesCount || !rawAid) {
        ctx.expect("issue rows", 1);
        ctx.emit({
          "Factory": tFactory,
          "Type": tType,
          "Country": tCountry,
          "Assessment Date": tAssess,
          "Modality": tModality,
          "Cycle": tCycle,
          "Issues": tIssues,
          "Responses": tResponses,
          "Publicly Reported Issue": "",
          "Issue Theme": "",
          "Legal Reference": ""
        }, "issue rows");
      } else {
        ctx.expect("issue rows", issuesCount);
        ctx.enqueue({
          url: "https://portal.betterwork.org/Issues/FactoryDetail4TransparencyCompliance",
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          payload: "assessmentId=" + rawAid + "&issueId=&clusterId=",
          label: "detail",
          note: "issues for assessment " + rawAid,
          userData: {
            Factory: tFactory,
            Type: tType,
            Country: tCountry,
            AssessmentDate: tAssess,
            Modality: tModality,
            Cycle: tCycle,
            Issues: tIssues,
            Responses: tResponses,
            assessmentId: rawAid
          }
        });
      }
    }
    return;
  }
  if (label === "detail") {
    const ud = ctx.request.userData || {};
    const arr = Array.isArray(ctx.json) ? ctx.json : [];
    if (arr.length === 0) {
      ctx.emit({
        "Factory": ud.Factory || "",
        "Type": ud.Type || "",
        "Country": ud.Country || "",
        "Assessment Date": ud.AssessmentDate || "",
        "Modality": ud.Modality || "",
        "Cycle": ud.Cycle || "",
        "Issues": ud.Issues || "",
        "Responses": ud.Responses || "",
        "Publicly Reported Issue": "",
        "Issue Theme": "",
        "Legal Reference": ""
      }, "issue rows");
      return;
    }
    for (let j = 0; j < arr.length; j++) {
      const tIssue = ctx.trace(j + ".IssueName", textVal);
      const tTheme = ctx.trace([j + ".ClusterName", j + ".CompliancePointName"], (a, b) => {
        const ca = a == null || a === "" ? "" : decodeHtml(String(a));
        const cb = b == null || b === "" ? "" : decodeHtml(String(b));
        if (ca && cb) return ca + ": " + cb;
        return ca || cb || "";
      });
      const tLegal = ctx.trace(j + ".LegalReference", textVal);
      ctx.emit({
        "Factory": ud.Factory || "",
        "Type": ud.Type || "",
        "Country": ud.Country || "",
        "Assessment Date": ud.AssessmentDate || "",
        "Modality": ud.Modality || "",
        "Cycle": ud.Cycle || "",
        "Issues": ud.Issues || "",
        "Responses": ud.Responses || "",
        "Publicly Reported Issue": tIssue,
        "Issue Theme": tTheme,
        "Legal Reference": tLegal
      }, "issue rows");
    }
    return;
  }
}
