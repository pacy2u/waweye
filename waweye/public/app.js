'use strict';
(function () {
  const POLL_MS = 10000, LABEL_ZOOM = 14;
  // Vehicles glide at a constant speed from one reported position to the next over the time between the two reports
  // (clamped), so they keep moving between polls instead of jumping; the price is showing them up to that long behind.
  const ANIM_MIN = POLL_MS, ANIM_MAX = 3 * POLL_MS, JUMP_DEG = 0.02; // a jump of over ~2 km (e.g. back from a depot) is not animated
  const COLORS = { bus: '#2B2B33', tram: '#0073E6', sel: '#FC4C02' };
  const state = { range: 'today', events: false, eventItems: [], selectedEvent: null, eventMarkers: new Map(), eventError: null, eventMeta: null, sport: false, sportItems: [], selectedSport: null, sportMarkers: new Map(), sportError: null, sportMeta: null, inc: false, incidents: [], selectedInc: null, incLayers: new Map(), incError: null, park: false, parkings: [], selectedPark: null, parkMarkers: new Map(), parkError: null, types: { bus: true, tram: true }, query: '', words: [], selected: null, follow: false, markers: new Map(), lastOk: 0, data: [] };

  // Timelapse (section "Timelapse" below): predicted movement of the vehicles, up to 1000× faster than real time.
  const lapse = { on: false, slider: 34, speed: 10, t0: 0, t: 0, last: 0, gen: 0, list: [], items: new Map(), sched: undefined, shown: 0, tracks: new Map(), markers: new Map(), lines: { done: 0, total: 0 }, dirty: false };

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
  const sportLayer = L.layerGroup();
  const eventLayer = L.layerGroup();
  const $ = (id) => document.getElementById(id);

  const radius = () => Math.max(4, Math.min(11, map.getZoom() - 6));
  const STALE_MS = 180000;
  const isStale = (v) => state.lastOk && v.time && state.lastOk - v.time > STALE_MS;
  const visible = (v) => state.types[v.type] && (!state.query || v.line.toLowerCase().startsWith(state.query));
  // The same search box filters the other layers by their text: every word must appear somewhere in it, case and
  // Polish letters aside ("lazienki" finds "Łazienki"). The text of an item is built once (items are replaced on each poll).
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
  const searchText = new WeakMap();
  function matches(it, fields) {
    if (!state.words.length) return true;
    let t = searchText.get(it);
    if (t == null) searchText.set(it, (t = fold(fields(it).flat(2).filter((x) => typeof x === 'string').join(' '))));
    return state.words.every((w) => t.includes(w));
  }
  const PARK_TEXT = (p) => [p.name, p.address, p.category];
  const INC_TEXT = (i) => [i.name, i.content];
  const SPORT_TEXT = (it) => [it.title, it.place, it.address, it.district, it.categories, it.audience, it.text];
  const EVENT_TEXT = (it) => [it.title, it.venue, it.district, it.organizer, it.categories, it.text, it.points.map((x) => [x.label, x.street, x.district])];

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
      // Recent positions of every vehicle: the timelapse tells its direction from them.
      const tr = lapse.tracks.get(v.id), lp = tr && tr[tr.length - 1];
      if (!tr) lapse.tracks.set(v.id, [[v.lat, v.lon]]);
      else if (lp[0] !== v.lat || lp[1] !== v.lon) { tr.push([v.lat, v.lon]); if (tr.length > 6) tr.shift(); }
      let m = state.markers.get(v.id);
      if (!m) {
        m = { v, mk: L.circleMarker([v.lat, v.lon], { ...style(v), renderer: canvas }), from: null, to: null, t0: 0, label: null };
        m.mk.on('click', (e) => { L.DomEvent.stopPropagation(e); select(m.v.id); });
        state.markers.set(v.id, m);
      } else {
        const last = m.to || m.from || [m.v.lat, m.v.lon]; // the newest position already being shown or headed to
        if (v.lat !== last[0] || v.lon !== last[1]) {
          const p = m.mk.getLatLng();
          if (Math.abs(v.lat - p.lat) + Math.abs(v.lon - p.lng) > JUMP_DEG) { m.mk.setLatLng([v.lat, v.lon]); if (m.label) m.label.setLatLng([v.lat, v.lon]); m.from = [v.lat, v.lon]; m.to = null; }
          else {
            const dt = v.time && m.v.time ? v.time - m.v.time : 0;
            m.from = [p.lat, p.lng]; m.to = [v.lat, v.lon]; m.t0 = now; m.dur = Math.max(ANIM_MIN, Math.min(ANIM_MAX, dt || POLL_MS));
          }
        }
        m.v = v;
      }
    }
    for (const [id, m] of state.markers) {
      // Markers of types we did not ask for are kept (hidden) so re-enabling a type does not flash an empty map.
      if (!seen.has(id) && requested.has(m.v.type)) { m.mk.remove(); if (m.label) m.label.remove(); state.markers.delete(id); lapse.tracks.delete(id); if (state.selected === id) deselect(); }
    }
    refresh();
  }

  function refresh() {
    const showLabels = map.getZoom() >= LABEL_ZOOM, bounds = map.getBounds().pad(0.1);
    for (const m of state.markers.values()) {
      const show = !lapse.on && (visible(m.v) || state.selected === m.v.id); // the timelapse draws its own markers
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

  // Collapsed panels: only the badge and the name stay (vehicles: line, direction and "Śledź"), to uncover the map on phones.
  // One choice for all panels, remembered (waweye.panelMin); following a vehicle on a phone collapses its panel for that vehicle only.
  const PANELS = ['panel', 'ppanel', 'ipanel', 'spanel', 'epanel', 'zpanel', 'mpanel'];
  let panelMinPref = false;
  try { panelMinPref = localStorage.getItem('waweye.panelMin') === '1'; } catch {}
  function setPanelMin(on, remember, ids = PANELS) {
    for (const id of ids) {
      const p = $(id), b = p.querySelector('.p-collapse'), txt = on ? 'Rozwiń szczegóły' : 'Zwiń szczegóły';
      p.classList.toggle('min', on); b.setAttribute('aria-expanded', String(!on)); b.setAttribute('aria-label', txt); b.title = txt;
    }
    if (remember) { panelMinPref = on; try { localStorage.setItem('waweye.panelMin', on ? '1' : '0'); } catch {} }
  }
  setPanelMin(panelMinPref, false);

  function select(id) {
    closeZone(); closeStation();
    if (state.selectedPark) deselectPark();
    if (state.selectedInc) deselectInc();
    if (state.selectedSport) deselectSport();
    if (state.selectedEvent) deselectEvent();
    state.selected = id;
    const m = state.markers.get(id);
    if (!m) return;
    const v = m.v;
    $('panel').hidden = false; setPanelMin(panelMinPref, false, ['panel']);
    $('p-line').textContent = v.line;
    $('p-type').textContent = (v.type === 'bus' ? 'Autobus' : 'Tramwaj') + ' ' + v.line;
    $('p-details').textContent = `Pojazd ${v.vehicle}${v.brigade ? ' · brygada ' + v.brigade : ''}${v.time ? ' · ' + new Date(v.time).toLocaleTimeString('pl-PL') : ''}${isStale(v) ? ` · dane sprzed ${Math.round((state.lastOk - v.time) / 60000)} min` : ''}`;
    for (const x of state.markers.values()) if (x.label) { x.label.remove(); x.label = null; }
    loadFleet();
    fillFleet(v);
    showRoute(v);
    refresh();
  }

  // ---- Route of the selected vehicle's line (public/data/trasy/<line>.json from the ZTM GTFS, scripts/trasy.js) ----
  // Drawn on the vehicles' canvas under them: the line in the selection colour, stops as small circles (tap or hover shows
  // the name). The variant follows the vehicle's movement (public/trasa.js); until it moves, both directions are shown.
  const route = { vehicle: null, line: null, data: null, error: null, track: [], shown: [], known: false, cache: new Map() };
  const routeLayer = L.layerGroup().addTo(map);
  const routeDate = (ymd) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  async function loadRoute(line) {
    if (route.cache.has(line)) return route.cache.get(line);
    // The route store (refreshed daily from the ZTM GTFS, /api/trasa) first; the files shipped with the app as the fallback.
    const fromFile = () => fetch('/data/trasy/' + encodeURIComponent(line) + '.json').then((res) => {
      if (res.status === 404) return null; // the line is not in the timetable (e.g. a new or replacement line)
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
    const p = fetch('/api/trasa?linia=' + encodeURIComponent(line)).then((res) => (res.ok ? res.json() : fromFile()), fromFile);
    route.cache.set(line, p);
    p.catch(() => route.cache.delete(line)); // try again on the next selection
    return p;
  }
  function showRoute(v) {
    if (route.vehicle !== v.id) { route.vehicle = v.id; route.track = [[v.lat, v.lon]]; route.shown = []; }
    route.line = v.line; route.data = null; route.error = null;
    routeLayer.clearLayers(); renderRoutePanel();
    loadRoute(v.line).then((data) => {
      if (route.vehicle !== v.id) return;
      route.data = data; route.error = data ? null : 'brak trasy tej linii w rozkładzie ZTM';
      if (data) updateRoute(true); else renderRoutePanel();
    }, (e) => { if (route.vehicle === v.id) { route.error = 'nie udało się wczytać trasy (' + e.message + ')'; renderRoutePanel(); } });
  }
  function updateRoute(force = false) {
    const m = route.vehicle && state.markers.get(route.vehicle);
    if (!m) return;
    const last = route.track[route.track.length - 1];
    if (!last || last[0] !== m.v.lat || last[1] !== m.v.lon) { route.track.push([m.v.lat, m.v.lon]); if (route.track.length > 6) route.track.shift(); }
    if (!route.data) return;
    const pick = wawTrasa.chooseVariants(route.data.variants, route.track);
    const same = pick.variants.length === route.shown.length && pick.variants.every((v, i) => v === route.shown[i]);
    route.known = pick.known;
    if (same && !force) { renderRoutePanel(); return; }
    route.shown = pick.variants;
    routeLayer.clearLayers();
    const lines = [], stops = [];
    for (const v of route.shown) {
      lines.push(L.polyline(v.shape, { renderer: canvas, interactive: false, color: COLORS.sel, weight: 5, opacity: route.shown.length > 1 ? 0.5 : 0.75, lineJoin: 'round' }).addTo(routeLayer));
      for (const [name, lat, lon] of v.stops) {
        const st = L.circleMarker([lat, lon], { renderer: canvas, radius: 4, color: COLORS.sel, weight: 2, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(name, { direction: 'top', offset: [0, -4], className: 'stop-tip' }).addTo(routeLayer);
        st.on('click', (e) => { L.DomEvent.stopPropagation(e); st.openTooltip(); });
        stops.push(st);
      }
    }
    // Stops above the line, both under the vehicles (canvas draws in order).
    for (const st of stops) st.bringToBack();
    for (const l of lines) l.bringToBack();
    metroLayer.eachLayer((l) => { if (!l.options.interactive) l.bringToBack(); }); // metro lines stay under the route
    renderRoutePanel();
  }
  function clearRoute() { route.vehicle = null; route.data = null; route.error = null; route.shown = []; route.track = []; routeLayer.clearLayers(); renderRoutePanel(); }
  function renderRoutePanel() {
    const el = $('p-route');
    if (!route.vehicle) { el.hidden = true; return; }
    el.hidden = false; el.className = 'p-route';
    if (route.error) { el.textContent = 'Trasa: ' + route.error; return; }
    if (!route.data) { el.textContent = 'Trasa: wczytywanie…'; return; }
    const d = route.data, valid = d.valid;
    const dirTxt = route.known && route.shown.length === 1
      ? `Kierunek: ${route.shown[0].headsign} · ${route.shown[0].stops.length} przystanków`
      : `Kierunek: ustalę, gdy pojazd ruszy · na mapie ${route.shown.length > 1 ? 'oba kierunki' : 'trasa linii'}`;
    const old = wawTrasa.expired(valid, warsawToday());
    el.textContent = '';
    const a = document.createElement('div'); a.textContent = dirTxt;
    const b = document.createElement('div'); b.className = 'p-route-src' + (old ? ' old' : '');
    b.textContent = valid ? (old ? `Rozkład ZTM ważny do ${routeDate(valid.to)} – trasa może być nieaktualna` : `Trasa wg rozkładu ZTM (GTFS) ważnego do ${routeDate(valid.to)}`) : 'Trasa wg rozkładu ZTM (GTFS)';
    el.append(a, b);
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
    clearRoute();
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

  function sportStatus() {
    if (!state.sport) return '';
    if (state.sportError) return ' · sport: ' + state.sportError;
    if (!state.sportMeta) return '';
    const n = state.sportMarkers.size ? [...state.sportMarkers.values()].reduce((k, m) => k + m.place.entries.length, 0) : 0;
    return ` · sport: ${n} ${RANGE_TXT[state.range]}${state.sportMeta.pending ? ', ustalanie adresów…' : ''}`;
  }
  function eventStatus() {
    if (!state.events) return '';
    if (state.eventError) return ' · DziejeSię: ' + state.eventError;
    if (!state.eventMeta) return '';
    const n = new Set([...state.eventMarkers.values()].flatMap((m) => m.place.entries.map((e) => e.it.id))).size;
    return ` · DziejeSię: ${n} ${RANGE_TXT[state.range]}${state.eventMeta.pending ? ', ustalanie adresów…' : ''}`;
  }
  function renderStatus() {
    const el = $('status'), t = $('status-text');
    if (!state.error && !state.lastOk) return; // still on the initial load
    const n = [...state.markers.values()].filter((m) => visible(m.v)).length; // computed now, never cached
    if (state.error) { el.className = 'err'; t.textContent = state.error; }
    else if (state.lastOk) { el.className = 'ok'; t.textContent = `${n} pojazdów · ${new Date(state.lastOk).toLocaleTimeString('pl-PL')}${state.source === 'mock' ? ' · dane testowe' : ''}${state.parkError ? ' · parkingi: ' + state.parkError : ''}${state.incError ? ' · utrudnienia: ' + state.incError : ''}${sportStatus()}${eventStatus()}${zones.sctError ? ' · strefa czystego transportu: ' + zones.sctError : ''}${metro.error ? ' · metro: ' + metro.error : ''}${state.data.length === 0 && state.received > 0 ? ` · API zwróciło ${state.received}, wszystkie odrzucone (nieaktualne/poza Warszawą)` : state.data.length === 0 && state.received === 0 ? ' · API zwróciło pustą listę' : ''}`; }
  }

  // Smooth movement between polls.
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return; // nothing to draw (also how tests freeze the vehicles)
    if (lapse.on) lapseFrame(now);
    let moving = false;
    for (const m of state.markers.values()) {
      if (!m.to) continue;
      const k = Math.min(1, (now - m.t0) / m.dur);
      m.mk.setLatLng([m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k]);
      if (m.label) m.label.setLatLng(m.mk.getLatLng());
      if (k >= 1) { m.from = m.to; m.to = null; } else moving = true;
    }
    if (moving || state.selected) {
      updateHighlight();
      const s = state.selected && state.markers.get(state.selected);
      if (state.follow && s) map.panTo(s.mk.getLatLng(), { animate: false });
    }
  }

  async function poll() {
    if (document.hidden) return; // hidden tab: no requests; visibilitychange catches up
    try {
      const types = [state.types.bus && 1, state.types.tram && 2].filter(Boolean);
      if (!types.length) { refresh(); return; } // nothing to show, nothing to fetch
      const res = await fetch('/api/vehicles?types=' + types.join(','), { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.error = null; state.lastOk = body.updated; state.source = body.source; state.received = body.received;
      sync(body.vehicles, new Set(types.map((t) => (t === 1 ? 'bus' : 'tram'))));
      if (state.selected) updateRoute();
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
      if (!matches(p, PARK_TEXT) && state.selectedPark !== p.id) continue;
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
    closeZone(); closeStation();
    if (state.selectedSport) deselectSport();
    if (state.selectedEvent) deselectEvent();
    state.selectedPark = id; fillParkPanel(p); $('ppanel').hidden = false; renderParkings();
  }
  function deselectPark() {
    state.selectedPark = null; $('ppanel').hidden = true; renderParkings();
  }

  async function pollParkings() {
    if (!state.park || document.hidden) return;
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
    if (state.park) { parkLayer.addTo(map); pollParkings(); if (!zonePrefs.sppnHidden) setSppn(true, true); }
    else { map.removeLayer(parkLayer); if (state.selectedPark) deselectPark(); if (zones.sppnAuto) setSppn(false); state.parkError = null; renderStatus(); }
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
      if (!matches(i, INC_TEXT) && state.selectedInc !== i.id) continue;
      const group = L.layerGroup();
      const sel = state.selectedInc === i.id;
      for (const sh of i.shapes) {
        if (sh.type === 'line') {
          L.polyline(sh.points, { renderer: canvas, color: sel ? '#FC4C02' : incColor(i), weight: sel ? 8 : 6, opacity: i.status === 'ended' ? 0.5 : 0.85 })
            .on('click', (e) => { L.DomEvent.stopPropagation(e); selectInc(i.id); }).addTo(group);
        }
        const at = sh.type === 'line' ? sh.points[Math.floor(sh.points.length / 2)] : sh.points[0];
        L.marker(at, { icon: incIcon(i), zIndexOffset: 800, keyboard: false, title: i.name })
          .on('click', (e) => { L.DomEvent.stopPropagation(e); selectInc(i.id); }).addTo(group);
      }
      group.addTo(incLayer); state.incLayers.set(i.id, group);
    }
    // One canvas serves vehicles and lines (a second canvas would sit on top and swallow vehicle clicks);
    // keep vehicles above the lines so they stay clickable.
    for (const m of state.markers.values()) if (map.hasLayer(m.mk)) m.mk.bringToFront();
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
    closeZone(); closeStation();
    if (state.selectedSport) deselectSport();
    if (state.selectedEvent) deselectEvent();
    state.selectedInc = id; fillIncPanel(i); $('ipanel').hidden = false; renderIncidents();
  }
  function deselectInc() {
    state.selectedInc = null; $('ipanel').hidden = true; renderIncidents();
  }
  async function pollIncidents() {
    if (!state.inc || document.hidden) return;
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

  // ---- Zones: paid parking (SPPN, the city's WMS layer) and the Clean Transport Zone (SCT, boundary from OpenStreetMap) ----
  // SPPN comes and goes with the parkings unless the user has hidden it (switched on without the parkings, it stays until switched off);
  // both switches are remembered in this browser only.
  // The city's WMS (Oracle MapViewer) serves no EPSG:3857. In CRS:84 it kept the shape of the degree box and padded the tile,
  // so the zone came out shifted and cut by straight lines; tiles are asked for in its own grid EPSG:2178 (public/pl2000.js),
  // where a map tile is a square in metres. Leaflet sends [min.x, min.y, max.x, max.y], i.e. northing, easting as WMS 1.3.0 wants.
  const SPPN_WMS = { url: 'https://wms.um.warszawa.pl/serwis', layers: 'KOMUNIKACJA_STREFA_PLATNEGO_PARKOWANIA',
    crs: { code: 'EPSG:2178', project: (ll) => L.point(toPL2000z7(ll.lat, ll.lng)) } };
  const SCT_URL = '/data/strefa-czystego-transportu.geojson', SCT_COLOR = '#00A878';
  const ZONE_INFO = {
    sppn: { badge: 'SPPN', name: 'Strefa Płatnego Parkowania Niestrzeżonego', sub: 'Zarząd Dróg Miejskich · stan na październik 2026',
      rows: [['Kiedy płatne', 'pon.–pt. 8:00–20:00\nweekendy i święta bezpłatnie'],
        ['Opłaty', '1. godzina 4,50 zł\n2. godzina 5,40 zł\n3. godzina 6,40 zł\n4. i kolejne 4,50 zł'],
        ['Jak zapłacić', 'parkomat albo aplikacja mobilna'],
        ['Brak opłaty', 'opłata dodatkowa 300 zł (niższa przy szybkiej wpłacie)'],
        ['Mieszkańcy', 'abonament mieszkańca – zasady na stronie ZDM']],
      note: 'Granice strefy z mapy m.st. Warszawy. Na miejscu obowiązują znaki D-44 (strefa parkowania) i D-45 (koniec strefy).',
      link: ['https://zdm.waw.pl/sprawy/parkowanie/oplata-za-postoj/', 'Opłaty i zasady na zdm.waw.pl'] },
    sct: { badge: 'SCT', name: 'Strefa Czystego Transportu', sub: 'ok. 37 km² w centrum · stan na październik 2026',
      rows: [['Kiedy', 'całą dobę, codziennie'],
        ['Wjazd od 2026', 'benzyna, LPG, hybrydy: co najmniej Euro 3\ndiesel: co najmniej Euro 5\n(albo odpowiednio nowy rocznik)'],
        ['Bez ograniczeń', 'samochody elektryczne, wodorowe i na CNG'],
        ['Zwolnienia', 'm.in. do końca 2027 r. mieszkańcy płacący podatki w Warszawie, seniorzy 70+, osoby z niepełnosprawnościami, pojazdy zabytkowe'],
        ['Kara', 'mandat do 500 zł']],
      note: 'Ulice graniczne leżą poza strefą. Granica z OpenStreetMap (© współtwórcy OSM, ODbL).',
      link: ['https://transport.um.warszawa.pl/sct', 'Wymagania i zwolnienia na transport.um.warszawa.pl'] },
  };
  const zones = { sppn: false, sppnAuto: false, sct: false, sctData: null, sctLoading: false, sctError: null, open: null };
  let zonePrefs = { sppnHidden: false, sct: false };
  try { zonePrefs = { ...zonePrefs, ...JSON.parse(localStorage.getItem('waweye.strefy') || '{}') }; } catch {}
  const saveZonePrefs = () => { try { localStorage.setItem('waweye.strefy', JSON.stringify(zonePrefs)); } catch {} };

  map.createPane('zones').style.zIndex = 250; // above the base map, below vehicles and markers
  // The WMS fills the zone solid pink with a faint edge. The SVG filter #sppn-edge (index.html) on every tile thins the
  // fill (55%) and draws the fill's own edge as a dashed line in the zone colour, so the line always matches the city's
  // layer. It reads no pixels, so the tiles need no CORS; edgeMode="duplicate" keeps tile seams from looking like edges.
  const sppnLayer = L.tileLayer.wms(SPPN_WMS.url, { layers: SPPN_WMS.layers, crs: SPPN_WMS.crs, format: 'image/png', transparent: true, version: '1.3.0',
    pane: 'zones', className: 'sppn-wms', maxZoom: 19, attribution: 'SPPN: m.st. Warszawa' });
  const sctLayer = L.layerGroup();

  function renderZoneControls() {
    $('z-sppn').checked = zones.sppn; $('z-sct').checked = zones.sct;
    $('zones-btn').classList.toggle('on', zones.sppn || zones.sct);
  }
  function setSppn(on, auto = false) {
    zones.sppn = on; zones.sppnAuto = on && auto;
    if (on) sppnLayer.addTo(map); else map.removeLayer(sppnLayer);
    renderZoneControls();
  }
  async function loadSct() {
    if (zones.sctData || zones.sctLoading) return;
    zones.sctLoading = true;
    try {
      const res = await fetch(SCT_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      zones.sctData = await res.json(); zones.sctError = null;
    } catch (e) {
      zones.sctError = 'brak danych (' + e.message + ')';
    }
    zones.sctLoading = false;
    drawSct(); renderStatus();
  }
  function drawSct() {
    sctLayer.clearLayers();
    if (!zones.sct || !zones.sctData) return;
    // Same canvas as the vehicles (a second canvas would swallow their clicks); not interactive and at the back.
    L.geoJSON(zones.sctData, { renderer: canvas, interactive: false, attribution: 'SCT: © współtwórcy OpenStreetMap',
      style: { color: SCT_COLOR, weight: 3, dashArray: '10 6', fillColor: SCT_COLOR, fillOpacity: 0.08 } })
      .eachLayer((l) => { l.addTo(sctLayer); l.bringToBack(); });
  }
  function setSct(on) {
    zones.sct = on;
    if (on) { sctLayer.addTo(map); loadSct(); drawSct(); }
    else { map.removeLayer(sctLayer); zones.sctError = null; renderStatus(); }
    renderZoneControls();
  }

  function openZone(kind) {
    const z = ZONE_INFO[kind];
    if (state.selected) deselect();
    if (state.selectedPark) deselectPark();
    if (state.selectedInc !== null) deselectInc();
    if (state.selectedSport) deselectSport();
    if (state.selectedEvent) deselectEvent();
    closeStation(); zones.open = kind;
    $('zp-badge').className = 'z-badge ' + kind; $('zp-badge').textContent = z.badge;
    $('zp-name').textContent = z.name; $('zp-sub').textContent = z.sub;
    const dl = $('zp-rows'); dl.textContent = '';
    for (const [k, v] of z.rows) row(dl, k, v);
    $('zp-note').textContent = z.note;
    $('zp-link').href = z.link[0]; $('zp-link').textContent = z.link[1];
    $('zpanel').hidden = false; showZoneMenu(false);
  }
  function closeZone() {
    if (!zones.open) return;
    zones.open = null; $('zpanel').hidden = true;
  }
  function showZoneMenu(show) {
    $('zmenu').hidden = !show; $('zones-btn').setAttribute('aria-expanded', show);
  }

  const ZoneControl = L.Control.extend({ options: { position: 'topright' },
    onAdd() { const el = $('zones'); L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); return el; } });
  new ZoneControl().addTo(map);
  $('zones-btn').onclick = () => showZoneMenu($('zmenu').hidden);
  $('z-sppn').onchange = (e) => { setSppn(e.target.checked, state.park); zonePrefs.sppnHidden = !e.target.checked; saveZonePrefs(); };
  $('z-sct').onchange = (e) => { setSct(e.target.checked); zonePrefs.sct = e.target.checked; saveZonePrefs(); };
  for (const b of document.querySelectorAll('.z-info')) b.onclick = () => openZone(b.dataset.zone);
  $('zclose').onclick = closeZone;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('zmenu').hidden) { showZoneMenu(false); $('zones-btn').focus(); } });
  if (zonePrefs.sct) setSct(true);

  // ---- Metro (M1, M2): lines and stations from OpenStreetMap (scripts/metro.js); the vehicle API has no metro ----
  // The layer comes and goes with the trams unless the user has hidden it with its own chip (switched on without the trams,
  // it stays until switched off); the choice is remembered in this browser only. Drawn on the vehicles' canvas, under them:
  // lines are not interactive, stations are (a click opens the station panel), and a vehicle on top of a station wins the click.
  const METRO_URL = '/data/metro.geojson';
  const metro = { on: false, auto: false, data: null, loading: false, error: null, selected: null, stations: [] };
  let metroPrefs = { hidden: false };
  try { metroPrefs = { ...metroPrefs, ...JSON.parse(localStorage.getItem('waweye.metro') || '{}') }; } catch {}
  const saveMetroPrefs = () => { try { localStorage.setItem('waweye.metro', JSON.stringify(metroPrefs)); } catch {} };
  const metroLayer = L.layerGroup();
  const metroColour = (refs) => (refs.length === 1 && metro.lineColours[refs[0]]) || '#242428';
  metro.lineColours = {};
  const stationRadius = () => Math.max(3, Math.min(8, map.getZoom() - 7));
  function stationStyle(st) {
    const sel = metro.selected === st.name;
    return { radius: sel ? stationRadius() + 3 : stationRadius(), color: sel ? COLORS.sel : metroColour(st.lines), weight: sel ? 4 : 2.5, fillColor: '#fff', fillOpacity: 1 };
  }
  async function loadMetro() {
    if (metro.data || metro.loading) return;
    metro.loading = true;
    try {
      const res = await fetch(METRO_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      metro.data = await res.json(); metro.error = null;
    } catch (e) {
      metro.error = 'brak danych (' + e.message + ')';
    }
    metro.loading = false;
    drawMetro(); renderStatus();
  }
  function drawMetro() {
    metroLayer.clearLayers(); metro.stations = [];
    if (!metro.on || !metro.data) return;
    const attribution = 'Metro: © współtwórcy OpenStreetMap';
    const stations = [];
    for (const f of metro.data.features) {
      const p = f.properties;
      if (p.kind === 'line') {
        metro.lineColours[p.ref] = p.colour;
        L.polyline(f.geometry.coordinates.map((c) => c.map(([lon, lat]) => [lat, lon])), { renderer: canvas, interactive: false, attribution,
          color: p.colour, weight: 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(metroLayer).bringToBack();
      } else if (p.kind === 'station' && p.name) stations.push({ name: p.name, lines: p.lines, ll: [f.geometry.coordinates[1], f.geometry.coordinates[0]] });
    }
    for (const st of stations) {
      st.mk = L.circleMarker(st.ll, { ...stationStyle(st), renderer: canvas, attribution });
      st.mk.on('click', (e) => { L.DomEvent.stopPropagation(e); openStation(st.name); });
      st.mk.addTo(metroLayer);
      metro.stations.push(st);
    }
    for (const m of state.markers.values()) if (map.hasLayer(m.mk)) m.mk.bringToFront(); // vehicles stay on top
  }
  function restyleStations() { for (const st of metro.stations) st.mk.setStyle(stationStyle(st)); }
  function setMetro(on, auto = false) {
    metro.on = on; metro.auto = on && auto;
    if (on) { metroLayer.addTo(map); loadMetro(); drawMetro(); }
    else { map.removeLayer(metroLayer); closeStation(); metro.error = null; renderStatus(); }
    $('t-metro').classList.toggle('on', on); $('t-metro').setAttribute('aria-pressed', on);
  }
  function openStation(name) {
    const st = metro.stations.find((s) => s.name === name);
    if (!st) return;
    if (state.selected) deselect();
    if (state.selectedPark) deselectPark();
    if (state.selectedInc !== null) deselectInc();
    if (state.selectedSport) deselectSport();
    if (state.selectedEvent) deselectEvent();
    closeZone();
    metro.selected = name; restyleStations(); st.mk.bringToFront();
    const badges = $('mp-badges'); badges.textContent = '';
    for (const ref of st.lines) { const b = document.createElement('span'); b.className = 'm-badge'; b.style.background = metroColour([ref]); b.textContent = ref; badges.append(b); }
    $('mp-name').textContent = st.name;
    $('mp-sub').textContent = st.lines.length > 1 ? 'Stacja metra · przesiadka ' + st.lines.join(' / ') : 'Stacja metra';
    const dl = $('mp-rows'); dl.textContent = '';
    for (const f of metro.data.features) {
      const p = f.properties;
      if (p.kind === 'line' && st.lines.includes(p.ref)) row(dl, p.ref, `${p.from} – ${p.to}`);
    }
    $('mpanel').hidden = false;
  }
  function closeStation() {
    if (metro.selected == null) return;
    metro.selected = null; $('mpanel').hidden = true; restyleStations();
  }
  $('t-metro').onclick = () => { const on = !metro.on; setMetro(on, state.types.tram); metroPrefs.hidden = !on; saveMetroPrefs(); };
  $('mclose').onclick = closeStation;
  map.on('zoomend', restyleStations);
  if (!metroPrefs.hidden && state.types.tram) setMetro(true, true);

  // ---- Sport classes (dataset "Zajęcia sportowe"); one marker per place, counting the classes in the chosen days ----
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const SPORT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="14.5" cy="4" r="2.2" fill="currentColor"/><path d="M7 21l3.5-5 2.5 2V22M10.5 16l1.5-6-3 1.5L7.5 14M12 10l3 2.5 3 .5M12 10l2.5-.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const RANGE_TXT = { today: 'dziś', tomorrow: 'jutro', week: 'w 7 dni' };
  const warsawToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
  const weekday = (ymd) => WEEKDAYS[new Date(ymd + 'T12:00:00Z').getUTCDay()];
  const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
  function rangeDays() {
    const t = warsawToday();
    return state.range === 'today' ? [t] : state.range === 'tomorrow' ? [addDays(t, 1)] : [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(t, n));
  }
  // Dated classes happen on their dates; the others every week on their weekdays.
  const occurrences = (it, days) => days.filter((d) => (it.dates.length ? it.dates.includes(d) : it.days.includes(weekday(d))));
  function dayLabel(d) {
    const t = warsawToday();
    const name = new Date(d + 'T12:00:00Z').toLocaleDateString('pl-PL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
    return d === t ? 'Dziś' : d === addDays(t, 1) ? 'Jutro' : name;
  }
  function sportPlaces() {
    const days = rangeDays(), places = new Map();
    for (const it of state.sportItems) {
      if (!matches(it, SPORT_TEXT)) continue;
      const occ = occurrences(it, days); if (!occ.length) continue;
      const key = `sp-${it.lat.toFixed(4)},${it.lon.toFixed(4)}`;
      let p = places.get(key);
      if (!p) places.set(key, (p = { id: key, lat: it.lat, lon: it.lon, entries: [] }));
      p.entries.push({ it, occ });
    }
    for (const p of places.values()) p.entries.sort((a, b) => (a.occ[0] + a.it.time).localeCompare(b.occ[0] + b.it.time));
    return places;
  }
  const spIcon = (p) => L.divIcon({ className: '', iconSize: null, iconAnchor: [16, 12],
    html: `<div class="sp ${state.selectedSport === p.id ? 'sel' : ''}">${SPORT_ICON}${p.entries.length > 1 ? p.entries.length : ''}</div>` });

  function renderSport() {
    const places = sportPlaces();
    for (const [id, m] of state.sportMarkers) if (!places.has(id)) { sportLayer.removeLayer(m); state.sportMarkers.delete(id); }
    for (const p of places.values()) {
      let m = state.sportMarkers.get(p.id);
      const title = p.entries.map((e) => e.it.title).join(', ');
      if (!m) {
        m = L.marker([p.lat, p.lon], { icon: spIcon(p), zIndexOffset: 750, keyboard: false, title });
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); selectSport(p.id); });
        m.addTo(sportLayer); state.sportMarkers.set(p.id, m);
      } else m.setIcon(spIcon(p));
      m.place = p;
    }
    if (state.selectedSport) { const p = places.get(state.selectedSport); if (p) fillSportPanel(p); else deselectSport(); }
  }

  function fillSportPanel(p) {
    const first = p.entries[0].it;
    const name = first.place || first.address || first.district || 'Zajęcia sportowe';
    $('sp-name').textContent = name;
    const n = p.entries.length;
    const count = n === 1 ? `zajęcia ${RANGE_TXT[state.range]}` : `${n} ${plural(n, '', 'zajęcia', 'zajęć')} ${RANGE_TXT[state.range]}`;
    $('sp-addr').textContent = [first.address !== name && first.address, first.district !== name && first.district, count].filter(Boolean).join(' · ');
    const ul = $('sp-list'); ul.textContent = '';
    const span = (cls, txt) => { const e = document.createElement('span'); e.className = cls; e.textContent = txt; return e; };
    for (const { it, occ } of p.entries) {
      const li = document.createElement('li');
      const more = occ.length > 1 ? ` (+${occ.length - 1} ${plural(occ.length - 1, 'termin', 'terminy', 'terminów')})` : '';
      li.append(span('s-when', `${dayLabel(occ[0])}${it.time ? ', ' + it.time : ''}${it.dates.length ? '' : ' · co tydzień'}${more}`), span('s-title', it.title));
      const tags = [...it.categories, ...it.audience];
      if (tags.length) { const t = span('s-tags', ''); for (const x of tags) t.appendChild(span('', x)); li.appendChild(t); }
      if (it.text) li.appendChild(span('s-desc', it.text.length > 160 ? it.text.slice(0, 157).replace(/\s+\S*$/, '') + '…' : it.text));
      if (it.place && it.place !== name) li.appendChild(span('s-desc', 'Miejsce: ' + it.place));
      const contact = [it.phone, it.email].filter(Boolean).join(' · ');
      if (contact) li.appendChild(span('s-desc', contact));
      if (it.url) {
        const a = document.createElement('a'); a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = 'Szczegóły i zapisy na sport.um.warszawa.pl ↗'; li.appendChild(a);
      }
      ul.appendChild(li);
    }
  }
  function selectSport(id) {
    const m = state.sportMarkers.get(id); if (!m) return;
    if (state.selected) deselect();
    if (state.selectedPark) deselectPark();
    if (state.selectedInc !== null) deselectInc();
    closeZone(); closeStation();
    if (state.selectedEvent) deselectEvent();
    state.selectedSport = id; fillSportPanel(m.place); $('spanel').hidden = false; $('spanel').scrollTop = 0; renderSport();
  }
  function deselectSport() {
    state.selectedSport = null; $('spanel').hidden = true; renderSport();
  }

  let sportRetry = 0;
  async function pollSport() {
    if (!state.sport || document.hidden) return;
    clearTimeout(sportRetry);
    try {
      const res = await fetch('/api/sport', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.sportError = null; state.sportItems = body.items; state.sportMeta = { pending: body.pending, unlocated: body.unlocated };
      renderSport();
      if (body.pending) sportRetry = setTimeout(pollSport, 20000); // the server is still looking up addresses; more arrive with each reply
    } catch (e) {
      state.sportError = 'brak danych (' + e.message + ')';
      sportRetry = setTimeout(pollSport, 60000); // a passing upstream error (e.g. 522) should not leave the layer empty for 30 min
    }
    renderStatus();
  }
  function toggleSport(btn) {
    state.sport = !state.sport;
    btn.classList.toggle('on', state.sport); btn.setAttribute('aria-pressed', state.sport);
    showWhen();
    if (state.sport) { sportLayer.addTo(map); pollSport(); }
    else { map.removeLayer(sportLayer); if (state.selectedSport) deselectSport(); state.sportError = null; clearTimeout(sportRetry); renderStatus(); }
  }
  $('t-sport').onclick = (e) => toggleSport(e.currentTarget);
  for (const b of document.querySelectorAll('#sfilter button')) {
    b.onclick = () => {
      state.range = b.dataset.range;
      for (const x of document.querySelectorAll('#sfilter button')) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }
      renderSport(); renderEvents(); renderStatus();
    };
  }
  $('sclose').onclick = deselectSport;
  // One "Kiedy" row (Dziś / Jutro / 7 dni) serves both Sport and DziejeSię.
  function showWhen() {
    const on = state.sport || state.events;
    $('sfilter').hidden = !on; document.body.classList.toggle('when-on', on);
  }
  setInterval(pollSport, 30 * 60000); // the dataset is updated every 2 h


  // ---- City events ("DziejeSię", dataset "Kalendarz wydarzeń"); an event held in several places has a marker in each ----
  const TICKET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 7.5A1.5 1.5 0 0 1 4 6h16a1.5 1.5 0 0 1 1.5 1.5V10a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 20 18H4a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4z" fill="currentColor"/><path d="M15 7.5v9" stroke="var(--picon-bg)" stroke-width="1.8" stroke-dasharray="1.8 1.6"/></svg>';
  const shortDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  // Occurrences that touch the chosen days (by date only; times are shown, not filtered on).
  const eventOcc = (it, days) => it.occurrences.filter((o) => o.from <= days[days.length - 1] && o.to >= days[0]);
  function occLabel(o) {
    const t = warsawToday();
    if (o.from !== o.to) return o.from <= t ? `do ${shortDate(o.to)}` : `${shortDate(o.from)} – ${shortDate(o.to)}`;
    const day = dayLabel(o.from);
    return `${day}${o.start ? ', ' + o.start + (o.end ? '–' + o.end : '') : ''}`;
  }
  function eventPlaces() {
    const days = rangeDays(), places = new Map();
    for (const it of state.eventItems) {
      if (!matches(it, EVENT_TEXT)) continue;
      const occ = eventOcc(it, days); if (!occ.length) continue;
      for (const pt of it.points) {
        const key = `ev-${pt.lat.toFixed(4)},${pt.lon.toFixed(4)}`;
        let p = places.get(key);
        if (!p) places.set(key, (p = { id: key, lat: pt.lat, lon: pt.lon, entries: [] }));
        if (!p.entries.some((e) => e.it === it)) p.entries.push({ it, occ, pt });
      }
    }
    for (const p of places.values()) p.entries.sort((a, b) => (a.occ[0].from + a.occ[0].start).localeCompare(b.occ[0].from + b.occ[0].start));
    return places;
  }
  const evIcon = (p) => L.divIcon({ className: '', iconSize: null, iconAnchor: [16, 12],
    html: `<div class="ev ${state.selectedEvent === p.id ? 'sel' : ''}">${TICKET_ICON}${p.entries.length > 1 ? p.entries.length : ''}</div>` });

  function renderEvents() {
    const places = eventPlaces();
    for (const [id, m] of state.eventMarkers) if (!places.has(id)) { eventLayer.removeLayer(m); state.eventMarkers.delete(id); }
    for (const p of places.values()) {
      let m = state.eventMarkers.get(p.id);
      if (!m) {
        m = L.marker([p.lat, p.lon], { icon: evIcon(p), zIndexOffset: 760, keyboard: false, title: p.entries.map((e) => e.it.title).join(', ') });
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); selectEvent(p.id); });
        m.addTo(eventLayer); state.eventMarkers.set(p.id, m);
      } else m.setIcon(evIcon(p));
      m.place = p;
    }
    if (state.selectedEvent) { const p = places.get(state.selectedEvent); if (p) fillEventPanel(p); else deselectEvent(); }
  }

  function fillEventPanel(p) {
    const { it: first, pt } = p.entries[0];
    const name = pt.label || first.venue || pt.street || first.district || 'Wydarzenie';
    const district = pt.district || first.district;
    $('ep-name').textContent = name;
    const n = p.entries.length;
    $('ep-addr').textContent = [pt.street !== name && pt.street, district !== name && district,
      `${n === 1 ? 'wydarzenie' : `${n} ${plural(n, '', 'wydarzenia', 'wydarzeń')}`} ${RANGE_TXT[state.range]}`].filter(Boolean).join(' · ');
    const ul = $('ep-list'); ul.textContent = '';
    const span = (cls, txt) => { const e = document.createElement('span'); e.className = cls; e.textContent = txt; return e; };
    for (const { it, occ } of p.entries) {
      const li = document.createElement('li');
      const more = occ.length > 1 ? ` (+${occ.length - 1} ${plural(occ.length - 1, 'termin', 'terminy', 'terminów')})` : '';
      li.append(span('s-when', occLabel(occ[0]) + more), span('s-title', it.title));
      if (it.categories.length) { const t = span('s-tags', ''); for (const x of it.categories) t.appendChild(span('', x)); li.appendChild(t); }
      if (it.text) li.appendChild(span('s-desc', it.text.length > 160 ? it.text.slice(0, 157).replace(/\s+\S*$/, '') + '…' : it.text));
      if (it.organizer) li.appendChild(span('s-desc', 'Organizator: ' + it.organizer));
      const here = (x) => x.lat.toFixed(4) === p.lat.toFixed(4) && x.lon.toFixed(4) === p.lon.toFixed(4);
      const others = [...new Set(it.points.filter((x) => !here(x)).map((x) => x.label || x.street).filter(Boolean))];
      if (others.length) li.appendChild(span('s-desc', 'Także w: ' + others.join(', ')));
      if (it.url) {
        const a = document.createElement('a'); a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = 'Więcej na ' + new URL(it.url).hostname.replace(/^www\./, '') + ' ↗'; li.appendChild(a);
      }
      ul.appendChild(li);
    }
  }
  function selectEvent(id) {
    const m = state.eventMarkers.get(id); if (!m) return;
    if (state.selected) deselect();
    if (state.selectedPark) deselectPark();
    if (state.selectedInc !== null) deselectInc();
    if (state.selectedSport) deselectSport();
    closeZone(); closeStation();
    state.selectedEvent = id; fillEventPanel(m.place); $('epanel').hidden = false; $('epanel').scrollTop = 0; renderEvents();
  }
  function deselectEvent() {
    state.selectedEvent = null; $('epanel').hidden = true; renderEvents();
  }

  let eventRetry = 0;
  async function pollEvents() {
    if (!state.events || document.hidden) return;
    clearTimeout(eventRetry);
    try {
      const res = await fetch('/api/wydarzenia', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      state.eventError = null; state.eventItems = body.items; state.eventMeta = { pending: body.pending, unlocated: body.unlocated };
      renderEvents();
      if (body.pending) eventRetry = setTimeout(pollEvents, 20000); // the server is still looking up addresses
    } catch (e) {
      state.eventError = 'brak danych (' + e.message + ')';
      eventRetry = setTimeout(pollEvents, 60000); // a passing upstream error should not leave the layer empty for 30 min
    }
    renderStatus();
  }
  function toggleEvents(btn) {
    state.events = !state.events;
    btn.classList.toggle('on', state.events); btn.setAttribute('aria-pressed', state.events);
    showWhen();
    if (state.events) { eventLayer.addTo(map); pollEvents(); }
    else { map.removeLayer(eventLayer); if (state.selectedEvent) deselectEvent(); state.eventError = null; clearTimeout(eventRetry); renderStatus(); }
  }
  $('t-events').onclick = (e) => toggleEvents(e.currentTarget);
  $('eclose').onclick = deselectEvent;
  setInterval(pollEvents, 30 * 60000); // the dataset is updated every 2 h

  // ---- My location, after Google Maps: the button finds the user and zooms in; the map stays on them until they drag it ----
  const ME_ZOOM = 16, ME_BLUE = '#1A73E8', WARSAW = L.latLngBounds([51.9, 20.5], [52.6, 21.6]); // same box as lib/warsaw.js
  const ORIENT_EVT = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  const LOC_ERR = { 1: 'Brak dostępu do lokalizacji. Zezwól na nią w ustawieniach przeglądarki.',
    2: 'Nie udało się ustalić Twojej lokalizacji.', 3: 'Ustalanie lokalizacji trwa zbyt długo. Spróbuj ponownie.' };
  const me = { active: false, watch: null, pos: null, acc: 0, busy: false, centered: false, flying: false, lost: false, denied: false,
    compass: null, gps: null, rot: 0, raf: 0, marker: null, circle: null };

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function renderLocate() {
    $('locate').className = 'locate' + (me.busy ? ' busy' : me.centered ? ' on' : me.pos ? ' found' : me.denied ? ' off' : '');
    if (!me.marker) return;
    const box = me.marker.getElement().firstChild, h = me.compass != null ? me.compass : me.gps;
    box.classList.toggle('lost', me.lost); box.classList.toggle('heading', h != null);
    if (h == null) return;
    me.rot += (((h - me.rot) % 360) + 540) % 360 - 180; // shortest turn: 359° -> 1° must not spin the beam all the way round
    box.firstChild.style.transform = `rotate(${me.rot}deg)`;
  }

  // While centred, zooming keeps the user in the middle (as in Google Maps) instead of zooming around the cursor or fingers.
  function setCentered(on) {
    me.centered = on;
    for (const k of ['scrollWheelZoom', 'touchZoom', 'doubleClickZoom']) map.options[k] = on ? 'center' : true;
    renderLocate();
  }

  function centerOnMe() {
    const zoom = Math.min(Math.max(map.getZoom(), ME_ZOOM), map.getBoundsZoom(me.pos.toBounds(Math.max(me.acc, 10) * 2)));
    setCentered(true); me.flying = true;
    map.once('moveend', () => { me.flying = false; });
    map.flyTo(me.pos, zoom, { duration: 0.8 });
    if (!WARSAW.contains(me.pos)) toast('Jesteś poza Warszawą – wawEye pokazuje pojazdy tylko w Warszawie.');
  }

  function onPosition(p) {
    const ll = L.latLng(p.coords.latitude, p.coords.longitude);
    me.pos = ll; me.acc = p.coords.accuracy || 0; me.lost = false; me.denied = false;
    me.gps = p.coords.speed > 1 && Number.isFinite(p.coords.heading) ? p.coords.heading : null; // GPS heading only means something while moving
    if (!me.marker) {
      // Same canvas as the vehicles (a second canvas would swallow their clicks); non-interactive and at the back.
      me.circle = L.circle(ll, { radius: me.acc, renderer: canvas, interactive: false, color: ME_BLUE, weight: 1, opacity: 0.4, fillColor: ME_BLUE, fillOpacity: 0.12 }).addTo(map);
      me.circle.bringToBack();
      me.marker = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 900, icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
        html: '<div class="me"><div class="me-beam"></div><div class="me-pulse"></div><div class="me-dot"></div></div>' }) }).addTo(map);
    } else { me.marker.setLatLng(ll); me.circle.setLatLng(ll).setRadius(me.acc); }
    if (me.busy) { me.busy = false; centerOnMe(); } else if (me.centered && !me.flying) map.panTo(ll);
    renderLocate();
  }

  function onPositionError(e) {
    const asked = me.busy; me.busy = false;
    if (e.code === 1) { // permission denied (or revoked): forget the position
      stopWatch(); me.active = false; me.denied = true; me.pos = null; setCentered(false);
      if (me.marker) { me.marker.remove(); me.circle.remove(); me.marker = me.circle = null; }
    } else if (me.pos && e.code === 2) me.lost = true; // keep the last position, greyed out, while the watch keeps trying
    // (a timeout alone is not "lost": some browsers report it while a phone stands still and the position does not change)
    if (asked || e.code === 1) toast(LOC_ERR[e.code] || LOC_ERR[2]);
    renderLocate();
  }

  function onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading; // iOS: clockwise from north
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha + ((screen.orientation && screen.orientation.angle) || 0); // alpha is counter-clockwise, device frame
    if (h == null) return;
    me.compass = ((h % 360) + 360) % 360;
    if (!me.raf) me.raf = requestAnimationFrame(() => { me.raf = 0; renderLocate(); });
  }

  function startWatch() {
    if (me.watch != null || document.hidden) return;
    me.watch = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    window.addEventListener(ORIENT_EVT, onOrientation);
  }
  function stopWatch() {
    if (me.watch == null) return;
    navigator.geolocation.clearWatch(me.watch); me.watch = null;
    window.removeEventListener(ORIENT_EVT, onOrientation);
  }

  function locate() {
    if (!navigator.geolocation) { toast('Ta przeglądarka nie udostępnia lokalizacji.'); return; }
    if (state.follow) { state.follow = false; $('follow').classList.remove('on'); } // one thing at a time drives the map
    me.active = true;
    if (me.pos) centerOnMe(); else { me.busy = true; renderLocate(); }
    startWatch();
  }
  $('locate').onclick = locate;
  map.on('dragstart', () => { if (me.centered) setCentered(false); });
  // Permission given earlier: show the dot straight away (without moving the map), like Google Maps does.
  if (navigator.geolocation && navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') { me.active = true; startWatch(); } }).catch(() => {});
  }

  // Like Google's button riding on top of the bottom sheet: lift it above an open panel that covers it (phones).
  function liftLocate() {
    const b = $('locate'), br = b.getBoundingClientRect();
    const tops = [...PANELS, 'lapse'].map($).filter((p) => !p.hidden).map((p) => p.getBoundingClientRect())
      .filter((r) => r.right > br.left && r.left < br.right).map((r) => r.top);
    b.style.bottom = tops.length ? `${document.documentElement.clientHeight - Math.min(...tops) + 10}px` : '';
  }
  if (window.ResizeObserver) { const ro = new ResizeObserver(liftLocate); for (const id of [...PANELS, 'lapse']) ro.observe($(id)); }
  window.addEventListener('resize', liftLocate);

  function toggleType(key, btn) {
    state.types[key] = !state.types[key];
    btn.classList.toggle('on', state.types[key]); btn.setAttribute('aria-pressed', state.types[key]);
    if (key === 'tram') { if (state.types.tram && !metroPrefs.hidden) setMetro(true, true); else if (!state.types.tram && metro.auto) setMetro(false); }
    lapse.dirty = true; refresh(); poll();
  }
  $('t-bus').onclick = (e) => toggleType('bus', e.currentTarget);
  $('t-tram').onclick = (e) => toggleType('tram', e.currentTarget);
  $('search').oninput = (e) => {
    lapse.dirty = true;
    state.query = e.target.value.trim().toLowerCase(); state.words = state.query ? fold(state.query).split(/\s+/) : [];
    renderParkings(); if (state.inc) renderIncidents(); renderSport(); renderEvents();
    refresh(); // last: it also redraws the status line with the new counts
  };
  $('close').onclick = deselect;
  for (const id of PANELS) {
    const p = $(id);
    p.querySelector('.p-collapse').onclick = () => setPanelMin(!p.classList.contains('min'), true);
    p.querySelector(id === 'panel' ? '.meta' : '.p-head').addEventListener('click', () => { if (p.classList.contains('min')) setPanelMin(false, true); });
  }
  $('follow').onclick = (e) => {
    state.follow = !state.follow; e.currentTarget.classList.toggle('on', state.follow);
    if (state.follow && me.centered) setCentered(false); // following a vehicle takes the map off the user
    if (state.follow && matchMedia('(max-width: 699px)').matches) setPanelMin(true, false, ['panel']); // on a phone the map matters while following
    const s = state.markers.get(state.selected); if (state.follow && s) map.setView(s.mk.getLatLng(), Math.max(map.getZoom(), 15));
  };
  map.on('click', () => { if (state.selected) deselect(); if (state.selectedPark) deselectPark(); if (state.selectedInc !== null) deselectInc(); if (state.selectedSport) deselectSport(); if (state.selectedEvent) deselectEvent(); closeZone(); closeStation(); showZoneMenu(false); });
  map.on('zoomend moveend', refresh);

  // ---- Timelapse ----
  // The city publishes no trips of the vehicles, so the timelapse is a prediction (public/prognoza.js): from the latest
  // data each vehicle keeps going along its line's route, in the direction it was moving, at an average speed. With the
  // timetable's departures per hour (/api/trasa?dzien=, from the ZTM GTFS) a line runs as many trips as planned: vehicles
  // at a terminus take the next departure or go off to the depot, new ones start when more trips are planned (night
  // lines at night); without it they turn back at the terminus forever. Time runs 0–1000× faster (the Tempo slider is
  // logarithmic); the Czas slider moves through the next LAPSE_H; ↻ starts again from fresh data. Vehicles off their
  // route or of a line without one stay put, faded. Closing the card (× or the chip) brings the map back to real time,
  // and so does clicking a vehicle seen live, which then gets selected with its route. A panel covering the card does not.
  const LAPSE_H = 24 * 3600000;
  const lapseLayer = L.layerGroup();
  const sliderToSpeed = (x) => (x <= 0 ? 0 : Math.pow(10, (3 * (x - 1)) / 99)); // 0 → stopped, 1…100 → ×1…×1000
  const speedTxt = (m) => (m === 0 ? '×0 · pauza' : '×' + (m < 10 ? m.toFixed(1).replace('.', ',') : Math.round(m)));
  const clock = (t) => new Date(t).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', second: '2-digit' }); // hh:mm:ss
  const ahead = (ms) => (ms < 60000 ? `+${Math.round(ms / 1000)} s` : ms < 3600000 ? `+${Math.floor(ms / 60000)} min`
    : `+${Math.floor(ms / 3600000)} h ${String(Math.floor(ms / 60000) % 60).padStart(2, '0')} min`);
  try { const s = localStorage.getItem('waweye.lapseSlider'); if (s != null && +s >= 0 && +s <= 100) lapse.slider = Math.round(+s); } catch {}

  // The hours of the horizon in Warsaw time (whole hours there are whole hours in UTC) with the timetable for them:
  // { hours: [{ at: seconds from t0, date, h, prev }], days: { date: { line: [[dir 0], [dir 1]] } } }, or null when the
  // timetable is not available (no route store, or the days are not in it): the prediction then runs without it.
  const WAW_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const dayBefore = (d) => new Date(Date.parse(d + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  async function loadSchedule(t0) {
    const hours = [];
    for (let k = 0, h0 = Math.floor(t0 / 3600e3) * 3600e3; k <= LAPSE_H / 3600e3 + 1; k++) {
      const p = Object.fromEntries(WAW_PARTS.formatToParts(h0 + k * 3600e3).map((x) => [x.type, x.value]));
      const date = `${p.year}-${p.month}-${p.day}`;
      hours.push({ at: (h0 + k * 3600e3 - t0) / 1000, date, h: +p.hour, prev: dayBefore(date) });
    }
    const need = [...new Set(hours.map((x) => x.date))], all = [...new Set([...need, ...hours.map((x) => x.prev)])];
    const got = await Promise.all(all.map((d) => fetch('/api/trasa?dzien=' + d).then((r) => (r.ok ? r.json() : null), () => null)));
    const days = Object.fromEntries(got.filter(Boolean).map((x) => [x.date, x.lines]));
    return need.every((d) => days[d]) ? { hours, days } : null; // a day before the timetable starts counts as no night trips
  }
  // Departure times of a line in the horizon (seconds from t0) per direction, or null when the timetable has no such line.
  function lineSlots(sched, line) {
    if (!Object.values(sched.days).some((d) => d[line])) return null;
    const n = (date, d, h) => { const L = sched.days[date] && sched.days[date][line]; return (L && L[d] && L[d][h]) || 0; };
    return [0, 1].map((d) => wawPrognoza.slots(sched.hours.map((x) => ({ at: x.at, n: n(x.date, d, x.h) + n(x.prev, d, x.h + 24) })), LAPSE_H / 1000));
  }

  // What the map shows for a line: items { key, type, line, id (vehicle seen live, clickable), faded, at(seconds) -> [lat, lon] | null }.
  function buildLine(line, data, live) {
    for (const x of live) x.plan = data ? wawPrognoza.plan(data.variants, x.track) : null;
    const type = (data && data.type) || (live[0] && live[0].v.type) || 'bus';
    const slotsOf = data && lapse.sched ? lineSlots(lapse.sched, line) : null;
    const add = (key, id, faded, at) => lapse.items.set(key, { key, type, line, id, faded, at });
    // Without a route: stays where it was, faded (gone when the timetable says the line does not run then).
    const running = (sec) => !slotsOf || slotsOf.some((a) => a.some((t) => Math.abs(t - sec) < 3600));
    for (const x of live) if (!x.plan) add(x.v.id, x.v.id, true, (sec) => (running(sec) ? [x.v.lat, x.v.lon] : null));
    const planned = live.filter((x) => x.plan);
    if (slotsOf) {
      for (const e of wawPrognoza.simulate(data.variants, type, planned.map((x) => ({ key: x.v.id, plan: x.plan })), slotsOf)) {
        add(e.live ? e.key : `${line}:${e.key}`, e.live ? e.key : null, false, (sec) => wawPrognoza.positionOf(e, sec, type));
      }
    } else for (const x of planned) add(x.v.id, x.v.id, false, (sec) => wawPrognoza.positionAt(data.variants, x.plan, type, sec));
    lapse.dirty = true;
  }

  function lapseStart() {
    const gen = ++lapse.gen;
    lapse.t0 = state.lastOk || Date.now(); lapse.t = lapse.t0; lapse.last = 0;
    lapse.list = [...state.markers.values()].map((m) => ({ v: m.v, track: (lapse.tracks.get(m.v.id) || [[m.v.lat, m.v.lon]]).slice(), plan: undefined }));
    lapse.items.clear(); lapse.sched = undefined;
    lapseLayer.clearLayers(); lapse.markers.clear();
    // Until a line is ready its vehicles stand where they were.
    for (const x of lapse.list) lapse.items.set(x.v.id, { key: x.v.id, type: x.v.type, line: x.v.line, id: x.v.id, faded: false, at: () => [x.v.lat, x.v.lon] });
    const liveLines = [...new Set(lapse.list.map((x) => x.v.line))];
    lapse.lines = { done: 0, total: liveLines.length };
    loadSchedule(lapse.t0).then((sched) => {
      if (gen !== lapse.gen) return;
      lapse.sched = sched;
      // Lines with no vehicle out now but trips in the horizon (night lines in the evening, early-morning ones).
      const more = sched ? [...new Set(Object.values(sched.days).flatMap((d) => Object.keys(d)))].filter((l) => !liveLines.includes(l) && lineSlots(sched, l).some((a) => a.length)) : [];
      const lines = [...liveLines, ...more];
      lapse.lines.total = lines.length;
      let i = 0;
      const worker = async () => {
        while (i < lines.length) {
          const line = lines[i++];
          let data = null;
          try { data = await loadRoute(line); } catch {}
          if (gen !== lapse.gen) return;
          lapse.lines.done++;
          buildLine(line, data, lapse.list.filter((x) => x.v.line === line));
        }
      };
      for (let k = 0; k < 6; k++) worker(); // a few lines at a time
    });
    lapse.dirty = true; renderLapse();
  }

  function lapseFrame(now) {
    const dt = lapse.last ? Math.min(now - lapse.last, 250) : 0; // a background tab does not jump ahead
    lapse.last = now;
    const t = Math.min(lapse.t0 + LAPSE_H, lapse.t + dt * lapse.speed);
    if (t === lapse.t && !lapse.dirty) return;
    lapse.t = t; lapse.dirty = false;
    const sec = (t - lapse.t0) / 1000, r = radius();
    let shown = 0;
    for (const [key, mk] of lapse.markers) if (!lapse.items.has(key)) { lapseLayer.removeLayer(mk); lapse.markers.delete(key); } // replaced by the line's prediction
    for (const it of lapse.items.values()) {
      let mk = lapse.markers.get(it.key);
      const p = visible(it) ? it.at(sec) : null;
      if (!p) { if (mk && lapseLayer.hasLayer(mk)) lapseLayer.removeLayer(mk); continue; }
      shown++;
      const op = it.faded ? 0.4 : 1;
      if (!mk) {
        lapse.markers.set(it.key, (mk = L.circleMarker(p, { renderer: canvas, radius: r, color: '#fff', weight: 1.5, fillColor: COLORS[it.type], fillOpacity: op, opacity: op, interactive: !!it.id })));
        const id = it.id;
        if (id) mk.on('click', (e) => { L.DomEvent.stopPropagation(e); setLapse(false); if (state.markers.has(id)) select(id); });
      } else {
        mk.setLatLng(p);
        if (mk.options.radius !== r) mk.setRadius(r);
        if (mk.options.fillOpacity !== op) mk.setStyle({ fillOpacity: op, opacity: op });
      }
      if (!lapseLayer.hasLayer(mk)) lapseLayer.addLayer(mk);
    }
    lapse.shown = shown;
    renderLapse();
  }

  function renderLapse() {
    $('lapse-speed-out').textContent = speedTxt(lapse.speed);
    const pos = $('lapse-pos'), d = lapse.t - lapse.t0, when = clock(lapse.t);
    if (document.activeElement !== pos) pos.value = Math.round((d / LAPSE_H) * 1000);
    $('lapse-pos-out').textContent = when; pos.setAttribute('aria-valuetext', when);
    $('lapse-time').textContent = d < 1000 ? 'teraz' : ahead(d);
    const lost = lapse.list.filter((x) => x.plan === null).length, { done, total } = lapse.lines;
    const speeds = 'ze średnią prędkością (autobus ok. 20 km/h, tramwaj ok. 18 km/h)';
    $('lapse-note').textContent = lapse.sched === undefined ? 'Wczytywanie rozkładu…' : done < total ? `Wczytywanie tras linii: ${done} z ${total}…`
      : `Na mapie ${lapse.shown} poj. Prognoza z danych z ${clock(lapse.t0)}: ` + (lapse.sched
        ? `tyle kursów, ile rozkład ZTM przewiduje w każdej godzinie; pojazdy jadą po trasach ${speeds}, na pętli czekają na kolejny kurs albo zjeżdżają do zajezdni. Pozycje są przybliżone.`
        : `pojazdy jadą dalej po trasach ${speeds}, na pętli czekają 4 min. Brak rozkładu godzinowego, więc liczba pojazdów się nie zmienia.`)
      + (lost ? ` ${lost} poj. bez trasy stoi w miejscu (wyblakłe).` : '');
  }

  function setLapse(on) {
    lapse.on = on;
    const btn = $('t-lapse');
    btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on);
    $('lapse').hidden = !on;
    if (on) {
      if (state.selected) deselect(); // predicted positions have no live vehicle to show details of
      const r = $('lapse').getBoundingClientRect(); // panels in the card's place (phones) close, so the card stays in sight
      for (const p of PANELS.map($)) if (!p.hidden && overlaps(p.getBoundingClientRect(), r)) p.querySelector('.p-ctrl button:last-child').click();
      lapseLayer.addTo(map); lapseStart();
    } else { lapse.gen++; map.removeLayer(lapseLayer); lapseLayer.clearLayers(); lapse.markers.clear(); lapse.list = []; lapse.items.clear(); }
    refresh(); liftLocate();
  }
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  function setLapseSlider(x) {
    lapse.slider = Math.max(0, Math.min(100, Math.round(x))); lapse.speed = sliderToSpeed(lapse.slider);
    const el = $('lapse-speed');
    el.value = lapse.slider; el.setAttribute('aria-valuetext', lapse.speed ? speedTxt(lapse.speed).slice(1) + ' razy szybciej' : 'pauza');
    try { localStorage.setItem('waweye.lapseSlider', String(lapse.slider)); } catch {}
    renderLapse();
  }
  setLapseSlider(lapse.slider);
  $('t-lapse').onclick = () => setLapse(!lapse.on);
  $('lapse-close').onclick = () => setLapse(false);
  $('lapse-speed').oninput = (e) => setLapseSlider(+e.target.value);
  $('lapse-pos').oninput = (e) => { lapse.t = lapse.t0 + LAPSE_H * (+e.target.value / 1000); lapse.dirty = true; };
  $('lapse-refresh').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.classList.add('busy');
    try { await poll(); } finally { b.disabled = false; b.classList.remove('busy'); }
    if (lapse.on) lapseStart();
  };
  map.on('zoomend', () => { lapse.dirty = true; }); // marker size follows the zoom

  window.__waweye = { lapse, setLapse, setLapseSlider, sliderToSpeed, state, zones, me, map, poll, select, deselect, selectPark, deselectPark, selectInc, deselectInc, selectSport, deselectSport, selectEvent, deselectEvent, openZone, closeZone, metro, openStation, closeStation, route };
  poll(); setInterval(poll, POLL_MS);
  // Polling and location tracking pause while the tab is hidden (saves requests, transfer and battery) and catch up when it is shown again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopWatch();
    else { poll(); pollParkings(); pollIncidents(); pollSport(); pollEvents(); if (me.active) startWatch(); }
  });
  requestAnimationFrame(frame);
})();
