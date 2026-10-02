# Pasibus – komunikacja miejska w Warszawie na żywo

Mapa pojazdów (autobusy, tramwaje) w czasie rzeczywistym. Dane: [Lokalizacja pojazdów komunikacji miejskiej](https://dane.um.warszawa.pl/pl/catalogue/f319f602-7292-4e8c-b3d1-f5898aa9a638), m.st. Warszawa. Mapa: OpenStreetMap + Leaflet.

Funkcje: zoom (przyciski, scroll, pinch), odświeżanie co 10 s z płynnym ruchem pojazdów, kliknięcie pojazdu wyróżnia go (pomarańczowy pierścień, reszta wyszarzona) i pokazuje panel ze szczegółami, tryb „Śledź”, filtr typu i linii. Wyświetlanie całej trasy linii jest zaparkowane.

## Uruchomienie lokalne
```bash
cd pasibus
npm install
cp .env.example .env      # wpisz WARSAW_API_KEY
npm start                 # http://localhost:3000
MOCK=1 npm start          # dane symulowane, bez klucza
```

## Testy
```bash
npm test          # jednostkowe: normalizacja, błędy API, handler
npm run test:e2e  # przeglądarka (Chromium, desktop + mobile) na danych symulowanych
```

## Wdrożenie na Vercel
1. Vercel → **Add New → Project** → importuj repo `pacy2u/tst`.
2. **Root Directory**: `pasibus`. Framework: *Other*.
3. **Settings → Environment Variables**: `WARSAW_API_KEY` = Twój klucz (Production + Preview).
4. **Deploy**. Aplikacja działa pod adresem `*.vercel.app` na komputerze i telefonie.

Klucz jest tylko po stronie serwera (`api/vehicles.js`); przeglądarka nigdy go nie widzi. Odpowiedzi są cache'owane na krawędzi przez 5 s, więc wielu użytkowników nie przeciąża API.

## Struktura
- `public/` – front (Leaflet, `app.js`, `style.css`)
- `api/vehicles.js` – funkcja Vercel; `lib/` – logika API, mock, handler
- `dev-server.js` – serwer lokalny
