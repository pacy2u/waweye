# wawEye – komunikacja miejska w Warszawie na żywo

Nazwa produktu od 3 października 2026 r.: **wawEye** (wcześniej Pasibus, zmieniona z powodu kolizji z siecią burgerowni o tej nazwie). Migracja identyfikatorów technicznych trwa według `PLAN_MIGRACJI_WAWEYE.md`: aplikacja działa pod https://waweye.vercel.app i pod dotychczasowym https://pasibus.vercel.app; produkcja korzysta z Workera `waweye-proxy`, a aplikacja i workflowy mają już nowe nazwy (folder `waweye/`, „wawEye – …”). Projekt w Vercel nazywa się `waweye`, repozytorium `pacy2u/waweye` (do 2026-10 `pacy2u/tst`; GitHub przekierowuje stare adresy). Stary adres https://pasibus.vercel.app działa dalej i w Fazie 9 zacznie przekierowywać na nowy.

Mapa pojazdów (autobusy, tramwaje) w czasie rzeczywistym, z liniami i stacjami metra. Dane: [Lokalizacja pojazdów komunikacji miejskiej](https://dane.um.warszawa.pl/pl/catalogue/f319f602-7292-4e8c-b3d1-f5898aa9a638), m.st. Warszawa. Mapa: OpenStreetMap + Leaflet.

Funkcje: zoom (przyciski, scroll, pinch), odświeżanie co 10 s z płynnym ruchem pojazdów, kliknięcie pojazdu wyróżnia go (pomarańczowy pierścień, reszta wyszarzona) i pokazuje panel ze szczegółami, tryb „Śledź”, przycisk ⌄ obok × zwija panel do jednego paska (linia, kierunek, „Śledź”), żeby odsłonić mapę, a stuknięcie paska go rozwija (wybór zapamiętany w przeglądarce i wspólny dla wszystkich paneli: parkingów, utrudnień, stref, metra, sportu i wydarzeń, które zwijają się do nazwy; na telefonie włączenie „Śledź” też zwija panel), filtr typu i linii. Przyciski typów to same ikony (autobus, tory, metro, P, znak ostrzegawczy), nazwy są w podpowiedzi i dla czytników ekranu. Przycisk **Metro** (ikona „M”) pokazuje linie M1 (niebieska) i M2 (czerwona) oraz 38 stacji jako białe kółka; kliknięcie stacji otwiera panel z nazwą, liniami i kierunkami. Warstwa pojawia się i znika razem z tramwajami, chyba że ukryjesz ją przyciskiem (wybór zapamiętany w przeglądarce). Pozycji pociągów metra nie ma, bo nie publikuje ich żaden oficjalny zbiór. Przycisk **lokalizacji** w prawym dolnym rogu (jak w Google Maps) pokazuje pozycję użytkownika niebieską kropką z okręgiem dokładności i przybliża do niej mapę; mapa podąża za użytkownikiem, dopóki jej nie przesunie (ikona z niebieskiej robi się szara, kolejne kliknięcie znów centruje). Na telefonach z kompasem (Android) kropka ma wiązkę pokazującą kierunek, w czasie jazdy kierunek z GPS. Pozycja nie opuszcza przeglądarki. Przycisk **Parking** (ikona P) pokazuje na mapie parkingi z liczbą wolnych miejsc (zielony: są wolne, czerwony: brak); po kliknięciu panel z wolnymi miejscami z podziałem na standardowe/dla niepełnosprawnych/elektryczne, pojemnością, godzinami, cennikiem i telefonem (zbiór „Wolne miejsca parkingowe”, odświeżany co minutę). Przycisk **Utrudnienia** (ikona ostrzeżenia) pokazuje utrudnienia w ruchu drogowym: punkty jako znaczniki, odcinki jako linie na mapie (żółte: trwają, niebieskoszare: zaplanowane, szare: zakończone); panel z opisem, datami i linkiem do infoulice.um.warszawa.pl. Po kliknięciu pojazdu panel pokazuje też dane ze zbioru [Pojazdy transportu publicznego](https://dane.um.warszawa.pl/pl/catalogue/a8295279-8bd5-4fec-8352-d7a7b96dc129): model, rok produkcji, nr rejestracyjny, operatora, zajezdnię, liczbę miejsc, wymiary, podłogę, klimatyzację, napęd, malowanie (łączone po numerze taborowym = numer pojazdu z lokalizacji). Przycisk **Sport** (ikona biegacza) pokazuje zajęcia sportowe z miejskiego kalendarza ([Zajęcia sportowe](https://dane.um.warszawa.pl/pl/catalogue/911aa2e8-d021-4dab-b5ff-751079cf902c), aktualizacja co 2 h) z filtrem Dziś / Jutro / 7 dni; jeden znacznik na miejsce z liczbą zajęć, panel z listą zajęć i linkiem do zapisów. Zajęcia bez punktu na mapie są umieszczane według adresu (OpenStreetMap Nominatim). Przycisk **DziejeSię** (ikona biletu) pokazuje wydarzenia z miejskiego [Kalendarza wydarzeń](https://dane.um.warszawa.pl/pl/catalogue/ba202e4b-dfa9-440c-83c0-0b3517520cb8) (aktualizacja co 2 h); wspólny z Sportem filtr Dziś / Jutro / 7 dni, znacznik w każdym miejscu wydarzenia, panel z terminem, opisem, organizatorem i linkiem do um.warszawa.pl. Po kliknięciu autobusu lub tramwaju na mapie pojawia się **trasa jego linii** z przystankami (nazwa po najechaniu lub dotknięciu), a panel podaje kierunek. Kierunek wynika z ruchu pojazdu wzdłuż trasy; dopóki pojazd nie ruszy, widać oba kierunki. Panel pokazuje też, do kiedy ważny jest rozkład, z którego pochodzi trasa, i ostrzega, gdy ta data minęła. Przycisk **Timelapse** (ikona zegara ze strzałką) pokazuje **przewidywany** ruch pojazdów w przyspieszonym tempie (`public/prognoza.js`): od najnowszych danych każdy pojazd jedzie dalej po trasie swojej linii, w kierunku, w którym się poruszał, ze średnią prędkością (autobus ok. 20 km/h, tramwaj ok. 18 km/h, z przystankami), a na pętli czeka 4 min i wraca. To przybliżenie bez rozkładu jazdy (API nie podaje kursów). Pojazdy bez trasy albo daleko od niej stoją w miejscu, wyblakłe. Suwak **Tempo** ma skalę 0–100, a mnożnik upływu czasu zmienia się logarytmicznie od ×0 (pauza) przez ×1 (pozycja 1), ×10, ×100 (pozycja 67) do ×1000 (wybór zapamiętany w przeglądarce). Suwak **Czas** przesuwa widok do 24 h naprzód i pokazuje godzinę (hh:mm:ss, czas warszawski), której dotyczy mapa; przesunięcie względem teraz (np. „+13 h 05 min”) jest w nagłówku karty. ↻ odświeża dane i liczy prognozę od nowa. Zamknięcie karty (× albo ponowne kliknięcie ikony) wraca do czasu rzeczywistego, w którym znów można wybrać pojazd i zobaczyć jego trasę; kliknięcie pojazdu w timelapse też wraca na żywo i wybiera ten pojazd razem z trasą. Panel otwarty na karcie (np. parking na telefonie) tylko ją zasłania, a prognoza trwa dalej.

## Źródło danych
API ZTM na nowym portalu: `POST https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow`, token w nagłówku `Authorization`, treść `{"type": 1}` (autobusy) lub `{"type": 2}` (tramwaje). Token generuje się na https://dane.um.warszawa.pl/key-api. Stary adres `api.um.warszawa.pl` z parametrem `apikey` nie przyjmuje tych tokenów.

Parkingi: `POST https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca` (ten sam token w `Authorization`, bez treści); odpowiedź `{"Parkings": [...]}`. Utrudnienia: `POST …/get_bin_utrudnienia_drogowe`, token w `Authorization`, odpowiedź to lista z polami `name`, `start_date`, `end_date`, `content`, `id`, `geo`. Dane o pojazdach: `POST …/get_ztm_pojazdy` (token w `Authorization`, bez treści), odpowiedź `{busy, tramwaje, markiBus, markiTramwaje, …}`; `/api/fleet` zwraca z niej tylko autobusy i tramwaje (cache 1 h). W trybie z Workerem Worker obsługuje zasoby `?type=1|2`, `?resource=parking`, `?resource=incidents`, `?resource=fleet` i `?resource=gtfs` (oficjalny GTFS ZTM przekazywany strumieniem; `&probe=1` zwraca tylko status, rozmiar, datę pliku i lokalizację Cloudflare). Czy GTFS da się pobrać przez Workera, pokazują: krok „GTFS ZTM przez Workera” w workflow wdrożenia Workera (zapytanie z GitHub Actions), operacja `test-gtfs` w workflow operacji Cloudflare oraz `/api/sprawdz-gtfs` (zapytanie z Vercel fra1: przez Workera i bezpośrednio). Kod Workera wdraża się automatycznie (patrz „Automatyczne wdrażanie Workera”).

Metro: API pojazdów i oficjalny GTFS ZTM (`https://gtfs.ztm.waw.pl/last`) nie zawierają metra, więc linie i stacje są z OpenStreetMap (relacje `route=subway` M1 i M2, licencja ODbL, atrybucja „© współtwórcy OpenStreetMap” na mapie). Plik `public/data/metro.geojson` tworzy `scripts/metro.js` w workflow **wawEye – dane metra (M1, M2)** (`waweye-dane-metra.yml`, na żądanie albo po zmianie skryptu), który sam commituje plik po kontroli: dokładnie 2 linie, M1 = 21 i M2 = 18 stacji (stan na październik 2026), Centrum i Świętokrzyska w Śródmieściu, wszystko w granicach Warszawy. Przy niezgodności przebieg kończy się błędem, a plik zostaje bez zmian. Lokalnie: `node scripts/metro.js [zapisana-odpowiedź-overpass.json]`.

Trasy linii: oficjalny GTFS ZTM (`https://gtfs.ztm.waw.pl/last`; zasady ZTM na ztm.waw.pl → Pliki do pobrania → Dane rozkładowe pozwalają przetwarzać i publikować dane, pod warunkiem dbania o ich aktualność). **Odświeżane automatycznie raz na dobę**: cron w Vercel (`vercel.json`, 2:00 UTC) woła `/api/odswiez-trasy`, które w regionie fra1 pobiera ZIP (ok. 52 MB; serwer GTFS nie odpowiada z USA, więc nie z GitHub Actions), rozpakowuje go strumieniowo (`lib/zip.js`), buduje trasy kodem `scripts/trasy.js` z tą samą kontrolą (m.in. co najmniej 250 linii, 175/17/N25, przebieg i przystanki) i zapisuje w magazynie Cloudflare KV przez Workera (`?resource=trasy`) tylko linie, które się zmieniły, a na końcu klucz z datą odświeżenia. Złe dane nie zmieniają magazynu. Aplikacja czyta trasę z `/api/trasa?linia=175` (CDN 1 h), a gdy magazyn nie odpowiada albo nie ma linii, z plików `public/data/trasy/<linia>.json` (zapas; ręcznie: `node scripts/trasy.js <folder GTFS>`). Bez `CRON_SECRET` w Vercel odświeżenie może wywołać każdy, ale nic nie robi częściej niż co 12 h; po ustawieniu `CRON_SECRET` wymaga go. Monitoring sprawdza `/api/trasa?meta=1` (alarm, gdy trasy są starsze niż 48 h albo rozkład wygasł).

## Uruchomienie lokalne
```bash
cd waweye
npm install
echo 'WARSAW_API_KEY=<token>' > .env   # token z https://dane.um.warszawa.pl/key-api
npm start                 # http://localhost:3000
MOCK=1 npm start          # dane symulowane, bez klucza
```

## Testy
```bash
npm test          # jednostkowe: normalizacja, błędy API, handler, operacje Vercel/Cloudflare
npm run test:e2e  # przeglądarka (Chromium, desktop + mobile) na danych symulowanych
node scripts/check-production.js   # kontrola produkcji: pojazdy, parkingi, utrudnienia, tabor
```
W GitHub Actions (`.github/workflows/`):
- **wawEye – testy**: oba zestawy testów przy każdym PR i po zmianie na `main` (zmiany samych plików `.md` nie zużywają minut).
- **wawEye – monitoring produkcji**: co 2 godziny `scripts/check-production.js` sprawdza https://waweye.vercel.app i https://pasibus.vercel.app (także to, czy pojazdy na żywo znajdują się w zbiorze taboru). Przy awarii zakłada jedno zgłoszenie (issue) „[monitoring] wawEye nie działa poprawnie”, a GitHub wysyła e-mail. GitHub uruchamia zaplanowane przebiegi z opóźnieniem albo je pomija (2026-10-03: 4 przebiegi w 17 godzin), więc odstępy bywają dłuższe niż 2 godziny. Po pierwszej udanej kontroli zgłoszenie zamyka się samo. Ręcznie: Actions → wawEye – monitoring produkcji → Run workflow.
- Repo jest prywatne, więc obowiązuje darmowa pula minut Actions (2000 min/mies. na koncie GitHub Free). Monitoring zużywa ok. 360 min/mies., testy kilka minut na PR. Po wyczerpaniu puli zadania się zatrzymują, nie generując kosztów (przy domyślnym limicie wydatków 0 USD).

## Wdrożenie na Vercel
1. Vercel → **Add New → Project** → importuj repo `pacy2u/waweye`.
2. **Root Directory**: `waweye` (do 2026-10 `pasibus`). Framework: *Other*.
3. **Settings → Environment Variables**: `WARSAW_API_KEY` = token API z https://dane.um.warszawa.pl/key-api (Production + Preview).
4. **Deploy**. Aplikacja działa pod adresem `*.vercel.app` na komputerze i telefonie.

Klucz jest tylko po stronie serwera (`api/vehicles.js`); przeglądarka nigdy go nie widzi. Odpowiedzi są cache'owane na krawędzi przez 5 s, więc wielu użytkowników nie przeciąża API.

## Pośrednik Cloudflare Worker (gdy Vercel nie łączy się z API Warszawy)
Stary host `api.um.warszawa.pl` nie przyjmował połączeń z adresów Vercel/AWS (`UND_ERR_CONNECT_TIMEOUT`); jeśli nowy host zachowuje się tak samo, a przeglądarka nie może pytać API wprost (brak CORS). Rozwiązanie: Worker w Cloudflare trzyma klucz i odpytuje Warszawę, a funkcja Vercel pyta Worker.

1. Konto na cloudflare.com (darmowe) → **Workers & Pages → Create → Create Worker**, nazwa `waweye-proxy` (do 2026-10 `pasibus-proxy`), Deploy.
2. **Edit code**: wklej zawartość `worker/index.js`, Deploy. (Tylko przy pierwszym założeniu Workera; potem kod wdraża workflow opisany niżej.)
3. **Settings → Variables and Secrets** (typ *Secret*): `WARSAW_API_KEY` = token API z https://dane.um.warszawa.pl/key-api, `PROXY_SECRET` = dowolny długi losowy ciąg.
4. W Vercel (**Settings → Environment Variables**) dodaj: `UPSTREAM_URL` = adres Workera (`https://waweye-proxy.<konto>.workers.dev`), `UPSTREAM_SECRET` = ten sam ciąg co `PROXY_SECRET`. Zrób **Redeploy**.

(Alternatywa z CLI: `cd worker && npx wrangler deploy`, potem `npx wrangler secret put WARSAW_API_KEY` i `PROXY_SECRET`.)

### Automatyczne wdrażanie Workera (bez wklejania kodu)
Workflow **wawEye – wdrożenie Workera Cloudflare** wdraża `worker/` po każdym merge'u zmian w tym folderze do `main`. Jednorazowa konfiguracja w przeglądarce:
1. Cloudflare → **My Profile → API Tokens → Create Token** → szablon **Edit Cloudflare Workers** → Create. Skopiuj token.
2. Cloudflare → **Workers & Pages**: skopiuj **Account ID** (prawa kolumna).
3. GitHub → repo `pacy2u/waweye` → **Settings → Secrets and variables → Actions → New repository secret**: `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID`.
4. **Actions → wawEye – wdrożenie Workera Cloudflare → Run workflow**, żeby od razu wgrać aktualny kod.

Przed wdrożeniem workflow znajduje albo tworzy przestrzeń Cloudflare KV `waweye-geokody` (magazyn współrzędnych adresów dla Sportu i DziejeSię) i podpina ją jako `GEOKODY`. Token z szablonu **Edit Cloudflare Workers** ma do tego uprawnienie (Workers KV Storage: Edit); bez niego Worker wdroży się bez magazynu, a aplikacja będzie szukać adresów tylko w Nominatim. Wdrożenie nie zmienia sekretów Workera (`WARSAW_API_KEY`, `PROXY_SECRET`), a `keep_vars = true` w `wrangler.toml` zachowuje zmienne ustawione w panelu. Bez sekretów workflow kończy się ostrzeżeniem i trzeba wkleić kod ręcznie jak wyżej.

**Stan (2026-10-05):** sekrety są ustawione i workflow działa, więc **kodu Workera nie wkleja się już ręcznie**. Nie klikaj też **Deploy** w edytorze Cloudflare: wdrożenie stamtąd starszej albo wklejonej wersji nadpisałoby to, co wgrał workflow, a następne wdrożenie z repo i tak by ją zastąpiło. Gdy automatyczne uruchomienie utknie w kolejce GitHub Actions (zdarzyło się 2026-10-05: zadania czekały 15 min na serwer i były anulowane), uruchom je ponownie: **Re-run all jobs** w przebiegu albo **Actions → wawEye – wdrożenie Workera Cloudflare → Run workflow**. Po wdrożeniu workflow sprawdza też GTFS ZTM przez Workera; wynik „NIE działa” z lokalizacji w USA jest oczekiwany (trasy odświeża Vercel we Frankfurcie).

## Operacje w Vercel i Cloudflare bez panelu (workflowy na żądanie)
Zmiany w projekcie Vercel i Workerach Cloudflare robią workflowy uruchamiane ręcznie (**Actions → workflow → Run workflow**). Aplikacja Claude na GitHubie nie może uruchamiać workflowów, więc Claude podaje parametry, a potem sam odczytuje wynik przebiegu. Tokeny są tylko w sekretach repozytorium. Logika: `scripts/vercel-ops.js` i `scripts/cloudflare-ops.js`, testy w `test/operacje.test.js`. Kolejność użycia przy zmianie nazwy opisuje `PLAN_MIGRACJI_WAWEYE.md`.
- **wawEye – operacje Vercel**: `stan` (tylko odczyt), `dodaj-domene`, `przekieruj-domene` (308), `przelacz-podglady` (Worker tylko dla podglądów i podgląd `main` do sprawdzenia, produkcja bez zmian), `przelacz-workera` (zmienia `UPSTREAM_URL`, opcjonalnie `UPSTREAM_SECRET`, i wdraża produkcję), `ustaw-root-directory` (i wdraża), `zmien-nazwe-projektu` (przywraca domeny, gdyby zniknęły), `wdroz-produkcje`. Po każdym wdrożeniu uruchamia kontrolę produkcji na wszystkich domenach produkcyjnych.
- **wawEye – operacje Cloudflare**: `stan`, `test-workera` (wszystkie zasoby z sekretem i 403 bez niego, także magazyn geokodów; działa z USA, więc API Warszawy odpowiada stamtąd błędem 522 i dane sprawdza się przez `przelacz-podglady`), `ustaw-sekrety` (z sekretów repozytorium), `usun-workera`. Usunięcia odmawia, jeśli Worker jest celem wdrożeń, używa go produkcja Vercel albo miał ruch w ostatnich 7 dniach.
- **wawEye – kontrola adresu**: `scripts/check-production.js` dla dowolnego adresu na serwerach GitHuba, bez zakładania zgłoszeń.

Sekrety repozytorium (**Settings → Secrets and variables → Actions**), poza `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID`:
- `VERCEL_TOKEN`: Vercel → Account Settings → Tokens → Create Token (zakres: zespół `ampm10`, z datą ważności).
- `WARSAW_API_KEY`: ten sam klucz, który ma Worker. Nie generuj nowego, bo może unieważnić stary.
- `PROXY_SECRET`: ten sam ciąg co `PROXY_SECRET` w Workerze i `UPSTREAM_SECRET` w Vercel.

Opcjonalnie dodaj do tokenu Cloudflare uprawnienie Account Analytics: Read, wtedy `stan` pokaże ruch każdego Workera. Identyfikatory zespołu i projektu Vercel są wpisane w workflowach. To nie są sekrety, a identyfikator projektu nie zmienia się po zmianie nazwy.

## Struktura
- `public/` – front (Leaflet, `app.js`, `style.css`)
- `public/o-serwisie.html` – strona „O serwisie” (`/o-serwisie`, link z logo w pasku mapy); `public/media/` – film 720p, plakat i zrzuty z telefonu dla tej strony
- `worker/` – opcjonalny pośrednik Cloudflare
- `api/*.js` – funkcje Vercel; `lib/` – logika API, mock, handler; `lib/geocoding.js` – współrzędne z adresu dla zajęć sportowych (OpenStreetMap Nominatim, 1 zapytanie/s, pamięć podręczna)
- `dev-server.js` – serwer lokalny
- `scripts/metro.js` – dane warstwy metra z OpenStreetMap (testy w `test/metro.test.js`); `scripts/strefy.js` – granica SCT; `public/data/` – pliki tych warstw
- `scripts/trasy.js` – trasy linii z GTFS ZTM do `public/data/trasy/`; `public/trasa.js` – wybór wariantu trasy (kierunek) w przeglądarce; testy w `test/trasy.test.js`
- `scripts/check-production.js` – kontrola produkcji (monitoring); `scripts/vercel-ops.js`, `scripts/cloudflare-ops.js` – operacje wywoływane przez workflowy na żądanie
- `ARCHITEKTURA.md` – architektura: komponenty i ich lokalizacja, przepływy danych (diagramy), infrastruktura, CI/CD, monitoring, sekrety
- `ROADMAPA.md` – analiza produktu i plan rozwoju; `CONTEXT.md` – notatki dla kolejnych sesji
- `wideo-promocyjne/` – 30-sekundowy film promocyjny (`waweye-showreel.mp4`) i kod, który go generuje z prawdziwych danych; wykluczony z wdrożenia przez `.vercelignore`
- `PLAN_MIGRACJI_WAWEYE.md` – plan migracji nazwy z „pasibus” na wawEye (domena, Worker, folder, repo) bez przerwy w działaniu
- `KOMUNIKAT_PRASOWY.md` – komunikat prasowy: cel, funkcje, źródła danych, plan rozwoju; `KOMUNIKAT_PRASOWY.html` – ten sam komunikat jako strona do udostępnienia (poza `public/`, więc Vercel jej nie publikuje)
