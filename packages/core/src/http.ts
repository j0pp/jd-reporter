export interface HttpResponse {
  status: number;
  url: string;
  headers: Headers;
  text: string;
  json(): unknown;
}

export interface HttpClient {
  (url: string, init?: RequestInit & { retries?: number }): Promise<HttpResponse>;
  // seconds the last successful call waited between requests; useful for persisting a learned delay
  readonly delayMs: number;
}

export interface HttpOptions {
  userAgent: string;
  fetch?: typeof fetch;
  // spacing between consecutive requests through this client
  delayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  // consecutive 429s that trip the breaker
  breakerThreshold?: number;
  breakerPauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  // called with every response; the crawler uses it to gzip raw bodies into r2
  onResponse?: (res: HttpResponse, init: RequestInit | undefined) => void | Promise<void>;
  log?: (msg: string) => void;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly bodySnippet: string,
  ) {
    super(`http ${status} for ${url}: ${bodySnippet.slice(0, 120)}`);
  }
}

export class RateLimitedError extends Error {
  constructor(public readonly url: string) {
    super(`rate limited repeatedly, breaker tripped at ${url}`);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// one client per vendor per run. sequential by design: the seed hit zero 429s at 1-3 s spacing and the
// budget is ~4k requests a day, so concurrency buys nothing worth the risk.
export function createHttp(opts: HttpOptions): HttpClient {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  let delayMs = opts.delayMs ?? 1500;
  const maxRetries = opts.maxRetries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const breakerThreshold = opts.breakerThreshold ?? 3;
  const breakerPauseMs = opts.breakerPauseMs ?? 10 * 60_000;
  let consecutive429 = 0;
  let lastAt = 0;

  const client = (async (url: string, init?: RequestInit & { retries?: number }) => {
    const retries = init?.retries ?? maxRetries;
    let attempt = 0;
    for (;;) {
      const wait = lastAt + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response | undefined;
      let err: unknown;
      try {
        res = await f(url, {
          ...init,
          signal: ctrl.signal,
          headers: {
            'user-agent': opts.userAgent,
            accept: 'application/json, text/html;q=0.8, */*;q=0.5',
            ...(init?.headers as Record<string, string> | undefined),
          },
        });
      } catch (e) {
        err = e;
      } finally {
        clearTimeout(timer);
      }

      if (res && res.status < 400) {
        consecutive429 = 0;
        const text = await res.text();
        const out: HttpResponse = {
          status: res.status,
          url,
          headers: res.headers,
          text,
          json: () => JSON.parse(text),
        };
        await opts.onResponse?.(out, init);
        return out;
      }

      const status = res?.status ?? 0;
      if (status === 429) {
        consecutive429 += 1;
        if (consecutive429 >= breakerThreshold) {
          // slow down for the rest of the run and give the vendor a real pause
          delayMs = Math.min(delayMs * 2, 30_000);
          opts.log?.(`breaker tripped on ${new URL(url).host}; pausing ${breakerPauseMs / 1000}s, delay now ${delayMs}ms`);
          consecutive429 = 0;
          await sleep(breakerPauseMs);
          throw new RateLimitedError(url);
        }
      }

      const retriable = status === 429 || status >= 500 || status === 0;
      if (!retriable || attempt >= retries) {
        const snippet = res ? (await res.text().catch(() => '')).slice(0, 200) : String(err);
        throw new HttpError(status, url, snippet);
      }

      const retryAfter = Number(res?.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : [5_000, 20_000, 60_000, 180_000][attempt] ?? 180_000;
      const jitter = Math.floor(Math.random() * 1000);
      opts.log?.(`retry ${attempt + 1}/${retries} after ${status || 'network error'} on ${url} in ${backoff + jitter}ms`);
      await sleep(backoff + jitter);
      attempt += 1;
    }
  }) as HttpClient;

  Object.defineProperty(client, 'delayMs', { get: () => delayMs });
  return client;
}
