// not a job: general applications, talent pools, volunteers. these never become findings
export const EVERGREEN_TITLE_RE =
  /general (application|interest|opportunit)|open application|talent (pool|network|community|pipeline)|future (opportunit|role|opening)|volunteer|expression of interest|don.?t see (a|the|your) (role|position|job)|join our (team|network|community)|speculative application|unsolicited|apply here if|not listed|evergreen|prospective|dream job/i;

export function isEvergreenTitle(title: string): boolean {
  return EVERGREEN_TITLE_RE.test(title);
}
