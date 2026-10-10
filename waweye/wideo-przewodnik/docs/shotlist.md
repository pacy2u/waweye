# wawEye – pierwsze kroki: scenariusz
30 s · 128 bpm · 64 uderzenia (1 uderzenie = 0,47 s) · formaty: 16x9 (główny), 9x16
Muzyka: syntezowany house, D-dur · bez lektora, napisy po polsku
Wygląd: grafit `#242428`, pomarańcz `#FC4C02` (jedyny akcent), Archivo (napisy) + JetBrains Mono (polecenia)

| # | uderzenia | czas | scena | na ekranie (zrzut) | ruch | wyjście | dźwięk |
|---|---|---|---|---|---|---|---|
| 1 | 0–4 | 0,0–1,9 | Hak: „Gdzie jest mój autobus?” | sama typografia na grafitowym tle; pomarańczowa kropka zamiast „?” | słowa wskakują po kolei (sprężyna), kropka pulsuje w rytm | kropka rośnie i zalewa kadr pomarańczem | uderzenie @0, pop @1, @2, tyk @3 |
| 2 | 4–8 | 1,9–3,8 | „wawEye. Warszawa na żywo.” | `desktop_viewport.png` (1090 pojazdów na mapie), logo | mapa wjeżdża z dołu i lekko się przybliża; licznik pojazdów | mapa zjeżdża w ramkę telefonu | whoosh @3,5, uderzenie @4 |
| 3 | 8–14 | 3,8–6,6 | 1 · Kliknij pojazd: trasa, kierunek, model | `m-trasa.png` (autobus 175, trasa, dane taboru) | telefon ląduje (sprężyna), kamera najeżdża na panel z modelem | telefon odjeżdża w lewo jak na taśmie | thud @8, pop @10 |
| 4 | 14–18 | 6,6–8,4 | 2 · Szukaj linii albo słowa | `m-szukaj.png` (wpisane „175”) | taśma; pole wyszukiwania podświetlone ramką akcentu | taśma | whoosh @14 |
| 5 | 18–22 | 8,4–10,3 | 3 · Wolne miejsca na parkingach | `m-parking.png` (175 wolnych z 420) | taśma; liczba wolnych miejsc wyskakuje obok telefonu | taśma | whoosh @18, pop @19 |
| 6 | 22–26 | 10,3–12,2 | 4 · Utrudnienia w ruchu | `m-utrudnienia.png` (Jagiellońska) | taśma; lekkie najechanie na panel | taśma | whoosh @22 |
| 7 | 26–30 | 12,2–14,1 | 5 · Sport i DziejeSię: Dziś / Jutro / 7 dni | `m-sport.png` + `m-dziejesie.png` obok siebie | dwa telefony, drugi wjeżdża pół taktu później | taśma | whoosh @26, pop @27 |
| 8 | 30–34 | 14,1–15,9 | 6 · Metro i strefy | `m-metro.png` + `m-strefy.png` | jak 7 | taśma | whoosh @30, pop @31 |
| 9 | 34–40 | 15,9–18,8 | 7 · Timelapse: ruch według rozkładu | `m-timelapse.png` (karta z suwakami) | telefon na środku, napis „×10 … ×1000” liczy w górę | telefon zmniejsza się w kropkę | whoosh @34, tyki @36–39, uderzenie @40 |
| 10 | 40–56 | 18,8–26,3 | Dla programistów: 4 kroki | typografia mono: `npm install` → `MOCK=1 npm start` → `localhost:3000` → `npm test` | każde polecenie pisze się znak po znaku co 4 uderzenia, poprzednie przesuwają się w górę; przy `localhost:3000` w rogu mała mapa z `desktop_viewport.png` | kursor rozciąga się w pasek i wymazuje kadr | tyk przy każdym poleceniu @40, 44, 48, 52 |
| 11 | 56–64 | 26,3–30,0 | Plansza końcowa | logo wawEye, `waweye.vercel.app`, „Komunikacja miejska w Warszawie na żywo” | litery adresu wskakują po kolei; plansza stoi 1,9 s | – | uderzenie @56, dzwonek @57 |

Formaty:
- 16x9: w scenach 3–9 telefon po lewej od środka, numer i podpis duże po prawej; w 7 i 8 dwa telefony obok siebie.
- 9x16: telefon duży na środku, podpis nad nim (poza strefą przycisków mediów społecznościowych); w 7 i 8 drugi telefon zastępuje pierwszy (cięcie na pół scenie) zamiast stać obok.

Najdłuższa przerwa bez nowego zdarzenia: uderzenia 8–14 (2,8 s; w środku pop @10).
