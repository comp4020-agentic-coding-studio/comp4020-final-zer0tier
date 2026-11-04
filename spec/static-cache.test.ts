import { get } from 'node:http';
import { expect, it } from 'vitest';
import { baseUrl } from './helpers.ts';

const cacheControl = async (path: string) => {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status, path).toBe(200);
  return response.headers.get('cache-control');
};

it('never caches the game page, so each visit signs out and a deploy shows up on the next visit', async () => {
  for (const path of ['/', '/index.html']) expect(await cacheControl(path), path).toBe('no-store');
});

it('lets browsers reuse scripts, styles, and scene art briefly, then revalidate them by ETag', async () => {
  for (const path of ['/app.js', '/battle.js', '/style.css', '/world.css', '/scenes/home.svg', '/scenes/skill-icons.svg']) {
    expect(await cacheControl(path), path).toBe('public, max-age=300, stale-while-revalidate=86400');
  }
  // An unchanged file costs a 304, not a fresh download. Node's fetch doesn't
  // forward a conditional request the way a browser does, so use plain HTTP.
  const request = (headers: Record<string, string> = {}) => new Promise<{ status: number; etag?: string }>((resolve, reject) => {
    get(`${baseUrl}/app.js`, { headers }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode!, etag: response.headers.etag }));
    }).on('error', reject);
  });
  const first = await request();
  expect(first.etag).toBeTruthy();
  expect((await request({ 'If-None-Match': first.etag! })).status).toBe(304);
});

it('keeps the large music files for a week and still serves partial ranges for seeking', async () => {
  expect(await cacheControl('/audio/rainbows.mp3')).toBe('public, max-age=604800');
  const range = await fetch(`${baseUrl}/audio/rainbows.mp3`, { headers: { Range: 'bytes=0-99' } });
  expect(range.status).toBe(206);
  expect(range.headers.get('cache-control')).toBe('public, max-age=604800');
  await range.arrayBuffer();
});
