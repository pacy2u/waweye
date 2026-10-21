# Komunikat prasowy

**Warszawa, 2 października 2026 r.** · Do publikacji od zaraz

## wawEye: autobusy i tramwaje Warszawy na jednej mapie, na żywo

**Darmowa aplikacja webowa pokazuje, gdzie w tej chwili jest każdy warszawski autobus i tramwaj. Na tej samej mapie widać wolne miejsca na parkingach i utrudnienia w ruchu. wawEye działa w przeglądarce na telefonie i komputerze. Nie trzeba go instalować ani zakładać konta, nie ma reklam i nie zbiera danych o użytkownikach.**

wawEye (https://waweye.vercel.app) to nowa aplikacja dla osób, które codziennie jeżdżą warszawską komunikacją miejską. Pozycje wszystkich autobusów i tramwajów odświeżają się na mapie co 10 sekund, a pojazdy przesuwają się płynnie. Po kliknięciu w pojazd widać jego linię i brygadę oraz dane konkretnego egzemplarza: model, rok produkcji, zajezdnię, liczbę miejsc i to, czy ma niską podłogę, klimatyzację i miejsce na wózek. Wszystkie dane pochodzą z oficjalnego portalu otwartych danych m.st. Warszawy.

### Cel: najszybszy podgląd miasta na żywo

Planery podróży mówią, jak dojechać z punktu A do punktu B. wawEye odpowiada na pytanie, które pasażer zadaje sobie na przystanku: gdzie jest teraz mój autobus? Otwierasz stronę i od razu widzisz pojazdy, utrudnienia i parkingi na jednej mapie.

Aplikacja wawEye powstała z myślą o codziennych pasażerach. Miłośnicy komunikacji też znajdą tu coś dla siebie: szczegółowe dane o każdym pojeździe, od producenta po malowanie.

> „[Proponowany cytat do zatwierdzenia przez autora] Chciałem mieć aplikację, która otwiera się w sekundę i po prostu pokazuje, gdzie jest mój autobus. Bez reklam, bez logowania i bez śledzenia użytkowników.”
> – [imię i nazwisko], twórca wawEye

### Co potrafi wawEye

**Pojazdy na żywo**
- Wszystkie autobusy i tramwaje w Warszawie, odświeżane co 10 sekund.
- Wyszukiwanie linii (np. „175”) i filtr autobusy/tramwaje.
- Kliknięty pojazd zostaje wyróżniony, a pozostałe są wyszarzone. Panel pokazuje linię, brygadę i godzinę ostatniej aktualizacji pozycji.
- Tryb „Śledź”: mapa jedzie razem z wybranym pojazdem.
- Numery linii pojawiają się na mapie po przybliżeniu. Pojazdy, których ostatni sygnał o pozycji jest starszy niż 3 minuty, są przyciemnione, żeby nie wprowadzały w błąd.

**Karta pojazdu**
Model i producent, rok produkcji, numer rejestracyjny, operator, zajezdnia, liczba miejsc, wymiary, rodzaj podłogi, klimatyzacja, napęd, miejsca na wózek inwalidzki i dziecięcy, malowanie. Dane są dostępne dla 99,5% autobusów i 99,6% tramwajów na trasach (pomiar z 2 października 2026 r.).

**Parkingi**
Po włączeniu warstwy „P” na mapie pojawiają się parkingi z liczbą wolnych miejsc: zielone, gdy są miejsca, czerwone, gdy ich brak. Panel parkingu pokazuje wolne miejsca standardowe, dla osób z niepełnosprawnościami i dla aut elektrycznych, a także pojemność, godziny otwarcia, cennik i telefon, pod który można zadzwonić jednym dotknięciem. Dane odświeżają się co minutę.

**Utrudnienia w ruchu**
Utrudnienia drogowe są na mapie punktami lub odcinkami ulic, a kolor mówi, czy trwają, są zaplanowane, czy już się skończyły. Panel podaje opis, daty i link do miejskiego serwisu infoulice.um.warszawa.pl. Dane odświeżają się co minutę.

**Wygodnie i oszczędnie**
Aplikację zaprojektowano najpierw na telefon. Mapę przybliża się gestem lub przyciskami. Gdy karta z aplikacją jest w tle, wawEye wstrzymuje odświeżanie, co oszczędza baterię i transfer. Każdą zmianę w aplikacji sprawdzają automatyczne testy, a działanie wersji produkcyjnej jest kontrolowane co dwie godziny.

### Źródła danych

wawEye nie tworzy własnych danych o ruchu. Pokazuje to, co publikuje miasto, pobierając dane przez oficjalne API portalu [dane.um.warszawa.pl](https://dane.um.warszawa.pl).

| Co widać w aplikacji | Zbiór danych | Udostępnia | Odświeżanie |
|---|---|---|---|
| Pozycje autobusów i tramwajów | [Lokalizacja pojazdów komunikacji miejskiej](https://dane.um.warszawa.pl/pl/catalogue/f319f602-7292-4e8c-b3d1-f5898aa9a638) | m.st. Warszawa (dane ZTM) | co 10 s |
| Karta pojazdu | [Pojazdy transportu publicznego](https://dane.um.warszawa.pl/pl/catalogue/a8295279-8bd5-4fec-8352-d7a7b96dc129) | m.st. Warszawa | co godzinę |
| Parkingi | Wolne miejsca parkingowe | m.st. Warszawa | co minutę |
| Utrudnienia | Utrudnienia drogowe (serwis infoulice) | m.st. Warszawa | co minutę |
| Podkład mapy | [OpenStreetMap](https://www.openstreetmap.org/copyright) | współtwórcy OpenStreetMap (licencja ODbL) | – |

Odpowiedzi API są przez kilka sekund przechowywane w pamięci podręcznej serwera, więc rosnąca liczba użytkowników nie zwiększa obciążenia miejskiego systemu. Miejski zbiór pozycji pojazdów obejmuje autobusy i tramwaje, ale nie metro. Rozkłady jazdy, trasy i przystanki, które pojawią się w kolejnych wersjach, również będą pochodzić wyłącznie z oficjalnych zbiorów miasta.

### Co dalej: plan rozwoju

Rozwój wawEye zaplanowano w fazach. Terminy są orientacyjne.

**Październik 2026 – fundamenty (w dużej części gotowe).** Automatyczne testy przy każdej zmianie, automatyczne wdrażanie i monitoring wersji produkcyjnej z powiadomieniem o awarii. Dzięki temu problem z danymi zostaje wykryty, zanim zgłosi go użytkownik.

**Listopad 2026 – trasy i przystanki.**
- Po kliknięciu pojazdu cała trasa jego linii z przystankami.
- Warstwa przystanków z listą linii, które się na nich zatrzymują.
- Linki do wybranej linii lub pojazdu, które można zapisać w zakładkach albo wysłać znajomemu („zobacz, gdzie jest mój autobus”).
- Linie metra M1 i M2 ze stacjami na mapie.

**Grudzień 2026 – styczeń 2027 – dla codziennego pasażera.**
- Instalacja na ekranie głównym telefonu prosto ze strony, bez sklepu z aplikacjami.
- Ulubione linie i przystanki, zapisywane wyłącznie na urządzeniu użytkownika.
- Przycisk „Pokaż mnie” i najbliższe przystanki.
- Odjazdy z przystanku: rozkład połączony z pojazdami na żywo, które zbliżają się do przystanku.
- Szacowanie opóźnień pojazdów.
- Filtr dostępności: pojazdy niskopodłogowe, klimatyzowane, z miejscem na wózek.
- Czytelniejsza mapa utrudnień i lepsza obsługa czytników ekranu, klawiatury oraz Safari na iPhone'ach.

**I–II kwartał 2027 – kontekst miasta i skala.**
- Informacja, czy utrudnienie dotyczy linii, którą jedziesz.
- Rowery miejskie Veturilo na mapie.
- Powiadomienia o utrudnieniach na ulubionych liniach.
- Opcjonalny ciemny motyw mapy.
- Lżejsze dane i przygotowanie na większy ruch.
- Później, z niższym priorytetem: historia i punktualność linii.

Zakres funkcji opartych na rozkładach zależy od danych publikowanych przez miasto. Na przykład szacowanie opóźnień wymaga rozkładów z podziałem na brygady, a jeśli miasto nie udostępni dokładnego przebiegu tras, trasa zostanie narysowana przez kolejne przystanki.

wawEye nie będzie planerem podróży ani osobną aplikacją natywną. Nie wprowadzi kont użytkowników, reklam ani analityki zachowań. Ma pozostać szybkim, darmowym podglądem miasta na żywo.

### O wawEye

wawEye to niekomercyjna aplikacja webowa, która pokazuje warszawską komunikację miejską w czasie rzeczywistym na podstawie otwartych danych m.st. Warszawy. Nazwa łączy WAW, popularny skrót Warszawy, z angielskim „eye” (oko). Wersja produkcyjna powstała w dwa dni. Projekt nie ma budżetu: działa w darmowych planach usług chmurowych (Vercel, Cloudflare), a mapę rysuje biblioteka open source Leaflet na podkładzie OpenStreetMap. Klucz do miejskiego API jest przechowywany wyłącznie po stronie serwera.

Aplikacja: https://waweye.vercel.app

### Kontakt dla mediów

[imię i nazwisko]
[e-mail] · [telefon]

---

*Przed wysyłką: uzupełnij pola w nawiasach kwadratowych i zatwierdź albo zmień proponowany cytat. Fakty i liczby pochodzą z `README.md`, `CONTEXT.md` i `ROADMAPA.md` (stan na 2 października 2026 r.). Jeśli komunikat wychodzi później, sprawdź z `ROADMAPA.md`, czy terminy faz się nie zmieniły.*
