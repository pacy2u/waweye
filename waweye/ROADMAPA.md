# wawEye – analiza produktu i roadmapa

Data: 2026-10-02. Na podstawie kodu z `main` (po PR #18), `README.md`, `CONTEXT.md` i `RAPORT_TESTOW_EKSPLORACYJNYCH.md`. Testy w dniu analizy: `npm test` – 39/39, `npm run test:e2e` – 43/43 (dane MOCK).

**Decyzje właściciela produktu (2026-10-02):** grupa docelowa to codzienni pasażerowie; rozkłady tylko z oficjalnych zbiorów miasta; budżet 0 zł; bez analityki użytkowników; domena `dane.um.warszawa.pl` zostanie dodana do środowiska sesji; stary token jest unieważniony. Skutki dla planu opisuje [sekcja 6](#6-decyzje-właściciela-produktu-i-ich-skutki).

## 1. W skrócie

wawEye (do 3 października 2026 r. Pasibus) to lekka mapa komunikacji miejskiej Warszawy na żywo. Od zera do produkcji (https://pasibus.vercel.app) powstał w dwa dni. Pokazuje autobusy i tramwaje, parkingi z wolnymi miejscami, utrudnienia drogowe i dane o taborze. Kod jest mały (ok. 1 700 linii razem z testami), dobrze przetestowany i odporny na kaprysy API Warszawy.

Najważniejsze wnioski:

1. **Pierwotny cel nie jest domknięty.** Zaznaczenie pojazdu miało pokazywać całą trasę linii, a to jest zaparkowane. Bez tras i przystanków aplikacja odpowiada na pytanie „gdzie jest pojazd”, ale nie „kiedy przyjedzie mój”. Od tego zależy codzienna użyteczność dla pasażera.
2. **Fundamenty operacyjne są ręczne.** Worker Cloudflare wkleja się ręcznie, testy nie są uruchamiane automatycznie przy PR, nikt nie monitoruje produkcji. Przy każdym nowym zbiorze danych rośnie ryzyko rozjazdu między repo a tym, co działa.
3. **Skalowanie ma ukryte limity.** Kafelki z `tile.openstreetmap.org` nie są przeznaczone do aplikacji z dużym ruchem, a odpytywanie co 10 s (ok. 37 KB na odpowiedź) zużywa limity żądań i transferu Vercel proporcjonalnie do liczby użytkowników.

Proponowana kolejność: **fundamenty (Faza 0) → trasy i przystanki (Faza 1) → funkcje dla codziennego pasażera (Faza 2) → kontekst miasta i skala (Faza 3)**.

Faza 0 jest w dużej części zrobiona na gałęzi `faza-0/fundamenty-pasibus` (status w tabeli Fazy 0).

## 2. Stan obecny

### Funkcje na produkcji
| Obszar | Co działa | Źródło danych |
|---|---|---|
| Pojazdy | autobusy i tramwaje co 10 s, płynny ruch, wybór i wyróżnienie, „Śledź”, filtr typu i linii, etykiety linii od zoomu 14, przyciemnianie danych starszych niż 3 min | `get_ztm_lokalizacja_pojazdow` |
| Tabor | model, rok, rejestracja, operator, zajezdnia, miejsca, podłoga, klimatyzacja, napęd | `get_ztm_pojazdy` (cache 1 h) |
| Parkingi | znaczniki „P &lt;wolne&gt;”, panel z podziałem miejsc, cennik, godziny, telefon | `get_m_parkingi_wolne_miejsca` |
| Utrudnienia | punkty i odcinki, status trwa/zaplanowane/zakończone, link do infoulice | `get_bin_utrudnienia_drogowe` |

### Architektura
Przeglądarka (Leaflet, bez bundlera) → funkcje Vercel `/api/*` (region `fra1`, cache na krawędzi 5–3600 s) → Cloudflare Worker z tokenem → `dane.um.warszawa.pl`. Bez bazy danych i bez kont użytkowników.

### Mocne strony
- **Odporna warstwa API** (`lib/warsaw.js`): tolerancyjne parsery (goła tablica, `carParks` zamiast `Parkings`), poprawna strefa czasowa z DST, ponowienia tylko tam, gdzie mają sens, czytelne błędy z podglądem odpowiedzi.
- **Bezpieczeństwo klucza**: token tylko w Workerze, wspólny sekret między Vercel a Workerem, 405/400 dla złych żądań.
- **Testy**: jednostkowe obejmują normalizację, błędy, Worker i handlery; e2e sprawdza desktop i telefon na danych symulowanych. Tryb `MOCK=1` pozwala pracować bez klucza.
- **Koszt bliski zeru**: cache na krawędzi sprawia, że liczba zapytań do API Warszawy nie rośnie z liczbą użytkowników.
- **Spójny wygląd** (styl Strava) i mobile-first; raport z testów eksploracyjnych naprawiony w 9 z 10 punktów.

### Słabe strony i dług techniczny
| # | Problem | Gdzie | Skutek |
|---|---|---|---|
| D1 | Worker wdrażany ręcznie (wklejanie kodu) | `worker/index.js`, `CONTEXT.md` | rozjazd repo i produkcji; nowy zasób (np. `fleet`) nie działa, dopóki ktoś nie wklei kodu |
| D2 | Brak CI – testy uruchamiane tylko ręcznie | brak `.github/workflows` | regresje mogą trafić na `main` i od razu na Vercel |
| D3 | Brak monitoringu produkcji | – | awarię API lub Workera zauważa dopiero użytkownik |
| D4 | Nowy zbiór danych wymaga zmian w 6 miejscach; cztery handlery prawie identyczne | `lib/handler.js`, `api/*.js`, `dev-server.js`, `worker/index.js` | każdy kolejny zbiór jest droższy i łatwiej o pomyłkę |
| D5 | Trzy panele z powielonym CSS i logiką otwierania/zamykania | `public/style.css`, `public/app.js` | kolejny panel (przystanek, linia) powieli to po raz czwarty |
| D6 | Dokumentacja się rozjechała: README każe kopiować usunięty `.env.example`; `CONTEXT.md` podaje 34/41 testów zamiast 39/43; `README1st` zawiera tylko testową linię | `README.md`, `CONTEXT.md`, `README1st` | myli następne sesje i nowych kontrybutorów |
| D7 | Odpytywanie trwa w ukrytej karcie (wznowienie tylko przyspiesza poll) | `public/app.js` (`setInterval(poll…)`) | zbędne żądania i transfer, bateria telefonu |
| D8 | ~~Połączenie z danymi o taborze niezweryfikowane na żywym API~~ **Sprawdzone 2026-10-02:** w zbiorze jest 99,5% autobusów i 99,6% tramwajów na żywo | `CONTEXT.md` | – |
| D9 | `maxDuration` ustawione tylko dla `vehicles` i `fleet` | `vercel.json` | niespójne limity czasu dla `parking`/`incidents` |
| D10 | Pasek statusu ma `role="status"`, a tekst zmienia się co 10 s | `public/index.html` | czytnik ekranu ogłasza go bez przerwy |
| D11 | Markery niedostępne z klawiatury, brak alternatywy (lista) | `public/app.js` | aplikacja nieużywalna bez myszy/dotyku |

### Ryzyka
| Ryzyko | Prawdopodobieństwo | Wpływ | Ograniczenie |
|---|---|---|---|
| Zmiana formatu lub zachowania API Warszawy | średnie | wysoki | tolerancyjne parsery już są; dodać monitoring (D3) |
| Polityka użycia kafelków OSM przy większym ruchu | średnie | wysoki | dostawca kafelków z darmowym progiem lub własny |
| Limity planu Vercel Hobby (żądania, transfer; plan tylko do użytku niekomercyjnego) | rośnie z ruchem | średni | przy budżecie 0 zł zostajemy na Hobby: mniejsze odpowiedzi, pauza w ukrytej karcie (zrobione), bez komercjalizacji |
| Wyczerpanie darmowej puli minut GitHub Actions (repo prywatne, 2000 min/mies.) | niskie | niski | monitoring co 2 h (~360 min), testy pomijają zmiany samych `.md`; po wyczerpaniu zadania stają, bez kosztów |
| Wolne odpowiedzi API Warszawy (pierwsze pobranie zbioru taboru ok. 21 s przy limicie 25 s; pojedyncze odpowiedzi `/api/vehicles` ok. 20 s, mierzone z sesji przez jej pośrednika) | średnie | średni | monitoring zapisuje czasy odpowiedzi; jeśli się potwierdzi, dłuższy limit dla taboru |
| ~~Stary token w historii gita~~ | – | – | unieważniony (potwierdzone 2026-10-02) |

## 3. Kierunek produktu

**Dla kogo (decyzja).** Główny użytkownik to **codzienny pasażer** w Warszawie, który chce wiedzieć, gdzie jest jego autobus i czy zdąży. Miłośnik komunikacji (tabor, malowania, zajezdnie) jest obsłużony tym, co już jest w panelu pojazdu; funkcje tylko dla niego nie mają priorytetu.

**Wyróżnik.** Jakdojade i Google Maps planują podróże; wawEye ma być **najszybszym podglądem miasta na żywo**: otwierasz i od razu widzisz pojazdy, utrudnienia i parkingi na jednej mapie. Bez instalacji, bez reklam, z danymi o konkretnym pojeździe.

**Czego nie robimy (na razie):**
- planera podróży (to robią inni i wymaga ogromnej pracy),
- aplikacji natywnej (wystarczy PWA),
- kont użytkowników i bazy danych, dopóki nie wymagają tego powiadomienia lub historia,
- analityki użytkowników (decyzja: nie, także bezciasteczkowej),
- niczego, co wymaga płatnej usługi (budżet 0 zł).

## 4. Roadmapa

Rozmiar: **S** – jeden PR/sesja, **M** – 2–4 PR, **L** – wiele PR plus rozpoznanie danych. Terminy są orientacyjne.

### Faza 0 – Fundamenty (październik 2026)
Cel: każda zmiana jest testowana i wdrażana automatycznie, a awaria jest widoczna, zanim zgłosi ją użytkownik.

| Zadanie | Dlaczego | Rozmiar | Status |
|---|---|---|---|
| Potwierdzić unieważnienie starego tokenu | token jest w historii gita | S (właściciel) | zrobione (właściciel) |
| Zweryfikować dane o taborze na żywym API (D8) | ostatnia funkcja może nie działać | S | zrobione: 99,5% / 99,6% |
| CI w GitHub Actions: `npm test` + `npm run test:e2e` przy każdym PR | koniec regresji na `main` (D2) | S | zrobione (`waweye-testy.yml`, do 2026-10 `pasibus-testy.yml`) |
| Automatyczne wdrażanie Workera (`wrangler deploy` w Actions) | koniec ręcznego wklejania (D1); użytkownik nie ma CLI | S | zrobione; sekrety `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID` ustawione, działa (m.in. wdrożenie z magazynem tras 2026-10-05); ręczne wklejanie kodu niepotrzebne |
| Monitoring syntetyczny co 2 h: wszystkie `/api/*` + dopasowanie pojazdów do taboru; przy awarii issue i e-mail | wykrycie awarii (D3) w 0 zł | S | zrobione (`waweye-monitoring-produkcji.yml`) |
| Porządek w dokumentacji (D6), `maxDuration` dla wszystkich funkcji (D9) | następne sesje startują z poprawnego stanu | S | zrobione (`README1st` usunięty na prośbę właściciela) |
| Pauza odpytywania w ukrytej karcie (D7) | mniej żądań i transferu, oszczędność baterii | S | zrobione |
| Wspólny handler zasobów i wspólny komponent panelu (D4, D5) | tańsze dodawanie zbiorów w Fazie 1 i 2 | M | następny PR |
| Metro M1/M2: statyczne linie i stacje (przeniesione z Fazy 1) | luka w obrazie komunikacji; API pojazdów nie ma metra | S | zrobione 2026-10-05 (gałąź `funkcja/warstwa-metra`): linie i stacje z OSM (`scripts/metro.js`, workflow `waweye-dane-metra.yml`), bo żaden osiągalny oficjalny zbiór nie ma metra; warstwa pojawia się razem z tramwajami |

### Faza 1 – Trasy i przystanki: domknięcie pierwotnego celu (listopad 2026)
Cel: po kliknięciu pojazdu widać trasę linii i przystanki; z linku można wrócić do tego samego widoku.

| Zadanie | Dlaczego | Rozmiar |
|---|---|---|
| **Rozpoznanie źródła tras i przystanków – tylko oficjalne zbiory miasta** (decyzja). Najlepszy kandydat (2026-10-05): **oficjalny GTFS ZTM** (`https://gtfs.ztm.waw.pl/last`, FTP `gtfs.ztm.waw.pl`; zasady na ztm.waw.pl → Pliki do pobrania → Dane rozkładowe pozwalają przetwarzać i publikować dane). Ma `routes`, `trips`, `stops`, `shapes` (kształty tras!) i `stop_times` (~380 MB), autobusy, tramwaje i koleje, **bez metra**. Przeszkoda: serwer nie odpowiada ani z sandboxa, ani z GitHub Actions; trzeba pobierać z Polski albo przez pośrednika w Europie i ciąć do małych plików per linia. Do sprawdzenia też `dane.um.warszawa.pl`: odpowiedniki starych `public_transport_routes` i `dbtimetable_get` | bez tego nie ma tras ani odjazdów; po dodaniu domeny do środowiska rozpoznanie da się zrobić w sesji | M |
| Dane linii z długim cache (zbiory rozkładowe zmieniają się rzadko): endpoint przez Workera z cache na krawędzi na dobę, ewentualnie pliki JSON per linia generowane raz dziennie w Actions | bez bazy danych i w darmowych progach | M |
| Trasa wybranej linii na mapie + przystanki na trasie | pierwotny wymóg produktu | M – **zrobione 2026-10-05** (gałąź `funkcja/trasa-wybranej-linii`): GTFS ZTM pobrany ręcznie, `scripts/trasy.js` → `public/data/trasy/`, kierunek z ruchu pojazdu |
| **Automatyczne odświeżanie tras z GTFS ZTM** | rozkład w GTFS obejmuje ok. 10 dni, a zasady ZTM wymagają aktualności | M – **zrobione 2026-10-05** (gałąź `funkcja/automatyczne-odswiezanie-tras`): sonda pokazała, że GTFS odpowiada tylko z Europy (Vercel fra1, Worker w FRA), a z USA nie (Worker w ATL: 522); cron Vercel raz na dobę → Cloudflare KV przez Workera, aplikacja czyta `/api/trasa`, pliki w repo jako zapas |
| Warstwa przystanków (od zoomu ~15) z panelem: nazwa, linie | punkt wyjścia do odjazdów w Fazie 2 | M |
| Linki do stanu (`?linia=175`, `?pojazd=1-1234`) | udostępnianie („gdzie jest mój autobus”), zakładki | S |

### Faza 2 – Codzienny pasażer (grudzień 2026 – styczeń 2027)
Cel: aplikację da się zainstalować na telefonie i używać codziennie do sprawdzania „swoich” linii.

| Zadanie | Dlaczego | Rozmiar |
|---|---|---|
| PWA: manifest, ikony, service worker dla powłoki aplikacji | instalacja na ekranie głównym, szybszy start | S |
| Ulubione linie i przystanki (localStorage) + szybki filtr | codzienne użycie w jednym kliknięciu | S |
| „Pokaż mnie” (geolokalizacja) + najbliższe przystanki | naturalny start na telefonie | S – lokalizacja zrobiona (przycisk jak w Google Maps, gałąź `feat/lokalizacja-uzytkownika-na-mapie`); najbliższe przystanki po warstwie przystanków z Fazy 1 |
| Odjazdy z przystanku: rozkład + pojazdy na żywo zbliżające się do przystanku | odpowiedź na „kiedy przyjedzie” | L |
| Szacowanie opóźnienia pojazdu (dopasowanie linii i brygady do rozkładu) | najczęściej oczekiwana informacja | L |
| Pozycje składów metra (szacowane z rozkładu, pokazywane razem z tramwajami) | prośba właściciela 2026-10-05; dziś mapa ma tylko linie i stacje | M – **zablokowane**: brak oficjalnego źródła pozycji i rozkładu metra (API pojazdów i GTFS ZTM go nie mają); bez społecznościowego GTFS |
| Filtr dostępności z danych o taborze: niskopodłogowe, klimatyzacja, miejsca na wózek | wartość dla osób z niepełnosprawnościami i z wózkami; dane już są | S |
| Utrudnienia: domyślnie ukryte zakończone, grupowanie gęstych znaczników | czytelność mapy | S |
| Dostępność: status ogłaszany tylko przy błędzie (D10), lista pojazdów linii obsługiwana klawiaturą (D11), testy e2e także w WebKit i Firefox | iOS/Safari to duża część telefonów; czytniki ekranu | M |

### Faza 3 – Kontekst miasta i skala (I–II kwartał 2027)
Cel: wawEye wytrzymuje większy ruch i łączy komunikację z innymi danymi miejskimi.

| Zadanie | Dlaczego | Rozmiar |
|---|---|---|
| Kafelki zgodne z polityką OSM przy większym ruchu: tylko darmowe opcje (darmowy próg dostawcy dla projektów niekomercyjnych), opcjonalnie ciemny motyw mapy | zgodność z polityką OSM przy budżecie 0 zł | S |
| Mniejsze odpowiedzi `/api/vehicles` (format tablicowy, zaokrąglone współrzędne, opcjonalnie tylko zmiany) | transfer i limity Vercel rosną liniowo z użytkownikami | M |
| Powiązanie utrudnień z liniami (bliskość geometrii utrudnienia do trasy) | „czy to utrudnienie dotyczy mojej linii?” | M |
| Veturilo / rowery miejskie (publiczny feed GBFS) | pierwszy i ostatni kilometr | M |
| Powiadomienia push o utrudnieniach na ulubionych liniach (Web Push działa też w PWA na iOS) | wymaga przechowywania subskrypcji – tylko jeśli zmieści się w darmowym progu (np. Cloudflare KV/D1) | L |
| Historia i punktualność linii (migawki w Cloudflare D1/R2 przez cron) | niski priorytet: bardziej dla miłośników niż pasażerów; tylko w darmowych progach | L |

### Pomysły na później (bez zobowiązań)
Mapa cieplna punktualności, porównanie linii w czasie, „najstarszy tabor na mieście” i inne treści dla miłośników, tryb kiosku/tablicy dla przystanków lub biur.

## 5. Mierniki sukcesu

Decyzja: **bez analityki użytkowników**. Mierzymy wyłącznie technicznie – monitoring produkcji (`scripts/check-production.js`) i panel zużycia Vercel (liczba wywołań funkcji, transfer) jako przybliżenie ruchu, bez śledzenia osób.

| Miernik | Źródło | Cel orientacyjny |
|---|---|---|
| Kontrole produkcji zakończone sukcesem | monitoring (Actions) | > 99% |
| Czas wykrycia awarii (od wystąpienia do e-maila z issue) | monitoring | ≤ 2 h (co 2 h, w budżecie minut) |
| Czas odpowiedzi `/api/vehicles` | raport monitoringu | < 3 s |
| Dopasowanie pojazdów na żywo do zbioru taboru | monitoring | > 90% (dziś 99,5%) |
| Transfer i wywołania funkcji na miesiąc | panel Vercel | w limitach planu Hobby |

## 6. Decyzje właściciela produktu i ich skutki

| Decyzja (2026-10-02) | Skutek dla roadmapy |
|---|---|
| Grupa docelowa: **codzienni pasażerowie** | Faza 1 i 2 bez zmian (trasy, odjazdy, ulubione, PWA). Funkcje dla miłośników (historia, statystyki taboru) spadają na koniec. |
| Rozkłady **tylko z oficjalnych zbiorów** miasta | Bez społecznościowego GTFS. Jeśli miasto nie publikuje kształtu tras, trasa jest linią przez kolejne przystanki. Szacowanie opóźnień zależy od tego, czy oficjalne rozkłady mają brygady. |
| Budżet **0 zł** | Zostajemy na Vercel Hobby (bez komercjalizacji), kafelki tylko w darmowych opcjach, monitoring co 2 h zamiast co kilka minut (pula minut Actions), push i historia tylko w darmowych progach. Mniejsze odpowiedzi API (Faza 3) zyskują na znaczeniu. |
| **Bez analityki** | Mierniki wyłącznie techniczne (sekcja 5). O priorytetach decydują rozmowy z użytkownikami i zgłoszenia, nie dane o użyciu. |
| **Dodać `dane.um.warszawa.pl`** do środowiska sesji | Rozpoznanie oficjalnych zbiorów tras i przystanków (pierwsze zadanie Fazy 1) da się zrobić w sesji. Zmiana działa w nowych sesjach. |
| Stary token **unieważniony** | Ryzyko zamknięte. |
