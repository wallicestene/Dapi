// The delivered rows as a file people can open anywhere: CSV, Excel, JSON, XML or an
// HTML table. Every format is built from the same rows in the spec's columns (translated
// where the job translated them), so a file always matches the table on screen.

import { strToU8, zipSync } from "fflate";

export type Format = "csv" | "xlsx" | "json" | "xml" | "html";
type Rows = Record<string, string>[];
interface Sheet {
  title: string;
  source: string | null;
  columns: string[];
  rows: Rows;
}

export const FORMATS: Record<Format, { ext: string; type: string; build: (s: Sheet) => string | Uint8Array }> = {
  csv: { ext: "csv", type: "text/csv; charset=utf-8", build: csv },
  xlsx: { ext: "xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", build: xlsx },
  json: { ext: "json", type: "application/json; charset=utf-8", build: ({ rows }) => JSON.stringify(rows, null, 2) },
  xml: { ext: "xml", type: "application/xml; charset=utf-8", build: xml },
  html: { ext: "html", type: "text/html; charset=utf-8", build: html },
};

function csv({ columns, rows }: Sheet) {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))];
  // A BOM so Excel reads non-English text (ø, å) right.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// Text as XML allows it: escaped, without the control characters XML forbids.
const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// A column name as an XML element name: "Assessment Date" -> assessment_date.
function tagNames(columns: string[]) {
  const seen = new Map<string, number>();
  return columns.map((c) => {
    let tag = c.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "column";
    if (/^(\d|xml)/i.test(tag)) tag = `_${tag}`;
    const n = (seen.get(tag) ?? 0) + 1;
    seen.set(tag, n);
    return n === 1 ? tag : `${tag}_${n}`;
  });
}

function xml({ title, source, columns, rows }: Sheet) {
  const tags = tagNames(columns);
  const body = rows.map((r) => `  <row>\n${columns.map((c, i) => `    <${tags[i]}>${esc(r[c])}</${tags[i]}>`).join("\n")}\n  </row>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rows title="${esc(title)}"${source ? ` source="${esc(source)}"` : ""} count="${rows.length}">\n${body}\n</rows>\n`;
}

function html({ title, source, columns, rows }: Sheet) {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { margin: 32px; font: 14px/1.45 system-ui, sans-serif; color: #1d2c3a; background: #fbfbf7; }
  h1 { margin: 0; font-size: 22px; }
  p { margin: 4px 0 20px; color: #4d5b66; }
  table { border-collapse: collapse; background: #fff; }
  th, td { padding: 7px 12px; border: 1px solid #dfe2d6; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: #f2f3ea; font-weight: 600; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p>${rows.length.toLocaleString("en-US")} rows${source ? ` from ${esc(source)}` : ""} · exported from Dapi on ${date}</p>
<table>
<thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>
${rows.map((r) => `<tr>${columns.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("\n")}
</tbody>
</table>
</body>
</html>
`;
}

// A real .xlsx, written by hand: a zip of SpreadsheetML parts. One sheet, the header row
// bold and frozen, columns sized to their content. Whole numbers and decimals become
// numbers; anything an ID could be (a leading zero, more than 15 digits) stays text.
function xlsx({ title, columns, rows }: Sheet) {
  const col = (i: number) => {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const number = (v: string) => /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v);
  const cell = (v: string, ref: string, style = 0) => {
    if (v === "") return "";
    if (!style && number(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    const text = esc(v.slice(0, 32767));
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""}>${text}</t></is></c>`;
  };
  const widths = columns.map((c) => Math.min(60, Math.max(c.length + 2, ...rows.slice(0, 500).map((r) => (r[c] ?? "").length + 1))));
  const sheetRows = [
    `<row r="1">${columns.map((c, i) => cell(c, `${col(i)}1`, 1)).join("")}</row>`,
    ...rows.map((r, n) => `<row r="${n + 2}">${columns.map((c, i) => cell(r[c] ?? "", `${col(i)}${n + 2}`)).join("")}</row>`),
  ].join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${col(Math.max(columns.length, 1) - 1)}${rows.length + 1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  // Excel limits a sheet's name to 31 characters, without : \ / ? * [ ].
  const name = esc(title.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Rows");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])), { level: 6 });
}
