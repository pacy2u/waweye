# wawEye – pierwsze kroki: scenariusz
30 s · 128 bpm · 64 uderzenia (1 uderzenie = 0,47 s) · formaty: 16x9 (główny), 9x16
Muzyka: syntezowany house, D-dur · bez lektora, napisy po polsku
Wygląd: grafit `#242428`, pomarańcz `#FC4C02` (jedyny akcent), Archivo (napisy) + JetBrains Mono (numery, liczniki, adres)

| # | uderzenia | czas | scena | na ekranie (zrzut) | ruch | wyjście | dźwięk |
|---|---|---|---|---|---|---|---|
| 1 | 0–4 | 0,0–1,9 | Hak: „Gdzie jest mój autobus?” | sama typografia na grafitowym tle; pomarańczowa kropka zamiast „?” | słowa wskakują po kolei (sprężyna), kropka pulsuje w rytm | kropka rośnie i zalewa kadr pomarańczem | uderzenie @0, pop @1, @2, tyk @3 |
| 2 | 4–8 | 1,9–3,8 | „wawEye. Warszawa na żywo.” | `desktop_viewport.png` (1090 pojazdów na mapie), logo | mapa wjeżdża z dołu i lekko się przybliża; licznik pojazdów | mapa zjeżdża w ramkę telefonu | whoosh @3,5, uderzenie @4 |
| 3 | 8–16 | 3,8–7,5 | 1 · Kliknij pojazd: trasa, kierunek, model | `m-trasa.png` (autobus 175, trasa, dane taboru) | telefon ląduje (sprężyna); kamera schodzi z trasy na panel z modelem | telefon odjeżdża w lewo jak na taśmie | thud @8, pop @12 |
| 4 | 16–20 | 7,5–9,4 | 2 · Śledź: mapa jedzie za pojazdem | `m-sledz.png` (panel zwinięty do paska, przycisk „Śledź”) | taśma; przycisk „Śledź” pulsuje raz | taśma | whoosh @16, pop @17 |
| 5 | 20–24 | 9,4–11,3 | 3 · Szukaj linii albo słowa | `m-szukaj.png` (wpisane „175”) | taśma; najazd na pole wyszukiwania | taśma | whoosh @20 |
| 6 | 24–28 | 11,3–13,1 | 4 · Wolne miejsca na parkingach | `m-parking.png` (175 wolnych z 420) | taśma; najazd na liczbę wolnych miejsc | taśma | whoosh @24, pop @25 |
| 7 | 28–32 | 13,1–15,0 | 5 · Utrudnienia w ruchu | `m-utrudnienia.png` (Jagiellońska) | taśma; najazd na panel | taśma | whoosh @28 |
| 8 | 32–36 | 15,0–16,9 | 6 · Sport: zajęcia w mieście | `m-sport.png` (filtr Dziś / Jutro / 7 dni) | taśma; najazd na filtr „7 dni” | taśma | whoosh @32 |
| 9 | 36–40 | 16,9–18,8 | 7 · DziejeSię: wydarzenia | `m-dziejesie.png` | taśma | taśma | whoosh @36 |
| 10 | 40–44 | 18,8–20,6 | 8 · Metro M1 i M2 | `m-metro.png` (Świętokrzyska) | taśma; najazd na panel stacji | taśma | whoosh @40 |
| 11 | 44–48 | 20,6–22,5 | 9 · Strefy: płatne parkowanie i czysty transport | `m-strefy.png` (menu stref) | taśma; najazd na menu | taśma | whoosh @44 |
| 12 | 48–54 | 22,5–25,3 | 10 · Timelapse: ruch według rozkładu | `m-timelapse.png` (karta z suwakami) | taśma; napis „×10 … ×1000” liczy w górę | taśma | whoosh @48, tyki @50–53 |
| 13 | 54–58 | 25,3–27,2 | 11 · Gdzie jestem? | `m-lokalizacja.png` (niebieska kropka, pl. Zamkowy) | taśma; okrąg wokół kropki pulsuje | telefon zmniejsza się w kropkę | whoosh @54, uderzenie @58 |
| 14 | 58–64 | 27,2–30,0 | Plansza końcowa | logo wawEye, `waweye.vercel.app`, „Komunikacja miejska w Warszawie na żywo · bez logowania i instalacji” | litery adresu wskakują po kolei; plansza stoi 2,8 s | – | uderzenie @58, dzwonek @59 |

Formaty:
- 16x9: w scenach 3–13 telefon po lewej od środka, numer i podpis duże po prawej; obok telefonu wjeżdża następny (taśma).
- 9x16: telefon duży na środku, podpis nad nim (poza strefą przycisków mediów społecznościowych).

Najdłuższa przerwa bez nowego zdarzenia: uderzenia 48–54 (2,8 s; w środku tyki licznika tempa).
Bez sceny dla programistów (decyzja właściciela 2026-10-10): cały czas dla użytkownika końcowego.
