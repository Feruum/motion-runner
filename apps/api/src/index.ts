import { Hono } from 'hono';

export const app = new Hono();

app.get('/api/health', (context) => context.json({
  status: 'ok',
  service: 'motion-runner-api',
  database: 'not-configured',
}));

app.notFound((context) => context.json({
  error: { code: 'NOT_FOUND', message: 'API route not found.' },
}, 404));

app.onError((error, context) => {
  console.error(error);
  return context.json({
    error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' },
  }, 500);
});

export default app;

if (import.meta.main) {
  Bun.serve({
    port: Number(Bun.env.API_PORT ?? 3001),
    fetch: app.fetch,
  });
}
