// Cloudflare Worker: relay to the Warsaw API from Cloudflare's network
// (api.um.warszawa.pl does not accept connections from Vercel/AWS addresses).
// Secrets: WARSAW_API_KEY, PROXY_SECRET.
const ENDPOINT = 'https://api.um.warszawa.pl/api/action/busestrams_get/';
const RESOURCE_ID = 'f2e5503e-927d-4ad3-9500-4ab9e55deb59';

export default {
  async fetch(request, env, fetchImpl = fetch) {
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (!env.PROXY_SECRET || request.headers.get('x-proxy-secret') !== env.PROXY_SECRET) return json({ error: 'forbidden' }, 403);
    const type = new URL(request.url).searchParams.get('type');
    if (type !== '1' && type !== '2') return json({ error: 'bad type' }, 400);
    try {
      const res = await fetchImpl(`${ENDPOINT}?resource_id=${RESOURCE_ID}&apikey=${encodeURIComponent(env.WARSAW_API_KEY)}&type=${type}`);
      return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return json({ error: 'upstream: ' + e.message }, 502);
    }
  },
};
