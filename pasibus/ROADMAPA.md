# Pasibus – analiza produktu i roadmapa

Data: 2026-10-02. Na podstawie kodu z `main` (po PR #18), `README.md`, `CONTEXT.md` i `RAPORT_TESTOW_EKSPLORACYJNYCH.md`. Testy w dniu analizy: `npm test` – 39/39, `npm run test:e2e` – 43/43 (dane MOCK).

## 1. W skrócie

Pasibus to lekka mapa komunikacji miejskiej Warszawy na żywo. Od zera do produkcji (https://pasibus.vercel.app) powstał w dwa dni. Pokazuje autobusy i tramwaje, parkingi z wolnymi miejscami, utrudnienia drogowe i dane o taborze. Kod jest mały (ok. 1 700 linii razem z testami), dobrze przetestowany i odporny na kaprysy API Warszawy.

Najważniejsze wnioski:

1. **Pierwotny cel nie jest domknięty.** Zaznaczenie pojazdu miało pokazywać całą trasę linii, a to jest zaparkowane. Bez tras i przystanków aplikacja odpowiada na pytanie „gdzie jest pojazd”, ale nie „kiedy przyjedzie mój”. Od tego zależy codzienna użyteczność dla pasażera.
2. **Fundamenty operacyjne są ręczne.** Worker Cloudflare wkleja się ręcznie, testy nie są uruchamiane automatycznie przy PR, nikt nie monitoruje produkcji. Przy każdym nowym zbiorze danych rośnie ryzyko rozjazdu między repo a tym, co działa.
3. **Skalowanie ma ukryte limity.** Kafelki z `tile.openstreetmap.org` nie są przeznaczone do aplikacji z dużym ruchem, a odpytywanie co 10 s (ok. 37 KB na odpowiedź) zużywa limity żądań i transferu Vercel proporcjonalnie do liczby użytkowników.

Proponowana kolejność: **fundamenty (Faza 0) → trasy i przystanki (Faza 1) → funkcje dla codziennego pasażera (Faza 2) → kontekst miasta i skala (Faza 3)**.

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
| D8 | Połączenie z danymi o taborze niezweryfikowane na żywym API | `CONTEXT.md` | panel może pokazywać „brak w zbiorze” dla wszystkich pojazdów |
| D9 | `maxDuration` ustawione tylko dla `vehicles` i `fleet` | `vercel.json` | niespójne limity czasu dla `parking`/`incidents` |
| D10 | Pasek statusu ma `role="status"`, a tekst zmienia się co 10 s | `public/index.html` | czytnik ekranu ogłasza go bez przerwy |
| D11 | Markery niedostępne z klawiatury, brak alternatywy (lista) | `public/app.js` | aplikacja nieużywalna bez myszy/dotyku |

### Ryzyka
| Ryzyko | Prawdopodobieństwo | Wpływ | Ograniczenie |
|---|---|---|---|
| Zmiana formatu lub zachowania API Warszawy | średnie | wysoki | tolerancyjne parsery już są; dodać monitoring (D3) |
| Polityka użycia kafelków OSM przy większym ruchu | średnie | wysoki | dostawca kafelków z darmowym progiem lub własny |
| Limity planu Vercel Hobby (żądania, transfer; plan tylko do użytku niekomercyjnego) | rośnie z ruchem | średni | mniejsze odpowiedzi, pauza w ukrytej karcie, decyzja o planie |
| Stary token w historii gita | – | wysoki | potwierdzić, że został unieważniony na portalu |

## 3. Kierunek produktu

**Dla kogo.** Główny użytkownik to pasażer w Warszawie, który chce wiedzieć, gdzie jest jego autobus i czy zdąży. Drugi to miłośnik komunikacji (tabor, malowania, zajezdnie), którego już dziś obsługuje panel pojazdu.

**Wyróżnik.** Jakdojade i Google Maps planują podróże; Pasibus ma być **najszybszym podglądem miasta na żywo**: otwierasz i od razu widzisz pojazdy, utrudnienia i parkingi na jednej mapie. Bez instalacji, bez reklam, z danymi o konkretnym pojeździe.

**Czego nie robimy (na razie):**
- planera podróży (to robią inni i wymaga ogromnej pracy),
- aplikacji natywnej (wystarczy PWA),
- kont użytkowników i bazy danych, dopóki nie wymagają tego powiadomienia lub historia.

## 4. Roadmapa

Rozmiar: **S** – jeden PR/sesja, **M** – 2–4 PR, **L** – wiele PR plus rozpoznanie danych. Terminy są orientacyjne.

### Faza 0 – Fundamenty (październik 2026)
Cel: każda zmiana jest testowana i wdrażana automatycznie, a awaria jest widoczna, zanim zgłosi ją użytkownik.

| Zadanie | Dlaczego | Rozmiar |
|---|---|---|
| Potwierdzić unieważnienie starego tokenu | token jest w historii gita | S (właściciel) |
| Zweryfikować dane o taborze na żywym API (D8) | ostatnia funkcja może nie działać | S |
| CI w GitHub Actions: `npm test` + `npm run test:e2e` przy każdym PR | koniec regresji na `main` (D2) | S |
| Automatyczne wdrażanie Workera (`wrangler deploy` w Actions, sekret `CLOUDFLARE_API_TOKEN`) + nagłówek z wersją Workera | koniec ręcznego wklejania (D1); użytkownik nie ma CLI | S |
| Monitoring syntetyczny: cykliczne zapytanie do `/api/vehicles` i alert, gdy `received = 0` lub błąd | szybkie wykrycie awarii (D3) | S |
| Porządek w dokumentacji (D6), `maxDuration` dla wszystkich funkcji (D9) | następne sesje startują z poprawnego stanu | S |
| Pauza odpytywania w ukrytej karcie (D7) | mniej żądań i transferu, oszczędność baterii | S |
| Wspólny handler zasobów i wspólny komponent panelu (D4, D5) | tańsze dodawanie zbiorów w Fazie 1 i 2 | M |

### Faza 1 – Trasy i przystanki: domknięcie pierwotnego celu (listopad 2026)
Cel: po kliknięciu pojazdu widać trasę linii i przystanki; z linku można wrócić do tego samego widoku.

| Zadanie | Dlaczego | Rozmiar |
|---|---|---|
| **Rozpoznanie źródła tras i przystanków.** Kandydaci do sprawdzenia: zbiory rozkładowe ZTM na `dane.um.warszawa.pl` (w starym API były m.in. `public_transport_routes` i `dbtimetable_get`) albo GTFS Warszawy z kształtami tras (`shapes.txt`) | bez tego nie ma tras ani odjazdów; wcześniej zablokowane brakiem dostępu do portalu z sesji | M |
| Statyczne dane linii generowane raz dziennie (Actions → pliki JSON per linia: przebieg + przystanki) | trasy zmieniają się rzadko; nie potrzeba bazy ani nowych funkcji serwerowych | M |
| Trasa wybranej linii na mapie + przystanki na trasie | pierwotny wymóg produktu | M |
| Warstwa przystanków (od zoomu ~15) z panelem: nazwa, linie | punkt wyjścia do odjazdów w Fazie 2 | M |
| Linki do stanu (`?linia=175`, `?pojazd=1-1234`) | udostępnianie („gdzie jest mój autobus”), zakładki | S |
| Metro M1/M2: statyczne linie i stacje (OSM, licencja ODbL) | luka w obrazie komunikacji; API pojazdów nie ma metra | S |

### Faza 2 – Codzienny pasażer (grudzień 2026 – styczeń 2027)
Cel: aplikację da się zainstalować na telefonie i używać codziennie do sprawdzania „swoich” linii.

| Zadanie | Dlaczego | Rozmiar |
|---|---|---|
| PWA: manifest, ikony, service worker dla powłoki aplikacji | instalacja na ekranie głównym, szybszy start | S |
| Ulubione linie i przystanki (localStorage) + szybki filtr | codzienne użycie w jednym kliknięciu | S |
| „Pokaż mnie” (geolokalizacja) + najbliższe przystanki | naturalny start na telefonie | S |
| Odjazdy z przystanku: rozkład + pojazdy na żywo zbliżające się do przystanku | odpowiedź na „kiedy przyjedzie” | L |
| Szacowanie opóźnienia pojazdu (dopasowanie linii i brygady do rozkładu) | najczęściej oczekiwana informacja | L |
| Filtr dostępności z danych o taborze: niskopodłogowe, klimatyzacja, miejsca na wózek | wartość dla osób z niepełnosprawnościami i z wózkami; dane już są | S |
| Utrudnienia: domyślnie ukryte zakończone, grupowanie gęstych znaczników | czytelność mapy | S |
| Dostępność: status ogłaszany tylko przy błędzie (D10), lista pojazdów linii obsługiwana klawiaturą (D11), testy e2e także w WebKit i Firefox | iOS/Safari to duża część telefonów; czytniki ekranu | M |

### Faza 3 – Kontekst miasta i skala (I–II kwartał 2027)
Cel: Pasibus wytrzymuje większy ruch i łączy komunikację z innymi danymi miejskimi.

| Zadanie | Dlaczego | Rozmiar |
|---|---|---|
| Własny lub komercyjny dostawca kafelków (np. z darmowym progiem), opcjonalnie ciemny motyw mapy | zgodność z polityką OSM przy ruchu | S |
| Mniejsze odpowiedzi `/api/vehicles` (format tablicowy, zaokrąglone współrzędne, opcjonalnie tylko zmiany) | transfer i limity Vercel rosną liniowo z użytkownikami | M |
| Powiązanie utrudnień z liniami (bliskość geometrii utrudnienia do trasy) | „czy to utrudnienie dotyczy mojej linii?” | M |
| Veturilo / rowery miejskie (publiczny feed GBFS) | pierwszy i ostatni kilometr | M |
| Powiadomienia push o utrudnieniach na ulubionych liniach (Web Push działa też w PWA na iOS) | wymaga przechowywania subskrypcji – pierwsza potrzeba backendu z danymi | L |
| Historia i punktualność linii (zapisywanie migawek np. w Cloudflare D1/R2 przez cron) | treści dla mediów/miłośników, przewaga nad konkurencją | L |

### Pomysły na później (bez zobowiązań)
Mapa cieplna punktualności, porównanie linii w czasie, „najstarszy tabor na mieście” i inne treści dla miłośników, tryb kiosku/tablicy dla przystanków lub biur.

## 5. Mierniki sukcesu

Dziś aplikacja nie zbiera żadnych danych o użyciu. Proponuję analitykę bez ciasteczek (np. Vercel Web Analytics lub Plausible – bez banera zgody) i śledzenie:

| Miernik | Cel orientacyjny |
|---|---|
| Czas do pierwszych pojazdów na mapie (p75) | < 3 s |
| Udział udanych odświeżeń `/api/vehicles` | > 99 % |
| Czas wykrycia awarii API (od wystąpienia do alertu) | < 15 min |
| Użytkownicy wracający w ciągu 7 dni | rośnie po Fazie 2 (PWA, ulubione) |
| Użycie funkcji: kliknięcie pojazdu, „Śledź”, parkingi, utrudnienia, trasy | pokazuje, w co inwestować dalej |

## 6. Decyzje do podjęcia przez właściciela produktu

1. **Główna grupa docelowa:** codzienni pasażerowie (priorytet: odjazdy, ulubione, PWA) czy miłośnicy komunikacji (priorytet: tabor, historia)? Roadmapa zakłada pasażerów.
2. **Źródło rozkładów:** tylko oficjalne zbiory miasta czy także społecznościowy GTFS, jeśli jest pełniejszy?
3. **Budżet:** czy zostajemy przy 0 zł (Vercel Hobby, darmowe progi), czy dopuszczamy kilka–kilkanaście dolarów miesięcznie za kafelki i plan Vercel przy większym ruchu? Plan Hobby wyklucza użycie komercyjne.
4. **Analityka:** zgoda na analitykę bez ciasteczek?
5. **Dostęp do API z sesji:** dodanie `dane.um.warszawa.pl` do dozwolonych domen środowiska znacznie przyspieszy Fazę 1 (rozpoznanie zbiorów rozkładowych).
