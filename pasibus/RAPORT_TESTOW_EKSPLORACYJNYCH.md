# Raport z testów eksploracyjnych: pasibus.vercel.app

Data: 2026-10-02. Przetestowano desktop (1280×800), telefon (360×640) i orientację poziomą (640×360) w Chromium (Playwright), z analizą kodu `app.js` i bezpośrednimi zapytaniami do API.

## Błędy i problemy

| # | Waga | Problem |
|---|---|---|
| 1 | Średnia | **Pasek górny nie mieści się na ekranie 360 px.** Zawartość ma 415 px przy 340 px kontenera, chip „Utrudnienia” kończy się na x≈425 px, poza ekranem (widać „Utru…”). Brak zawijania i przewijania, więc na wąskim telefonie trudno włączyć utrudnienia. |
| 2 | Niska | **Pole wyszukiwania za wąskie na desktopie.** Placeholder ucięty do „Linia, np. 1”. |
| 3 | Niska | **Panel utrudnień w poziomej orientacji (640×360) zajmuje 198 px z 360 px.** Panel przewija się wewnętrznie (zawartość 883 px), ale prawie nie zostaje miejsca na mapę. |
| 4 | Niska | **Utrudnienie bez daty końca pokazuje „– ?”** (np. „10.08.2026, 07:00 – ?”). Dotyczy 3 z 65 utrudnień; lepsze byłoby „bezterminowo”. |
| 5 | Niska | **Brak favicony.** `/favicon.ico` zwraca 404, co daje błąd w konsoli. |
| 6 | Niska | **Pierwsze dane po ok. 11,7 s w sieci testowej** (przez proxy kontenera), z napisem „Ładowanie…” bez wskaźnika postępu. API odpowiada w ok. 0,7 s (37 KB, brotli), więc do sprawdzenia na prawdziwej sieci. |
| 7 | Niska | **Wyłączenie obu typów pojazdów wysyła zapytanie o oba typy** (`types=1,2`). Użytkownik widzi 0 pojazdów, ale dane są pobierane. |
| 8 | Niska | **Ponowne włączenie typu powoduje chwilową pustkę na mapie.** Serwer filtruje po typie, więc markery są usuwane i wracają dopiero po kolejnym pollu. |
| 9 | Niska | **API przyjmuje każdą metodę HTTP z kodem 200** (POST, PUT, DELETE, OPTIONS). Nieprawidłowe `types` (`abc`, `99`, `1;drop`) są po cichu zamieniane na „wszystko”. CORS `*`. |
| 10 | Info | **7 z 1872 pojazdów ma dane starsze niż 180 s** (maks. 274 s), a aplikacja pokazuje je jak aktualne. |

## Co działa dobrze

- Filtry Autobusy/Tramwaje, w tym `aria-pressed`.
- Wyszukiwanie po prefiksie linii (`175`, `1`, `N`, spacje, `zzz`, ciąg z HTML); licznik przelicza się na bieżąco.
- Panel pojazdu, „Śledź” (zoom 15); zaznaczony pojazd zostaje widoczny mimo filtra.
- Parkingi (14): bez NaN/undefined/wartości ujemnych, wolne ≤ pojemność, poprawny cennik, godziny i `tel:`.
- Utrudnienia (65): wszystkie ze współrzędnymi i treścią, spójne statusy dat, poprawny link do infoulice.um.warszawa.pl.
- Wzajemne wykluczanie paneli (pojazd/parking/utrudnienie).
- Etykiety linii od zoomu 14; minimalny zoom 9 respektowany.
- Obsługa błędów API (500, HTML zamiast JSON, pusta lista) z czytelnymi komunikatami; tryb `mock` oznaczony „dane testowe”.
- Brak XSS w wyszukiwarce i w polu `line` (renderowane jako tekst).
- 10 szybkich przełączeń filtrów bez błędów JS.
- Dane pojazdów: brak duplikatów ID i pustych linii; pojazdy spoza Warszawy to linie podmiejskie 7xx.

## Czego nie sprawdzono

- Realnego zachowania kafelków OSM i ich wydajności (ograniczony dostęp w środowisku testowym).
- Wolnej sieci i trybu offline poza symulowanymi błędami API.
- Dostępności dla czytników ekranu (markery mapy mają `keyboard: false`, nie da się ich wybrać klawiaturą).
- Przeglądarek innych niż Chromium (Safari/iOS, Firefox).
