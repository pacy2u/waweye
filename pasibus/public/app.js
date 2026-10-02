'use strict';
(function () {
  const POLL_MS = 10000, ANIM_MS = 900, LABEL_ZOOM = 14;
  const COLORS = { bus: '#2B2B33', tram: '#0073E6', sel: '#FC4C02' };
  const state = { types: { bus: true, tram: true }, query: '', selected: null, follow: false, markers: new Map(), lastOk: 0, data: [] };

  const map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 9, maxZoom: 19 }).setView([52.2297, 21.0122], 12);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · dane: m.st. Warszawa',
  }).addTo(map);

  const canvas = L.canvas({ padding: 0.3 });
  const labelLayer = L.layerGroup().addTo(map);
  let highlight = null;
  const $ = (id) => document.getElementById(id);

  const radius = () => Math.max(4, Math.min(11, map.getZoom() - 6));
  const visible = (v) => state.types[v.type] && (!state.query || v.line.toLowerCase().startsWith(state.query));

  function style(v) {
    const sel = state.selected, dim = sel && sel !== v.id;
    return { radius: sel === v.id ? radius() + 4 : radius(), color: '#fff', weight: sel === v.id ? 3 : 1.5,
      fillColor: sel === v.id ? COLORS.sel : COLORS[v.type], fillOpacity: dim ? 0.3 : 1, opacity: dim ? 0.35 : 1 };
  }

  function sync(vehicles) {
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
      if (!seen.has(id)) { m.mk.remove(); if (m.label) m.label.remove(); state.markers.delete(id); if (state.selected === id) deselect(); }
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
    $('status-text').dataset.count = [...state.markers.values()].filter((m) => visible(m.v)).length;
    renderStatus();
  }

  function select(id) {
    state.selected = id;
    const m = state.markers.get(id);
    if (!m) return;
    const v = m.v;
    $('panel').hidden = false;
    $('p-line').textContent = v.line;
    $('p-type').textContent = (v.type === 'bus' ? 'Autobus' : 'Tramwaj') + ' ' + v.line;
    $('p-details').textContent = `Pojazd ${v.vehicle}${v.brigade ? ' · brygada ' + v.brigade : ''}${v.time ? ' · ' + new Date(v.time).toLocaleTimeString('pl-PL') : ''}`;
    for (const x of state.markers.values()) if (x.label) { x.label.remove(); x.label = null; }
    refresh();
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
    const n = t.dataset.count || 0;
    if (state.error) { el.className = 'err'; t.textContent = state.error; }
    else if (state.lastOk) { el.className = 'ok'; t.textContent = `${n} pojazdów · ${new Date(state.lastOk).toLocaleTimeString('pl-PL')}${state.source === 'mock' ? ' · dane testowe' : ''}`; }
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
      const res = await fetch('/api/vehicles?types=' + (types.length ? types.join(',') : '1,2'), { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.error = null; state.lastOk = body.updated; state.source = body.source;
      sync(body.vehicles);
    } catch (e) {
      state.error = 'Brak danych: ' + e.message + (state.lastOk ? ' (pokazuję ostatnie)' : '');
      renderStatus();
    }
  }

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
  map.on('click', () => { if (state.selected) deselect(); });
  map.on('zoomend moveend', refresh);

  window.__pasibus = { state, map, select, deselect };
  poll(); setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  requestAnimationFrame(frame);
})();
