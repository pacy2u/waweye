'use strict';
// Vercel project operations for the wawEye migration (PLAN_MIGRACJI_WAWEYE.md),
// run by .github/workflows/waweye-operacje-vercel.yml:
//   node scripts/vercel-ops.js <operation> [value] [redirectTo]
// Env: VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID; PROXY_SECRET for przelacz-podglady, and with NOWY_SEKRET=true
// for przelacz-workera with a new secret.
// Prints a Markdown report (Polish) and never prints the token or secret values.
// Operations that deploy write the production addresses to check to GITHUB_OUTPUT as `sprawdz`.

const checkProduction = require('./check-production');

const API = 'https://api.vercel.com';
const POLL_MS = 10000;
const DEPLOY_TIMEOUT_MS = 15 * 60000;
const ALIAS_WAIT_POLLS = 12; // after READY, wait up to 2 min for the production domains to point at it

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const WORKER_URL_RE = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/;
const ROOT_DIR_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const PROJECT_NAME_RE = /^[a-z0-9._-]{1,100}$/;

function client({ token, teamId, fetchImpl = fetch }) {
  return async (method, path, body) => {
    const url = new URL(API + path);
    url.searchParams.set('teamId', teamId);
    const res = await fetchImpl(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const e = data && data.error;
      const err = new Error(`${method} ${path.split('?')[0]}: HTTP ${res.status}${e ? ` (${[e.code, e.message].filter(Boolean).join(': ')})` : ''}`);
      err.status = res.status;
      err.code = e && e.code;
      throw err;
    }
    return data;
  };
}

const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const targets = (e) => [].concat(e.target || []);
const productionDomains = (domains) => domains.filter((d) => !d.redirect && !d.gitBranch).map((d) => `https://${d.name}`);

function checkDomain(value) {
  const d = String(value || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) throw new Error(`Niepoprawna domena: "${value}". Podaj samą nazwę, np. waweye.vercel.app.`);
  return d;
}

async function listDomains({ api, projectId }) {
  return (await api('GET', `/v9/projects/${projectId}/domains`)).domains || [];
}

// Production value of UPSTREAM_URL, i.e. which Worker production uses: '' when unset (direct calls to the
// Warsaw API), null when Vercel does not reveal it (type "sensitive").
async function upstreamUrl(ctx, envs) {
  envs = envs || (await ctx.api('GET', `/v9/projects/${ctx.projectId}/env`)).envs || [];
  const r = envs.find((e) => e.key === 'UPSTREAM_URL' && targets(e).includes('production'));
  if (!r) return '';
  if (r.type === 'sensitive') return null;
  const full = await ctx.api('GET', `/v1/projects/${ctx.projectId}/env/${r.id}`);
  return full && typeof full.value === 'string' && /^https:\/\//.test(full.value) ? full.value : null;
}

async function stan(ctx) {
  const { api, projectId } = ctx;
  const p = await api('GET', `/v9/projects/${projectId}`);
  const domains = await listDomains(ctx);
  const envs = (await api('GET', `/v9/projects/${projectId}/env`)).envs || [];
  const deployments = (await api('GET', `/v6/deployments?projectId=${projectId}&target=production&limit=3`)).deployments || [];
  const link = p.link;
  const upstream = await upstreamUrl(ctx, envs);
  const md = [
    '### Vercel: stan projektu',
    '',
    `- Projekt: **${p.name}** (\`${projectId}\`)`,
    `- Root Directory: \`${p.rootDirectory || '(katalog główny repozytorium)'}\``,
    `- Repozytorium: ${link ? `${link.org}/${link.repo}, gałąź produkcyjna \`${link.productionBranch || 'main'}\`` : 'brak połączenia z repozytorium'}`,
    `- Worker produkcji (UPSTREAM_URL): ${upstream === null ? 'nieznany (wartość ukryta w Vercel)' : upstream || 'brak – funkcje pytają API Warszawy bezpośrednio'}`,
    '',
    '| Domena | Rola | Zweryfikowana |',
    '|---|---|---|',
    ...domains.map((d) => `| ${d.name} | ${d.redirect ? `przekierowanie ${d.redirectStatusCode || ''} → ${d.redirect}` : d.gitBranch ? `gałąź ${d.gitBranch}` : 'produkcja'} | ${d.verified ? 'tak' : 'nie'} |`),
    '',
    '| Zmienna | Środowiska | Typ |',
    '|---|---|---|',
    ...envs.map((e) => `| ${e.key} | ${targets(e).join(', ')} | ${e.type} |`),
    '',
    '| Ostatnie wdrożenia produkcyjne | Stan | Commit |',
    '|---|---|---|',
    ...deployments.map((d) => {
      const m = d.meta || {};
      return `| ${d.url} (${new Date(d.created).toISOString().slice(0, 16).replace('T', ' ')} UTC) | ${d.state || d.readyState} | ${String(m.githubCommitSha || '').slice(0, 7)} ${cell(m.githubCommitMessage)} |`;
    }),
  ];
  return { md: md.join('\n'), check: [] };
}

async function dodajDomene(ctx, value) {
  const domain = checkDomain(value);
  const { api, projectId } = ctx;
  if ((await listDomains(ctx)).some((d) => d.name === domain)) {
    return { md: `Domena **${domain}** już jest w projekcie, nic nie zmieniam.`, check: [`https://${domain}`] };
  }
  try {
    await api('POST', `/v10/projects/${projectId}/domains`, { name: domain });
  } catch (e) {
    if (e.status === 409 || /in.use|already|taken/i.test(String(e.code) + e.message)) {
      throw new Error(`Domena ${domain} jest niedostępna (zajęta przez inny projekt?). Wybierz inną, np. z listy w planie migracji (D1). Odpowiedź Vercel: ${e.message}`, { cause: e });
    }
    throw e;
  }
  if (!(await listDomains(ctx)).some((d) => d.name === domain)) throw new Error(`Vercel przyjął domenę ${domain}, ale nie ma jej na liście domen projektu.`);
  return { md: `Dodano domenę **${domain}**. Serwuje to samo wdrożenie co dotychczasowe adresy; żaden adres nie został zmieniony ani usunięty.`, check: [`https://${domain}`] };
}

async function przekierujDomene(ctx, value, redirectTo) {
  const domain = checkDomain(value);
  const target = checkDomain(redirectTo);
  if (domain === target) throw new Error('Domena nie może przekierowywać sama na siebie.');
  const { api, projectId } = ctx;
  const domains = await listDomains(ctx);
  const from = domains.find((d) => d.name === domain);
  const to = domains.find((d) => d.name === target);
  if (!from) throw new Error(`Domeny ${domain} nie ma w projekcie.`);
  if (!to || to.redirect || to.gitBranch) throw new Error(`Domena docelowa ${target} musi być domeną produkcyjną tego projektu (bez przekierowania). Najpierw ją dodaj (dodaj-domene).`);
  await api('PATCH', `/v9/projects/${projectId}/domains/${domain}`, { redirect: target, redirectStatusCode: 308 });
  return { md: `Domena **${domain}** przekierowuje teraz (308) na **${target}**. Domena zostaje w projekcie, nie usuwaj jej.`, check: [`https://${target}`] };
}

// Update a variable in the records that already serve production or preview; create one for both if none exist.
async function setVar(ctx, envs, key, value, type) {
  const { api, projectId } = ctx;
  const records = envs.filter((e) => e.key === key && targets(e).some((t) => t === 'production' || t === 'preview'));
  if (!records.length) {
    await api('POST', `/v10/projects/${projectId}/env`, { key, value, type, target: ['production', 'preview'] });
    return `${key}: utworzono (production, preview)`;
  }
  for (const r of records) await api('PATCH', `/v9/projects/${projectId}/env/${r.id}`, { value });
  return `${key}: zaktualizowano (${records.map((r) => targets(r).join(', ')).join('; ')})`;
}

// Deploys the production branch from git, as production or as a preview (no target), and waits until it is ready.
async function deployBranch(ctx, production) {
  const { api, projectId, sleep, now } = ctx;
  const p = await api('GET', `/v9/projects/${projectId}`);
  if (!p.link || p.link.type !== 'github' || !p.link.repoId) throw new Error('Projekt nie jest połączony z repozytorium GitHub, więc nie mogę wdrożyć gałęzi produkcyjnej.');
  const ref = p.link.productionBranch || 'main';
  const body = { name: p.name, project: projectId, gitSource: { type: 'github', repoId: String(p.link.repoId), ref } };
  if (production) body.target = 'production';
  const created = await api('POST', '/v13/deployments', body);
  const t0 = now();
  let d = created;
  while (!['READY', 'ERROR', 'CANCELED'].includes(d.readyState)) {
    if (now() - t0 > DEPLOY_TIMEOUT_MS) throw new Error(`Wdrożenie ${created.id} trwa ponad 15 minut. Sprawdź je w panelu Vercel; produkcja działa na poprzednim wdrożeniu.`);
    await sleep(POLL_MS);
    d = await api('GET', `/v13/deployments/${created.id}`);
  }
  if (d.readyState !== 'READY') {
    throw new Error(`Wdrożenie ${created.id} zakończyło się stanem ${d.readyState}. Produkcja działa dalej na poprzednim wdrożeniu. Szczegóły: ${d.inspectorUrl || created.inspectorUrl || 'panel Vercel'}`);
  }
  return { d, ref, id: created.id };
}

async function wdrozProdukcje(ctx) {
  const { api, sleep } = ctx;
  let { d, ref, id } = await deployBranch(ctx, true);
  for (let i = 0; i < ALIAS_WAIT_POLLS && !d.aliasAssigned && !d.aliasError; i++) {
    await sleep(POLL_MS);
    d = await api('GET', `/v13/deployments/${id}`);
  }
  if (d.aliasError) throw new Error(`Wdrożenie jest gotowe, ale domeny produkcyjne go nie wskazują: ${d.aliasError.message || d.aliasError.code}`);
  const check = productionDomains(await listDomains(ctx));
  return { md: `Wdrożenie produkcyjne gałęzi \`${ref}\` gotowe: ${d.url}${d.aliasAssigned ? '' : ' (domeny jeszcze się przełączają)'}.`, check };
}

function checkWorkerUrl(value) {
  const url = String(value || '').trim().replace(/\/$/, '');
  if (!WORKER_URL_RE.test(url)) throw new Error(`Niepoprawny adres Workera: "${value}". Oczekuję https://<nazwa>.<konto>.workers.dev`);
  return url;
}

// Preview-only variables: a record that also serves production is never changed here.
async function setPreviewVar(ctx, envs, key, value, type) {
  const { api, projectId } = ctx;
  const records = envs.filter((e) => e.key === key && targets(e).includes('preview'));
  if (records.some((e) => targets(e).includes('production'))) throw new Error(`Zmienna ${key} jest wspólna dla produkcji i podglądów, więc nie zmieniam jej tylko dla podglądów.`);
  if (!records.length) {
    await api('POST', `/v10/projects/${projectId}/env`, { key, value, type, target: ['preview'] });
    return `${key}: utworzono (preview)`;
  }
  for (const r of records) await api('PATCH', `/v9/projects/${projectId}/env/${r.id}`, { value });
  return `${key}: zaktualizowano (preview)`;
}

// Points previews at a Worker and deploys a preview of the production branch: its functions run in the same region as
// production (fra1), so this tests a new Worker the way production would use it, without touching production.
async function przelaczPodglady(ctx, value, secret) {
  const url = checkWorkerUrl(value);
  if (!secret) throw new Error('Brak sekretu PROXY_SECRET w repozytorium, a podglądy potrzebują go jako UPSTREAM_SECRET.');
  const envs = (await ctx.api('GET', `/v9/projects/${ctx.projectId}/env`)).envs || [];
  const changes = [await setPreviewVar(ctx, envs, 'UPSTREAM_URL', url, 'plain'), await setPreviewVar(ctx, envs, 'UPSTREAM_SECRET', secret, 'encrypted')];
  const { d, ref } = await deployBranch(ctx, false);
  const base = `https://${d.url}`;
  const paths = ['/api/vehicles', '/api/parking', '/api/incidents', '/api/fleet'];
  const [vehicles, parking, incidents, fleet] = await Promise.all(paths.map((p) => checkProduction.get(base, p, ctx.fetchImpl)));
  const head = [`Podglądy używają Workera ${url}:`, '', ...changes.map((c) => `- ${c}`), '', `Podgląd gałęzi \`${ref}\` gotowy: ${base}`, ''];
  // No JSON at all (401, or a redirect to the Vercel login page): Deployment Protection, so a person has to look.
  if ([vehicles, parking, incidents, fleet].every((r) => !r.error && r.body === null)) {
    return { md: [...head, `Workflow nie może sprawdzić podglądu sam (HTTP ${vehicles.status}, zamiast danych strona). Zwykle oznacza to, że Vercel chroni podglądy logowaniem. Otwórz ${base} w przeglądarce, w której jesteś zalogowany do Vercel. Jeśli na mapie są pojazdy, a po włączeniu parkingów i utrudnień pojawiają się znaczniki, nowy Worker działa.`].join('\n'), check: [] };
  }
  const result = checkProduction.evaluate({ vehicles, parking, incidents, fleet });
  const md = [...head, checkProduction.report(base, result)].join('\n');
  if (!result.ok) throw new Error(md + '\nProdukcja jest bez zmian. Zmienne podglądów można zostawić albo przełączyć z powrotem tą samą operacją.');
  return { md, check: [] };
}

async function przelaczWorkera(ctx, value, newSecret) {
  const url = checkWorkerUrl(value);
  const envs = (await ctx.api('GET', `/v9/projects/${ctx.projectId}/env`)).envs || [];
  const changes = [await setVar(ctx, envs, 'UPSTREAM_URL', url, 'plain')];
  if (newSecret) changes.push(await setVar(ctx, envs, 'UPSTREAM_SECRET', newSecret, 'encrypted'));
  const dep = await wdrozProdukcje(ctx);
  return {
    md: [`Przełączenie na Workera ${url}:`, '', ...changes.map((c) => `- ${c}`), '', dep.md,
      '', 'Wycofanie: uruchom tę operację ponownie z adresem poprzedniego Workera.'].join('\n'),
    check: dep.check,
  };
}

async function ustawRootDirectory(ctx, value) {
  const dir = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!ROOT_DIR_RE.test(dir) || dir.split('/').some((seg) => seg === '.' || seg === '..')) throw new Error(`Niepoprawny folder: "${value}". Podaj ścieżkę względną, np. waweye.`);
  await ctx.api('PATCH', `/v9/projects/${ctx.projectId}`, { rootDirectory: dir });
  const dep = await wdrozProdukcje(ctx);
  return { md: `Root Directory ustawiony na \`${dir}\`.\n\n${dep.md}`, check: dep.check };
}

async function zmienNazweProjektu(ctx, value) {
  const name = String(value || '').trim();
  if (!PROJECT_NAME_RE.test(name)) throw new Error(`Niepoprawna nazwa projektu: "${value}". Dozwolone małe litery, cyfry, kropka, myślnik i podkreślenie.`);
  const { api, projectId } = ctx;
  const before = await listDomains(ctx);
  await api('PATCH', `/v9/projects/${projectId}`, { name });
  const after = await listDomains(ctx);
  const lost = before.filter((d) => !after.some((a) => a.name === d.name));
  const restored = [];
  for (const d of lost) {
    const body = { name: d.name };
    if (d.redirect) Object.assign(body, { redirect: d.redirect, redirectStatusCode: d.redirectStatusCode || 308 });
    if (d.gitBranch) body.gitBranch = d.gitBranch;
    await api('POST', `/v10/projects/${projectId}/domains`, body);
    restored.push(d.name);
  }
  return {
    md: `Projekt nazywa się teraz **${name}**. Adresy podglądów będą zaczynać się od \`${name}-git-\`.${restored.length ? ` Po zmianie nazwy zniknęły domeny ${restored.join(', ')} – dodałem je z powrotem.` : ' Wszystkie domeny zostały na miejscu.'}`,
    check: productionDomains(await listDomains(ctx)),
  };
}

const OPERATIONS = {
  stan: (ctx) => stan(ctx),
  'dodaj-domene': (ctx, [value]) => dodajDomene(ctx, value),
  'przekieruj-domene': (ctx, [value, redirectTo]) => przekierujDomene(ctx, value, redirectTo),
  'przelacz-podglady': (ctx, [value]) => przelaczPodglady(ctx, value, ctx.proxySecret),
  'przelacz-workera': (ctx, [value]) => {
    if (ctx.wantNewSecret && !ctx.proxySecret) throw new Error('Zaznaczono nowy_sekret, ale w repozytorium nie ma sekretu PROXY_SECRET. Nic nie zmieniam.');
    return przelaczWorkera(ctx, value, ctx.wantNewSecret ? ctx.proxySecret : '');
  },
  'ustaw-root-directory': (ctx, [value]) => ustawRootDirectory(ctx, value),
  'zmien-nazwe-projektu': (ctx, [value]) => zmienNazweProjektu(ctx, value),
  'wdroz-produkcje': (ctx) => wdrozProdukcje(ctx),
};

function context({ env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const missing = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Brak ${missing.join(', ')}. Dodaj sekret VERCEL_TOKEN w repozytorium (Settings → Secrets and variables → Actions), patrz README.`);
  return {
    api: client({ token: env.VERCEL_TOKEN, teamId: env.VERCEL_TEAM_ID, fetchImpl }),
    projectId: env.VERCEL_PROJECT_ID, proxySecret: env.PROXY_SECRET || '', wantNewSecret: env.NOWY_SEKRET === 'true', fetchImpl, sleep, now,
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
    const { md, check } = await run(operation, args);
    process.stdout.write(md + '\n');
    if (process.env.GITHUB_OUTPUT && check.length) require('fs').appendFileSync(process.env.GITHUB_OUTPUT, `sprawdz=${check.join(' ')}\n`);
  } catch (e) {
    process.stdout.write(`### Vercel: operacja \`${operation}\` nie powiodła się\n\n${e.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { client, context, run, upstreamUrl, OPERATIONS, productionDomains };
