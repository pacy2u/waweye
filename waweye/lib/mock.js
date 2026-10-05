'use strict';
const { warsawDate } = require('./warsaw');
// Deterministic moving vehicles around Warsaw, for local work without the live API.
const LINES = { bus: ['175', '186', '523', '111', '500', 'N22'], tram: ['9', '17', '24', '33'] };

function mockVehicles(now = Date.now(), n = 120) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const type = i % 4 === 0 ? 'tram' : 'bus';
    const lines = LINES[type];
    const phase = (now / 60000 + i * 0.37) * (0.4 + (i % 5) * 0.1);
    const a = i * 2.399963;
    const r = 0.015 + (i % 17) * 0.004;
    out.push({
      id: `${type === 'bus' ? 1 : 2}-${1000 + i}`,
      type,
      line: lines[i % lines.length],
      vehicle: String(1000 + i),
      brigade: String(1 + (i % 9)),
      lat: 52.2297 + r * Math.sin(a + phase),
      lon: 21.0122 + r * 1.6 * Math.cos(a + phase),
      time: now,
    });
  }
  return out;
}

const PARKINGS = [
  ['Parking Pl. Żelaznej Bramy', 52.23956, 21.001779, 47, 0], ['Parking Pałac Kultury i Nauki', 52.2318, 21.0063, 120, 85],
  ['Parking Dworzec Centralny', 52.2285, 21.0033, 300, 12], ['Parking Pl. Defilad', 52.2304, 21.0107, 80, 41],
  ['Parking Stadion Narodowy', 52.2394, 21.0457, 500, 233], ['Parking Rondo Daszyńskiego', 52.2308, 20.9842, 60, 0],
];

function mockParkings() {
  return PARKINGS.map(([name, latitude, longitude, total, free], i) => ({
    name, latitude: String(latitude), longitude: String(longitude), adress: 'ul. Przykładowa ' + (i + 1),
    opening_hours: [{ monday: '00:00-23:59', tuesday: '00:00-23:59', wednesday: '00:00-23:59', thursday: '00:00-23:59', friday: '00:00-23:59', saturday: '00:00-23:59', sunday: '00:00-23:59' }],
    tariffs: [{ VehicleType: 'Samochód osobowy', Prices: [{ StayLength: '1.00', StayPrice: '5.00' }, { StayLength: '2.00', StayPrice: '11.00' }] }],
    levels: 1, total_places: [{ level: '0', standard: total, disabled: 2, electric: 4 }],
    free_places_total: { public: free, disabled: i % 2, electric: i % 3 },
    acceptedPaymentMethod: 'Gotówka, karta płatnicza', additionalSecurity: 'Parking strzeżony',
    manager: 'Zarząd Terenów Publicznych', operatorTelephone: '+48 730-255-220', parkingCategory: 'Publiczny',
  }));
}

// Warsaw-local "YYYY-MM-DD HH:MM:SS" offset by `days` from now (good enough for mock data).
const wl = (days) => new Date(Date.now() + days * 86400e3 + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
function mockIncidents() {
  const pt = (lat, lng) => [[{ geomType: 0, latlngs: [{ lat, lng }] }]];
  return [
    { start_date: wl(-1), end_date: wl(2), name: 'Wymienią nawierzchnię na skrzyżowaniu', id: 8144, content: ['Skrzyżowanie będzie zamknięte.', 'Ruch wróci w piątek.'], geo: pt(52.2321, 21.0151) },
    { start_date: wl(-3), end_date: wl(5), name: 'Remont ulicy Marszałkowskiej', id: 8146, content: ['Zwężenie jezdni na odcinku.'],
      geo: [[{ geomType: 1, latlngs: [{ lat: 52.2260, lng: 21.0120 }, { lat: 52.2300, lng: 21.0160 }, { lat: 52.2350, lng: 21.0200 }] }]] },
    { start_date: wl(3), end_date: wl(6), name: 'Planowane zamknięcie ul. Targowej', id: 8150, content: ['Prace od przyszłego tygodnia.'], geo: pt(52.2500, 21.0400) },
    { start_date: wl(-9), end_date: wl(-1), name: 'Zakończone prace na Powiślu', id: 8101, content: ['Prace zakończone.'], geo: pt(52.2330, 21.0300) },
  ];
}

// Fleet records for the mock vehicles (fleet numbers 1000..1119), in the shape of the "Pojazdy transportu publicznego" API.
function mockFleet() {
  const busy = [], tramwaje = [];
  for (let i = 0; i < 120; i++) {
    const tram = i % 4 === 0;
    (tram ? tramwaje : busy).push({
      nazwaSkroconaOperatora: tram ? 'TW' : 'MZA', nazwaOperatora: tram ? 'Tramwaje Warszawskie Sp. z o.o.' : 'Miejskie Zakłady Autobusowe Sp. z o.o.',
      schematMalowania: 'ZTM', kolorPojazdu: 'RAL 1003+3020', kolorTapicerki: 'czerwony ZTM-Pocztówka', rokProdukcji: 2008 + (i % 15),
      numerTaborowy: String(1000 + i), trakcja: tram ? 'Tram' : 'Bus', idMarki: tram ? 85 : 1, nazwaZajezdni: tram ? 'R-5 "Annopol"' : 'Redutowa',
      ...(tram ? {} : { numerRejestracyjny: 'WZ ' + (1000 + i) + 'M' }),
    });
  }
  return {
    busy, tramwaje, metro: [], kolej: [], markiMetro: [], markiKolej: [],
    markiBus: [{ idMarki: 1, marka: 'Solaris', typ: 'Urbino', wersja: '12', wariant: 'IV', producent: 'Solaris Bus & Coach S.A.', dlugosc: 11947, szerokosc: 2550,
      katWielkosci: 'MAXI (12m)', liczMiejscSiedzacychTab: 30, liczMiejscStojacychTab: 74, liczMiejscTab: 104, liczMiejscWozekInwalid: 1, liczMiejscWozekDziec: 1,
      podloga: 'LE', klimatyzacja: true, rodzajZasilania: 'Spalinowy', zasilanie: 'ON', platnosc: 'karta płatnicza + blik' }],
    markiTramwaje: [{ idMarki: 85, marka: 'Konstal', typ: '105N', wersja: null, wariant: 'i', producent: 'Konstal', dlugosc: 13500, szerokosc: 2400,
      katWielkosci: '15m', liczMiejscSiedzacychTab: 18, liczMiejscStojacychTab: 107, liczMiejscTab: 125, liczMiejscWozekInwalid: 0, liczMiejscWozekDziec: 1,
      podloga: 'HF', klimatyzacja: false, platnosc: 'karta płatnicza + blik' }],
  };
}

// Sport classes in the shape of the "Zajęcia sportowe" API (records from the live API, 2026-10-05, trimmed).
// Weekly classes run every day here, so the e2e test finds some "today" on any weekday.
const EVERY_DAY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((id) => ({ id, name: id }));
const point = (lon, lat, properties = {}) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties }] });
const ymd = (days) => warsawDate(Date.now() + days * 86400e3); // the app counts days in Warsaw time
// Addresses the mock geocoder knows (lib/handler.js), standing in for Nominatim.
const MOCK_GEOCODES = { 'Lokalna 33, Warszawa': { lat: 52.1610, lon: 21.2050 }, 'Michała Kajki 80, Warszawa': { lat: 52.2320, lon: 21.1010 } };

function mockSport() {
  const cls = (title, extra) => ({ title, url: 'https://sport.um.warszawa.pl/-/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), language: 'pl_PL',
    category: [{ id: 'category_1', name: 'Fitness' }], dedicated: [{ id: 'value_1', name: 'Kobiety' }, { id: 'value_2', name: 'Mężczyźni' }],
    localization: [{}, { id: 'srodmiescie', name: 'Śródmieście' }], text: '<p>Bezpłatne zajęcia. Zapisy na miejscu.</p>', time: '18:00', ...extra });
  return [
    cls('Taneczne piątki dla seniorów', { day: EVERY_DAY, date: [], time: '10:00', category: [{ id: 'c', name: 'Taniec' }], dedicated: [{ id: 'value_5', name: 'Seniorzy' }],
      localization: [{ id: 'praga-polnoc', name: 'Praga-Północ' }], map: point(21.035758, 52.25002, { district: 'Praga-Północ', shortStreetName: 'ul. Jagiellońska', streetNumber: '7' }) }),
    cls('Zdrowy kręgosłup', { day: EVERY_DAY, date: [], time: '18:30', category: [{ id: 'c', name: 'Gimnastyka' }],
      localization: [{ id: 'praga-polnoc', name: 'Praga-Północ' }], map: point(21.035758, 52.25002, { district: 'Praga-Północ', shortStreetName: 'ul. Jagiellońska', streetNumber: '7' }) }),
    cls('Cykl spacerów jogicznych', { day: EVERY_DAY, date: [], time: '09:30', category: [{ id: 'c', name: 'Aktywności parkowe i miejskie' }],
      address: [{ name: 'Park Kultury w Powsinie', street: 'Maślaków 1', postCodeAndOffice: '02-973, Warszawa', phone: ['22648 48 11'], email: ['sekretariat@parkpowsin.pl'] }],
      map: point(21.091389, 52.116374, { details: 'Zbiórka przy KluboKawiarni Powsin' }) }),
    cls('Fruwaj z Orłami', { day: EVERY_DAY, date: [], dedicated: [{ id: 'value_3', name: 'Dzieci' }], address: [{ name: 'Białe Orły', postCodeAndOffice: 'Warszawa' }],
      map: point(21.0449405431161, 52.2955022585573, { details: 'Szkoła Podstawowa nr 380 ul. Krasiczyńska 4/6' }) }),
    cls('Bieg w Parku Skaryszewskim', { day: [{ id: 'saturday', name: 'Sobota' }], date: [ymd(0), ymd(3)], time: '08:00', category: [{ id: 'c', name: 'Bieganie' }],
      map: point(21.0520, 52.2440) }),
    cls('Tenisowe środy dla Seniorów', { day: EVERY_DAY, date: [], time: '11:00', category: [{ id: 'c', name: 'Inne' }],
      address: [{ name: 'Korty Falenica', postCodeAndOffice: 'Warszawa', street: 'Lokalna 33' }], localization: [{}, { id: 'wawer', name: 'Wawer' }] }),
    cls('Siatkówka w SP 218', { day: EVERY_DAY, date: [], address: [{ name: 'Szkoła Podstawowa nr 218', postCodeAndOffice: '04-621 Warszawa', street: 'Michała Kajki 80/82' }],
      text: '<h3>Dla kogo?</h3><p>Dla młodzieży&nbsp;i dorosłych.</p><script>alert(1)</script><a href="tel:22">22</a>' }),
    cls('Fit Mama w OSiR Wawer', { day: EVERY_DAY, date: [] }), // no address, no point: cannot be placed
    cls('Zakończony turniej', { day: [], date: [ymd(-30)], map: point(21.0, 52.23) }),
  ];
}

// City events in the shape of the "Kalendarz wydarzeń" API (records from the live API, 2026-10-05, trimmed).
const at = (days, time) => `${ymd(days)}T${time}:00+02`;
function mockEvents() {
  const ev = (title, extra) => ({ title, url: 'https://um.warszawa.pl/-/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), language: 'pl_PL', availableLanguages: ['pl_PL'],
    category: [{ id: '34057', name: 'Kultura' }], text: '<p>Opis wydarzenia.</p><p>Organizator: <a href="https://teatrsyrena.pl/" target="_blank">Teatr Syrena</a></p>', ...extra });
  return [
    ev('Oskarżony – spektakl', { address: [{ name: 'OCH-Teatr' }], localization: [{ id: '33974', name: 'Ochota' }], lead: 'Dramat sądowy w reżyserii Krystyny Jandy.',
      occurrence: [{ daily: false, from: at(0, '19:00'), to: at(0, '21:00') }, { daily: false, from: at(1, '19:00'), to: at(1, '21:00') }],
      map: point(20.9799983868717, 52.2141938100175, { district: 'Ochota', shortStreetName: 'ul. Grójecka', streetNumber: '65' }) }),
    ev('Wystawa w Zachęcie', { address: [{ name: 'Zachęta', street: 'pl. Małachowskiego 3' }], occurrence: [{ daily: true, from: at(-10, '00:00'), to: at(20, '23:59') }],
      map: point(21.0115, 52.2392, { district: 'Śródmieście', shortStreetName: 'pl. Małachowskiego', streetNumber: '3' }) }),
    ev('Niepodległościowy Bal Kostiumowy', { address: [{ name: 'Dom Kultury Zacisze', street: 'ul. Blokowa 1' }], occurrence: [{ daily: false, from: at(3, '11:00'), to: at(3, '11:00') }],
      map: { type: 'FeatureCollection', features: [0, 1, 2].map(() => point(21.071652391045, 52.2834103762377, { district: 'Targówek', shortStreetName: 'ul. Blokowa', streetNumber: '1' }).features[0]) } }),
    ev('Festiwal na dwóch scenach', { address: [{ name: 'Teatr Syrena', street: 'Litewska 3' }], occurrence: [{ daily: true, from: at(0, '00:00'), to: at(0, '23:59') }],
      map: { type: 'FeatureCollection', features: [point(21.038453, 52.252014, { shortStreetName: 'ul. Targowa', streetNumber: '56' }).features[0], point(21.022151, 52.216486, { shortStreetName: 'ul. Litewska', streetNumber: '3' }).features[0]] } }),
    ev('Koncert w SP 218', { address: [{ name: 'Szkoła Podstawowa nr 218', street: 'Michała Kajki 80/82' }], occurrence: [{ daily: false, from: at(0, '17:00'), to: at(0, '18:30') }],
      text: '<p>Koncert.</p><script>alert(1)</script>' }), // no point: placed from the address
    ev('Wydarzenie bez miejsca', { occurrence: [{ daily: false, from: at(0, '12:00'), to: at(0, '13:00') }] }),
    ev('Dawno zakończone', { occurrence: [{ daily: false, from: '2023-07-05T09:00:00+02', to: '2023-07-05T10:00:00+02' }], map: point(21, 52.23) }),
  ];
}

module.exports = { mockFleet, mockVehicles, mockParkings, mockIncidents, mockSport, mockEvents, MOCK_GEOCODES };
