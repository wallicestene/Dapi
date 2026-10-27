// Site part for Better Work factory compliance, written by hand to prove the frame.
// The only code here that knows about the site: two undocumented endpoints, and
// how their answers become one row per issue.

const LIST_URL = 'https://portal.betterwork.org/Transparency/GetSuppliersComplianceData';
const DETAIL_URL = 'https://portal.betterwork.org/Issues/FactoryDetail4TransparencyCompliance';
const FORM = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };

export const start = [
  {
    url: LIST_URL,
    method: 'POST',
    headers: FORM,
    payload: 'countryId=&clusterId=&issueId=&factoryName=&assessmentStart=&assessmentEnd=&sort=&group=&filter=',
    label: 'LIST',
    note: 'factory list',
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "/Date(1756080000000)/" -> "25 Aug 2025". The timestamp is midnight UTC.
function formatDate(dotNetDate) {
  const d = new Date(Number(dotNetDate.match(/-?\d+/)[0]));
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export async function handle({ request, json, trace, enqueue, emit, expect }) {
  if (request.label === 'LIST') {
    expect('issue rows', json.Data.reduce((n, f) => n + f.NumberOfNonCompliances, 0));
    expect('rows for factories without issues', json.Data.filter((f) => f.NumberOfNonCompliances === 0).length);

    json.Data.forEach((f, i) => {
      const factory = {
        Factory: trace(`Data.${i}.Name`),
        Type: trace(`Data.${i}.FactoryType`),
        Country: trace(`Data.${i}.Country`),
        'Assessment Date': trace(`Data.${i}.AssessmentDate`, formatDate),
        Modality: trace(`Data.${i}.Modality`),
        Cycle: trace(`Data.${i}.CycleNumber`),
        Issues: trace(`Data.${i}.NumberOfNonCompliances`),
        Responses: trace(`Data.${i}.NumberOfResponse`),
      };

      if (f.NumberOfNonCompliances === 0) {
        emit(
          { ...factory, 'Publicly Reported Issue': '', 'Issue Theme': '', 'Legal Reference': '' },
          'rows for factories without issues'
        );
      } else {
        // The factory columns travel with the request, receipts included.
        enqueue({
          url: DETAIL_URL,
          method: 'POST',
          headers: FORM,
          payload: `assessmentId=${f.LastAssessmentId}&issueId=&clusterId=`,
          label: 'DETAIL',
          note: `issues of ${f.Name}`,
          userData: { factory },
        });
      }
    });
  }

  if (request.label === 'DETAIL') {
    const { factory } = request.userData;
    json.forEach((_, i) => {
      emit(
        {
          ...factory,
          'Publicly Reported Issue': trace(`${i}.IssueName`),
          'Issue Theme': trace([`${i}.ClusterName`, `${i}.CompliancePointName`], (cluster, point) => `${cluster}: ${point}`),
          'Legal Reference': trace(`${i}.LegalReference`),
        },
        'issue rows'
      );
    });
  }
}
