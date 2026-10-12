# wawEye – komunikacja miejska w Warszawie na żywo

**https://waweye.vercel.app**

Mapa autobusów i tramwajów w Warszawie w czasie rzeczywistym, z liniami i stacjami metra. Otwiera się w sekundę, działa na telefonie i komputerze, bez logowania, reklam i analityki.

## Co pokazuje

- **Pojazdy na żywo**: pozycje GPS odświeżane co 10 s, płynny ruch między odczytami, filtr typu i linii, tryb „Śledź”.
- **Trasa linii** z przystankami po kliknięciu pojazdu oraz dane taboru: model, rocznik, operator, zajezdnia, klimatyzacja.
- **Metro**: linie M1 i M2 z 38 stacjami.
- **Warstwy miejskie**: parkingi z wolnymi miejscami, utrudnienia w ruchu, strefy płatnego parkowania i czystego transportu, zajęcia sportowe, wydarzenia.
- **Timelapse**: przewidywany ruch pojazdów do 24 h naprzód według rozkładu ZTM.
- **Moja lokalizacja**: pozycja nie opuszcza przeglądarki.

## Dane

Otwarte dane m.st. Warszawy ([dane.um.warszawa.pl](https://dane.um.warszawa.pl)), rozkład GTFS ZTM, OpenStreetMap. Mapa: [Leaflet](https://leafletjs.com) i kafelki OpenStreetMap. Aplikacja nie jest oficjalnym serwisem miasta ani ZTM.

## Jak to działa

Strona statyczna i funkcje serverless w Vercel (Node.js, bez frameworka). Klucz API miasta jest tylko po stronie serwera: zapytania idą przez pośrednika Cloudflare Worker, a trasy i rozkład trzyma magazyn Cloudflare KV, odświeżany raz na dobę. Szczegóły i diagramy: [`waweye/ARCHITEKTURA.md`](waweye/ARCHITEKTURA.md).

## Uruchomienie

```bash
cd waweye
npm install
MOCK=1 npm start      # dane symulowane, bez klucza API → http://localhost:3000
```

Z prawdziwymi danymi potrzebny jest darmowy token z https://dane.um.warszawa.pl/key-api (`WARSAW_API_KEY` w pliku `waweye/.env`). Pełna instrukcja, wdrożenie i konfiguracja: [`waweye/README.md`](waweye/README.md).

## Testy i jakość

ESLint, testy jednostkowe z progami pokrycia kodu, testy w przeglądarce (Chromium i WebKit, desktop i telefon, z kontrolą dostępności axe) przy każdym PR. Produkcja trafia do użytkowników dopiero po zielonej bramce testów. Opis całego procesu: [`waweye/TESTY_I_JAKOSC.md`](waweye/TESTY_I_JAKOSC.md).

## Dokumentacja

| Plik | Zawartość |
| --- | --- |
| [`waweye/README.md`](waweye/README.md) | funkcje, uruchomienie, wdrożenie (Vercel, Cloudflare) |
| [`waweye/ARCHITEKTURA.md`](waweye/ARCHITEKTURA.md) | komponenty, przepływy danych, CI/CD, monitoring |
| [`waweye/TESTY_I_JAKOSC.md`](waweye/TESTY_I_JAKOSC.md) | testy, raportowanie, klasyfikacja błędów |
| [`waweye/ROADMAPA.md`](waweye/ROADMAPA.md) | plany rozwoju |
| [`waweye/CONTEXT.md`](waweye/CONTEXT.md) | decyzje projektowe i ich uzasadnienie |
