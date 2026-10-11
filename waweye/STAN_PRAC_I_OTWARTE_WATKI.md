# wawEye – stan prac i otwarte wątki

Notatka do podjęcia pracy w nowej sesji (człowiek albo Claude). Stan na **2026-10-12, 01:55 czasu warszawskiego**. Po zamknięciu wątku usuń go stąd albo przenieś do „Zrobione”; gdy lista jest pusta, plik można skasować.

Znaczniki pewności: [Pewne] sprawdzone, [Prawdopodobne] silne przesłanki, [Zgaduję] luka w danych.

## Od czego zacząć

1. Przeczytaj `PLAN_NAPRAWCZY_TESTOW.md` (blok „Stan”), potem `TESTY_I_JAKOSC.md` (opis testów, §7: jak bramka i Vercel współpracują).
2. Sprawdź otwarte PR i zgłoszenia (`monitoring:*`) w repozytorium. Na 01:55 nie było żadnych [Pewne].
3. Przejdź listę „Otwarte wątki” poniżej, od góry.

## Otwarte wątki

### 1. Wdrożenie Workera na `cloudflare/wrangler-action@v4` nie było jeszcze uruchomione

- **Stan:** PR #74 (Dependabot) podniósł akcję z v3 do v4, czyli o wersję główną. Workflow `waweye-wdrozenie-workera.yml` uruchamia się tylko przy zmianach w `waweye/worker/**`, więc v4 nie przeszło jeszcze ani jednego przebiegu [Pewne].
- **Ryzyko:** przy następnej zmianie Workera wdrożenie może się nie udać (np. zmienione wejścia akcji) [Zgaduję]. Produkcja działa dalej na poprzedniej wersji Workera, więc awaria wdrożenia nie wyłącza aplikacji [Prawdopodobne].
- **Do zrobienia:** uruchomić ręcznie Actions → „wawEye – wdrożenie Workera Cloudflare” → Run workflow (wdraża ten sam kod), sprawdzić, czy jest zielony. Jeśli jest czerwony: przeczytać informacje o wydaniu v4 i poprawić wejścia w kroku „Wdrożenie (wrangler deploy)”.

### 2. Obserwacja A4 i stabilność WebKit – termin ok. 2026-10-25

- **Kryterium A4:** przez 2 tygodnie od wdrożenia każde zgłoszenie monitoringu ma etykietę `monitoring:dostawca` albo `monitoring:aplikacja` (`PLAN_NAPRAWCZY_TESTOW.md` A4).
- **WebKit:** job `testy-webkit` jest informacyjny (`continue-on-error`). Jeśli przez ten czas jest stabilnie zielony, zaproponować właścicielowi włączenie go do `bramka` (B3).
- **Dane do decyzji o błędach 522:** raport monitoringu wypisuje lokalizację Cloudflare (`[Cloudflare XXX]`). Jedno 522 widziano już z FRA, co osłabia hipotezę o odrzucanych lokalizacjach [Prawdopodobne]. Jeśli 522 nie zależy od lokalizacji, następny krok to zgłoszenie do operatora API miasta.
- **Przypomnienie:** zaplanowane na 2026-10-25 08:00 (czasu warszawskiego, już po zmianie czasu) w sesji, w której powstała ta notatka. Nowa sesja go nie dostanie, więc sprawdź termin sam.

### 3. Pomysł bez decyzji: oznaczenie pojazdów „poza trasą linii”

- **Kontekst:** w nocy (ok. 01:30) tramwaje 9 i 1 stały poza swoimi trasami. Najpewniej to zjazdy do zajezdni albo postój z numerem ostatniej linii. GTFS nie opisuje zjazdów, więc aplikacja tego nie wie [Prawdopodobne].
- **Propozycja:** wyróżnić pojazd daleko od trasy swojej linii (np. przygaszony znacznik i dopisek w panelu). Szacunek 2–4 h z testem. **Czeka na decyzję właściciela.**

### 4. Zaparkowane decyzje

- **WCAG:** docelowy poziom zaparkowany przez właściciela. Testy axe w E2E blokują tylko błędy `serious` i `critical`, lista wyjątków jest pusta.
- **Formatter (np. Prettier):** nie wybrany. Dziś jest tylko ESLint.
- **Reguła gałęzi `main`:** zapisana, ale nieegzekwowana (prywatne repozytorium bez organizacji GitHub Team). Bramkę realnie wymusza Vercel: produkcja czeka na `bramka`.
- **CodeQL:** niedostępny dla konta osobistego, świadoma rezygnacja.

## Uwagi do procesu (wnioski z tej sesji)

- Scalenie dwóch PR w krótkim odstępie anuluje oczekujący przebieg testów na `main` (tak było z #80). Nie szkodzi, bo następny commit ma własny przebieg i wdrożenie, ale wersja z anulowanym przebiegiem nigdy nie trafi na produkcję [Pewne].
- Dependabot: komentarze `@dependabot recreate` i `@dependabot rebase` działają z opóźnieniem. Przed scaleniem sprawdź, czy PR ma już nowy commit i zielony `testy`. #74 scalono jeszcze w starej wersji, z commitem danych metra (zmieniona była tylko data w `metro.geojson`, więc bez szkody). Od #80 workflowy danych pomijają gałęzie Dependabota.
- Po kliknięciu „Merge” sprawdź, czy commit naprawdę jest w `main`. Szkic PR (draft) nie daje się scalić, dopóki nie klikniesz „Ready for review”.

## Zrobione w tej sesji (dla kontekstu)

- `TESTY_I_JAKOSC.md` (raport dla audytora i na wdrożenie), prezentacja tego raportu w Artifact (15 slajdów), `PLAN_NAPRAWCZY_TESTOW.md`.
- P0 i P1 w kodzie: bramka CI z wykrywaniem zmian, pokrycie z progami, ESLint, axe w E2E, WebKit w CI, klasyfikacja alarmów z ponowną kontrolą, nagłówek `x-colo`, Dependabot, szablon PR, `LISTA_REGRESJI_RECZNEJ.md`, kolor przycisków „O serwisie” (wariant B), rezygnacja z pytania iOS o czujniki ruchu (`CONTEXT.md`).
- Kroki ręczne właściciela: Vercel Deployment Checks na `bramka`, UptimeRobot (słowo `"source":"live"` na `/api/vehicles`, alarm przetestowany), alerty i aktualizacje Dependabot.
- PR: #71, #73, #76–#82 oraz #74, #75 od Dependabota – wszystkie scalone; testy na `main` po ostatnim (#82) zielone.
