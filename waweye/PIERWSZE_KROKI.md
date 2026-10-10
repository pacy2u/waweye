# wawEye – pierwsze kroki

Krótki przewodnik dla nowych osób: najpierw jak korzystać z aplikacji, potem jak ją uruchomić u siebie. Szczegóły techniczne są w `README.md`, architektura w `ARCHITEKTURA.md`.

## Część 1. Korzystanie z aplikacji

Otwórz https://waweye.vercel.app na komputerze albo w telefonie. Nie trzeba się logować ani niczego instalować.

1. **Pojazdy na żywo.** Na mapie widać autobusy i tramwaje. Pozycje odświeżają się co 10 s, a pojazdy jadą płynnie między odczytami. Numery linii pojawiają się po przybliżeniu mapy.
2. **Wybierz pojazd.** Kliknij autobus albo tramwaj. Dostaje pomarańczowy pierścień, reszta szarzeje, a na mapie pojawia się trasa linii z przystankami. Panel podaje kierunek i dane pojazdu: model, rok produkcji, operatora, klimatyzację itd.
   - **Śledź** – mapa podąża za pojazdem.
   - **⌄** – zwija panel do jednego paska, żeby odsłonić mapę; stuknięcie paska go rozwija.
3. **Szukaj.** Wpisz w pole „Szukaj” numer linii (np. `175`) albo słowo (np. `teatr`). Wyszukiwanie działa we wszystkich włączonych warstwach, bez względu na wielkość liter i polskie znaki.
4. **Warstwy w pasku przycisków** (nazwa każdej ikony jest w podpowiedzi po najechaniu):

   | Ikona | Co pokazuje |
   |---|---|
   | autobus, tory | autobusy, tramwaje (włączanie i wyłączanie) |
   | M | linie metra M1 i M2 oraz stacje (klik w stację: linie i kierunki) |
   | P | parkingi z liczbą wolnych miejsc (zielony: są, czerwony: brak) |
   | trójkąt z „!” | utrudnienia w ruchu (żółte: trwają, niebieskoszare: zaplanowane) |
   | biegacz – Sport | miejskie zajęcia sportowe z linkiem do zapisów |
   | bilet – DziejeSię | wydarzenia z miejskiego kalendarza |
   | zegar ze strzałką – Timelapse | przewidywany ruch pojazdów w przyspieszonym tempie |

   Sport i DziejeSię mają wspólny filtr **Dziś / Jutro / 7 dni**.
5. **Strefy.** Przycisk z ikoną warstw pod przyciskami zoomu włącza strefę płatnego parkowania (SPPN) i strefę czystego transportu (SCT). Przycisk ⓘ obok przełącznika otwiera zasady strefy.
6. **Timelapse.** Suwak **Tempo** przyspiesza czas (od pauzy do ×1000), suwak **Czas** przesuwa widok do 24 h naprzód. Liczba pojazdów idzie za rozkładem ZTM, ale pozycje są tylko prognozą. Zamknięcie karty (×) wraca do danych na żywo.
7. **Moja lokalizacja.** Przycisk w prawym dolnym rogu pokazuje Twoją pozycję i centruje na niej mapę. Pozycja nie opuszcza przeglądarki.
8. **O serwisie.** Logo wawEye w pasku prowadzi do strony z filmem, źródłami danych i planem rozwoju.

Dobrze wiedzieć: „0 pojazdów” zwykle oznacza, że przyciski Autobusy i Tramwaje są wyłączone. Pozycji pociągów metra nie ma, bo nie publikuje ich żadne oficjalne źródło.

## Część 2. Uruchomienie u siebie (dla programistów)

Potrzebny jest Node.js 18 lub nowszy.

1. **Pobierz kod i zależności:**
   ```bash
   git clone https://github.com/pacy2u/waweye.git
   cd waweye/waweye
   npm install
   ```
2. **Uruchom bez klucza (dane symulowane)** – najszybszy start:
   ```bash
   MOCK=1 npm start      # http://localhost:3000
   ```
3. **Uruchom na prawdziwych danych.** Wygeneruj token na https://dane.um.warszawa.pl/key-api i zapisz go w `.env` (plik jest w `.gitignore`, nigdy go nie commituj):
   ```bash
   echo 'WARSAW_API_KEY=<token>' > .env
   npm start
   ```
   Serwery Warszawy bywają nieosiągalne z niektórych sieci (np. chmur); wtedy pracuj na `MOCK=1`.
4. **Przetestuj zmiany:**
   ```bash
   npm test           # testy jednostkowe
   npm run test:e2e   # przeglądarka (Chromium, komputer + telefon) na danych symulowanych
   ```
   Oba zestawy uruchamiają się też automatycznie w GitHub Actions przy każdym PR.
5. **Wyślij zmiany.** Pracuj na gałęzi z opisową nazwą (np. `funkcja/filtr-utrudnien`) i otwórz PR do `main`. Po merge'u Vercel sam wdraża aplikację, a zmiany w `worker/` wdraża workflow „wawEye – wdrożenie Workera Cloudflare”.

### Gdzie co jest

- `public/` – front (Leaflet, `app.js`, `style.css`), bez bundlera
- `api/` – funkcje Vercel; `lib/` – wspólna logika, dane symulowane (`mock.js`)
- `worker/` – pośrednik Cloudflare, który trzyma klucz i odpytuje API Warszawy
- `scripts/` – przygotowanie danych (trasy, metro, strefy) i kontrola produkcji
- `test/` – testy jednostkowe i e2e

Własne wdrożenie na Vercel i konfigurację Workera opisuje `README.md` („Wdrożenie na Vercel”, „Pośrednik Cloudflare Worker”).
