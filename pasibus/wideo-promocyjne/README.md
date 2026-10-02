# Pasibus – wideo promocyjne (30 s)

`pasibus-showreel.mp4` – 30 sekund, 1920×1080, 60 kl./s, H.264 + AAC. Showreel w konwencji „jednorożec przed debiutem na NYSE”.
Wszystko, co widać, powstaje z kodu w tym folderze i z prawdziwych danych pasibus.vercel.app; muzyka jest syntezowana od zera (bez sampli).

## Scenariusz (120 BPM, takt = 2 s)
| Czas | Scena | Co się dzieje |
|---|---|---|
| 0–2 s | Puls | pomarańczowa kropka bije w rytm, wokół krążą „pojazdy”, HUD ze współrzędnymi; okrągłe przejście w pomarańcz |
| 2–6 s | Hak | liczby z danych na żywo: 2 634 pojazdy · 245 linii · 1 miasto · „?” → „UNTIL NOW.” → zapadnięcie w kropkę, cisza |
| 6–8 s | Logo | wybuch, składanie ikony (kwadrat, autobus, koła), litery PASIBUS z animacją szerokości kroju |
| 8–12 s | Mapa | ~1100 pojazdów wylatuje z centrum na swoje prawdziwe pozycje; ślady GPS z 25 minut rysują sieć Warszawy; Wisła z danych OSM; przelot kamery do Ronda Dmowskiego |
| 11,5–12 s | Cięcie | mapa „wchodzi” w ekran telefonu, telefon odjeżdża na miejsce |
| 12–20 s | Produkt | 4 prawdziwe zrzuty aplikacji: mapa, tramwaj z danymi taboru, parkingi, utrudnienia; karty z danymi |
| 20–24 s | IPO | terminal giełdowy NYSE: PSBS, wykres z kamieniami milowymi z historii PR-ów, kafelki KPI |
| 24–26 s | Tablica LED | wyświetlacz jak w autobusie: linia „IPO”, następny przystanek: WALL STREET |
| 26–30 s | Finał | dzwon otwarcia sesji, logo, deszcz konfetti z taśmy giełdowej, adres, podpis o źródłach danych |

## Jak odtworzyć
Wymagania: Node 18+, `npm install` w `pasibus/` (playwright-core), Chromium, `ffmpeg`, ImageMagick (`convert`).
W sandboksie sesji Claude polecenia sieciowe uruchamiaj z `NODE_USE_ENV_PROXY=1`.
```bash
cd pasibus
node wideo-promocyjne/zbierz-migawki.js /tmp/migawki 100 15          # ~25 min jazdy na żywo + parkingi, utrudnienia, tabor
node wideo-promocyjne/przygotuj-dane.js /tmp/migawki /tmp/migawki     # → zasoby/dane-wideo.js
node wideo-promocyjne/przygotuj-wode.js                               # → zasoby/woda.js (Wisła z kafelków OSM)
node wideo-promocyjne/zrzuty-aplikacji.js                             # → zasoby/ekran-*.webp (produkcja, telefon 390×844 @3x)
node wideo-promocyjne/muzyka.js                                       # → zasoby/muzyka.wav
node wideo-promocyjne/renderuj.js                                     # → pasibus-showreel.mp4 (SUB=4: rozmycie ruchu, ~15–30 min)
```
Podgląd: `node wideo-promocyjne/podglad.js /tmp/podglad 2.2 9.5 14.8` zapisuje wybrane klatki. Szkic bez rozmycia ruchu: `SUB=1 node wideo-promocyjne/renderuj.js /tmp/szkic.mp4`.

## Pliki
- `kompozycja.html` – cała animacja; `window.seek(t)` rysuje klatkę dla czasu `t` (DOM + canvas, bez animacji CSS, więc render jest deterministyczny).
- `muzyka.js` – syntezator i aranżacja (stopa, klaśnięcia, hi-haty, bas z sidechainem, supersaw, riser, uderzenia, dzwon giełdowy, pogłos). Punkty synchronizacji opisują komentarze sekcji.
- `renderuj.js` – kilka kart Chromium renderuje równolegle; każda klatka to 4 podklatki uśrednione w ffmpeg (migawka 180°); ziarno filmowe dodaje ffmpeg.
- `wspolne.js` – lokalny serwer HTTP i start przeglądarki; `podglad.js` – pojedyncze klatki.
- `fonty/` – Archivo (zmienna szerokość i grubość) i JetBrains Mono, licencja SIL Open Font License.

## Źródła danych
Pojazdy, tabor, parkingi i utrudnienia: API m.st. Warszawy przez pasibus.vercel.app (2 października 2026, ok. 22:10). Woda: © OpenStreetMap contributors (ODbL). Notowanie „NYSE: PSBS” to żart – Pasibus nie jest notowany na żadnej giełdzie, co mówi też plansza końcowa.
