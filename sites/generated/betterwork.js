export const config = { maxConcurrency: 10, maxRequestsPerMinute: 480, maxRetries: 3 };

export const start = [
  {
    url: 'https://portal.betterwork.org/Transparency/GetSuppliersComplianceData',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    payload: 'countryId=&clusterId=&issueId=&factoryName=&assessmentStart=&assessmentEnd=&sort=&group=&filter=',
    label: 'list',
    note: 'factory compliance list (185 factories)'
  }
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDotNetDate(v) {
  if (typeof v !== 'string') return '';
  const m = /Date\((-?\d+)\)/.exec(v);
  if (!m) return '';
  const ms = parseInt(m[1], 10);
  if (ms === -62135596800000) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
function decodeEnt(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}
function toStr(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}
function cleanStr(v) {
  if (v === null || v === undefined) return '';
  return decodeEnt(String(v)).trim();
}

export async function handle(ctx) {
  const label = ctx.request.label || 'list';
  if (label === 'detail') {
    const factories = (ctx.request.userData && ctx.request.userData.factories) || [];
    let arr = [];
    if (Array.isArray(ctx.json)) arr = ctx.json;
    else if (ctx.json && Array.isArray(ctx.json.Data)) arr = ctx.json.Data;
    else arr = [];
    if (arr.length === 0) {
      for (const f of factories) {
        const base = f.base || {};
        ctx.emit({
          'Factory': base['Factory'],
          'Type': base['Type'],
          'Country': base['Country'],
          'Assessment Date': base['Assessment Date'],
          'Modality': base['Modality'],
          'Cycle': base['Cycle'],
          'Issues': base['Issues'],
          'Responses': base['Responses'],
          'Publicly Reported Issue': '',
          'Issue Theme': '',
          'Legal Reference': ''
        }, 'issue rows');
      }
      // if userData shape was old single-base, still avoid drop
      if (factories.length === 0 && ctx.request.userData && ctx.request.userData.base) {
        const base = ctx.request.userData.base;
        ctx.emit({
          'Factory': base['Factory'],
          'Type': base['Type'],
          'Country': base['Country'],
          'Assessment Date': base['Assessment Date'],
          'Modality': base['Modality'],
          'Cycle': base['Cycle'],
          'Issues': base['Issues'],
          'Responses': base['Responses'],
          'Publicly Reported Issue': '',
          'Issue Theme': '',
          'Legal Reference': ''
        }, 'issue rows');
      }
      return;
    }
    // One detail response per assessmentId. In the normal case one factory per assessmentId.
    // If several factories share one assessmentId, repeat the same issue list for each.
    const targets = factories.length ? factories : [{ base: ctx.request.userData.base }] ;
    for (const f of targets) {
      const base = f.base;
      if (!base) continue;
      for (let j = 0; j < arr.length; j++) {
        const issue = ctx.trace(j + '.IssueName', cleanStr);
        const theme = ctx.trace([j + '.ClusterName', j + '.CompliancePointName'], (c, p) => {
          const cs = decodeEnt(String(c || '')).trim();
          const ps = decodeEnt(String(p || '')).trim();
          if (cs && ps) return cs + ': ' + ps;
          return cs || ps || '';
        });
        const legal = ctx.trace(j + '.LegalReference', cleanStr);
        ctx.emit({
          'Factory': base['Factory'],
          'Type': base['Type'],
          'Country': base['Country'],
          'Assessment Date': base['Assessment Date'],
          'Modality': base['Modality'],
          'Cycle': base['Cycle'],
          'Issues': base['Issues'],
          'Responses': base['Responses'],
          'Publicly Reported Issue': issue,
          'Issue Theme': theme,
          'Legal Reference': legal
        }, 'issue rows');
      }
    }
    return;
  }
  // list
  const data = (ctx.json && ctx.json.Data) ? ctx.json.Data : [];
  const groups = new Map();
  let expectedRows = 0;
  const immediate = [];
  for (let i = 0; i < data.length; i++) {
    const raw = data[i] || {};
    const nIssues = (typeof raw.NumberOfNonCompliances === 'number') ? raw.NumberOfNonCompliances : parseInt(raw.NumberOfNonCompliances, 10);
    const safeN = isNaN(nIssues) ? 0 : nIssues;
    expectedRows += safeN > 0 ? safeN : 1;
    const base = {
      'Factory': ctx.trace('Data.' + i + '.Name', cleanStr),
      'Type': ctx.trace('Data.' + i + '.FactoryType', cleanStr),
      'Country': ctx.trace('Data.' + i + '.Country', cleanStr),
      'Assessment Date': ctx.trace('Data.' + i + '.AssessmentDate', fmtDotNetDate),
      'Modality': ctx.trace('Data.' + i + '.Modality', cleanStr),
      'Cycle': ctx.trace('Data.' + i + '.CycleNumber', toStr),
      'Issues': ctx.trace('Data.' + i + '.NumberOfNonCompliances', toStr),
      'Responses': ctx.trace('Data.' + i + '.NumberOfResponse', toStr)
    };
    const assessmentId = raw.LastAssessmentId;
    const rawName = raw.Name || ('factory index ' + i);
    if (!safeN || !assessmentId) {
      // no issues, or no detail id to fetch: emit one row with blank issue columns
      immediate.push(base);
    } else {
      if (!groups.has(assessmentId)) groups.set(assessmentId, []);
      groups.get(assessmentId).push({ base: base, issuesCount: safeN, name: rawName });
    }
  }
  ctx.expect('issue rows', expectedRows);
  for (const base of immediate) {
    ctx.emit({
      'Factory': base['Factory'],
      'Type': base['Type'],
      'Country': base['Country'],
      'Assessment Date': base['Assessment Date'],
      'Modality': base['Modality'],
      'Cycle': base['Cycle'],
      'Issues': base['Issues'],
      'Responses': base['Responses'],
      'Publicly Reported Issue': '',
      'Issue Theme': '',
      'Legal Reference': ''
    }, 'issue rows');
  }
  for (const [assessmentId, list] of groups.entries()) {
    const factories = list.map(e => ({ base: e.base, issuesCount: e.issuesCount }));
    const fallback = [];
    for (const e of list) {
      for (let k = 0; k < e.issuesCount; k++) {
        fallback.push({
          row: {
            'Factory': e.base['Factory'],
            'Type': e.base['Type'],
            'Country': e.base['Country'],
            'Assessment Date': e.base['Assessment Date'],
            'Modality': e.base['Modality'],
            'Cycle': e.base['Cycle'],
            'Issues': e.base['Issues'],
            'Responses': e.base['Responses'],
            'Publicly Reported Issue': '',
            'Issue Theme': '',
            'Legal Reference': ''
          },
          kind: 'issue rows'
        });
      }
    }
    const firstName = list[0].name;
    ctx.enqueue({
      url: 'https://portal.betterwork.org/Issues/FactoryDetail4TransparencyCompliance',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      payload: 'assessmentId=' + encodeURIComponent(String(assessmentId)) + '&issueId=&clusterId=',
      label: 'detail',
      note: 'issues for ' + firstName + ' (assessment ' + assessmentId + ')',
      userData: { factories: factories },
      fallback: fallback
    });
  }
}
