# Plan migracji z „pasibus” na „wawEye”

Data: 2026-10-03. Podstawa: `git grep -i pasibus` na gałęzi po commicie `3a8fb6b` (zmiana nazwy w interfejsie i dokumentacji), `README.md`, `CONTEXT.md` oraz sprawdzenie sieci z sesji Claude.

Cel: wszędzie, gdzie to możliwe, zastąpić „pasibus” nazwą wawEye i przez cały czas nie przerwać działania aplikacji, API, Workera, monitoringu, wdrożeń ani pracy w sesjach Claude.

## 1. Zasady ciągłości

1. **Najpierw dodaj nowe obok starego, potem przełącz, na końcu usuń stare.** Żaden krok nie wyłącza starego elementu, dopóki nowy nie przejdzie weryfikacji.
2. **Jedna zmiana infrastruktury na raz.** Po każdej fazie wykonaj listę kontrolną z sekcji 6.
3. **Nieudany build w Vercel nie wyłącza produkcji.** Ostatnie udane wdrożenie działa dalej, a poprzednie można przywrócić w Deployments → Instant Rollback.
4. **Stary adres `pasibus.vercel.app` zostaje na zawsze**, na końcu jako przekierowanie. Nie usuwaj go z projektu: zwolnioną nazwę mógłby zająć ktoś inny i przejąć ruch ze starych linków.
5. **Stary Worker usuwamy dopiero po co najmniej 7 dniach bez ruchu.** Ruch widać w Cloudflare → Worker → Metrics.
6. **Identyfikatory techniczne piszemy małymi literami (`waweye`).** Domeny, foldery, Workery i nazwy pakietów npm nie rozróżniają wielkości liter albo jej nie dopuszczają. Zapis **wawEye** obowiązuje w tekstach i logo.

Kto wykonuje kroki:
- **Claude** – zmiany w repozytorium przez PR oraz operacje w Vercel i Cloudflare przez workflowy uruchamiane na żądanie (sekcja 4a). Krok opisany jako „**Claude:** `operacje …`” wygląda tak: Claude podaje parametry, właściciel klika Run workflow, a Claude odczytuje wynik przebiegu i decyduje o następnym kroku. Aplikacja Claude na GitHubie może czytać Actions, ale nie może ich uruchamiać (`403 Resource not accessible by integration`). Tokeny są w sekretach repozytorium i nie trafiają ani do sesji, ani do czatu.
- **Właściciel** – jednorazowe przygotowanie (Faza 0), zmiana nazwy repozytorium, ustawienia środowiska sesji, decyzje i merge PR-ów. Panele Vercel i Cloudflare są potrzebne tylko awaryjnie.

## 2. Inwentaryzacja

### 2a. W repozytorium

| Obszar | Gdzie | Co zawiera „pasibus” | Wpływ na działanie | Faza |
|---|---|---|---|---|
| Interfejs i dokumentacja | `public/index.html`, `public/app.js` (komunikat), `public/style.css`, `KOMUNIKAT_PRASOWY.*`, `README.md`, `ROADMAPA.md`, `CONTEXT.md` | nazwa produktu | brak | 1 (zrobione) |
| Folder aplikacji | `pasibus/` (ok. 60 plików) | ścieżka | **krytyczny**: Root Directory w Vercel i ścieżki w workflowach | 6 |
| Workflow testów | `.github/workflows/pasibus-testy.yml` | nazwa pliku i workflow, `paths`, `working-directory`, `cache-dependency-path`, grupa `concurrency`, artefakt `pasibus-*.png` | testy przy PR | 5, 6 |
| Workflow monitoringu | `.github/workflows/pasibus-monitoring-produkcji.yml` | nazwa, sprawdzany adres, **tytuł zgłoszenia** `[monitoring] pasibus.vercel.app nie działa poprawnie`, ścieżka skryptu | wykrywanie awarii | 3, 6 |
| Workflow wdrożenia Workera | `.github/workflows/pasibus-wdrozenie-workera.yml` | nazwa, `paths`, `working-directory`, `workingDirectory` | wdrożenie Workera | 6 |
| Worker | `worker/wrangler.toml` | `name = "pasibus-proxy"`, czyli adres `pasibus-proxy.<konto>.workers.dev` | **krytyczny**: przez Workera idą wszystkie zapytania do API | 4 |
| Kontrola produkcji | `scripts/check-production.js` | `DEFAULT_URL`, zmienna `PASIBUS_URL` | monitoring | 3, 5 |
| Uchwyt testowy | `public/app.js` (`window.__pasibus`), `test/e2e.js` (58 odniesień, razem z nazwami zrzutów `pasibus-*.png`) | identyfikator | testy e2e i skrypty wideo | 5 |
| Pakiet npm | `package.json`, `package-lock.json` | `"name": "pasibus"` | brak | 5 |
| Wideo promocyjne | `wideo-promocyjne/kompozycja.html` (logo `PASIBUS`, notowanie `PSBS`, „Pasibus Inc.”, adres, stopka), `renderuj.js` (plik wyjściowy, katalog tymczasowy, metadane), `zrzuty-aplikacji.js` i `zbierz-migawki.js` (adres, `PASIBUS_URL`, `__pasibus`, User-Agent z `github.com/pacy2u/tst`), `przygotuj-wode.js` (katalog cache, User-Agent), `przygotuj-dane.js` i `zasoby/dane-wideo.js` (komentarz), `README.md` | tekst, nazwy plików i obrazy: `pasibus-showreel.mp4` i 4 zrzuty `zasoby/ekran-*.webp` ze starym logo | brak (poza aplikacją, `.vercelignore`) | 8 |
| Wskazówki dla Claude | `CLAUDE.md` | przykład nazwy gałęzi | brak | 6 |
| Raport z testów | `RAPORT_TESTOW_EKSPLORACYJNYCH.md` | tytuł z adresem | brak; dokument historyczny, **zostaje bez zmian** | – |

**Dane w przeglądarce:** aplikacja nie używa `localStorage`, `sessionStorage`, IndexedDB ani service workera. Zmiana domeny nie skasuje więc użytkownikom żadnych danych. Zmieni się to w Fazie 2 roadmapy (ulubione w `localStorage`, instalacja jako PWA), bo te dane są przypisane do domeny. **Migrację domeny trzeba skończyć przed wprowadzeniem ulubionych i PWA.**

### 2b. Poza repozytorium

| Usługa | Element z „pasibus” | Kto zmienia | Faza |
|---|---|---|---|
| Vercel (zespół `ampm10`) | projekt `pasibus`, domena produkcyjna `pasibus.vercel.app`, adresy podglądów `pasibus-git-<gałąź>-ampm10.vercel.app`, Root Directory `pasibus`, zmienna `UPSTREAM_URL` wskazująca Workera `pasibus-proxy` | właściciel | 2, 4, 6, 9 |
| Cloudflare | Worker `pasibus-proxy` z sekretami `WARSAW_API_KEY` i `PROXY_SECRET` | właściciel (sekrety), workflow (kod) | 4, 9 |
| GitHub | repozytorium `pacy2u/tst` (do zmiany według decyzji D2), historia przebiegów workflowów, zgłoszenia monitoringu, stare gałęzie z „pasibus” w nazwie (np. `faza-0/fundamenty-pasibus`) | właściciel | 7, 9 |
| Środowisko sesji Claude (`apck01`) | lista dozwolonych domen zawiera `pasibus.vercel.app`; **`waweye.vercel.app` jest dziś blokowany** (sprawdzone 2026-10-03, proxy odrzuca połączenie), repozytorium sesji `pacy2u/tst` | właściciel | 2, 7 |
| Opublikowane treści | komunikat prasowy (strona Artifact, `KOMUNIKAT_PRASOWY.*`), wideo, linki wysłane ludziom | Claude (treść); stary adres musi działać zawsze | 1, 8, 9 |
| Bez zmian | API `dane.um.warszawa.pl` (token nie zależy od nazwy ani domeny), kafelki OpenStreetMap (przeglądarka sama wyśle nowy adres strony), Leaflet, sekrety Actions `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID` | – | – |

## 3. Decyzje przed startem

| # | Decyzja | Rekomendacja |
|---|---|---|
| D1 | Nowy adres | **`waweye.vercel.app`**: darmowy, zgodny z budżetem 0 zł. Gdy jest zajęty: `waw-eye.vercel.app` albo `waweye-app.vercel.app`. Własna domena (np. `waweye.pl`) kosztuje rocznie i wymaga zmiany decyzji o budżecie. Można ją dodać później jako kolejny adres, bez przerwy w działaniu. |
| D2 | Nazwa repozytorium | `pacy2u/tst` → **`pacy2u/waweye`**, jako jedna z ostatnich faz. GitHub przekierowuje stare adresy, dopóki nikt nie założy nowego repo `tst` na tym koncie. |
| D3 | Folder aplikacji | `pasibus/` → **`waweye/`**. Układ z podfolderem zostaje, nie przenosimy aplikacji do katalogu głównego. |
| D4 | Nowa nazwa Workera | **`waweye-proxy`** |
| D5 | Wideo | Ponowny render z nowym logo i zrzutami. Do ustalenia: zapis w logo (`WAWEYE` czy `wawEye`) i żartobliwe notowanie zamiast `PSBS` (np. `WAWE`). |

## 4. Fazy

Kolejność ma znaczenie: faza N zakłada, że wcześniejsze fazy są zakończone i zweryfikowane. Fazy 7 i 8 nie zależą od siebie.

### 4a. Workflowy operacyjne
Uruchamia je właściciel (Actions → wybrany workflow → Run workflow) z parametrami od Claude. Logika jest w `scripts/vercel-ops.js` i `scripts/cloudflare-ops.js` i ma testy jednostkowe (`test/operacje.test.js`). Operacje, które coś zmieniają, najpierw sprawdzają warunki bezpieczeństwa, a po zmianie same weryfikują wynik.

| Workflow | Operacje |
|---|---|
| `wawEye – operacje Vercel` | `stan` (tylko odczyt), `dodaj-domene`, `przekieruj-domene`, `przelacz-podglady` (Worker tylko dla podglądów i podgląd `main` do sprawdzenia), `przelacz-workera`, `ustaw-root-directory`, `zmien-nazwe-projektu`, `wdroz-produkcje`. Po każdym wdrożeniu uruchamia kontrolę produkcji na wszystkich domenach produkcyjnych. |
| `wawEye – operacje Cloudflare` | `stan` (tylko odczyt), `test-workera`, `ustaw-sekrety`, `usun-workera`. Usunięcia odmawia, jeśli Worker jest celem wdrożeń, używa go produkcja Vercel albo miał ruch w ostatnich 7 dniach. |
| `wawEye – kontrola adresu` | kontrola produkcji dowolnego adresu na serwerach GitHuba, bez zakładania zgłoszeń. Działa także wtedy, gdy sesja Claude nie ma dostępu do adresu. |

### Faza 0 – Przygotowanie (jednorazowo, właściciel) – zrobione 2026-10-03
1. Zmerguj PR z workflowami. Workflowy uruchamiane na żądanie działają dopiero z gałęzi `main`.
2. **Token Vercel:** Vercel → Account Settings → Tokens → Create Token. Nazwa np. `github-actions-waweye`, zakres: zespół `ampm10`, ważność 90 dni.
3. GitHub → `pacy2u/tst` → Settings → Secrets and variables → Actions → New repository secret. Dodaj trzy sekrety:
   - `VERCEL_TOKEN`: token z punktu 2.
   - `WARSAW_API_KEY`: **ten sam** klucz, który ma dziś Worker. Nie generuj nowego na dane.um.warszawa.pl, bo nowy klucz może unieważnić stary i zatrzymać produkcję. Jeśli starego nie da się odczytać, najpierw daj znać Claude.
   - `PROXY_SECRET`: ten sam ciąg co `PROXY_SECRET` w Workerze i `UPSTREAM_SECRET` w Vercel. Jeśli go nie znasz, wpisz nowy, długi i losowy. Wtedy w Fazie 4 Claude przełączy produkcję z opcją `nowy_sekret`: nowy adres Workera i nowy sekret trafią do Vercel razem, w jednym wdrożeniu.
4. Opcjonalnie: do tokenu Cloudflare (`CLOUDFLARE_API_TOKEN`) dodaj uprawnienie Account Analytics: Read. Bez niego workflow nie pokaże ruchu Workera, ale usuwanie i tak sprawdza, czy produkcja go nie używa.
5. **Claude:** `operacje Vercel → stan` i `operacje Cloudflare → stan` potwierdzają, że tokeny działają, i zapisują stan wyjściowy.

Wynik (2026-10-03):
- Oba tokeny działają. Token Cloudflare ma też dostęp do statystyk: `pasibus-proxy` obsłużył 3403 zapytania w 7 dni.
- W Vercel wszystkie zmienne (`UPSTREAM_URL`, `UPSTREAM_SECRET`, `WARSAW_API_KEY`) mają typ *sensitive*: ich wartości są ukryte także przed API. Dlatego workflow nie widzi, którego Workera używa produkcja. `usun-workera` decyduje wtedy po braku ruchu.
- `test-workera` dla `pasibus-proxy` dał 403, czyli `PROXY_SECRET` w GitHubie jest nowy, inny niż w obecnym Workerze. W Fazie 4 przełączamy więc z opcją `nowy_sekret`.

### Faza 1 – Nazwa w interfejsie i dokumentacji (zrobione na gałęzi)
- Commit `3a8fb6b`: logo i tytuł aplikacji, komunikat o lokalizacji, komunikaty prasowe, README, ROADMAPA, CONTEXT.
- Weryfikacja: testy jednostkowe 42/42, e2e 65/65, logo „wawEye” na zrzucie z telefonu.
- Ryzyko: brak, bo zmienia się tylko tekst. Wycofanie: revert PR.

### Faza 2 – Nowy adres obok starego – zrobione 2026-10-03
1. **Claude:** `operacje Vercel → dodaj-domene`, wartość `waweye.vercel.app`. Domena dochodzi bez przekierowania, a workflow od razu uruchamia na niej kontrolę produkcji. Jeśli nazwa jest zajęta, workflow to zgłosi i nic nie zmieni. Wtedy wybieramy alternatywę z D1.
2. Opcjonalnie, **właściciel:** ustawienia środowiska sesji (menu środowiska na pasku tytułu → Edit → Network access → Custom) → dodaj `waweye.vercel.app` do Allowed domains. Zmiana działa w nowych sesjach. Bez tego Claude sprawdza adres przez workflow `kontrola adresu`.
3. Opcjonalnie, **Claude:** `operacje Vercel → zmien-nazwe-projektu`, wartość `waweye`. Zmieni to adresy podglądów. Jeśli po zmianie nazwy zniknie którakolwiek domena, workflow od razu doda ją z powrotem.
- Wycofanie: usuń nowy adres w panelu Vercel. Nic jeszcze od niego nie zależy.

### Faza 3 – Monitoring obu adresów – zrobione 2026-10-03 (pacy2u/tst#29)
1. **Claude (PR):**
   - `check-production.js`: domyślny adres `https://waweye.vercel.app`, zmienna `WAWEYE_URL`, na czas migracji z obsługą starej `PASIBUS_URL`.
   - Workflow monitoringu sprawdza oba adresy.
   - Nowy tytuł zgłoszenia: `[monitoring] wawEye nie działa poprawnie`.
2. **Ważne:** monitoring zamyka zgłoszenie, szukając go po dokładnym tytule. Merguj ten PR tylko wtedy, gdy nie ma otwartego zgłoszenia `[monitoring] …`. Jeśli jest, Claude zamknie je po naprawie.
3. Sprawdzanie dwóch adresów wydłuża przebieg o około minutę, czyli około +360 min/mies. przy puli 2000. Wraca do jednego adresu w Fazie 9.
- Weryfikacja: Actions → monitoring → Run workflow → zielony dla obu adresów. Wycofanie: revert PR.

### Faza 4 – Nowy Worker obok starego – zrobione 2026-10-03

Wynik: `waweye-proxy` wdrożony 20:23 (pacy2u/tst#29). Sekrety ustawione. Test przez podgląd poprawny: 1310 rekordów, bez błędów. Przełączenie produkcji o 20:45 z `nowy_sekret`; oba adresy przeszły kontrolę. Krok 5 pominięty: stary `pasibus-proxy` ma `WARSAW_API_KEY` i `PROXY_SECRET` zapisane jako zwykłe zmienne tekstowe, a Cloudflare nie pozwala utworzyć sekretu o tej samej nazwie (błąd 10053). Nic się wtedy nie zmieniło. Instant Rollback do wdrożenia sprzed przełączenia przestał być możliwy po merge'u pacy2u/tst#31 (nowe wdrożenie produkcyjne; plan Hobby cofa tylko o jedno). Problemy z nowym Workerem naprawiamy więc w nim samym: ten sam kod, ponowne wdrożenie workflowem. Stary Worker czeka bezczynnie na Fazę 9.

1. **Claude (PR):** w `wrangler.toml` zmień nazwę na `name = "waweye-proxy"` i zaktualizuj dokumentację. Po merge'u workflow wdroży **nowego** Workera. Stary `pasibus-proxy` zostaje nietknięty i dalej obsługuje produkcję.
2. **Claude:** `operacje Cloudflare → ustaw-sekrety`, Worker `waweye-proxy`. Wpisuje `WARSAW_API_KEY` i `PROXY_SECRET` z sekretów repozytorium. Wdrożenie nigdy nie ustawia sekretów, więc bez tego kroku nowy Worker zwraca błędy. Dopóki nic na niego nie wskazuje, nikomu to nie szkodzi.
3. **Claude, test bez ryzyka dla produkcji:**
   - `operacje Cloudflare → test-workera`, Worker `waweye-proxy`, sprawdza sekret: bez niego Worker ma odpowiadać 403. Zrobione 2026-10-03: sekret działa, ale zapytania do API Warszawy kończą się błędem 522. Test działa na serwerach GitHuba w USA, Cloudflare uruchamia wtedy Workera w USA, a API Warszawy nie przyjmuje połączeń z takich miejsc. Z sesji Claude połączenie z `dane.um.warszawa.pl` też jest zrywane.
   - Miarodajny test: `operacje Vercel → przelacz-podglady`, wartość `https://waweye-proxy.<konto>.workers.dev`. Ustawia `UPSTREAM_URL` i `UPSTREAM_SECRET` **tylko dla podglądów** (zmiennych produkcji nie dotyka; jeśli zmienna jest wspólna z produkcją, odmawia) i wdraża podgląd `main`. Funkcje podglądu działają we Frankfurcie jak produkcja, więc Worker łączy się z API Warszawy z Europy. Workflow sprawdza podgląd. Jeśli Vercel chroni go logowaniem, właściciel otwiera link z raportu i patrzy, czy na mapie są pojazdy. Przy okazji podglądy, które dotąd nie miały `UPSTREAM_URL`, zaczynają pokazywać dane.
   - Produkcja przez cały czas korzysta ze starego Workera.
4. **Claude, przełączenie:** `operacje Vercel → przelacz-workera`, wartość `https://waweye-proxy.<konto>.workers.dev`, **z opcją `nowy_sekret`** (`PROXY_SECRET` w GitHubie jest nowy, patrz wynik Fazy 0). Workflow ustawia `UPSTREAM_URL` i `UPSTREAM_SECRET` jednym wdrożeniem `main`, a potem uruchamia kontrolę produkcji na wszystkich domenach.
5. **Claude, zaraz po udanym przełączeniu:** `operacje Cloudflare → ustaw-sekrety`, Worker `pasibus-proxy`. Stary Worker nie obsługuje już produkcji, więc można mu bezpiecznie wpisać nowy sekret. Od tej chwili oba Workery przyjmują tę samą parę, a powrót jest jedną operacją. Potem `test-workera` dla `pasibus-proxy`.
6. Obserwuj przez co najmniej 7 dni. Usunięcie starego Workera jest w Fazie 9.
- Wycofanie po kroku 5: `przelacz-workera` z adresem `pasibus-proxy`. Między krokami 4 i 5 stary Worker ma jeszcze stary sekret. Wtedy wycofaniem jest Instant Rollback w panelu Vercel (Deployments → poprzednie wdrożenie), bo poprzednie wdrożenie ma zapisaną starą parę zmiennych.

### Faza 5 – Identyfikatory w kodzie – w PR po Fazie 4
**Claude (PR), wszystko w jednym PR-ze, bo te identyfikatory nie mają zewnętrznych użytkowników:**
- `window.__pasibus` → `window.__waweye` w `public/app.js`, `test/e2e.js` i `wideo-promocyjne/zrzuty-aplikacji.js`.
- Zrzuty `pasibus-*.png` → `waweye-*.png` w `test/e2e.js` i ścieżka artefaktu w workflow testów. Obie zmiany muszą być w tym samym PR-ze.
- Nazwa pakietu `waweye`: `npm pkg set name=waweye`, a potem `npm install --package-lock-only`. Plik lock generuje narzędzie, nie edycja ręczna.
- Zmienna `PASIBUS_URL` → `WAWEYE_URL` w skryptach wideo, z obsługą starej nazwy do Fazy 9.
- Nazwy katalogów tymczasowych i User-Agent w skryptach wideo (`waweye-kafelki`, `waweye-promo-video`).
- Wynik (2026-10-03): `npm test` 62/62, `npm run test:e2e` 65/65, zrzuty `waweye-*.png`. Nazwa w `package.json` zmieniona ręcznie, bo `npm pkg set` przeformatowałby cały plik; `package-lock.json` wygenerowany przez `npm install --package-lock-only`.
- Weryfikacja: `npm test`, `npm run test:e2e`, zielone CI. Wycofanie: revert PR.

### Faza 6 – Folder `pasibus/` → `waweye/`
Przygotowanie:
- Zmerguj albo zamknij wszystkie otwarte PR-y. Gałęzie sprzed zmiany folderu będą miały konflikty.
- Najlepiej po Fazie 4. Merge tego PR-a uruchomi workflow wdrożenia Workera, bo zmienią się ścieżki w `worker/`, i wdroży ten sam kod pod ostateczną nazwą. To nieszkodliwe.

**Claude (PR), jedna atomowa zmiana:**
- `git mv pasibus waweye`.
- Workflowy: pliki `waweye-*.yml`, nazwy „wawEye – …”, `paths`, `working-directory`, `cache-dependency-path`, `workingDirectory`, grupy `concurrency`, ścieżki `pasibus/scripts/` w workflowach operacyjnych.
- Ścieżki w `README.md`, `CONTEXT.md`, `wideo-promocyjne/README.md`, przykład w `CLAUDE.md`.
- `vercel.json` i `.vercelignore` mają ścieżki względne, więc zostają bez zmian.
- Podgląd Vercel dla tego PR-a się nie zbuduje, bo Root Directory `pasibus` nie istnieje na gałęzi. To spodziewane. Zmianę potwierdzają testy w GitHub Actions.

Okno zmiany (kilka minut):
1. **Właściciel:** merge PR-a.
2. Build produkcyjny tego commita w Vercel się nie uda, bo nie ma folderu `pasibus`. **Produkcja dalej serwuje poprzednie wdrożenie.**
3. **Claude, zaraz po merge'u:** `operacje Vercel → ustaw-root-directory`, wartość `waweye`. Workflow zmienia ustawienie, wdraża `main` i uruchamia kontrolę produkcji na wszystkich domenach. Potem Claude uruchamia monitoring.
- Wycofanie: przycisk Revert przy PR-ze na GitHubie, potem `ustaw-root-directory` z wartością `pasibus`.
- Zmiana nazw plików workflowów tworzy w Actions nowe workflowy. Historia przebiegów zostaje pod starymi nazwami. Identyfikator zadania `testy` zostaje bez zmian, więc ewentualne reguły ochrony gałęzi nadal pasują.

### Faza 7 – Repozytorium `pacy2u/tst` → `pacy2u/waweye`
1. **Właściciel:** sprawdź, czy nazwa `waweye` jest wolna, potem GitHub → Settings → General → Repository name → `waweye` → Rename. **Nigdy nie zakładaj później nowego repo o nazwie `tst`**, bo przestaną działać przekierowania.
2. **Claude:** `operacje Vercel → stan` powinien pokazać repozytorium `pacy2u/waweye`. Następnie `wdroz-produkcje` potwierdza, że wdrożenia z gita działają. Jeśli nie działają, **właściciel** robi w Vercel → Settings → Git Disconnect i Connect tego samego repo. Produkcja działa w tym czasie bez przerwy.
3. Sekrety i workflowy Actions przechodzą razem z repo. **Claude** sprawdza to, uruchamiając monitoring.
4. **Claude:** aplikacja Claude na GitHubie jest przypisana do repo, nie do nazwy. Nową sesję trzeba jednak założyć z wybranym `pacy2u/waweye`. Jeśli sesja nie widzi repo, połącz GitHub ponownie na https://claude.ai/connect-github.
5. **Claude (PR):** linki `github.com/pacy2u/tst` w README, CONTEXT i User-Agent w skryptach wideo.
- Wycofanie: zmień nazwę z powrotem na `tst`.

### Faza 8 – Wideo promocyjne (po Fazach 2 i 5)
**Stan (2026-10-03):** zrobione bez ponownego zbierania danych. `waweye-showreel.mp4` zastępuje `pasibus-showreel.mp4`: logo `wawEye`, notowanie `WAWE`, „wawEye Inc.”, adres `waweye.vercel.app` (dodany w Fazie 2), stopka. W zrzutach podmieniony tylko pierwszy wiersz nagłówka aplikacji. Identyfikatory techniczne w skryptach wideo (`__pasibus`, `PASIBUS_URL`, User-Agent, katalog cache) zostają do Faz 5 i 7.

1. **Claude (PR):**
   - `kompozycja.html`: logo, notowanie, „Pasibus Inc.”, adres i stopka według decyzji D5.
   - Nowe zrzuty: `zrzuty-aplikacji.js` na nowym adresie.
   - Ponowny render (15–30 min) do pliku `waweye-showreel.mp4`, stary `pasibus-showreel.mp4` usunięty w tym samym PR-ze.
   - Migawki danych z 2 października zostają, bo nie zależą od nazwy.
2. Przed startem trzeba sprawdzić, czy sesja ma `ffmpeg` i ImageMagick.
3. Plik ma około 21 MB, a historia gita zachowa też stary. Lepiej trzymać wideo poza repozytorium, np. jako załącznik wydania (Release) na GitHubie.
- Ryzyko: brak, bo wideo nie jest częścią aplikacji.

### Faza 9 – Sprzątanie (po co najmniej 14 dniach zielonego monitoringu)
1. **Claude:** `operacje Vercel → przekieruj-domene`, wartość `pasibus.vercel.app`, przekieruj na `waweye.vercel.app` (308). Adres zostaje w projekcie, nie usuwamy go.
   - Karty otwarte na starym adresie przed tą zmianą przestaną odświeżać pojazdy, aż ktoś przeładuje stronę. Przeładowanie przeniesie na nowy adres.
2. **Claude (PR):**
   - Monitoring sprawdza tylko nowy adres, plus jeden krok sprawdzający, czy stary przekierowuje.
   - Usunięcie obsługi `PASIBUS_URL`.
   - Końcowa aktualizacja `CONTEXT.md` i `README.md`.
3. **Claude:** `operacje Cloudflare → usun-workera`, Worker `pasibus-proxy`, z potwierdzeniem nazwą. Workflow odmówi, jeśli Worker miał ruch w ostatnich 7 dniach (Vercel ukrywa `UPSTREAM_URL`, więc o bezpieczeństwie usunięcia decyduje ruch) albo jest celem wdrożeń.
4. Opcjonalnie, **właściciel:**
   - Usuń zmergowane gałęzie z „pasibus” w nazwie.
   - Usuń `pasibus.vercel.app` z listy dozwolonych domen w środowisku sesji, gdy przekierowanie nie będzie już sprawdzane.

## 5. Harmonogram orientacyjny

| Dzień | Fazy |
|---|---|
| 0 | 0 (przygotowanie), 1 (merge PR-a), 2 |
| 1 | 3 |
| 2 | 4: nowy Worker, test, przełączenie |
| 3 | 5 |
| 4 | 6: okno zmiany folderu |
| 5 | 7 |
| dowolnie po 5 | 8 |
| od 19 | 9: po 14 dniach obserwacji |

Całość zajmie około 3 tygodni, z czego większość to obserwacja. Pracy jest kilka godzin.

## 6. Lista kontrolna po każdej fazie
- [ ] CI zielone (`npm test`, `npm run test:e2e`).
- [ ] Kontrola produkcji (`node scripts/check-production.js` albo workflow `wawEye – kontrola adresu`) dla `https://waweye.vercel.app` (od Fazy 2) i `https://pasibus.vercel.app` (do Fazy 9): wszystkie zasoby OK, dopasowanie do taboru powyżej 90%.
- [ ] Actions → monitoring → Run workflow → zielony.
- [ ] Na telefonie działają mapa, wybór pojazdu z danymi taboru, parkingi, utrudnienia i lokalizacja.
- [ ] Brak otwartego zgłoszenia `[monitoring] …`.

## 7. Ryzyka

| Ryzyko | Skutek | Zabezpieczenie |
|---|---|---|
| `waweye.vercel.app` zajęty | brak wymarzonego adresu | alternatywy z D1, sprawdzenie w Fazie 2 przed jakąkolwiek zmianą w kodzie |
| Nowy Worker bez sekretów | błędy API po przełączeniu | `ustaw-sekrety` i `test-workera` przed przełączeniem (Faza 4) |
| Nowy klucz API Warszawy unieważnia stary | produkcja traci dane | do sekretu repozytorium kopiujemy istniejący klucz, nie generujemy nowego (Faza 0) |
| Wyciek tokenu Vercel | ktoś może zmieniać projekt | token tylko w sekretach repozytorium, zakres jednego zespołu, ważność 90 dni; nigdy w czacie ani w sesji |
| Zmiana folderu bez zmiany Root Directory | wdrożenia nie przechodzą | produkcja działa dalej; `ustaw-root-directory` zaraz po merge'u (Faza 6) |
| Nowy tytuł zgłoszenia przy otwartym starym | stare zgłoszenie nie zamknie się samo | merge Fazy 3 bez otwartych zgłoszeń albo ręczne zamknięcie |
| Usunięcie `pasibus.vercel.app` | ktoś przejmuje nazwę, stare linki prowadzą do obcej strony | adresu nigdy nie usuwamy, zostaje przekierowanie |
| Nowe repo o nazwie `tst` | przestają działać przekierowania do `pacy2u/waweye` | nie zakładać |
| Utrata połączenia Vercel z repo po zmianie nazwy | brak nowych wdrożeń (produkcja działa) | sprawdzenie w Fazie 7, Disconnect/Connect |
| Środowisko sesji bez nowego adresu | Claude nie sprawdzi produkcji z sesji | workflow `kontrola adresu`; opcjonalnie dodanie domeny w Fazie 2 |
| Otwarte PR-y w trakcie zmiany folderu | konflikty | zmerguj lub zamknij przed Fazą 6 |
| Ulubione i PWA wprowadzone przed zmianą domeny | użytkownicy tracą ulubione, zainstalowana aplikacja wskazuje stary adres | migracja domeny przed Fazą 2 roadmapy |
