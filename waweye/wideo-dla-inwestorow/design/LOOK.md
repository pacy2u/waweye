# LOOK – wawEye dla inwestorów smart city (15 s, 16:9)

Źródło marki: `waweye/public/style.css` i `waweye/public/favicon.svg` (folderu `./brand` nie ma). Pliki marki wygrywają.

## Paleta

| Rola | Hex | Użycie |
| --- | --- | --- |
| Tło | `#242428` | charcoal aplikacji, cały film |
| Neutralny 1 | `#FFFFFF` | nagłówki, napisy (15,46:1 na tle) |
| Neutralny 2 | `#A7A7B1` | ślady GPS, liczby pomocnicze, źródło (6,48:1 na tle) |
| Akcent | `#FC4C02` | jedna rzecz, na którą patrzysz w danym ujęciu: autobus bohatera, parking, utrudnienie, słowo „investment”, ikona logo (4,55:1 na tle) |

Pochodne (nie nowe kolory, tylko krycie): ślady GPS `#A7A7B1` przy 22–35 % krycia, woda (Wisła) `#A7A7B1` przy 10 %.
Zasada: w kadrze naraz jest jeden element w akcencie. Tekst w akcencie tylko ≥ 78 px i tylko na gładkim tle (bez śladów pod spodem), bo 4,55:1 nie ma zapasu.

## Typografia

- Nagłówki: **Archivo** (zmienna, 800), licencja SIL OFL, plik z `wideo-promocyjne/fonty`.
- Dane i podpisy: **JetBrains Mono** (500), SIL OFL.
- Skala 1,25 od 32 px (dla 1080 px wysokości): 32 · 40 · 50 · 62,5 · 78 · 98 · 122.
  - H1 122 px (11,3 % wysokości) – plansza końcowa.
  - H2 78 px (7,2 %) – zdania lektora na ekranie (min. 5 % = 54 px spełnione).
  - Liczby statystyk 98 px; etykiety 32 px mono; źródło 25,6 px (32 ÷ 1,25) mono w `#A7A7B1`.
- Interlinia nagłówków 1,05; światło −1 % dla 122 i 98 px.

## Siatka

- Kadr 1920×1080, 30 kl./s.
- Title-safe 5 %: tekst w prostokącie x 96–1824, y 54–1026.
- Action-safe 3,5 %: wszystkie ważne kształty w x 67–1853, y 38–1042.
- Tekst lektora ma stałe miejsce: lewa krawędź x = 96, linia bazowa dolnego bloku y ≤ 1026. Napis jest jednocześnie napisami dla odtwarzania bez dźwięku (każde słowo lektora jest na ekranie).

## Język kształtów

- Zaokrąglony i płaski, jak ikona aplikacji (rx = 25 % boku). Bez cieni, bez gradientów, bez tekstury.
- Linie: ślady GPS 1,5 px; trasa bohatera 6 px w akcencie, zaokrąglone końce i złącza.
- Pojazdy: kropki 3 px (neutralne), bohater 14 px w akcencie z pierścieniem 3 px (tak jak wybrany pojazd w aplikacji: pomarańczowy pierścień).
- Znaczniki: parking = zaokrąglony kwadrat z „P”, utrudnienie = odcinek linii 6 px; zawsze ten sam promień narożnika 25 %.
- Logo: `favicon.svg` wklejone bez zmian; obok napis „wawEye” w Archivo 800 w akcencie, tak jak `.brand` w aplikacji.
