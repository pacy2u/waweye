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
- **Claude** – zmiany w repozytorium przez PR, testy i kontrola produkcji z sesji.
- **Właściciel** – kroki w panelach Vercel, Cloudflare, GitHub i ustawieniach środowiska sesji. Wszystkie da się zrobić w przeglądarce, bez CLI.

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

### Faza 1 – Nazwa w interfejsie i dokumentacji (zrobione na gałęzi)
- Commit `3a8fb6b`: logo i tytuł aplikacji, komunikat o lokalizacji, komunikaty prasowe, README, ROADMAPA, CONTEXT.
- Weryfikacja: testy jednostkowe 42/42, e2e 65/65, logo „wawEye” na zrzucie z telefonu.
- Ryzyko: brak, bo zmienia się tylko tekst. Wycofanie: revert PR.

### Faza 2 – Nowy adres obok starego
1. **Właściciel:** Vercel → projekt → Settings → Domains → Add → `waweye.vercel.app`, **bez** przekierowania. Oba adresy serwują to samo wdrożenie.
2. **Właściciel:** ustawienia środowiska sesji (menu środowiska na pasku tytułu → Edit → Network access → Custom) → dodaj `waweye.vercel.app` do Allowed domains. Zmiana działa w nowych sesjach.
3. **Claude:** `node scripts/check-production.js https://waweye.vercel.app`. Wszystkie zasoby muszą dać OK.
4. Opcjonalnie, **właściciel:** zmień nazwę projektu w Vercel na `waweye` (zmieni to adresy podglądów). Zaraz potem sprawdź w Domains, czy `pasibus.vercel.app` nadal jest na liście. Jeśli zniknęła, dodaj ją od razu z powrotem.
- Wycofanie: usuń nowy adres. Nic jeszcze od niego nie zależy.

### Faza 3 – Monitoring obu adresów
1. **Claude (PR):**
   - `check-production.js`: domyślny adres `https://waweye.vercel.app`, zmienna `WAWEYE_URL`, na czas migracji z obsługą starej `PASIBUS_URL`.
   - Workflow monitoringu sprawdza oba adresy.
   - Nowy tytuł zgłoszenia: `[monitoring] wawEye nie działa poprawnie`.
2. **Ważne:** monitoring zamyka zgłoszenie, szukając go po dokładnym tytule. Merguj ten PR tylko wtedy, gdy nie ma otwartego zgłoszenia `[monitoring] …`. Jeśli jest, zamknij je ręcznie po naprawie.
3. Sprawdzanie dwóch adresów wydłuża przebieg o około minutę, czyli około +360 min/mies. przy puli 2000. Wraca do jednego adresu w Fazie 9.
- Weryfikacja: Actions → monitoring → Run workflow → zielony dla obu adresów. Wycofanie: revert PR.

### Faza 4 – Nowy Worker obok starego
1. **Claude (PR):** w `wrangler.toml` zmień nazwę na `name = "waweye-proxy"` i zaktualizuj dokumentację. Po merge'u workflow wdroży **nowego** Workera. Stary `pasibus-proxy` zostaje nietknięty i dalej obsługuje produkcję.
2. **Właściciel:** Cloudflare → Workers → `waweye-proxy` → Settings → Variables and Secrets → dodaj `WARSAW_API_KEY` i `PROXY_SECRET`, te same wartości co w starym Workerze. Wdrożenie nigdy nie ustawia sekretów, więc bez tego kroku nowy Worker zwraca błędy. Dopóki nic na niego nie wskazuje, nikomu to nie szkodzi.
3. **Test bez ryzyka dla produkcji:** w Vercel → Environment Variables ustaw `UPSTREAM_URL` **tylko dla Preview** na `https://waweye-proxy.<konto>.workers.dev`. Zrób Redeploy dowolnego podglądu i sprawdź w nim mapę, panel pojazdu, parkingi i utrudnienia.
4. **Przełączenie:** ustaw `UPSTREAM_URL` dla Production na adres nowego Workera → Redeploy produkcji → **Claude:** `check-production.js` dla obu adresów.
5. Obserwuj przez co najmniej 7 dni. Usunięcie starego Workera jest w Fazie 9.
- Wycofanie: przywróć `UPSTREAM_URL` na `pasibus-proxy` i zrób Redeploy. Stary Worker działa przez cały okres obserwacji.

### Faza 5 – Identyfikatory w kodzie
**Claude (PR), wszystko w jednym PR-ze, bo te identyfikatory nie mają zewnętrznych użytkowników:**
- `window.__pasibus` → `window.__waweye` w `public/app.js`, `test/e2e.js` i `wideo-promocyjne/zrzuty-aplikacji.js`.
- Zrzuty `pasibus-*.png` → `waweye-*.png` w `test/e2e.js` i ścieżka artefaktu w workflow testów. Obie zmiany muszą być w tym samym PR-ze.
- Nazwa pakietu `waweye`: `npm pkg set name=waweye`, a potem `npm install --package-lock-only`. Plik lock generuje narzędzie, nie edycja ręczna.
- Zmienna `PASIBUS_URL` → `WAWEYE_URL` w skryptach wideo, z obsługą starej nazwy do Fazy 9.
- Nazwy katalogów tymczasowych w skryptach wideo.
- Weryfikacja: `npm test`, `npm run test:e2e`, zielone CI. Wycofanie: revert PR.

### Faza 6 – Folder `pasibus/` → `waweye/`
Przygotowanie:
- Zmerguj albo zamknij wszystkie otwarte PR-y. Gałęzie sprzed zmiany folderu będą miały konflikty.
- Najlepiej po Fazie 4. Merge tego PR-a uruchomi workflow wdrożenia Workera, bo zmienią się ścieżki w `worker/`, i wdroży ten sam kod pod ostateczną nazwą. To nieszkodliwe.

**Claude (PR), jedna atomowa zmiana:**
- `git mv pasibus waweye`.
- Workflowy: pliki `waweye-*.yml`, nazwy „wawEye – …”, `paths`, `working-directory`, `cache-dependency-path`, `workingDirectory`, grupy `concurrency`.
- Ścieżki w `README.md`, `CONTEXT.md`, `wideo-promocyjne/README.md`, przykład w `CLAUDE.md`.
- `vercel.json` i `.vercelignore` mają ścieżki względne, więc zostają bez zmian.
- Podgląd Vercel dla tego PR-a się nie zbuduje, bo Root Directory `pasibus` nie istnieje na gałęzi. To spodziewane. Zmianę potwierdzają testy w GitHub Actions.

Okno zmiany (około 15 minut, właściciel):
1. Merge PR-a.
2. Build produkcyjny tego commita w Vercel się nie uda, bo nie ma folderu `pasibus`. **Produkcja dalej serwuje poprzednie wdrożenie.**
3. Vercel → Settings → Build and Deployment → Root Directory = `waweye` → Save → Deployments → Redeploy najnowszego `main`.
4. **Claude:** `check-production.js` dla obu adresów. **Właściciel:** Actions → monitoring → Run workflow.
- Wycofanie: przycisk Revert przy PR-ze na GitHubie, Root Directory z powrotem na `pasibus`, Redeploy.
- Zmiana nazw plików workflowów tworzy w Actions nowe workflowy. Historia przebiegów zostaje pod starymi nazwami. Identyfikator zadania `testy` zostaje bez zmian, więc ewentualne reguły ochrony gałęzi nadal pasują.

### Faza 7 – Repozytorium `pacy2u/tst` → `pacy2u/waweye`
1. **Właściciel:** sprawdź, czy nazwa `waweye` jest wolna, potem GitHub → Settings → General → Repository name → `waweye` → Rename. **Nigdy nie zakładaj później nowego repo o nazwie `tst`**, bo przestaną działać przekierowania.
2. **Właściciel:** Vercel → Settings → Git: połączone repozytorium powinno pokazywać `pacy2u/waweye`. Zmerguj drobny PR i sprawdź, czy ruszyło wdrożenie. Jeśli nie, zrób Disconnect i Connect tego samego repo. Produkcja działa w tym czasie bez przerwy.
3. Sekrety i workflowy Actions przechodzą razem z repo. Sprawdź to przez Actions → monitoring → Run workflow.
4. **Claude:** aplikacja Claude na GitHubie jest przypisana do repo, nie do nazwy. Nową sesję trzeba jednak założyć z wybranym `pacy2u/waweye`. Jeśli sesja nie widzi repo, połącz GitHub ponownie na https://claude.ai/connect-github.
5. **Claude (PR):** linki `github.com/pacy2u/tst` w README, CONTEXT i User-Agent w skryptach wideo.
- Wycofanie: zmień nazwę z powrotem na `tst`.

### Faza 8 – Wideo promocyjne (po Fazach 2 i 5)
1. **Claude (PR):**
   - `kompozycja.html`: logo, notowanie, „Pasibus Inc.”, adres i stopka według decyzji D5.
   - Nowe zrzuty: `zrzuty-aplikacji.js` na nowym adresie.
   - Ponowny render (15–30 min) do pliku `waweye-showreel.mp4`, stary `pasibus-showreel.mp4` usunięty w tym samym PR-ze.
   - Migawki danych z 2 października zostają, bo nie zależą od nazwy.
2. Przed startem trzeba sprawdzić, czy sesja ma `ffmpeg` i ImageMagick.
3. Plik ma około 21 MB, a historia gita zachowa też stary. Lepiej trzymać wideo poza repozytorium, np. jako załącznik wydania (Release) na GitHubie.
- Ryzyko: brak, bo wideo nie jest częścią aplikacji.

### Faza 9 – Sprzątanie (po co najmniej 14 dniach zielonego monitoringu)
1. **Właściciel:** Vercel → Domains → `pasibus.vercel.app` → Edit → Redirect to `waweye.vercel.app` (308). Nie usuwaj tego adresu.
   - Karty otwarte na starym adresie przed tą zmianą przestaną odświeżać pojazdy, aż ktoś przeładuje stronę. Przeładowanie przeniesie na nowy adres.
2. **Claude (PR):**
   - Monitoring sprawdza tylko nowy adres, plus jeden krok sprawdzający, czy stary przekierowuje.
   - Usunięcie obsługi `PASIBUS_URL`.
   - Końcowa aktualizacja `CONTEXT.md` i `README.md`.
3. **Właściciel:** Cloudflare → `pasibus-proxy` → Metrics. Jeśli przez 7 dni nie było ruchu, usuń Workera.
4. Opcjonalnie, **właściciel:**
   - Usuń zmergowane gałęzie z „pasibus” w nazwie.
   - Usuń `pasibus.vercel.app` z listy dozwolonych domen w środowisku sesji, gdy przekierowanie nie będzie już sprawdzane.

## 5. Harmonogram orientacyjny

| Dzień | Fazy |
|---|---|
| 0 | 1 (merge PR-a), 2 |
| 1 | 3 |
| 2 | 4: nowy Worker, test w Preview, przełączenie |
| 3 | 5 |
| 4 | 6: okno zmiany folderu |
| 5 | 7 |
| dowolnie po 5 | 8 |
| od 19 | 9: po 14 dniach obserwacji |

Całość zajmie około 3 tygodni, z czego większość to obserwacja. Pracy jest kilka godzin.

## 6. Lista kontrolna po każdej fazie
- [ ] CI zielone (`npm test`, `npm run test:e2e`).
- [ ] `node scripts/check-production.js https://waweye.vercel.app` (od Fazy 2) i `https://pasibus.vercel.app` (do Fazy 9): wszystkie zasoby OK, dopasowanie do taboru powyżej 90%.
- [ ] Actions → monitoring → Run workflow → zielony.
- [ ] Na telefonie działają mapa, wybór pojazdu z danymi taboru, parkingi, utrudnienia i lokalizacja.
- [ ] Brak otwartego zgłoszenia `[monitoring] …`.

## 7. Ryzyka

| Ryzyko | Skutek | Zabezpieczenie |
|---|---|---|
| `waweye.vercel.app` zajęty | brak wymarzonego adresu | alternatywy z D1, sprawdzenie w Fazie 2 przed jakąkolwiek zmianą w kodzie |
| Nowy Worker bez sekretów | błędy API po przełączeniu | sekrety przed przełączeniem, test przez `UPSTREAM_URL` tylko w Preview (Faza 4) |
| Zmiana folderu bez zmiany Root Directory | wdrożenia nie przechodzą | produkcja działa dalej; poprawić Root Directory i zrobić Redeploy (Faza 6) |
| Nowy tytuł zgłoszenia przy otwartym starym | stare zgłoszenie nie zamknie się samo | merge Fazy 3 bez otwartych zgłoszeń albo ręczne zamknięcie |
| Usunięcie `pasibus.vercel.app` | ktoś przejmuje nazwę, stare linki prowadzą do obcej strony | adresu nigdy nie usuwamy, zostaje przekierowanie |
| Nowe repo o nazwie `tst` | przestają działać przekierowania do `pacy2u/waweye` | nie zakładać |
| Utrata połączenia Vercel z repo po zmianie nazwy | brak nowych wdrożeń (produkcja działa) | sprawdzenie w Fazie 7, Disconnect/Connect |
| Środowisko sesji bez nowego adresu | Claude nie sprawdzi produkcji | dodanie domeny w Fazie 2 |
| Otwarte PR-y w trakcie zmiany folderu | konflikty | zmerguj lub zamknij przed Fazą 6 |
| Ulubione i PWA wprowadzone przed zmianą domeny | użytkownicy tracą ulubione, zainstalowana aplikacja wskazuje stary adres | migracja domeny przed Fazą 2 roadmapy |
