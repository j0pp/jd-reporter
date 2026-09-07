import { describe, expect, it } from 'vitest';
import { parseEmployerPage } from '../src/employer-page.ts';
import { classifyRange } from '../src/classifier/range.ts';
import { stripHtml } from '../src/html.ts';

describe('employer page (stripe-shaped offsite posting)', () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Staff Engineer",
      "jobLocation":{"@type":"Place","address":{"addressLocality":"New York","addressRegion":"NY"}},
      "baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","minValue":262900,"maxValue":394300,"unitText":"YEAR"}},
      "description":"<p>Build payments.</p>"}</script>
    <style>.x{}</style></head>
    <body><h1>Staff Engineer</h1><p>The annual US base salary range for this role is $262,900 - $394,300.</p><script>var x=1;</script></body></html>`;

  it('reads json-ld baseSalary as structured comp', () => {
    const page = parseEmployerPage(html);
    expect(page.jsonLd).toEqual([{ min: 262900, max: 394300, currency: 'USD', interval: 'YEAR', summary: 'jsonld baseSalary 262900-394300 USD/YEAR' }]);
    expect(page.locations).toEqual(['New York, NY']);
    expect(page.title).toBe('Staff Engineer');
    expect(page.text).not.toMatch(/var x=1/);
    expect(classifyRange({ text: page.text, structured: page.jsonLd, source: 'employer_page_jsonld' }).method).toBe('structured');
  });

  it('falls back to page text when there is no json-ld', () => {
    const page = parseEmployerPage('<body><p>Salary: $100,000 - $120,000</p></body>');
    expect(page.jsonLd).toBeNull();
    expect(classifyRange({ text: page.text, structured: null, source: 'employer_page_text' }).method).toBe('text_range');
  });

  it('handles @graph wrappers', () => {
    const page = parseEmployerPage(
      `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["JobPosting"],"baseSalary":{"currency":"USD","value":{"value":95000,"unitText":"YEAR"}}}]}</script>`,
    );
    expect(page.jsonLd?.[0]).toMatchObject({ min: 95000, max: 95000 });
  });
});

describe('stripHtml', () => {
  it('decodes double-escaped greenhouse html and keeps ranges readable across tags', () => {
    expect(stripHtml('&lt;p&gt;$120,000&lt;/p&gt;&lt;p&gt;to $150,000&lt;/p&gt;')).toBe('$120,000 to $150,000');
    expect(stripHtml('<p>A &amp; B</p><br>C&nbsp;D &#8212; E')).toBe('A & B C D — E');
  });
});
