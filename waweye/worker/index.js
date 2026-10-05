// Cloudflare Worker: relay to the Warsaw API from Cloudflare's network
// (the Warsaw API may refuse connections from Vercel/AWS addresses).
// Secrets (Settings -> Variables and Secrets): WARSAW_API_KEY, PROXY_SECRET.
// New open-data portal API: POST {"type": 1|2}, token in the Authorization header.
const ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow';
// Resources without a request body: ?resource=parking | incidents | fleet
const RESOURCES = {
  parking: 'https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca',
  fleet: 'https://dane.um.warszawa.pl/api/action/get_ztm_pojazdy',
  incidents: 'https://dane.um.warszawa.pl/api/action/get_bin_utrudnienia_drogowe',
  sport: 'https://dane.um.warszawa.pl/api/action/get_bmm_zajecia_sportowe',
};

export async function handle(request, env, fetchImpl) {
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (!env.PROXY_SECRET || request.headers.get('x-proxy-secret') !== env.PROXY_SECRET) return json({ error: 'forbidden' }, 403);
  const params = new URL(request.url).searchParams;
  const resource = params.get('resource');
  const resourceUrl = Object.hasOwn(RESOURCES, resource) ? RESOURCES[resource] : undefined;
  const type = params.get('type');
  if (!resourceUrl && type !== '1' && type !== '2') return json({ error: 'bad type' }, 400);
  if (!env.WARSAW_API_KEY) return json({ error: 'worker is missing WARSAW_API_KEY' }, 500);
  try {
    // The docs say "Authorization: token uzytkownika"; try the raw token, then "Bearer <token>" on 401/403.
    let res;
    for (const auth of [env.WARSAW_API_KEY, `Bearer ${env.WARSAW_API_KEY}`]) {
      res = await fetchImpl(resourceUrl || ENDPOINT, resourceUrl
        ? { method: 'POST', headers: { Authorization: auth } }
        : { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: Number(type) }) });
      if (res.status !== 401 && res.status !== 403) break;
    }
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return json({ error: 'upstream: ' + e.message }, 502);
  }
}

export default {
  // Cloudflare calls fetch(request, env, ctx) - ctx is NOT a fetch function.
  fetch(request, env) {
    return handle(request, env, fetch);
  },
};
