'use strict';
(function () {
  const POLL_MS = 10000, ANIM_MS = 900, LABEL_ZOOM = 14;
  const COLORS = { bus: '#2B2B33', tram: '#0073E6', sel: '#FC4C02' };
  const state = { inc: false, incidents: [], selectedInc: null, incLayers: new Map(), incError: null, park: false, parkings: [], selectedPark: null, parkMarkers: new Map(), parkError: null, types: { bus: true, tram: true }, query: '', selected: null, follow: false, markers: new Map(), lastOk: 0, data: [] };

  const map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 9, maxZoom: 19 }).setView([52.2297, 21.0122], 12);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · dane: m.st. Warszawa',
  }).addTo(map);

  const canvas = L.canvas({ padding: 0.3 });
  const labelLayer = L.layerGroup().addTo(map);
  let highlight = null;
  const parkLayer = L.layerGroup();
  const incLayer = L.layerGroup();
  const $ = (id) => document.getElementById(id);

  const radius = () => Math.max(4, Math.min(11, map.getZoom() - 6));
  const STALE_MS = 180000;
  const isStale = (v) => state.lastOk && v.time && state.lastOk - v.time > STALE_MS;
  const visible = (v) => state.types[v.type] && (!state.query || v.line.toLowerCase().startsWith(state.query));

  function style(v) {
    const sel = state.selected, dim = sel && sel !== v.id;
    return { radius: sel === v.id ? radius() + 4 : radius(), color: '#fff', weight: sel === v.id ? 3 : 1.5,
      fillColor: sel === v.id ? COLORS.sel : COLORS[v.type], fillOpacity: dim ? 0.3 : isStale(v) ? 0.55 : 1, opacity: dim ? 0.35 : 1 };
  }

  function sync(vehicles, requested) {
    state.data = vehicles;
    const seen = new Set(), now = performance.now();
    for (const v of vehicles) {
      seen.add(v.id);
      let m = state.markers.get(v.id);
      if (!m) {
        m = { v, mk: L.circleMarker([v.lat, v.lon], { ...style(v), renderer: canvas }), from: null, to: null, t0: 0, label: null };
        m.mk.on('click', (e) => { L.DomEvent.stopPropagation(e); select(m.v.id); });
        state.markers.set(v.id, m);
      } else {
        const p = m.mk.getLatLng();
        m.from = [p.lat, p.lng]; m.to = [v.lat, v.lon]; m.t0 = now; m.v = v;
      }
    }
    for (const [id, m] of state.markers) {
      // Markers of types we did not ask for are kept (hidden) so re-enabling a type does not flash an empty map.
      if (!seen.has(id) && requested.has(m.v.type)) { m.mk.remove(); if (m.label) m.label.remove(); state.markers.delete(id); if (state.selected === id) deselect(); }
    }
    refresh();
  }

  function refresh() {
    const showLabels = map.getZoom() >= LABEL_ZOOM, bounds = map.getBounds().pad(0.1);
    for (const m of state.markers.values()) {
      const show = visible(m.v) || state.selected === m.v.id;
      if (show) { if (!map.hasLayer(m.mk)) m.mk.addTo(map); m.mk.setStyle(style(m.v)); if (state.selected === m.v.id) m.mk.bringToFront(); }
      else if (map.hasLayer(m.mk)) m.mk.remove();
      const wantLabel = show && showLabels && bounds.contains(m.mk.getLatLng());
      if (wantLabel && !m.label) {
        m.label = L.marker(m.mk.getLatLng(), { interactive: false, keyboard: false, zIndexOffset: state.selected === m.v.id ? 1000 : 0,
          icon: L.divIcon({ className: '', html: `<div class="lbl ${state.selected === m.v.id ? 'sel' : m.v.type}">${m.v.line}</div>`, iconSize: null, iconAnchor: [14, -2] }) }).addTo(labelLayer);
      } else if (!wantLabel && m.label) { m.label.remove(); m.label = null; }
    }
    updateHighlight();
    renderStatus();
  }

  function select(id) {
    if (state.selectedPark) deselectPark();
    if (state.selectedInc) deselectInc();
    state.selected = id;
    const m = state.markers.get(id);
    if (!m) return;
    const v = m.v;
    $('panel').hidden = false;
    $('p-line').textContent = v.line;
    $('p-type').textContent = (v.type === 'bus' ? 'Autobus' : 'Tramwaj') + ' ' + v.line;
    $('p-details').textContent = `Pojazd ${v.vehicle}${v.brigade ? ' · brygada ' + v.brigade : ''}${v.time ? ' · ' + new Date(v.time).toLocaleTimeString('pl-PL') : ''}${isStale(v) ? ` · dane sprzed ${Math.round((state.lastOk - v.time) / 60000)} min` : ''}`;
    for (const x of state.markers.values()) if (x.label) { x.label.remove(); x.label = null; }
    loadFleet();
    fillFleet(v);
    refresh();
  }

  // ---- Fleet details (dataset "Pojazdy transportu publicznego"), fetched once on first selection ----
  const fleetInfo = (v) => {
    const f = state.fleet; if (!f) return null;
    const keys = [v.vehicle, v.vehicle.replace(/^0+/, '')].map((n) => `${v.type}:${n}`);
    const rec = keys.map((k) => f.vehicles[k]).find(Boolean);
    return rec ? { rec, brand: rec.brand != null ? f.brands[`${v.type}:${rec.brand}`] : null } : null;
  };
  const dim = (mm) => (mm ? (mm / 1000).toFixed(2).replace('.', ',') + ' m' : '');
  const seatsTxt = (b) => [b.seats != null && `${b.seats} siedzących`, b.standing != null && `${b.standing} stojących`, b.capacity != null && `razem ${b.capacity}`].filter(Boolean).join(' · ');
  const FLOOR = { LE: 'niskopodłogowy (LE)', LF: 'niskopodłogowy (LF)', HF: 'wysokopodłogowy (HF)' };

  function fillFleet(v) {
    const dl = $('p-fleet'); dl.textContent = '';
    if (state.selected !== v.id) return;
    const info = fleetInfo(v);
    if (!info) {
      if (!state.fleet && !state.fleetError) row(dl, 'Dane o pojeździe', 'ładowanie…');
      else if (state.fleetError) row(dl, 'Dane o pojeździe', 'brak (' + state.fleetError + ')');
      else row(dl, 'Dane o pojeździe', 'brak w zbiorze dla numeru ' + v.vehicle);
      dl.hidden = !dl.children.length; return;
    }
    const { rec, brand: b } = info;
    if (b) row(dl, 'Model', [b.make, b.model].filter(Boolean).join(' '));
    row(dl, 'Rok produkcji', rec.year); row(dl, 'Nr rejestracyjny', rec.plate);
    row(dl, 'Operator', rec.operator); row(dl, 'Zajezdnia', rec.depot);
    if (b) {
      row(dl, 'Producent', b.producer); row(dl, 'Miejsca', seatsTxt(b));
      row(dl, 'Długość × szer.', b.length ? `${dim(b.length)}${b.width ? ' × ' + dim(b.width) : ''}` : ''); row(dl, 'Klasa', b.sizeClass);
      row(dl, 'Podłoga', FLOOR[b.floor] || b.floor);
      if (b.ac != null) row(dl, 'Klimatyzacja', b.ac ? 'tak' : 'nie');
      row(dl, 'Napęd', b.power); row(dl, 'Płatność', b.payment);
      if (b.wheelchair != null) row(dl, 'Miejsca na wózek', b.wheelchair + (b.stroller ? ` (+${b.stroller} dziecięcy)` : ''));
    }
    row(dl, 'Malowanie', [rec.paint, rec.color].filter(Boolean).join(' · ')); row(dl, 'Tapicerka', rec.upholstery);
    dl.hidden = !dl.children.length;
  }

  async function loadFleet() {
    if (state.fleet || state.fleetLoading) return;
    state.fleetLoading = true; state.fleetError = null;
    try {
      const res = await fetch('/api/fleet');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.fleet = body; state.fleetError = null;
    } catch (e) {
      state.fleetError = e.message; // shown in the panel; loadFleet retries at the next selection
    }
    state.fleetLoading = false;
    const m = state.selected && state.markers.get(state.selected);
    if (m) fillFleet(m.v);
  }
  function deselect() {
    state.selected = null; state.follow = false; $('follow').classList.remove('on');
    $('panel').hidden = true;
    for (const x of state.markers.values()) if (x.label) { x.label.remove(); x.label = null; }
    refresh();
  }

  function updateHighlight() {
    const m = state.selected && state.markers.get(state.selected);
    if (!m) { if (highlight) { highlight.remove(); highlight = null; } return; }
    if (!highlight) highlight = L.marker(m.mk.getLatLng(), { interactive: false, keyboard: false, zIndexOffset: 500,
      icon: L.divIcon({ className: '', html: '<div class="hl"></div>', iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(map);
    else highlight.setLatLng(m.mk.getLatLng());
  }

  function renderStatus() {
    const el = $('status'), t = $('status-text');
    if (!state.error && !state.lastOk) return; // still on the initial load
    const n = [...state.markers.values()].filter((m) => visible(m.v)).length; // computed now, never cached
    if (state.error) { el.className = 'err'; t.textContent = state.error; }
    else if (state.lastOk) { el.className = 'ok'; t.textContent = `${n} pojazdów · ${new Date(state.lastOk).toLocaleTimeString('pl-PL')}${state.source === 'mock' ? ' · dane testowe' : ''}${state.parkError ? ' · parkingi: ' + state.parkError : ''}${state.incError ? ' · utrudnienia: ' + state.incError : ''}${state.data.length === 0 && state.received > 0 ? ` · API zwróciło ${state.received}, wszystkie odrzucone (nieaktualne/poza Warszawą)` : state.data.length === 0 && state.received === 0 ? ' · API zwróciło pustą listę' : ''}`; }
  }

  // Smooth movement between polls.
  function frame(now) {
    let moving = false;
    for (const m of state.markers.values()) {
      if (!m.to) continue;
      const k = Math.min(1, (now - m.t0) / ANIM_MS);
      m.mk.setLatLng([m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k]);
      if (m.label) m.label.setLatLng(m.mk.getLatLng());
      if (k >= 1) m.to = null; else moving = true;
    }
    if (moving || state.selected) {
      updateHighlight();
      const s = state.selected && state.markers.get(state.selected);
      if (state.follow && s) map.panTo(s.mk.getLatLng(), { animate: false });
    }
    requestAnimationFrame(frame);
  }

  async function poll() {
    try {
      const types = [state.types.bus && 1, state.types.tram && 2].filter(Boolean);
      if (!types.length) { refresh(); return; } // nothing to show, nothing to fetch
      const res = await fetch('/api/vehicles?types=' + types.join(','), { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.error = null; state.lastOk = body.updated; state.source = body.source; state.received = body.received;
      sync(body.vehicles, new Set(types.map((t) => (t === 1 ? 'bus' : 'tram'))));
    } catch (e) {
      state.error = 'Brak danych: ' + e.message + (state.lastOk ? ' (pokazuję ostatnie)' : '');
      renderStatus();
    }
  }

  // ---- Parkings ----
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const sum = (o) => o.standard + o.disabled + o.electric;
  const freeAll = (p) => sum(p.free);
  const money = (n) => n.toFixed(2).replace('.', ',') + ' zł';
  const pkLabel = (p) => `<div class="pk ${freeAll(p) ? '' : 'none'} ${state.selectedPark === p.id ? 'sel' : ''}">P ${freeAll(p)}</div>`;

  function renderParkings() {
    const seen = new Set();
    for (const p of state.parkings) {
      seen.add(p.id);
      let m = state.parkMarkers.get(p.id);
      const icon = L.divIcon({ className: '', html: pkLabel(p), iconSize: null, iconAnchor: [17, 11] });
      if (!m) {
        m = L.marker([p.lat, p.lon], { icon, zIndexOffset: 700, keyboard: false, title: p.name }).addTo(parkLayer);
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); selectPark(p.id); });
        state.parkMarkers.set(p.id, m);
      } else m.setIcon(icon);
      m.parking = p;
    }
    for (const [id, m] of state.parkMarkers) if (!seen.has(id)) { parkLayer.removeLayer(m); state.parkMarkers.delete(id); }
    if (state.selectedPark) { const p = state.parkings.find((x) => x.id === state.selectedPark); if (p) fillParkPanel(p); else deselectPark(); }
  }

  function row(dl, k, v, link) {
    if (!v) return;
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd');
    if (link) { const a = document.createElement('a'); a.href = link; a.textContent = v; dd.appendChild(a); } else dd.textContent = v;
    dl.append(dt, dd);
  }

  function fillParkPanel(p) {
    const free = freeAll(p), cap = sum(p.capacity);
    $('pp-badge').textContent = 'P'; $('pp-badge').classList.toggle('none', !free);
    $('pp-name').textContent = p.name; $('pp-addr').textContent = [p.address, p.category].filter(Boolean).join(' · ');
    $('pp-free').textContent = free; $('pp-of').textContent = `wolnych miejsc${cap ? ' z ' + cap : ''}`;
    const dl = $('pp-rows'); dl.textContent = '';
    row(dl, 'Standardowe', `${p.free.standard} wolnych${p.capacity.standard ? ' z ' + p.capacity.standard : ''}`);
    row(dl, 'Dla niepełnospr.', `${p.free.disabled} wolnych${p.capacity.disabled ? ' z ' + p.capacity.disabled : ''}`);
    row(dl, 'Elektryczne', `${p.free.electric} wolnych${p.capacity.electric ? ' z ' + p.capacity.electric : ''}`);
    const today = p.hours && p.hours[DAYS[new Date().getDay()]];
    row(dl, 'Dziś otwarte', today);
    if (p.carTariff.length) row(dl, 'Cennik (os.)', p.carTariff.slice(0, 3).map((t) => `${t.hours} h: ${money(t.price)}`).join(' · '));
    row(dl, 'Płatności', p.payment); row(dl, 'Ochrona', p.security); row(dl, 'Zarządca', p.manager);
    row(dl, 'Telefon', p.phone, p.phone ? 'tel:' + p.phone.replace(/[^+\d]/g, '') : '');
  }

  function selectPark(id) {
    const p = state.parkings.find((x) => x.id === id); if (!p) return;
    if (state.selected) deselect();
    if (state.selectedInc) deselectInc();
    state.selectedPark = id; fillParkPanel(p); $('ppanel').hidden = false; renderParkings();
  }
  function deselectPark() {
    state.selectedPark = null; $('ppanel').hidden = true; renderParkings();
  }

  async function pollParkings() {
    if (!state.park) return;
    try {
      const res = await fetch('/api/parking', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.parkError = null; state.parkings = body.parkings; renderParkings();
    } catch (e) {
      state.parkError = 'brak danych (' + e.message + ')';
    }
    renderStatus();
  }
  function toggleParking(btn) {
    state.park = !state.park;
    btn.classList.toggle('on', state.park); btn.setAttribute('aria-pressed', state.park);
    if (state.park) { parkLayer.addTo(map); pollParkings(); }
    else { map.removeLayer(parkLayer); if (state.selectedPark) deselectPark(); state.parkError = null; renderStatus(); }
  }
  $('t-park').onclick = (e) => toggleParking(e.currentTarget);
  $('pclose').onclick = deselectPark;
  setInterval(pollParkings, 60000);

  // ---- Road incidents ----
  const STATUS_TXT = { active: 'Trwa', planned: 'Zaplanowane', ended: 'Zakończone' };
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?');
  const incColor = (i) => (i.status === 'active' ? '#F5A100' : i.status === 'planned' ? '#7A8BA6' : '#8a8a92');
  const incIcon = (i) => L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div class="ic ${i.status} ${state.selectedInc === i.id ? 'sel' : ''}">!</div>` });

  function renderIncidents() {
    for (const g of state.incLayers.values()) incLayer.removeLayer(g);
    state.incLayers.clear();
    for (const i of state.incidents) {
      const group = L.layerGroup();
      const sel = state.selectedInc === i.id;
      for (const sh of i.shapes) {
        if (sh.type === 'line') {
          L.polyline(sh.points, { color: sel ? '#FC4C02' : incColor(i), weight: sel ? 8 : 6, opacity: i.status === 'ended' ? 0.5 : 0.85 })
            .on('click', (e) => { L.DomEvent.stopPropagation(e); selectInc(i.id); }).addTo(group);
        }
        const at = sh.type === 'line' ? sh.points[Math.floor(sh.points.length / 2)] : sh.points[0];
        L.marker(at, { icon: incIcon(i), zIndexOffset: 800, keyboard: false, title: i.name })
          .on('click', (e) => { L.DomEvent.stopPropagation(e); selectInc(i.id); }).addTo(group);
      }
      group.addTo(incLayer); state.incLayers.set(i.id, group);
    }
    if (state.selectedInc !== null) { const i = state.incidents.find((x) => x.id === state.selectedInc); if (i) fillIncPanel(i); else deselectInc(); }
  }

  function fillIncPanel(i) {
    $('ip-badge').className = 'i-badge ' + i.status; $('ip-name').textContent = i.name;
    $('ip-when').textContent = i.start && i.end ? `${fmtDate(i.start)} – ${fmtDate(i.end)}`
      : i.start ? `od ${fmtDate(i.start)} · bez daty zakończenia` : i.end ? `do ${fmtDate(i.end)}` : 'brak dat';
    const st = $('ip-status'); st.textContent = STATUS_TXT[i.status]; st.className = 'i-status ' + i.status;
    const body = $('ip-body'); body.textContent = '';
    for (const t of i.content) { const p = document.createElement('p'); p.textContent = t; body.appendChild(p); }
    const link = $('ip-link');
    if (typeof i.id === 'number') { link.href = `https://infoulice.um.warszawa.pl/?page_id=${i.id}`; link.hidden = false; } else link.hidden = true;
  }
  function selectInc(id) {
    const i = state.incidents.find((x) => x.id === id); if (!i) return;
    if (state.selected) deselect();
    if (state.selectedPark) deselectPark();
    state.selectedInc = id; fillIncPanel(i); $('ipanel').hidden = false; renderIncidents();
  }
  function deselectInc() {
    state.selectedInc = null; $('ipanel').hidden = true; renderIncidents();
  }
  async function pollIncidents() {
    if (!state.inc) return;
    try {
      const res = await fetch('/api/incidents', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.incError = null; state.incidents = body.incidents; renderIncidents();
    } catch (e) {
      state.incError = 'brak danych (' + e.message + ')';
    }
    renderStatus();
  }
  function toggleIncidents(btn) {
    state.inc = !state.inc;
    btn.classList.toggle('on', state.inc); btn.setAttribute('aria-pressed', state.inc);
    if (state.inc) { incLayer.addTo(map); pollIncidents(); }
    else { map.removeLayer(incLayer); if (state.selectedInc !== null) deselectInc(); state.incError = null; renderStatus(); }
  }
  $('t-inc').onclick = (e) => toggleIncidents(e.currentTarget);
  $('iclose').onclick = deselectInc;
  setInterval(pollIncidents, 60000);

  function toggleType(key, btn) {
    state.types[key] = !state.types[key];
    btn.classList.toggle('on', state.types[key]); btn.setAttribute('aria-pressed', state.types[key]);
    refresh(); poll();
  }
  $('t-bus').onclick = (e) => toggleType('bus', e.currentTarget);
  $('t-tram').onclick = (e) => toggleType('tram', e.currentTarget);
  $('search').oninput = (e) => { state.query = e.target.value.trim().toLowerCase(); refresh(); };
  $('close').onclick = deselect;
  $('follow').onclick = (e) => {
    state.follow = !state.follow; e.currentTarget.classList.toggle('on', state.follow);
    const s = state.markers.get(state.selected); if (state.follow && s) map.setView(s.mk.getLatLng(), Math.max(map.getZoom(), 15));
  };
  map.on('click', () => { if (state.selected) deselect(); if (state.selectedPark) deselectPark(); if (state.selectedInc !== null) deselectInc(); });
  map.on('zoomend moveend', refresh);

  window.__pasibus = { state, map, select, deselect, selectPark, deselectPark, selectInc, deselectInc };
  poll(); setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  requestAnimationFrame(frame);
})();
