# Dane kolejowe (SKM, WKD, Koleje Mazowieckie) – stan rozpoznania

Notatka z sesji 2026-10-05. To punkt wyjścia do przyszłej analizy i ewentualnego rozwoju funkcji kolejowych w Waweye. Nic w kodzie nie zostało zmienione.

## Pytanie i decyzja właściciela

- Pytanie: czy dane, z których korzysta Waweye, obejmują kolej (SKM, WKD, Koleje Mazowieckie)?
- Decyzja: **same statyczne linie i stacje kolejowe nie są interesujące**. Funkcja ma sens dopiero wtedy, gdy pokazuje pociągi na mapie (pozycje na żywo albo szacowane), tak jak autobusy i tramwaje. Zadanie odłożone na później.

## Wnioski: co jest w obecnych źródłach

| Źródło | SKM | WKD | Koleje Mazowieckie | Uwagi |
|---|---|---|---|---|
| API pozycji pojazdów (`dane.um.warszawa.pl`, `lib/warsaw.js`) | nie | nie | nie | tylko `type` 1 (autobus) i 2 (tramwaj) |
| GTFS ZTM (`https://gtfs.ztm.waw.pl/last`) | **tak** (`route_type 2`, linie S…) | raczej nie | raczej nie | WKD i KM nie są przewoźnikami ZTM; niesprawdzone, bo surowego GTFS nie ma w repozytorium |
| Rejestr taboru („Pojazdy transportu publicznego”, `api/fleet.js`) | pole `kolej` | ? | ? | `lib/warsaw.js` pomija to pole; w danych testowych jest puste, zawartość produkcyjna nieznana |

Szczegóły:

- `scripts/trasy.js:14` świadomie pomija kolej (`TYPES = { 0: 'tram', 3: 'bus' }`), bo nie ma jej w API pojazdów. Dlatego w `public/data/trasy/` nie ma plików S1, S2 itd. Test `test/trasy.test.js` potwierdza pominięcie na przykładzie trasy `S1`.
- GTFS ZTM odpowiada tylko z Europy (Vercel `fra1`, Worker Cloudflare we Frankfurcie), a z sandboxa, z GitHub Actions i z USA nie. Odświeżanie tras już działa przez cron Vercel → Cloudflare KV (`CONTEXT.md`, `ROADMAPA.md` Faza 1).
- Metro ma ten sam problem: brak pozycji pociągów, a zadanie „Pozycje składów metra” w Fazie 2 jest zablokowane brakiem źródła.

## Ograniczenia z decyzji właściciela (ROADMAPA, sekcja 6)

- Rozkłady **tylko z oficjalnych zbiorów** (bez społecznościowego GTFS).
- Budżet 0 zł (Vercel Hobby, darmowe progi).
- Grupa docelowa: codzienni pasażerowie.

## Możliwe kierunki rozwoju

1. **Szacowane pozycje SKM z rozkładu GTFS ZTM.** Wykonalne na dziś: źródło jest oficjalne i już pobierane automatycznie. Pozycja wynikałaby z `stop_times` i `shapes` (interpolacja między stacjami według aktualnej godziny), bez opóźnień. Inaczej niż przy metrze, tu dane są. Ryzyko: pociąg na mapie może być w innym miejscu niż w rzeczywistości, więc trzeba go wyraźnie oznaczyć jako „wg rozkładu”. Ten sam mechanizm przydałby się później metru, jeśli pojawi się źródło jego rozkładu.
2. **Pozycje lub opóźnienia na żywo.** Wymagają nowego źródła. Kandydaci do sprawdzenia (**nic z tego nie zostało zweryfikowane w tej sesji**):
   - otwarte dane PKP PLK (zarządca infrastruktury; rozkład i dane o przebiegu pociągów, w tym opóźnienia na stacjach),
   - własne publikacje przewoźników SKM, WKD i Kolei Mazowieckich (GTFS, GTFS-RT, API),
   - Krajowy Punkt Dostępowy / `dane.gov.pl`.

   Do ustalenia dla każdego: czy jest oficjalny, jaka licencja, czy daje pozycje GPS czy tylko opóźnienia na stacjach, czy odpowiada z Europy (Vercel `fra1`) i czy mieści się w darmowych limitach.
3. **WKD i KM w rozkładzie.** Jeśli nie ma ich w GTFS ZTM, potrzebne są oficjalne GTFS przewoźników. Bez tego zostaje tylko SKM.

## Otwarte pytania na start przyszłej analizy

- Jakie dokładnie linie kolejowe są w GTFS ZTM (tylko SKM, czy też inne)? Do sprawdzenia w `routes.txt` przy najbliższym pobraniu albo w danych w Cloudflare KV.
- Czy pole `kolej` w rejestrze taboru zawiera dane SKM i czy da się je powiązać z czymkolwiek na żywo?
- Czy szacowanie pozycji z rozkładu (kierunek 1) spełnia oczekiwanie „pociągi na mapie”, czy potrzebne są wyłącznie dane na żywo?
- Czy rozpoznanie źródeł PLK i przewoźników da się zrobić w sesji (dostęp sieciowy środowiska), czy trzeba sondy z Europy jak przy GTFS ZTM?

## Proponowany pierwszy krok

Rozpoznanie źródeł z kierunku 2 (krótka tabela: źródło, oficjalność, licencja, zakres, osiągalność z `fra1`). Na tej podstawie decyzja: dane na żywo, szacowanie z rozkładu SKM albo dalsze wstrzymanie.
