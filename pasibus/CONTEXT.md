# Pasibus – kontekst projektu (przekazanie między sesjami)

Aktualizowane: 2026-10-02. Czytaj to najpierw, jeśli wznawiasz pracę w nowej sesji. Szczegóły uruchomienia i wdrożenia: `README.md`.

## Cel
Aplikacja webowa (komputer + telefon) pokazująca na mapie Warszawy w czasie rzeczywistym pojazdy komunikacji miejskiej, z możliwością zoomu i wyboru pojedynczego pojazdu (wyróżnienie na tle pozostałych). Kolorystyka jak w Strava (pomarańcz `#FC4C02`, grafit `#242428`). Wszystko w folderze `pasibus/` repo `pacy2u/tst`. Użytkownik pisze po polsku; oczekuje: pytań przed generowaniem kodu przy niejasnościach i przetestowania wszystkiego przed oddaniem.

## Stan (działa na produkcji: https://pasibus.vercel.app)
- **Pojazdy** (autobusy + tramwaje): odświeżanie co 10 s, płynny ruch, zoom, wybór pojazdu (pomarańczowy pierścień, reszta wyszarzona), panel szczegółów, „Śledź”, filtry typu i linii, numery linii od zoomu 14.
- **Dane o pojeździe**: po kliknięciu panel dociąga `/api/fleet` (zbiór `get_ztm_pojazdy`, raz na sesję) i łączy po `numerTaborowy` = `vehicle` + typ (autobus/tramwaj). Sprawdzone na produkcji 2026-10-02: w zbiorze jest 99,5% autobusów i 99,6% tramwajów na żywo (braki to pojedyncze numery). Monitoring pilnuje, żeby dopasowanie nie spadło poniżej 90%.
- **Parking** (przycisk z ikoną P): znaczniki „P <wolne>” (zielony/czerwony), panel: wolne z pojemności, podział standard/niepełnosprawni/elektryczne, godziny, cennik, telefon. Odświeżanie 60 s.
- **Utrudnienia** (przycisk z ikoną ostrzeżenia): punkty i linie, status trwa/zaplanowane/zakończone, panel z treścią i linkiem do infoulice. Odświeżanie 60 s.
- Panele pojazdu/parkingu/utrudnienia wzajemnie się wykluczają.
- Odświeżanie wstrzymuje się w ukrytej karcie i wraca od razu po jej pokazaniu.
- Testy: `npm test` (jednostkowe), `npm run test:e2e` (Chromium, desktop + telefon, na danych MOCK). Uruchamiane automatycznie w GitHub Actions przy każdym PR (`.github/workflows/pasibus-testy.yml`).
- Monitoring: co 2 h `scripts/check-production.js` w Actions; przy awarii otwiera issue „[monitoring] …” i zamyka je po powrocie do normy.

## Architektura
```
przeglądarka (Leaflet, public/app.js)
   └─ /api/vehicles | /api/parking | /api/incidents | /api/fleet   (funkcje Vercel, region fra1, maxDuration 60)
        └─ UPSTREAM_URL ustawione? → Cloudflare Worker (GET ?type=1|2 | ?resource=parking|incidents|fleet, nagłówek x-proxy-secret)
                                          └─ POST https://dane.um.warszawa.pl/api/action/…  (token w Authorization)
        └─ brak UPSTREAM_URL → bezpośrednio POST do dane.um.warszawa.pl (tryb awaryjny/lokalny)
```
- `lib/warsaw.js` – pobieranie, normalizacja (pojazdy, parkingi, utrudnienia), parsowanie czasu Europe/Warsaw, ponowienia, czytelne błędy.
- `lib/handler.js` – handlery wspólne dla Vercel i `dev-server.js`; `lib/mock.js` – dane symulowane (`MOCK=1`).
- `worker/index.js` – kod Workera. **Po każdej zmianie tego pliku trzeba ręcznie wkleić go w Cloudflare (Edit code → Deploy)**; Vercel go nie wdraża.
- `public/` – front bez bundlera; Leaflet lokalnie w `public/vendor/`.

## Zmienne / sekrety (tylko nazwy, wartości NIGDY w repo)
| Gdzie | Nazwa | Uwagi |
|---|---|---|
| Cloudflare Worker `pasibus-proxy` (adres `https://pasibus-proxy.andrzejgpacek.workers.dev`) | `WARSAW_API_KEY` (Secret) | token z https://dane.um.warszawa.pl/key-api |
| Cloudflare Worker | `PROXY_SECRET` (Secret) | losowy ciąg, inny niż token |
| Vercel (Production + Preview) | `UPSTREAM_URL` | adres Workera, bez końcowego `/` |
| Vercel | `UPSTREAM_SECRET` | taki sam jak `PROXY_SECRET`; po zmianie zmiennych → Redeploy |
Lokalnie: `pasibus/.env` (w `.gitignore`).

## Pułapka: dwa canvasy Leaflet
Linie utrudnień muszą używać tego samego renderera canvas co pojazdy (`renderer: canvas`). Drugi canvas leży nad pierwszym i połyka kliknięcia, przez co nie dało się wybrać pojazdu przy włączonych utrudnieniach. Po narysowaniu linii pojazdy są przenoszone na wierzch (`bringToFront`). Pilnuje tego krok e2e „vehicles stay clickable while the incidents layer is on”.

## Ustalenia o API (ważne, wiele kosztowało debugowania)
1. **Stary host `api.um.warszawa.pl` + `?apikey=` nie przyjmuje tokenów z nowego portalu** (`Błędny apikey`). Używamy nowego API: `POST https://dane.um.warszawa.pl/api/action/<nazwa>`, token w nagłówku `Authorization` (kod próbuje samego tokenu, a przy 401/403 `Bearer <token>`).
2. Endpointy: pojazdy `get_ztm_lokalizacja_pojazdow` (treść JSON `{"type":1|2}`), parkingi `get_m_parkingi_wolne_miejsca`, utrudnienia `get_bin_utrudnienia_drogowe` (oba bez treści).
3. **Format odpowiedzi różni się od dokumentacji**: pojazdy to goła tablica (nie `{result:[]}`); parkingi pod kluczem `carParks` (dok.: `Parkings`), obok `Status` i `Timestamp`. Parsery są tolerancyjne. Przy nowym zbiorze zakładaj, że przykład z dokumentacji może się różnić – dlatego błędy zawierają podgląd odpowiedzi (`Unexpected API response: …`).
4. **Serwery Warszawy nie łączą się z adresów Vercel/AWS** (`UND_ERR_CONNECT_TIMEOUT`); też z sandboxa sesji bywały zrywane połączenia. Rozwiązanie: Cloudflare Worker jako pośrednik. Test z przeglądarki w Polsce potwierdził brak CORS, więc bezpośrednio z przeglądarki się nie da.
5. `Time` pojazdów to czas lokalny Warszawy; parsowany strefą `Europe/Warsaw` (DST), pojazdy starsze niż 5 min i spoza bboxa są odrzucane.
6. API pojazdów nie zawiera **metra** (`typ` 1 = autobus, 2 = tramwaj).
7. Cloudflare wywołuje `fetch(request, env, ctx)` – trzeci argument to NIE funkcja fetch (był błąd).

## Decyzje produktowe (2026-10-02, szczegóły w `ROADMAPA.md`)
- Grupa docelowa: **codzienni pasażerowie**.
- Rozkłady, trasy i przystanki: **tylko oficjalne zbiory miasta** (bez społecznościowego GTFS).
- Budżet: **0 zł** (Vercel Hobby, darmowe progi, darmowa pula minut GitHub Actions dla prywatnego repo).
- **Bez analityki** użytkowników, także bezciasteczkowej. Mierzymy tylko technicznie (monitoring).

## Środowisko pracy (sesje w chmurze)
- Dostęp sieciowy sesji ustawia się w edycji środowiska (`apck01`); **zmiany stosują się tylko do nowych sesji**. Potrzebne domeny: `dane.um.warszawa.pl` (czytanie opisów zbiorów i test API; użytkownik zgodził się ją dodać 2026-10-02), `tile.openstreetmap.org` (kafelki w testach), `api.um.warszawa.pl` (stary host). Produkcja `pasibus.vercel.app` jest osiągalna z sesji, więc żywe dane można sprawdzać przez `/api/*` albo `node scripts/check-production.js`.
- Gałęzie: **opisowe nazwy** (`CLAUDE.md`), np. `faza-0/fundamenty-pasibus`; zmiany idą przez PR do `main` (użytkownik merguje, Vercel wdraża z `main`). Po zmergowanym PR zaczynaj od `git fetch && git merge --ff-only origin/main`.
- Użytkownik nie ma CLI; wkleja kod i wyniki z konsoli/zrzuty ekranu. Pytaj o to, czego nie da się sprawdzić bez żywego API (ja zwykle nie mam dostępu do `dane.um.warszawa.pl`).

## Zasady / pułapki
- **Nie commituj tokenu.** Token pojawił się w czacie i na zrzutach ekranu; stary token jest w historii gita, ale użytkownik potwierdził jego unieważnienie (2026-10-02). `.env.example` usunięto.
- Nowy zbiór danych = nowy endpoint w `lib/warsaw.js` + `lib/handler.js` + `api/<nazwa>.js` + `dev-server.js` + wpis w `RESOURCES` w `worker/index.js` + testy (jednostkowe z rekordem z dokumentacji, e2e na MOCK). Worker wdraża się sam po merge'u zmian w `worker/` (`.github/workflows/pasibus-wdrozenie-workera.yml`; sekrety `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID` są w repo od 2026-10-02), ręczne wklejanie nie jest już potrzebne. Faza 0 roadmapy przewiduje uproszczenie tego do wspólnego handlera.
- Pasek statusu „0 pojazdów” bywa po prostu efektem wyłączonych przycisków Autobusy/Tramwaje (nie błąd).
- Testy e2e klikające w pojazdy muszą zamrozić dane (np. `document.hidden` = true, potem czekać, aż żaden znacznik nie ma `to`), bo dane MOCK się ruszają, a poll co 10 s animuje pojazdy spod kursora.

## Odłożone / pomysły (kolejność wg wartości)
Pełna analiza i plan rozwoju w fazach: `ROADMAPA.md`.
1. **Trasa wybranej linii** (pierwotny wymóg: zaznaczenie pojazdu pokazuje całą planowaną trasę linii) – zaparkowane. Potrzebny zbiór z rozkładami/przebiegiem linii z `dane.um.warszawa.pl`; poproś użytkownika o sekcję „Parametry API / Przykłady wywołań” albo odczytaj stronę, gdy domena jest dozwolona w sesji.
2. **Metro** – brak w zbiorze pojazdów; opcje: statyczne linie M1/M2 i stacje albo osobny zbiór na żywo (nie znaleziono).
3. Drobne: opcjonalny filtr starych utrudnień; grupowanie gęstych znaczników/etykiet; ewentualnie ukrycie zakończonych utrudnień.

## Historia (PR-y w `pacy2u/tst`)
#1–#2 aplikacja + poprawki Vercel (region fra1) · #3 przyczyna błędu sieci w komunikatach · #4–#5 Worker Cloudflare · #6 treść błędu API · #7 przejście na nowe API (`Authorization`) · #8 timeout 25 s, podgląd odpowiedzi · #9 goła tablica + strefa czasowa · #10–#11 Parking (`carParks`) · #12 Utrudnienia · #13 licznik pojazdów liczony przy wyświetlaniu · #14 CONTEXT.md + CLAUDE.md · #15–#16 raport z testów eksploracyjnych · #17 poprawki z raportu · #18 dane o taborze · #19 klikanie pojazdów przy włączonych utrudnieniach (jeden canvas) · #20 roadmapa i Faza 0: CI, monitoring, automatyczne wdrażanie Workera (działa od 2026-10-02), pauza w ukrytej karcie · gałąź `fix/stabilny-test-e2e-klikania-pojazdow`: stabilny krok e2e klikania pojazdów (zamrożone dane na czas klikania), usunięty `README1st`.
