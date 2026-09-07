// the two agencies a reader can report a posting to. copy, not data: verified against the agency pages on
// 2026-09-05 (cchr online form takes anonymous tips; dol's is the combined pay equity / salary history /
// pay transparency complaint form and the faq says the public may report a posting they merely noticed)
export interface Law {
  code: 'nyc' | 'nys';
  name: string;
  statuteCite: string;
  agency: string;
  complaintUrl: string;
  complaintLabel: string;
  coverageRule: string;
}

export const LAWS: Law[] = [
  {
    code: 'nyc',
    name: 'New York City',
    statuteCite: 'NYC Admin. Code § 8-107(32) (Local Laws 32 and 59 of 2022)',
    agency: 'NYC Commission on Human Rights',
    complaintUrl: 'https://www.nyc.gov/site/cchr/about/report-discrimination.page',
    complaintLabel: 'Report to the NYC Commission on Human Rights',
    coverageRule:
      'Employers with 4+ employees (at least one in NYC). Any advertised job that can or will be performed at least in part in New York City. Temporary help firms exempt. No penalty for a first complaint fixed within 30 days. Anonymous tips accepted; call 311 or (212) 416-0197.',
  },
  {
    code: 'nys',
    name: 'New York State',
    statuteCite: 'NY Labor Law § 194-b',
    agency: 'New York State Department of Labor',
    complaintUrl: 'https://dol.ny.gov/pay-equitysalary-historypay-transparency-complaint-form',
    complaintLabel: 'Report to the NYS Department of Labor',
    coverageRule:
      'Employers with 4+ employees. Any advertised job physically performed at least in part in New York State, or performed elsewhere but reporting to a NYS supervisor, office or worksite. Temporary help firms exempt. Anyone who notices a non-compliant posting may report it; Division of Labor Standards, 1-888-52-LABOR, LSAsk@labor.ny.gov.',
  },
];
