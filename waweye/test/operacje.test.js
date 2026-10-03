'use strict';
// Unit tests for the migration operations (scripts/vercel-ops.js, scripts/cloudflare-ops.js) against fake APIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vercelOps = require('../scripts/vercel-ops');
const cfOps = require('../scripts/cloudflare-ops');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ENV = { VERCEL_TOKEN: 'vtok', VERCEL_TEAM_ID: 'team_1', VERCEL_PROJECT_ID: 'prj_1' };

// ---- Fake Vercel API ----
function fakeVercel(over = {}) {
  const s = {
    project: { name: 'pasibus', rootDirectory: 'pasibus', link: { type: 'github', org: 'pacy2u', repo: 'tst', repoId: 123, productionBranch: 'main' } },
    domains: [
      { name: 'pasibus.vercel.app', verified: true },
      { name: 'stary.example', verified: true, redirect: 'pasibus.vercel.app', redirectStatusCode: 308 },
      { name: 'dev.example', verified: true, gitBranch: 'dev' },
    ],
    envs: [
      { id: 'e1', key: 'UPSTREAM_URL', target: ['production', 'preview'], type: 'plain', value: 'https://pasibus-proxy.konto.workers.dev' },
      { id: 'e2', key: 'UPSTREAM_SECRET', target: ['production', 'preview'], type: 'encrypted', value: 'tajne-stare' },
    ],
    deployStates: ['BUILDING', 'READY'],
    aliasAfter: 1,
    calls: [],
    ...over,
  };
  let polls = 0, aliasPolls = 0;
  s.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    s.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth: init.headers && init.headers.Authorization });
    const p = u.pathname;
    if (u.hostname === 'pasibus-new.vercel.app') {
      if (s.preview === 'protected') return new Response('<html>Authentication Required</html>', { status: 401, headers: { 'Content-Type': 'text/html' } });
      if (s.preview === 'broken' && p === '/api/vehicles') return json({ error: 'HTTP 522' }, 502);
      return json({
        '/api/vehicles': { source: 'live', errors: [], received: 2, vehicles: [{ type: 'bus', vehicle: '1' }, { type: 'tram', vehicle: '2' }] },
        '/api/parking': { parkings: [{}] }, '/api/incidents': { incidents: [] }, '/api/fleet': { vehicles: { 'bus:1': {}, 'tram:2': {} }, brands: {} },
      }[p] || { error: 'not found' }, p.startsWith('/api/') ? 200 : 404);
    }
    if (method === 'GET' && p === '/v9/projects/prj_1') return json(s.project);
    if (method === 'PATCH' && p === '/v9/projects/prj_1') {
      Object.assign(s.project, body);
      if (body.name && s.loseDomainOnRename) s.domains = s.domains.filter((d) => d.name !== s.loseDomainOnRename);
      return json(s.project);
    }
    if (method === 'GET' && p === '/v9/projects/prj_1/domains') return json({ domains: s.domains });
    if (method === 'POST' && p === '/v10/projects/prj_1/domains') {
      if (s.takenDomains && s.takenDomains.includes(body.name)) return json({ error: { code: 'domain_already_in_use', message: 'in use' } }, 409);
      s.domains.push({ verified: true, ...body });
      return json(body);
    }
    const dm = p.match(/^\/v9\/projects\/prj_1\/domains\/(.+)$/);
    if (method === 'PATCH' && dm) { Object.assign(s.domains.find((d) => d.name === dm[1]), body); return json({}); }
    if (method === 'GET' && p === '/v9/projects/prj_1/env') return json({ envs: s.envs.map(({ value, ...e }) => ({ ...e, value: 'zaszyfrowane' })) });
    const ev = p.match(/^\/v1\/projects\/prj_1\/env\/(.+)$/);
    if (method === 'GET' && ev) return json(s.envs.find((e) => e.id === ev[1]));
    const ep = p.match(/^\/v9\/projects\/prj_1\/env\/(.+)$/);
    if (method === 'PATCH' && ep) { Object.assign(s.envs.find((e) => e.id === ep[1]), body); return json({}); }
    if (method === 'POST' && p === '/v10/projects/prj_1/env') { s.envs.push({ id: 'n' + s.envs.length, ...body }); return json({}); }
    if (method === 'GET' && p === '/v6/deployments') return json({ deployments: [{ url: 'pasibus-abc.vercel.app', created: Date.parse('2026-10-03T10:00:00Z'), state: 'READY', meta: { githubCommitSha: 'abcdef123', githubCommitMessage: 'Zmień | nazwę' } }] });
    if (method === 'POST' && p === '/v13/deployments') return json({ id: 'dpl_1', url: 'pasibus-new.vercel.app', readyState: 'QUEUED', inspectorUrl: 'https://vercel.com/i/dpl_1' });
    if (method === 'GET' && p === '/v13/deployments/dpl_1') {
      const state = s.deployStates[Math.min(polls++, s.deployStates.length - 1)];
      const aliasAssigned = state === 'READY' && aliasPolls++ >= s.aliasAfter;
      return json({ id: 'dpl_1', url: 'pasibus-new.vercel.app', readyState: state, aliasAssigned });
    }
    return json({ error: { code: 'not_found', message: `${method} ${p}` } }, 404);
  };
  return s;
}
const vdeps = (s, env = ENV) => ({ env, fetchImpl: s.fetch, sleep: async () => {}, now: () => 0 });
const writes = (s) => s.calls.filter((c) => c.method !== 'GET');

test('vercel stan: project, domains, variable names and the production Worker, never variable values', async () => {
  const s = fakeVercel();
  const { md, check } = await vercelOps.run('stan', [], vdeps(s));
  assert.match(md, /Projekt: \*\*pasibus\*\*/);
  assert.match(md, /Root Directory: `pasibus`/);
  assert.match(md, /pacy2u\/tst, gałąź produkcyjna `main`/);
  assert.match(md, /Worker produkcji \(UPSTREAM_URL\): https:\/\/pasibus-proxy\.konto\.workers\.dev/);
  assert.match(md, /\| stary\.example \| przekierowanie 308 → pasibus\.vercel\.app \|/);
  assert.match(md, /\| dev\.example \| gałąź dev \|/);
  assert.match(md, /\| UPSTREAM_SECRET \| production, preview \| encrypted \|/);
  assert.match(md, /Zmień \\\| nazwę/);
  assert.doesNotMatch(md, /tajne-stare|zaszyfrowane/);
  assert.deepEqual(check, []);
  assert.equal(writes(s).length, 0);
  assert.ok(s.calls.every((c) => c.auth === 'Bearer vtok' && c.query.teamId === 'team_1'));
});

test('vercel: missing token explains which secret to add', async () => {
  await assert.rejects(vercelOps.run('stan', [], vdeps(fakeVercel(), {})), /VERCEL_TOKEN/);
  await assert.rejects(vercelOps.run('nieznana', [], vdeps(fakeVercel())), /Nieznana operacja/);
});

test('vercel dodaj-domene: adds next to the old ones, is idempotent and explains a taken name', async () => {
  const s = fakeVercel({ takenDomains: ['zajeta.vercel.app'] });
  const r = await vercelOps.run('dodaj-domene', ['WawEye.vercel.app'], vdeps(s));
  assert.deepEqual(writes(s).map((c) => [c.method, c.path, c.body]), [['POST', '/v10/projects/prj_1/domains', { name: 'waweye.vercel.app' }]]);
  assert.deepEqual(r.check, ['https://waweye.vercel.app']);
  assert.ok(s.domains.some((d) => d.name === 'pasibus.vercel.app'));
  const again = await vercelOps.run('dodaj-domene', ['waweye.vercel.app'], vdeps(s));
  assert.match(again.md, /już jest w projekcie/);
  assert.equal(writes(s).length, 1);
  await assert.rejects(vercelOps.run('dodaj-domene', ['zajeta.vercel.app'], vdeps(s)), /niedostępna/);
  await assert.rejects(vercelOps.run('dodaj-domene', ['https://zly adres'], vdeps(s)), /Niepoprawna domena/);
});

test('vercel przekieruj-domene: 308 to a production domain of the project only', async () => {
  const s = fakeVercel();
  s.domains.push({ name: 'waweye.vercel.app', verified: true });
  await assert.rejects(vercelOps.run('przekieruj-domene', ['pasibus.vercel.app', 'dev.example'], vdeps(s)), /domeną produkcyjną/);
  await assert.rejects(vercelOps.run('przekieruj-domene', ['pasibus.vercel.app', 'pasibus.vercel.app'], vdeps(s)), /sama na siebie/);
  const r = await vercelOps.run('przekieruj-domene', ['pasibus.vercel.app', 'waweye.vercel.app'], vdeps(s));
  assert.deepEqual(writes(s).map((c) => [c.method, c.path, c.body]), [['PATCH', '/v9/projects/prj_1/domains/pasibus.vercel.app', { redirect: 'waweye.vercel.app', redirectStatusCode: 308 }]]);
  assert.deepEqual(r.check, ['https://waweye.vercel.app']);
});

test('vercel przelacz-workera: updates UPSTREAM_URL only, deploys main and waits for the domains', async () => {
  const s = fakeVercel();
  const r = await vercelOps.run('przelacz-workera', ['https://waweye-proxy.konto.workers.dev/'], vdeps(s));
  assert.equal(s.envs.find((e) => e.key === 'UPSTREAM_URL').value, 'https://waweye-proxy.konto.workers.dev');
  assert.equal(s.envs.find((e) => e.key === 'UPSTREAM_SECRET').value, 'tajne-stare');
  const dep = s.calls.find((c) => c.method === 'POST' && c.path === '/v13/deployments');
  assert.deepEqual(dep.body, { name: 'pasibus', project: 'prj_1', target: 'production', gitSource: { type: 'github', repoId: '123', ref: 'main' } });
  assert.deepEqual(r.check, ['https://pasibus.vercel.app']);
  assert.match(r.md, /UPSTREAM_URL: zaktualizowano \(production, preview\)/);
  assert.match(r.md, /Wycofanie/);
});

test('vercel przelacz-workera: optional new secret is written but never printed; bad address writes nothing', async () => {
  const s = fakeVercel();
  await assert.rejects(vercelOps.run('przelacz-workera', ['http://evil.example'], vdeps(s)), /Niepoprawny adres Workera/);
  assert.equal(writes(s).length, 0);
  await assert.rejects(vercelOps.run('przelacz-workera', ['https://waweye-proxy.konto.workers.dev'], vdeps(s, { ...ENV, NOWY_SEKRET: 'true' })), /nie ma sekretu PROXY_SECRET/);
  assert.equal(writes(s).length, 0);
  await vercelOps.run('przelacz-workera', ['https://waweye-proxy.konto.workers.dev'], vdeps(s, { ...ENV, PROXY_SECRET: 'nowe-tajne' }));
  assert.equal(s.envs.find((e) => e.key === 'UPSTREAM_SECRET').value, 'tajne-stare', 'without NOWY_SEKRET the secret stays');
  const r = await vercelOps.run('przelacz-workera', ['https://waweye-proxy.konto.workers.dev'], vdeps(s, { ...ENV, NOWY_SEKRET: 'true', PROXY_SECRET: 'nowe-tajne' }));
  assert.equal(s.envs.find((e) => e.key === 'UPSTREAM_SECRET').value, 'nowe-tajne');
  assert.doesNotMatch(r.md, /nowe-tajne/);
});

test('vercel: a failed build leaves production alone and says so', async () => {
  const s = fakeVercel({ deployStates: ['BUILDING', 'ERROR'] });
  await assert.rejects(vercelOps.run('ustaw-root-directory', ['waweye'], vdeps(s)), /stanem ERROR\. Produkcja działa dalej na poprzednim wdrożeniu/);
  assert.equal(s.project.rootDirectory, 'waweye');
  await assert.rejects(vercelOps.run('ustaw-root-directory', ['../etc'], vdeps(fakeVercel())), /Niepoprawny folder/);
});

test('vercel ustaw-root-directory and wdroz-produkcje deploy the production branch', async () => {
  const s = fakeVercel();
  const r = await vercelOps.run('ustaw-root-directory', ['/waweye/'], vdeps(s));
  assert.equal(s.project.rootDirectory, 'waweye');
  assert.match(r.md, /Root Directory ustawiony na `waweye`/);
  assert.deepEqual(r.check, ['https://pasibus.vercel.app']);
  const s2 = fakeVercel({ project: { name: 'x', link: null } });
  await assert.rejects(vercelOps.run('wdroz-produkcje', [], vdeps(s2)), /nie jest połączony z repozytorium/);
});

test('vercel zmien-nazwe-projektu: a domain lost in the rename is added back', async () => {
  const s = fakeVercel({ loseDomainOnRename: 'pasibus.vercel.app' });
  const r = await vercelOps.run('zmien-nazwe-projektu', ['waweye'], vdeps(s));
  assert.equal(s.project.name, 'waweye');
  assert.ok(s.domains.some((d) => d.name === 'pasibus.vercel.app' && !d.redirect));
  assert.match(r.md, /dodałem je z powrotem/);
  await assert.rejects(vercelOps.run('zmien-nazwe-projektu', ['WawEye'], vdeps(fakeVercel())), /Niepoprawna nazwa/);
});

// As on the real project (stan, 2026-10-03): the Worker variables serve production only.
const prodOnlyEnvs = () => [
  { id: 'e1', key: 'UPSTREAM_URL', target: ['production'], type: 'sensitive', value: 'https://pasibus-proxy.konto.workers.dev' },
  { id: 'e2', key: 'UPSTREAM_SECRET', target: ['production'], type: 'sensitive', value: 'tajne-stare' },
];

test('vercel przelacz-podglady: preview-only variables, a preview of main, production untouched', async () => {
  const s = fakeVercel({ preview: 'protected', envs: prodOnlyEnvs() });
  const env = { ...ENV, PROXY_SECRET: 'nowe-tajne' };
  const r = await vercelOps.run('przelacz-podglady', ['https://waweye-proxy.konto.workers.dev'], vdeps(s, env));
  const created = s.envs.filter((e) => e.target.length === 1 && e.target[0] === 'preview');
  assert.deepEqual(created.map((e) => [e.key, e.value, e.type]), [['UPSTREAM_URL', 'https://waweye-proxy.konto.workers.dev', 'plain'], ['UPSTREAM_SECRET', 'nowe-tajne', 'encrypted']]);
  assert.equal(s.envs.find((e) => e.id === 'e1').value, 'https://pasibus-proxy.konto.workers.dev');
  assert.equal(s.envs.find((e) => e.id === 'e2').value, 'tajne-stare');
  const dep = s.calls.find((c) => c.method === 'POST' && c.path === '/v13/deployments');
  assert.deepEqual(dep.body, { name: 'pasibus', project: 'prj_1', gitSource: { type: 'github', repoId: '123', ref: 'main' } });
  assert.match(r.md, /nie może sprawdzić podglądu sam \(HTTP 401[\s\S]*chroni podglądy logowaniem[\s\S]*https:\/\/pasibus-new\.vercel\.app/);
  assert.doesNotMatch(r.md, /nowe-tajne/);
  assert.deepEqual(r.check, []);
  // A second run updates the preview records instead of adding new ones.
  await vercelOps.run('przelacz-podglady', ['https://inny-proxy.konto.workers.dev'], vdeps(s, env));
  assert.equal(s.envs.filter((e) => e.key === 'UPSTREAM_URL').length, 2);
  assert.equal(s.envs.find((e) => e.key === 'UPSTREAM_URL' && e.target[0] === 'preview' && e.target.length === 1).value, 'https://inny-proxy.konto.workers.dev');
});

test('vercel przelacz-podglady: checks an unprotected preview and reports a broken one', async () => {
  const env = { ...ENV, PROXY_SECRET: 'nowe-tajne' };
  const ok = await vercelOps.run('przelacz-podglady', ['https://waweye-proxy.konto.workers.dev'], vdeps(fakeVercel({ preview: 'ok', envs: prodOnlyEnvs() }), env));
  assert.match(ok.md, /Kontrola produkcji: wszystko działa[\s\S]*https:\/\/pasibus-new\.vercel\.app/);
  await assert.rejects(vercelOps.run('przelacz-podglady', ['https://waweye-proxy.konto.workers.dev'], vdeps(fakeVercel({ preview: 'broken', envs: prodOnlyEnvs() }), env)),
    /PROBLEM[\s\S]*HTTP 502 \(HTTP 522\)[\s\S]*Produkcja jest bez zmian/);
});

test('vercel przelacz-podglady: refuses shared production records and a missing secret', async () => {
  const s = fakeVercel();
  s.envs[0].target = ['production', 'preview'];
  await assert.rejects(vercelOps.run('przelacz-podglady', ['https://waweye-proxy.konto.workers.dev'], vdeps(s, { ...ENV, PROXY_SECRET: 'x' })), /wspólna dla produkcji i podglądów/);
  assert.equal(writes(s).length, 0);
  await assert.rejects(vercelOps.run('przelacz-podglady', ['https://waweye-proxy.konto.workers.dev'], vdeps(fakeVercel({ envs: prodOnlyEnvs() }))), /Brak sekretu PROXY_SECRET/);
});

// ---- Fake Cloudflare API ----
const CF_ENV = { CLOUDFLARE_API_TOKEN: 'ctok', CLOUDFLARE_ACCOUNT_ID: 'acc1' };
function fakeCf(over = {}) {
  const s = {
    scripts: [{ id: 'pasibus-proxy', modified_on: '2026-10-02T20:00:00Z' }],
    secrets: { 'pasibus-proxy': [{ name: 'WARSAW_API_KEY' }, { name: 'PROXY_SECRET' }] },
    plain: {}, // plain_text bindings per Worker, as the old pasibus-proxy has (2026-10-03)
    requests: { 'pasibus-proxy': 1200 },
    analyticsError: null,
    workerStatus: 200,
    calls: [],
    ...over,
  };
  s.vercel = fakeVercel();
  s.fetch = async (url, init = {}) => {
    if (url.startsWith('https://api.vercel.com')) return s.vercel.fetch(url, init);
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    s.calls.push({ method, url, path: u.pathname, body, headers: init.headers || {} });
    const ok = (result) => json({ success: true, errors: [], result });
    const p = u.pathname.replace('/client/v4', '');
    if (u.hostname.endsWith('workers.dev')) {
      if ((init.headers || {})['x-proxy-secret'] !== 'proxy-tajne') return json({ error: 'forbidden' }, 403);
      if (s.workerStatus !== 200) return json({ error: 'worker is missing WARSAW_API_KEY' }, s.workerStatus);
      const q = u.search;
      return json(q === '?type=1' ? [{ Lines: '175' }, { Lines: '520' }] : q === '?resource=parking' ? { Status: 'ok', carParks: [{}] } : q === '?resource=fleet' ? { busy: [{}, {}], tramwaje: [{}] } : []);
    }
    if (method === 'GET' && p === '/accounts/acc1/workers/scripts') return ok(s.scripts);
    if (method === 'GET' && p === '/accounts/acc1/workers/subdomain') return ok({ subdomain: 'konto' });
    const sec = p.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)\/secrets$/);
    if (sec && method === 'GET') return ok(s.secrets[sec[1]] || []);
    if (sec && method === 'PUT') { (s.secrets[sec[1]] = (s.secrets[sec[1]] || []).filter((x) => x.name !== body.name)).push({ name: body.name, type: body.type }); return ok({ name: body.name }); }
    const set = p.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)\/settings$/);
    if (set && method === 'GET') return ok({ bindings: [...(s.secrets[set[1]] || []).map((x) => ({ name: x.name, type: 'secret_text' })), ...(s.plain[set[1]] || []).map((n) => ({ name: n, type: 'plain_text', text: 'jawne-tajne' }))] });
    const del = p.match(/^\/accounts\/acc1\/workers\/scripts\/([^/]+)$/);
    if (del && method === 'DELETE') { s.scripts = s.scripts.filter((x) => x.id !== del[1]); return ok(null); }
    if (method === 'POST' && p === '/graphql') {
      if (s.analyticsError) return json({ data: null, errors: [{ message: s.analyticsError }] });
      return json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: s.requests[body.variables.scriptName] || 0 } }] }] } }, errors: null });
    }
    return json({ success: false, errors: [{ code: 7003, message: `${method} ${p}` }] }, 404);
  };
  return s;
}
const cdeps = (s, env = { ...CF_ENV, ...ENV }) => ({ env, fetchImpl: s.fetch, now: () => Date.parse('2026-10-03T12:00:00Z') });

test('cloudflare: deployedName reads the Worker name from wrangler.toml', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-')), 'wrangler.toml');
  fs.writeFileSync(f, '# x\nname = "waweye-proxy"\nmain = "index.js"\n');
  assert.equal(cfOps.deployedName(f), 'waweye-proxy');
  assert.equal(typeof cfOps.deployedName(), 'string');
});

test('cloudflare stan: Workers with secrets, traffic and which one production uses', async () => {
  const s = fakeCf();
  const md = await cfOps.run('stan', ['waweye-proxy'], cdeps(s));
  assert.match(md, /Produkcja Vercel \(UPSTREAM_URL\): https:\/\/pasibus-proxy\.konto\.workers\.dev/);
  assert.match(md, /\| pasibus-proxy \| https:\/\/pasibus-proxy\.konto\.workers\.dev \| 2026-10-02 20:00 \| PROXY_SECRET, WARSAW_API_KEY \| 1200 \|[^\n]*używany przez produkcję Vercel/);
  assert.match(md, /\| waweye-proxy \| nie istnieje \|/);
  assert.ok(s.calls.every((c) => c.headers.Authorization === 'Bearer ctok'));
});

test('cloudflare ustaw-sekrety: needs the deployed Worker, writes both values, prints none', async () => {
  const env = { ...CF_ENV, ...ENV, WARSAW_API_KEY: 'klucz-tajny', PROXY_SECRET: 'proxy-tajne' };
  const s = fakeCf();
  await assert.rejects(cfOps.run('ustaw-sekrety', ['waweye-proxy'], cdeps(s, env)), /nie istnieje\. Najpierw go wdroż/);
  await assert.rejects(cfOps.run('ustaw-sekrety', ['waweye-proxy'], cdeps(s, { ...CF_ENV })), /Brak sekretów WARSAW_API_KEY, PROXY_SECRET/);
  s.scripts.push({ id: 'waweye-proxy' });
  const md = await cfOps.run('ustaw-sekrety', ['waweye-proxy'], cdeps(s, env));
  const puts = s.calls.filter((c) => c.method === 'PUT').map((c) => c.body);
  assert.deepEqual(puts, [{ name: 'WARSAW_API_KEY', text: 'klucz-tajny', type: 'secret_text' }, { name: 'PROXY_SECRET', text: 'proxy-tajne', type: 'secret_text' }]);
  assert.doesNotMatch(md, /klucz-tajny|proxy-tajne/);
});

test('cloudflare ustaw-sekrety: a plain variable with the same name stops it before any write', async () => {
  const env = { ...CF_ENV, ...ENV, WARSAW_API_KEY: 'klucz-tajny', PROXY_SECRET: 'proxy-tajne' };
  const s = fakeCf({ secrets: {}, plain: { 'pasibus-proxy': ['WARSAW_API_KEY', 'PROXY_SECRET'] } });
  await assert.rejects(cfOps.run('ustaw-sekrety', ['pasibus-proxy'], cdeps(s, env)), /ma już zwykłe zmienne WARSAW_API_KEY \(plain_text\), PROXY_SECRET \(plain_text\)[\s\S]*Nic nie zmieniam/);
  assert.equal(s.calls.filter((c) => c.method === 'PUT').length, 0);
  const md = await cfOps.run('stan', [], cdeps(s));
  assert.match(md, /\| pasibus-proxy \|[^\n]*\| brak; jawnym tekstem: PROXY_SECRET, WARSAW_API_KEY \|/);
  assert.doesNotMatch(md, /jawne-tajne/);
});

test('cloudflare test-workera: every resource with the secret and a 403 without it', async () => {
  const env = { ...CF_ENV, PROXY_SECRET: 'proxy-tajne' };
  const md = await cfOps.run('test-workera', ['waweye-proxy'], cdeps(fakeCf(), env));
  assert.match(md, /test Workera waweye-proxy: działa/);
  assert.match(md, /\| Autobusy \(\?type=1\) \| OK \| 2 rekordów/);
  assert.match(md, /\| Tabor \(\?resource=fleet\) \| OK \| 3 rekordów/);
  assert.match(md, /\| Bez sekretu \(oczekiwane 403\) \| OK \| HTTP 403 \|/);
  assert.doesNotMatch(md, /proxy-tajne/);
  await assert.rejects(cfOps.run('test-workera', ['waweye-proxy'], cdeps(fakeCf({ workerStatus: 500 }), env)), /PROBLEM[\s\S]*HTTP 500 \(worker is missing WARSAW_API_KEY\)/);
  // 522 everywhere while the secret works: explain the location problem and point to the preview test.
  await assert.rejects(cfOps.run('test-workera', ['waweye-proxy'], cdeps(fakeCf({ workerStatus: 522 }), env)), /HTTP 522[\s\S]*Sekret działa[\s\S]*przelacz-podglady/);
  await assert.rejects(cfOps.run('test-workera', ['waweye-proxy'], cdeps(fakeCf({ workerStatus: 500 }), env)), (e) => !/Sekret działa/.test(e.message));
  await assert.rejects(cfOps.run('test-workera', ['waweye-proxy'], cdeps(fakeCf(), CF_ENV)), /PROXY_SECRET/);
});

test('cloudflare usun-workera: refuses anything that could still serve production', async () => {
  const s = fakeCf({ scripts: [{ id: 'pasibus-proxy' }, { id: 'waweye-proxy' }, { id: 'stary-proxy' }] });
  const active = cfOps.deployedName();
  await assert.rejects(cfOps.run('usun-workera', ['stary-proxy', 'stary'], cdeps(s)), /wpisz w polu potwierdzenia/);
  await assert.rejects(cfOps.run('usun-workera', [active, active], cdeps(s)), /Nie usuwam go/);
  const old = active === 'pasibus-proxy' ? 'stary-proxy' : 'pasibus-proxy';
  // Vercel reveals UPSTREAM_URL: pointing at the Worker blocks even without traffic.
  s.requests[old] = 0;
  s.vercel.envs[0].value = `https://${old}.konto.workers.dev`;
  await assert.rejects(cfOps.run('usun-workera', [old, old], cdeps(s)), /nadal używa Workera/);
  s.vercel.envs[0].value = 'https://waweye-proxy.konto.workers.dev';
  s.requests[old] = 5;
  await assert.rejects(cfOps.run('usun-workera', [old, old], cdeps(s)), /obsłużył 5 zapytań/);
  s.requests[old] = 0;
  const md = await cfOps.run('usun-workera', [old, old], cdeps(s));
  assert.match(md, new RegExp(`usunięto Workera ${old}[\\s\\S]*Produkcja używa: https://waweye-proxy`));
  assert.ok(!s.scripts.some((x) => x.id === old));
  assert.match(await cfOps.run('usun-workera', [old, old], cdeps(s)), /nie istnieje, nic nie usuwam/);
});

test('cloudflare usun-workera: with UPSTREAM_URL hidden in Vercel only zero traffic allows deleting', async () => {
  const s = fakeCf({ scripts: [{ id: 'pasibus-proxy' }, { id: 'waweye-proxy' }, { id: 'stary-proxy' }] });
  const old = cfOps.deployedName() === 'pasibus-proxy' ? 'stary-proxy' : 'pasibus-proxy';
  s.vercel.envs[0].type = 'sensitive'; // as on the real project (stan, 2026-10-03)
  s.requests[old] = 1200;
  await assert.rejects(cfOps.run('usun-workera', [old, old], cdeps(s)), /obsłużył 1200 zapytań/);
  s.requests[old] = 0;
  s.analyticsError = 'not authorized';
  await assert.rejects(cfOps.run('usun-workera', [old, old], cdeps(s)), /Nie mogę sprawdzić[\s\S]*ukryta w Vercel[\s\S]*not authorized/);
  await assert.rejects(cfOps.run('usun-workera', [old, old], cdeps(s, CF_ENV)), /Nie mogę sprawdzić[\s\S]*VERCEL_TOKEN/);
  assert.ok(s.scripts.some((x) => x.id === old));
  s.analyticsError = null;
  const md = await cfOps.run('usun-workera', [old, old], cdeps(s, CF_ENV));
  assert.match(md, /o usunięciu zdecydował brak ruchu[\s\S]*Ruch w ostatnich 7 dniach: 0/);
  assert.ok(!s.scripts.some((x) => x.id === old));
});

test('cloudflare: analytics without permission does not break stan', async () => {
  const md = await cfOps.run('stan', [], cdeps(fakeCf({ analyticsError: 'not authorized for that account' })));
  assert.match(md, /nieznane \(not authorized for that account\)/);
});
