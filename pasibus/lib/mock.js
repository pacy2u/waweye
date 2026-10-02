'use strict';
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

module.exports = { mockVehicles, mockParkings };
