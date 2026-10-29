# wawEye – stan prac i otwarte wątki

Notatka do podjęcia pracy w nowej sesji (człowiek albo Claude). Stan na **2026-10-25, 08:20 czasu warszawskiego**. Po zamknięciu wątku usuń go stąd albo przenieś do „Zrobione”; gdy lista jest pusta, plik można skasować.

Znaczniki pewności: [Pewne] sprawdzone, [Prawdopodobne] silne przesłanki, [Zgaduję] luka w danych.

## Od czego zacząć

1. Przeczytaj `PLAN_NAPRAWCZY_TESTOW.md` (blok „Stan”), potem `TESTY_I_JAKOSC.md` (opis testów, §7: jak bramka i Vercel współpracują).
2. Sprawdź otwarte PR i zgłoszenia (`monitoring:*`) w repozytorium. Na 01:55 nie było żadnych [Pewne].
3. Przejdź listę „Otwarte wątki” poniżej, od góry.

## Otwarte wątki

### 1. Po odbiorze A4 (2026-10-25): trzy zadania

- **Kategoria „0 pojazdów przy rekordach od API”** w `scripts/check-production.js`: dziś „aplikacja”, powinna być „dostawca” z ponowną kontrolą po 4 min (#95: 189 rekordów, wszystkie starsze niż 5 min). Szacunek 1 h z testem.
- **Niestabilny test kompasu w WebKit** (`test/e2e.js`, krok „compass turns the heading beam”): raz na ok. 15 przebiegów po `alpha 0` wiązka zostaje na `rotate(90deg)`. Przyczyna niepotwierdzona [Zgaduję: wcześniejsza pozycja GPS z kursem 90° nadpisuje kompas]. Po poprawce można włączyć `testy-webkit` do `bramka`. Szacunek 1–2 h.
- **Błędy 522 z API miasta:** wszystkie z Cloudflare FRA, więc lokalizacja nie jest przyczyną [Prawdopodobne]. Zgłoszenie do operatora API (dane.um.warszawa.pl) z datami z #88–#98 – po stronie właściciela.

### 2. Pomysł bez decyzji: oznaczenie pojazdów „poza trasą linii”

- **Kontekst:** w nocy (ok. 01:30) tramwaje 9 i 1 stały poza swoimi trasami. Najpewniej to zjazdy do zajezdni albo postój z numerem ostatniej linii. GTFS nie opisuje zjazdów, więc aplikacja tego nie wie [Prawdopodobne].
- **Propozycja:** wyróżnić pojazd daleko od trasy swojej linii (np. przygaszony znacznik i dopisek w panelu). Szacunek 2–4 h z testem. **Czeka na decyzję właściciela.**

### 3. Zaparkowane decyzje

- **WCAG:** docelowy poziom zaparkowany przez właściciela. Testy axe w E2E blokują tylko błędy `serious` i `critical`, lista wyjątków jest pusta.
- **Formatter (np. Prettier):** nie wybrany. Dziś jest tylko ESLint.
- **Reguła gałęzi `main` i CodeQL:** repozytorium jest już publiczne, więc oba są dostępne bez opłat – do włączenia przez właściciela (Settings → Rules: „Enforcement status: Active”; Security → Code scanning → CodeQL → Default setup).
- **Tematy (topics) repozytorium:** wciąż puste – do dodania w „About”.

## Uwagi do procesu (wnioski z tej sesji)

- Scalenie dwóch PR w krótkim odstępie anuluje oczekujący przebieg testów na `main` (tak było z #80). Nie szkodzi, bo następny commit ma własny przebieg i wdrożenie, ale wersja z anulowanym przebiegiem nigdy nie trafi na produkcję [Pewne].
- Dependabot: komentarze `@dependabot recreate` i `@dependabot rebase` działają z opóźnieniem. Przed scaleniem sprawdź, czy PR ma już nowy commit i zielony `testy`. #74 scalono jeszcze w starej wersji, z commitem danych metra (zmieniona była tylko data w `metro.geojson`, więc bez szkody). Od #80 workflowy danych pomijają gałęzie Dependabota.
- Po kliknięciu „Merge” sprawdź, czy commit naprawdę jest w `main`. Szkic PR (draft) nie daje się scalić, dopóki nie klikniesz „Ready for review”.

## Zrobione w tej sesji (dla kontekstu)

- `TESTY_I_JAKOSC.md` (raport dla audytora i na wdrożenie), prezentacja tego raportu w Artifact (15 slajdów), `PLAN_NAPRAWCZY_TESTOW.md`.
- P0 i P1 w kodzie: bramka CI z wykrywaniem zmian, pokrycie z progami, ESLint, axe w E2E, WebKit w CI, klasyfikacja alarmów z ponowną kontrolą, nagłówek `x-colo`, Dependabot, szablon PR, `LISTA_REGRESJI_RECZNEJ.md`, kolor przycisków „O serwisie” (wariant B), rezygnacja z pytania iOS o czujniki ruchu (`CONTEXT.md`).
- Kroki ręczne właściciela: Vercel Deployment Checks na `bramka`, UptimeRobot (słowo `"source":"live"` na `/api/vehicles`, alarm przetestowany), alerty i aktualizacje Dependabot.
- Wdrożenie Workera na `cloudflare/wrangler-action@v4` sprawdzone ręcznym przebiegiem 2026-10-12 ok. 02:00 – zielone.
- PR: #71, #73, #76–#82 oraz #74, #75 od Dependabota – wszystkie scalone; testy na `main` po ostatnim (#82) zielone.
