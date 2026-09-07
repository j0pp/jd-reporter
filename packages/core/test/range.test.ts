import { describe, expect, it } from 'vitest';
import { applyOffsiteRule, classifyRange } from '../src/classifier/range.ts';
import type { StructuredComp } from '../src/types.ts';

const text = (t: string, title = 'Software Engineer') => classifyRange({ text: t, structured: null, title });

describe('range classifier: the format zoo from FINDINGS', () => {
  it.each([
    ['$124,979.94 — $141,000', 124979.94, 141000, 'year'],
    ['The pay range is $85 — $97 USD per hour.', 85, 97, 'hour'],
    ['Salary: $400,000-600,000 depending on experience', 400000, 600000, 'year'],
    ['Base pay $ 243 , 800 -$ 303 , 000 /year', 243800, 303000, 'year'],
    ['USD$115,000.00 - USD$147,500.00', 115000, 147500, 'year'],
    ['Compensation: $120-150k plus equity', 120000, 150000, 'year'],
    ['Base salary $120 - $150 plus equity', 120000, 150000, 'year'],
    ['Base salary $120,000 - $150,000 plus a $20K bonus', 120000, 150000, 'year'],
    ['The base salary range for this role is $110,000 to $130,000.', 110000, 130000, 'year'],
    ['Salary Range: $1,850 - $2,300 per month', 1850, 2300, 'month'],
  ])('reads %s as a text range', (t, min, max, period) => {
    const r = text(t);
    expect(r.method).toBe('text_range');
    expect(r.min).toBe(min);
    expect(r.max).toBe(max);
    expect(r.period).toBe(period);
    expect(r.evidenceSpan).toBeTruthy();
  });

  it.each([
    ['The base salary for this role is $110,000 (OTE $295,000).', 110000, 'year'],
    ['Interns are paid $10,000/month.', 10000, 'month'],
    ['New York, NY Pay Rate: USD $17.25', 17.25, 'hour'],
    ['The base pay for this role is: 21.50 per hour', 21.5, 'hour'],
    ['Annual Salary - 54,313.06 USD', 54313.06, 'year'],
    ['This position pays $18 per hour.', 18, 'hour'],
  ])('reads %s as a single stated figure (compliant)', (t, v, period) => {
    const r = text(t);
    expect(r.method).toBe('fixed_rate');
    expect(r.min).toBe(v);
    expect(r.max).toBe(v);
    expect(r.period).toBe(period);
  });

  it.each([
    ['Compensation: up to $325K + equity', undefined, 325000],
    ['Base Salary: $120+ / OTE $240k+', 120000, undefined],
    ['Salary $150,000+ depending on experience', 150000, undefined],
  ])('reads %s as open ended', (t, min, max) => {
    const r = text(t);
    expect(r.method).toBe('open_ended');
    expect(r.min).toBe(min);
    expect(r.max).toBe(max);
  });

  it.each([
    'The salary range is between $XX and $XX/year.',
    'Pay: $XX to $XX',
    'Compensation $XXX',
    'The expected salary range is $1 — $2 USD',
    'Salary: $1 — $1',
  ])('reads %s as an unfilled template', (t) => {
    expect(text(t).method).toBe('placeholder_range');
  });

  it.each(['The range is $143,00 to $210,000', 'Base: $127,0000 - $190,0000', 'up to $190,0000'])('reads %s as malformed (review only)', (t) => {
    expect(text(t).method).toBe('malformed_range');
  });

  it.each([
    'Competitive salary & equity.',
    'We raised a $250 million Series E and have $21B traded on the platform.',
    'Benefits include a 401(k) match up to $5,000 and a $1,000 learning stipend.',
    'Plus a $15K sign-on bonus!',
    'We are a $2B ARR company.',
    'Great culture, unlimited PTO.',
  ])('reads %s as none', (t) => {
    expect(text(t).method).toBe('none');
  });

  it('flags a pay-sized figure the patterns cannot parse for review, never as a finding', () => {
    const r = text('Salary: $85.000 per year depending on experience.');
    expect(r.method).toBe('dollar_mention_only');
    expect(r.confidence).toBeLessThan(0.5);
    // a per-project figure with no pay-sized reading is simply none
    expect(text('Compensation is $2k per project depending on scope.').method).toBe('none');
  });

  it('tags evergreen titles before reading text', () => {
    expect(text('anything', 'General Application').method).toBe('evergreen');
    expect(text('anything', 'Join our Talent Network').method).toBe('evergreen');
    expect(text('anything', 'Sales').method).toBe('none');
  });
});

describe('range classifier: the five false alarms', () => {
  it('1. eliseai: a single base figure with an ote is disclosed, not missing', () => {
    const r = text('Base salary: $110,000 (OTE $295,000). Equity and benefits included.');
    expect(r.method).toBe('fixed_rate');
  });

  it('3. dig: tips must not win over the real hourly range', () => {
    const r = text('Pay: $17 - $18 / hour. Team members typically earn an additional $2-3/hour in tips.');
    expect(r.method).toBe('text_range');
    expect(r.min).toBe(17);
    expect(r.max).toBe(18);
  });

  it('4. blackrock and gopuff: USD prefixes with and without a dollar sign', () => {
    expect(text('For New York City only the salary range for this position is USD$115,000.00 - USD$147,500.00').method).toBe('text_range');
    expect(text('New York, NY Pay Rate: USD $17.25').method).toBe('fixed_rate');
    const gopuff = text('New York, NY Pay Rate: USD $17.25 The salary range above reflects what we would reasonably expect to pay.');
    expect(gopuff.method).toBe('fixed_rate');
    expect(gopuff.period).toBe('hour');
  });

  it('6. a bonus mentioned nearby does not erase the range (success academy, lifestance, le pain quotidien, insomnia)', () => {
    expect(text('This position is not bonus eligible. Compensation Range $180,000 — $200,000 USD').method).toBe('text_range');
    expect(text('Full-time Sign-on Bonus. Above market compensation-Range from $82,000 to $110,000, compensation model based on productivity.').method).toBe('text_range');
    expect(text('The annualized salary range for this position (plus a bonus) is: $70,000 - $82,000 Perks and Benefits').method).toBe('text_range');
    const insomnia = text('Competitive pay + bonus eligibility: $20.00-$23.00 •Medical, dental, vision');
    expect(insomnia.method).toBe('text_range');
    expect(insomnia.period).toBe('hour');
    // but money that the noun leads straight into is still not pay
    expect(text('Eligible for an annual bonus of $5,000 based on performance.').method).toBe('none');
    expect(text('We offer a 401(k) match up to $5,000.').method).toBe('none');
  });

  it('7. insomnia and nitra: what follows a plus is an addition to pay, not a description of it', () => {
    const courier = text('PERKS & PAY: · Pay rate: $18.00/hr + full tip earnings on deliveries · Pay-on-Demand');
    expect(courier.method).toBe('fixed_rate');
    expect(courier.min).toBe(18);
    expect(text('Pay rate: $18.00/hr plus tips').method).toBe('fixed_rate');
    expect(text('The base salary range for this full-time position is $175k + bonus + equity + benefits.')).toMatchObject({ method: 'fixed_rate', min: 175000 });
    // a perk-sized figure near pay words is not even a mention worth reviewing
    expect(text('Competitive base salary + quarterly bonus. · $50.00 per month cellphone data plan stipend.').method).toBe('none');
    // a typo the patterns cannot parse but that is clearly pay-sized goes to a human
    expect(text('PERKS: • Pay rate: $18/00/hr • Flexible schedules').method).toBe('dollar_mention_only');
  });

  it('5. stripe: api silence on an offsite posting is not a finding', () => {
    const none = text('Join Stripe. We love engineers.');
    expect(none.method).toBe('none');
    expect(applyOffsiteRule(none, true).method).toBe('offsite_unverified');
    expect(applyOffsiteRule(none, false).method).toBe('none');
    // a page-sourced none stays none: the employer page was read and had nothing
    expect(applyOffsiteRule({ ...none, source: 'employer_page_text' }, true).method).toBe('none');
  });
});

describe('range classifier: structured fields', () => {
  it('greenhouse pay_input_ranges beat any text', () => {
    const structured: StructuredComp[] = [{ min: 120000, max: 150000, currency: 'USD', interval: null, summary: 'New York' }];
    const r = classifyRange({ text: 'Competitive salary', structured, title: 'Engineer' });
    expect(r.method).toBe('structured');
    expect(r.min).toBe(120000);
    expect(r.max).toBe(150000);
    expect(r.period).toBe('year');
    expect(r.confidence).toBe(1);
  });

  it('lever salaryRange carries its own interval', () => {
    const structured: StructuredComp[] = [{ min: 40, max: 55, currency: 'USD', interval: 'per-hour-wage', summary: null }];
    expect(classifyRange({ text: '', structured }).period).toBe('hour');
  });

  it('ashby: a summary string with no parsed numbers is read like text but reported as structured', () => {
    const structured: StructuredComp[] = [{ min: null, max: null, currency: null, interval: null, summary: '$120K – $150K • Offers Equity' }];
    const r = classifyRange({ text: '', structured });
    expect(r.method).toBe('structured');
    expect(r.min).toBe(120000);
    expect(r.max).toBe(150000);
  });

  it('a structured range with only one bound is open ended', () => {
    const structured: StructuredComp[] = [{ min: 90000, max: null, currency: 'USD', interval: '1 YEAR', summary: null }];
    expect(classifyRange({ text: '', structured }).method).toBe('open_ended');
  });

  it('a structured $1-$2 placeholder is still a placeholder', () => {
    const structured: StructuredComp[] = [{ min: 1, max: 2, currency: 'USD', interval: '1 YEAR', summary: null }];
    expect(classifyRange({ text: '', structured }).method).toBe('placeholder_range');
  });

  it('largest maximum wins across several tiers or components', () => {
    const structured: StructuredComp[] = [
      { min: 20000, max: 40000, currency: 'USD', interval: '1 YEAR', summary: 'equity' },
      { min: 150000, max: 190000, currency: 'USD', interval: '1 YEAR', summary: 'base' },
    ];
    expect(classifyRange({ text: '', structured }).max).toBe(190000);
  });
});
