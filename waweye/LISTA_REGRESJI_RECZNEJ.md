# wawEye – lista regresji ręcznej

Wykonaj przed scaleniem każdej zmiany widocznej dla użytkownika i odhacz w opisie PR (szablon PR ma na to pole). Zajmuje 20–30 min. Uzupełnia testy automatyczne tam, gdzie one nie sięgają: prawdziwy iPhone, prawdziwe dane, wolna sieć (`TESTY_I_JAKOSC.md` §11, `PLAN_NAPRAWCZY_TESTOW.md` B4).

Gdzie: podgląd Vercel z PR (`waweye-git-<gałąź>-ampm10.vercel.app`), czyli prawdziwe dane, nie MOCK.

## Urządzenia

- [ ] **iPhone z Safari** (prawdziwe urządzenie, nie emulator): pionowo i poziomo
- [ ] **Komputer** z Chrome albo Firefoksem (inną niż Chromium przeglądarką, jeśli się da)

## Mapa i pojazdy

- [ ] Pojazdy pojawiają się w ciągu kilku sekund, licznik w pasku statusu pasuje do mapy
- [ ] Kliknięcie pojazdu: panel z danymi taboru, trasa linii z przystankami; „Śledź” trzyma pojazd na środku
- [ ] Filtry Autobusy / Tramwaje / Metro i wyszukiwanie linii działają
- [ ] Na telefonie panel zwija się do paska i rozwija z powrotem

## Moja lokalizacja

- [ ] Pierwsze użycie: pytanie o zgodę, potem niebieska kropka i przybliżenie
- [ ] Na iPhonie aplikacja **nie** prosi o dostęp do ruchu i orientacji (decyzja w `CONTEXT.md`); stożek kierunku pojawia się dopiero w ruchu (kurs z GPS). Na Androidzie stożek obraca się także w miejscu
- [ ] Odmowa zgody: czytelny komunikat, przekreślony przycisk

## Warstwy

- [ ] Parkingi, strefy (SPPN, SCT), utrudnienia, Sport, DziejeSię: każda raz włączona, jeden panel otwarty, wyłączenie chowa warstwę
- [ ] Timelapse: suwaki Tempo i Czas działają, zamknięcie karty wraca do czasu rzeczywistego

## Sieć i błędy

- [ ] Wolna sieć (DevTools → Network → „Slow 4G”): komunikat „Ładowanie…”, potem dane; brak zawieszenia
- [ ] Tryb samolotowy na chwilę: komunikat o braku danych, po powrocie sieci dane wracają same

## Strona „O serwisie”

- [ ] Logo prowadzi do strony, film-przewodnik w formacie urządzenia (9:16 na telefonie), „Mapa” wraca do mapy

## Wynik

Wpisz w PR: urządzenia, wynik („wszystko OK” albo numer zgłoszenia z błędem) i datę. Błąd znaleziony tutaj dostaje najpierw test automatyczny, jeśli się da, potem poprawkę.
