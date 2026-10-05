'use strict';
// Cloudflare Worker operations for the wawEye migration (PLAN_MIGRACJI_WAWEYE.md),
// run by .github/workflows/waweye-operacje-cloudflare.yml:
//   node scripts/cloudflare-ops.js <operation> [worker] [confirmation]
// podepnij-kv is run by .github/workflows/waweye-wdrozenie-workera.yml before every deploy.
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; PROXY_SECRET (test-workera, ustaw-sekrety);
// WARSAW_API_KEY (ustaw-sekrety); VERCEL_* (stan, usun-workera: which Worker production uses, when Vercel reveals it).
// Prints a Markdown report (Polish) and never prints token or secret values.
const fs = require('fs');
const path = require('path');
const vercel = require('./vercel-ops');

const CF = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 60000; // the fleet dataset took ~21 s on a cold cache (2026-10-02)
const WORKER_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SECRETS = ['WARSAW_API_KEY', 'PROXY_SECRET'];
const PROBES = [
  { name: 'Autobusy (?type=1)', query: '?type=1', mustHaveRecords: true },
  { name: 'Tramwaje (?type=2)', query: '?type=2' }, // may be empty at night
  { name: 'Parkingi (?resource=parking)', query: '?resource=parking' },
  { name: 'Utrudnienia (?resource=incidents)', query: '?resource=incidents' },
  { name: 'Tabor (?resource=fleet)', query: '?resource=fleet' },
];
const KV_TITLE = 'waweye-geokody';
const KV_BINDING = 'GEOKODY'; // env.GEOKODY in worker/index.js
const ANALYTICS_QUERY = `query($accountTag: string!, $scriptName: string!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 100, filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }) { sum { requests } }
  } }
}`;

function client({ token, fetchImpl = fetch }) {
  return async (method, p, body) => {
    const res = await fetchImpl(CF + p, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = JSON.parse(await res.text()); } catch {}
    if (!res.ok || !data || data.success === false) {
      const msg = data && Array.isArray(data.errors) && data.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
      const err = new Error(`${method} ${p}: HTTP ${res.status}${msg ? ` (${msg})` : ''}`);
      err.status = res.status;
      throw err;
    }
    return data.result;
  };
}

function checkWorker(value) {
  const w = String(value || '').trim().toLowerCase();
  if (!WORKER_RE.test(w)) throw new Error(`Niepoprawna nazwa Workera: "${value}".`);
  return w;
}

// The Worker that `wrangler deploy` targets (worker/wrangler.toml), i.e. the one the deploy workflow keeps updating.
function deployedName(file = path.join(__dirname, '../worker/wrangler.toml')) {
  const m = fs.readFileSync(file, 'utf8').match(/^name\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

async function scripts(ctx) {
  return (await ctx.api('GET', `/accounts/${ctx.accountId}/workers/scripts`)) || [];
}

// Binding names and types from the script settings (secret_text, plain_text, ...); never their values.
async function bindings(ctx, worker) {
  const settings = await ctx.api('GET', `/accounts/${ctx.accountId}/workers/scripts/${worker}/settings`);
  return ((settings && settings.bindings) || []).map((b) => ({ name: b.name, type: b.type }));
}

async function workerBase(ctx, worker) {
  const sub = await ctx.api('GET', `/accounts/${ctx.accountId}/workers/subdomain`);
  if (!sub || !sub.subdomain) throw new Error('Konto Cloudflare nie ma adresu workers.dev.');
  return `https://${worker}.${sub.subdomain}.workers.dev`;
}

// Requests in the last 7 days from Workers analytics; { error } when the token may not read analytics.
async function requests7d(ctx, scriptName) {
  const until = new Date(ctx.now());
  const since = new Date(until.getTime() - 7 * 864e5);
  try {
    const res = await ctx.fetchImpl(CF + '/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ANALYTICS_QUERY, variables: { accountTag: ctx.accountId, scriptName, since: since.toISOString(), until: until.toISOString() } }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.data || (data.errors && data.errors.length)) {
      return { error: (data && data.errors && data.errors[0] && data.errors[0].message) || `HTTP ${res.status}` };
    }
    const acc = (data.data.viewer && data.data.viewer.accounts && data.data.viewer.accounts[0]) || {};
    return { requests: (acc.workersInvocationsAdaptive || []).reduce((s, r) => s + ((r.sum && r.sum.requests) || 0), 0) };
  } catch (e) {
    return { error: e.message };
  }
}

async function vercelUpstream(ctx) {
  if (!ctx.vercel) return { error: 'brak sekretu VERCEL_TOKEN' };
  try {
    return { url: await vercel.upstreamUrl(ctx.vercel) };
  } catch (e) {
    return { error: e.message };
  }
}

const isUsedBy = (upstream, worker) => typeof upstream === 'string' && upstream.startsWith(`https://${worker}.`);

async function stan(ctx, value) {
  const extra = value ? checkWorker(value) : null;
  const list = await scripts(ctx);
  const names = [...new Set([...list.map((s) => s.id), ...(extra ? [extra] : [])])];
  const active = deployedName();
  const up = await vercelUpstream(ctx);
  const sub = await ctx.api('GET', `/accounts/${ctx.accountId}/workers/subdomain`);
  const rows = [];
  for (const name of names) {
    const s = list.find((x) => x.id === name);
    let secrets = '–';
    if (s) {
      try { secrets = ((await ctx.api('GET', `/accounts/${ctx.accountId}/workers/scripts/${name}/secrets`)) || []).map((x) => x.name).sort().join(', ') || 'brak'; } catch (e) { secrets = `nie mogę odczytać (${e.message})`; }
      try {
        const plain = (await bindings(ctx, name)).filter((b) => b.type === 'plain_text').map((b) => b.name).sort();
        if (plain.length) secrets += `; jawnym tekstem: ${plain.join(', ')}`;
      } catch {}
    }
    const r = s ? await requests7d(ctx, name) : { requests: 0 };
    const roles = [name === active ? 'cel wdrożeń (wrangler.toml)' : '', isUsedBy(up.url, name) ? 'używany przez produkcję Vercel' : ''].filter(Boolean).join(', ');
    rows.push(`| ${name} | ${s ? `https://${name}.${sub && sub.subdomain}.workers.dev` : 'nie istnieje'} | ${s ? String(s.modified_on || '').slice(0, 16).replace('T', ' ') : '–'} | ${secrets} | ${r.error ? `nieznane (${r.error})` : r.requests} | ${roles || '–'} |`);
  }
  return [
    '### Cloudflare: Workery',
    '',
    `Produkcja Vercel (UPSTREAM_URL): ${up.error ? `nieznana (${up.error})` : up.url === null ? 'nieznana (wartość ukryta w Vercel)' : up.url || 'brak Workera'}`,
    '',
    '| Worker | Adres | Zmieniony (UTC) | Sekrety | Zapytania (7 dni) | Rola |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

const recordCount = (body) => {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object') {
    const arrays = Object.values(body).filter(Array.isArray);
    if (arrays.length) return arrays.reduce((s, a) => s + a.length, 0);
    return Object.keys(body).length;
  }
  return 0;
};

async function testWorkera(ctx, value) {
  const worker = checkWorker(value);
  if (!ctx.proxySecret) throw new Error('Brak sekretu PROXY_SECRET w repozytorium (patrz README).');
  const base = await workerBase(ctx, worker);
  const probe = async (query, secret) => {
    const t0 = ctx.now();
    try {
      const res = await ctx.fetchImpl(base + '/' + query, { headers: secret ? { 'x-proxy-secret': secret } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = undefined; }
      return { status: res.status, body, ms: ctx.now() - t0 };
    } catch (e) {
      return { status: 0, error: e.message, ms: ctx.now() - t0 };
    }
  };
  const rows = [];
  const statuses = [];
  let ok = true;
  for (const p of PROBES) {
    const r = await probe(p.query, ctx.proxySecret);
    statuses.push(r.status);
    let problem = r.error ? `brak odpowiedzi (${r.error})` : r.status !== 200 ? `HTTP ${r.status}${r.body && r.body.error ? ` (${r.body.error})` : ''}` : r.body === undefined ? 'odpowiedź nie jest JSON-em' : null;
    if (!problem && p.mustHaveRecords && !recordCount(r.body)) problem = '0 rekordów';
    if (problem) ok = false;
    rows.push(`| ${p.name} | ${problem ? 'BŁĄD' : 'OK'} | ${problem || `${recordCount(r.body)} rekordów, ${r.ms} ms`} |`);
  }
  // The geocode store needs neither the Warsaw API nor a location, so it answers from GitHub's runners too.
  const geo = await (async () => {
    try {
      const res = await ctx.fetchImpl(base + '/?resource=geokody', { method: 'POST', headers: { 'x-proxy-secret': ctx.proxySecret, 'Content-Type': 'application/json' }, body: JSON.stringify({ get: ['test-workera'] }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await res.json().catch(() => null);
      return res.status === 200 && body && body.found ? null : `HTTP ${res.status}${body && body.error ? ` (${body.error})` : ''}`;
    } catch (e) { return `brak odpowiedzi (${e.message})`; }
  })();
  if (geo) ok = false;
  rows.push(`| Geokody (?resource=geokody, KV) | ${geo ? 'BŁĄD' : 'OK'} | ${geo || 'magazyn odpowiada'} |`);
  const anon = await probe('?type=1', '');
  const anonOk = anon.status === 403;
  if (!anonOk) ok = false;
  rows.push(`| Bez sekretu (oczekiwane 403) | ${anonOk ? 'OK' : 'BŁĄD'} | HTTP ${anon.status || anon.error} |`);
  const md = [`### Cloudflare: test Workera ${worker}: ${ok ? 'działa' : 'PROBLEM'}`, '', base, '', '| Sprawdzenie | Wynik | Szczegóły |', '|---|---|---|', ...rows].join('\n');
  // 52x on every resource while the secret check passes: Cloudflare runs the Worker near the caller (GitHub's runners
  // are in the USA) and the Warsaw API does not accept connections from there (2026-10-03). Production calls the
  // Worker from Vercel's fra1 region, so test it through a preview instead.
  if (anonOk && statuses.every((st) => st >= 520 && st <= 530)) {
    const err = new Error(`${md}\n\nSekret działa (bez niego 403), ale każde zapytanie Workera do API Warszawy kończy się błędem 52x Cloudflare. Ten test działa na serwerach GitHuba w USA, a API Warszawy nie przyjmuje połączeń z takich lokalizacji. Produkcja woła Workera z Vercel we Frankfurcie. Sprawdź Workera tak, jak użyje go produkcja: operacje Vercel → przelacz-podglady.`);
    err.report = true;
    throw err;
  }
  if (!ok) { const err = new Error(md); err.report = true; throw err; }
  return md;
}

// Can the Worker fetch the official ZTM GTFS (gtfs.ztm.waw.pl)? Run from GitHub's runners, so it shows what a scheduled
// workflow would get; colo is the Cloudflare location the Worker ran in. Only a report: a failure here is an answer.
async function testGtfs(ctx, value) {
  const worker = checkWorker(value);
  if (!ctx.proxySecret) throw new Error('Brak sekretu PROXY_SECRET w repozytorium (patrz README).');
  const base = await workerBase(ctx, worker);
  const t0 = ctx.now();
  let row;
  try {
    const res = await ctx.fetchImpl(base + '/?resource=gtfs&probe=1', { headers: { 'x-proxy-secret': ctx.proxySecret }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const b = await res.json().catch(() => ({}));
    const size = b.length ? `${(b.length / 1048576).toFixed(1).replace('.', ',')} MB` : 'rozmiar nieznany';
    row = res.status === 200
      ? `| działa | HTTP ${b.status}, ${size}, plik z ${b.modified || '?'}, ${b.url || ''} | ${b.colo || '?'} | ${b.ms ?? '?'} ms |`
      : `| NIE działa | HTTP ${res.status}${b.error ? ` (${b.error})` : ''} | ${b.colo || '?'} | ${b.ms ?? ctx.now() - t0} ms |`;
  } catch (e) {
    row = `| NIE działa | brak odpowiedzi Workera (${e.message}) | ? | ${ctx.now() - t0} ms |`;
  }
  return [`### Cloudflare: GTFS ZTM przez Workera ${worker} (zapytanie z GitHub Actions)`, '', '| Wynik | Szczegóły | Lokalizacja Cloudflare | Czas |', '|---|---|---|---|', row].join('\n');
}

async function ustawSekrety(ctx, value) {
  const worker = checkWorker(value);
  const values = { WARSAW_API_KEY: ctx.warsawApiKey, PROXY_SECRET: ctx.proxySecret };
  const missing = SECRETS.filter((k) => !values[k]);
  if (missing.length) throw new Error(`Brak sekretów ${missing.join(', ')} w repozytorium (Settings → Secrets and variables → Actions), patrz README.`);
  if (!(await scripts(ctx)).some((s) => s.id === worker)) {
    throw new Error(`Worker ${worker} nie istnieje. Najpierw go wdroż: zmerguj zmianę nazwy w worker/wrangler.toml (workflow wdrożenia Workera utworzy go sam).`);
  }
  // Cloudflare refuses a secret whose name is already a plain variable (error 10053), as on pasibus-proxy.
  let existing = [];
  try { existing = await bindings(ctx, worker); } catch {}
  const clash = existing.filter((b) => SECRETS.includes(b.name) && b.type !== 'secret_text').map((b) => `${b.name} (${b.type})`);
  if (clash.length) {
    throw new Error(`Worker ${worker} ma już zwykłe zmienne ${clash.join(', ')}, a Cloudflare nie pozwala utworzyć sekretu o tej samej nazwie. Nic nie zmieniam. Aby zamienić je na sekrety, usuń te zmienne w panelu Cloudflare (Worker → Settings → Variables and Secrets) i uruchom operację ponownie.`);
  }
  for (const name of SECRETS) {
    await ctx.api('PUT', `/accounts/${ctx.accountId}/workers/scripts/${worker}/secrets`, { name, text: values[name], type: 'secret_text' });
  }
  const now = ((await ctx.api('GET', `/accounts/${ctx.accountId}/workers/scripts/${worker}/secrets`)) || []).map((x) => x.name);
  const absent = SECRETS.filter((k) => !now.includes(k));
  if (absent.length) throw new Error(`Po zapisie brakuje sekretów ${absent.join(', ')} w Workerze ${worker}.`);
  return `### Cloudflare: sekrety Workera ${worker}\n\nUstawiono ${SECRETS.join(' i ')} (wartości z sekretów repozytorium). Następny krok: test-workera.`;
}

// Finds or creates the KV namespace for geocodes and binds it in wrangler.toml (the CI checkout only: the id is
// not a secret, but keeping it out of the repository lets the same file deploy to any account).
async function podepnijKv(ctx, file = path.join(__dirname, '../worker/wrangler.toml')) {
  const toml = fs.readFileSync(file, 'utf8');
  let ns = null;
  for (let page = 1; !ns && page <= 20; page++) {
    const list = (await ctx.api('GET', `/accounts/${ctx.accountId}/storage/kv/namespaces?per_page=100&page=${page}`)) || [];
    ns = list.find((n) => n.title === KV_TITLE) || null;
    if (list.length < 100) break;
  }
  const created = !ns;
  if (!ns) ns = await ctx.api('POST', `/accounts/${ctx.accountId}/storage/kv/namespaces`, { title: KV_TITLE });
  if (!ns || !/^[0-9a-f]{32}$/.test(ns.id || '')) throw new Error(`Cloudflare nie podał identyfikatora przestrzeni KV ${KV_TITLE}.`);
  const bound = new RegExp(`^binding\\s*=\\s*"${KV_BINDING}"`, 'm').test(toml);
  if (!bound) fs.writeFileSync(file, `${toml.replace(/\n*$/, '\n')}\n# Added by scripts/cloudflare-ops.js podepnij-kv (deploy workflow)\n[[kv_namespaces]]\nbinding = "${KV_BINDING}"\nid = "${ns.id}"\n`);
  return `### Cloudflare: magazyn geokodów\n\nPrzestrzeń KV \`${KV_TITLE}\` (${ns.id}) ${created ? 'utworzona teraz' : 'już istniała'}; ${bound ? 'wrangler.toml już ją podpina' : `podpięta jako \`${KV_BINDING}\``}.`;
}

async function usunWorkera(ctx, value, confirmation) {
  const worker = checkWorker(value);
  if (String(confirmation || '').trim() !== worker) throw new Error(`Aby usunąć Workera, wpisz w polu potwierdzenia dokładnie jego nazwę: ${worker}.`);
  if (worker === deployedName()) throw new Error(`${worker} to Worker, którego wdraża workflow (worker/wrangler.toml). Nie usuwam go.`);
  // Production must not depend on it: either Vercel's UPSTREAM_URL points elsewhere or, when Vercel hides the value
  // (type "sensitive"), the Worker had no traffic for 7 days (production and its monitoring would show up there).
  const up = await vercelUpstream(ctx);
  const known = !up.error && up.url !== null;
  if (known && isUsedBy(up.url, worker)) throw new Error(`Produkcja Vercel nadal używa Workera ${worker} (UPSTREAM_URL). Najpierw przełącz ją na nowego Workera (operacje Vercel: przelacz-workera).`);
  if (!(await scripts(ctx)).some((s) => s.id === worker)) return `### Cloudflare: Worker ${worker} nie istnieje, nic nie usuwam.`;
  const r = await requests7d(ctx, worker);
  if (!r.error && r.requests > 0) throw new Error(`Worker ${worker} obsłużył ${r.requests} zapytań w ostatnich 7 dniach. Usuń go dopiero, gdy ruch spadnie do zera.`);
  if (!known && r.error) {
    throw new Error(`Nie mogę sprawdzić, czy produkcja używa Workera ${worker}: UPSTREAM_URL jest niedostępny (${up.error || 'wartość ukryta w Vercel'}), a ruchu nie da się odczytać (${r.error}). Bez tego nie usuwam.`);
  }
  await ctx.api('DELETE', `/accounts/${ctx.accountId}/workers/scripts/${worker}`);
  return `### Cloudflare: usunięto Workera ${worker}\n\n${known ? `Produkcja używa: ${up.url || 'bez Workera'}.` : 'Wartość UPSTREAM_URL jest ukryta w Vercel; o usunięciu zdecydował brak ruchu.'}${r.error ? ` Ruchu z ostatnich 7 dni nie dało się odczytać (${r.error}).` : ' Ruch w ostatnich 7 dniach: 0.'}`;
}

const OPERATIONS = {
  stan: (ctx, [w]) => stan(ctx, w),
  'test-workera': (ctx, [w]) => testWorkera(ctx, w),
  'test-gtfs': (ctx, [w]) => testGtfs(ctx, w),
  'ustaw-sekrety': (ctx, [w]) => ustawSekrety(ctx, w),
  'usun-workera': (ctx, [w, confirmation]) => usunWorkera(ctx, w, confirmation),
  'podepnij-kv': (ctx, [file]) => podepnijKv(ctx, file || undefined),
};

function context({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Brak sekretów ${missing.join(', ')} w repozytorium (patrz README).`);
  let v = null;
  try { v = vercel.context({ env, fetchImpl }); } catch {}
  return {
    api: client({ token: env.CLOUDFLARE_API_TOKEN, fetchImpl }),
    token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID,
    proxySecret: env.PROXY_SECRET || '', warsawApiKey: env.WARSAW_API_KEY || '',
    vercel: v, fetchImpl, now,
  };
}

async function run(operation, args, deps) {
  const op = OPERATIONS[operation];
  if (!op) throw new Error(`Nieznana operacja "${operation}". Dostępne: ${Object.keys(OPERATIONS).join(', ')}.`);
  return op(context(deps), args);
}

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  try {
    process.stdout.write((await run(operation, args)) + '\n');
  } catch (e) {
    process.stdout.write(e.report ? e.message + '\n' : `### Cloudflare: operacja \`${operation}\` nie powiodła się\n\n${e.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { client, context, run, deployedName, recordCount, OPERATIONS };
