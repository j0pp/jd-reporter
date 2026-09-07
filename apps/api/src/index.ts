import { createD1Db } from '@jdr/db/d1';
import { Hono } from 'hono';
import { adminRoutes } from './admin.ts';
import type { AppEnv } from './env.ts';
import { submitRoutes } from './submit.ts';

// one worker: /api/* runs here, everything else is the static export in ../web/out (assets binding, worker-first only on /api)
const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  c.set('db', createD1Db(c.env.DB));
  c.set('actor', 'anonymous');
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, at: new Date().toISOString() }));
app.route('/api', submitRoutes);
app.route('/api/admin', adminRoutes);

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'something broke on our side', detail: err.message.slice(0, 200) }, 500);
});

export default app;
