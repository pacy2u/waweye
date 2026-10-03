# Pasibus – komunikacja miejska w Warszawie na żywo

Mapa pojazdów (autobusy, tramwaje) w czasie rzeczywistym. Dane: [Lokalizacja pojazdów komunikacji miejskiej](https://dane.um.warszawa.pl/pl/catalogue/f319f602-7292-4e8c-b3d1-f5898aa9a638), m.st. Warszawa. Mapa: OpenStreetMap + Leaflet.

Funkcje: zoom (przyciski, scroll, pinch), odświeżanie co 10 s z płynnym ruchem pojazdów, kliknięcie pojazdu wyróżnia go (pomarańczowy pierścień, reszta wyszarzona) i pokazuje panel ze szczegółami, tryb „Śledź”, filtr typu i linii. Przycisk **lokalizacji** w prawym dolnym rogu (jak w Google Maps) pokazuje pozycję użytkownika niebieską kropką z okręgiem dokładności i przybliża do niej mapę; mapa podąża za użytkownikiem, dopóki jej nie przesunie (ikona z niebieskiej robi się szara, kolejne kliknięcie znów centruje). Na telefonach z kompasem (Android) kropka ma wiązkę pokazującą kierunek, w czasie jazdy kierunek z GPS. Pozycja nie opuszcza przeglądarki. Przycisk **Parking** (ikona P) pokazuje na mapie parkingi z liczbą wolnych miejsc (zielony: są wolne, czerwony: brak); po kliknięciu panel z wolnymi miejscami z podziałem na standardowe/dla niepełnosprawnych/elektryczne, pojemnością, godzinami, cennikiem i telefonem (zbiór „Wolne miejsca parkingowe”, odświeżany co minutę). Przycisk **Utrudnienia** (ikona ostrzeżenia) pokazuje utrudnienia w ruchu drogowym: punkty jako znaczniki, odcinki jako linie na mapie (żółte: trwają, niebieskoszare: zaplanowane, szare: zakończone); panel z opisem, datami i linkiem do infoulice.um.warszawa.pl. Po kliknięciu pojazdu panel pokazuje też dane ze zbioru [Pojazdy transportu publicznego](https://dane.um.warszawa.pl/pl/catalogue/a8295279-8bd5-4fec-8352-d7a7b96dc129): model, rok produkcji, nr rejestracyjny, operatora, zajezdnię, liczbę miejsc, wymiary, podłogę, klimatyzację, napęd, malowanie (łączone po numerze taborowym = numer pojazdu z lokalizacji). Wyświetlanie całej trasy linii jest zaparkowane.

## Źródło danych
API ZTM na nowym portalu: `POST https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow`, token w nagłówku `Authorization`, treść `{"type": 1}` (autobusy) lub `{"type": 2}` (tramwaje). Token generuje się na https://dane.um.warszawa.pl/key-api. Stary adres `api.um.warszawa.pl` z parametrem `apikey` nie przyjmuje tych tokenów.

Parkingi: `POST https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca` (ten sam token w `Authorization`, bez treści); odpowiedź `{"Parkings": [...]}`. Utrudnienia: `POST …/get_bin_utrudnienia_drogowe`, token w `Authorization`, odpowiedź to lista z polami `name`, `start_date`, `end_date`, `content`, `id`, `geo`. Dane o pojazdach: `POST …/get_ztm_pojazdy` (token w `Authorization`, bez treści), odpowiedź `{busy, tramwaje, markiBus, markiTramwaje, …}`; `/api/fleet` zwraca z niej tylko autobusy i tramwaje (cache 1 h). W trybie z Workerem Worker obsługuje zasoby `?type=1|2`, `?resource=parking`, `?resource=incidents` i `?resource=fleet` – po aktualizacji repo trzeba wkleić nowy kod `worker/index.js` do Cloudflare.

## Uruchomienie lokalne
```bash
cd pasibus
npm install
echo 'WARSAW_API_KEY=<token>' > .env   # token z https://dane.um.warszawa.pl/key-api
npm start                 # http://localhost:3000
MOCK=1 npm start          # dane symulowane, bez klucza
```

## Testy
```bash
npm test          # jednostkowe: normalizacja, błędy API, handler
npm run test:e2e  # przeglądarka (Chromium, desktop + mobile) na danych symulowanych
node scripts/check-production.js   # kontrola produkcji: pojazdy, parkingi, utrudnienia, tabor
```
W GitHub Actions (`.github/workflows/`):
- **Pasibus – testy**: oba zestawy testów przy każdym PR i po zmianie na `main` (zmiany samych plików `.md` nie zużywają minut).
- **Pasibus – monitoring produkcji**: co 2 godziny `scripts/check-production.js` sprawdza https://pasibus.vercel.app (także to, czy pojazdy na żywo znajdują się w zbiorze taboru). Przy awarii zakłada jedno zgłoszenie (issue) „[monitoring] pasibus.vercel.app nie działa poprawnie”, a GitHub wysyła e-mail. Po pierwszej udanej kontroli zgłoszenie zamyka się samo. Ręcznie: Actions → Pasibus – monitoring produkcji → Run workflow.
- Repo jest prywatne, więc obowiązuje darmowa pula minut Actions (2000 min/mies. na koncie GitHub Free). Monitoring zużywa ok. 360 min/mies., testy kilka minut na PR. Po wyczerpaniu puli zadania się zatrzymują, nie generując kosztów (przy domyślnym limicie wydatków 0 USD).

## Wdrożenie na Vercel
1. Vercel → **Add New → Project** → importuj repo `pacy2u/tst`.
2. **Root Directory**: `pasibus`. Framework: *Other*.
3. **Settings → Environment Variables**: `WARSAW_API_KEY` = token API z https://dane.um.warszawa.pl/key-api (Production + Preview).
4. **Deploy**. Aplikacja działa pod adresem `*.vercel.app` na komputerze i telefonie.

Klucz jest tylko po stronie serwera (`api/vehicles.js`); przeglądarka nigdy go nie widzi. Odpowiedzi są cache'owane na krawędzi przez 5 s, więc wielu użytkowników nie przeciąża API.

## Pośrednik Cloudflare Worker (gdy Vercel nie łączy się z API Warszawy)
Stary host `api.um.warszawa.pl` nie przyjmował połączeń z adresów Vercel/AWS (`UND_ERR_CONNECT_TIMEOUT`); jeśli nowy host zachowuje się tak samo, a przeglądarka nie może pytać API wprost (brak CORS). Rozwiązanie: Worker w Cloudflare trzyma klucz i odpytuje Warszawę, a funkcja Vercel pyta Worker.

1. Konto na cloudflare.com (darmowe) → **Workers & Pages → Create → Create Worker**, nazwa `pasibus-proxy`, Deploy.
2. **Edit code**: wklej zawartość `worker/index.js`, Deploy.
3. **Settings → Variables and Secrets** (typ *Secret*): `WARSAW_API_KEY` = token API z https://dane.um.warszawa.pl/key-api, `PROXY_SECRET` = dowolny długi losowy ciąg.
4. W Vercel (**Settings → Environment Variables**) dodaj: `UPSTREAM_URL` = adres Workera (`https://pasibus-proxy.<konto>.workers.dev`), `UPSTREAM_SECRET` = ten sam ciąg co `PROXY_SECRET`. Zrób **Redeploy**.

(Alternatywa z CLI: `cd worker && npx wrangler deploy`, potem `npx wrangler secret put WARSAW_API_KEY` i `PROXY_SECRET`.)

### Automatyczne wdrażanie Workera (bez wklejania kodu)
Workflow **Pasibus – wdrożenie Workera Cloudflare** wdraża `worker/` po każdym merge'u zmian w tym folderze do `main`. Jednorazowa konfiguracja w przeglądarce:
1. Cloudflare → **My Profile → API Tokens → Create Token** → szablon **Edit Cloudflare Workers** → Create. Skopiuj token.
2. Cloudflare → **Workers & Pages**: skopiuj **Account ID** (prawa kolumna).
3. GitHub → repo `pacy2u/tst` → **Settings → Secrets and variables → Actions → New repository secret**: `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID`.
4. **Actions → Pasibus – wdrożenie Workera Cloudflare → Run workflow**, żeby od razu wgrać aktualny kod.

Wdrożenie nie zmienia sekretów Workera (`WARSAW_API_KEY`, `PROXY_SECRET`), a `keep_vars = true` w `wrangler.toml` zachowuje zmienne ustawione w panelu. Bez sekretów workflow kończy się ostrzeżeniem i trzeba wkleić kod ręcznie jak wyżej.

## Struktura
- `public/` – front (Leaflet, `app.js`, `style.css`)
- `worker/` – opcjonalny pośrednik Cloudflare
- `api/*.js` – funkcje Vercel; `lib/` – logika API, mock, handler
- `dev-server.js` – serwer lokalny
- `scripts/check-production.js` – kontrola produkcji (monitoring)
- `ROADMAPA.md` – analiza produktu i plan rozwoju; `CONTEXT.md` – notatki dla kolejnych sesji
- `wideo-promocyjne/` – 30-sekundowy film promocyjny (`pasibus-showreel.mp4`) i kod, który go generuje z prawdziwych danych; wykluczony z wdrożenia przez `.vercelignore`
- `KOMUNIKAT_PRASOWY.md` – komunikat prasowy: cel, funkcje, źródła danych, plan rozwoju; `KOMUNIKAT_PRASOWY.html` – ten sam komunikat jako strona do udostępnienia (poza `public/`, więc Vercel jej nie publikuje)
