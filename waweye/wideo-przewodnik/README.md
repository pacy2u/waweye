# wawEye – pierwsze kroki (film-przewodnik, 30 s)

Krótki animowany przewodnik po funkcjach aplikacji dla nowych użytkowników, na podstawie `PIERWSZE_KROKI.md`. Dwa formaty: 16:9 (1920×1080) i 9:16 (1080×1920), 60 kl./s, H.264 + AAC, głośność −14 LUFS. Bez lektora; napisy po polsku, muzyka i efekty syntezowane w kodzie.

Wszystko, co widać na ekranach telefonów, to prawdziwe zrzuty produkcji (https://waweye.vercel.app, dane na żywo z 10 października 2026, ok. 16:50–17:30) – przycięte, powiększone i przesuwane, bez dorysowanych ekranów. Folder nie trafia na Vercel (`.vercelignore`).

## Scenariusz (128 BPM, 1 uderzenie = 0,47 s)
Szczegóły uderzenie po uderzeniu: `docs/shotlist.md`; rundy krytyki: `docs/critique.md`.

| Czas | Scena |
|---|---|
| 0–1,9 s | „Gdzie jest mój autobus?” – pomarańczowy „?” wciąga kamerę |
| 1,9–3,5 s | mapa na żywo z ok. 1090 pojazdami, karta „wawEye · Warszawa na żywo” |
| 3,5–27 s | 11 funkcji na „taśmie” telefonów: kliknij pojazd, Śledź, Szukaj, Parkingi, Utrudnienia, Sport, DziejeSię, Metro, Strefy, Timelapse, Gdzie jestem? – każda z powiększonym wycinkiem panelu |
| 27–30 s | plansza: wawEye, `waweye.vercel.app`, „Komunikacja miejska w Warszawie na żywo. Bez logowania i instalacji.” |

## Jak odtworzyć
Film powstał wtyczką Motion Reel (Claude Code): `film.js` to czysta funkcja czasu (`window.seek(t)` rysuje klatkę), a skrypty wtyczki renderują klatki, syntezują muzykę i efekty, miksują i kodują.
```bash
cd waweye
npm install                                           # playwright-core dla zrzuty.js
NODE_USE_ENV_PROXY=1 node wideo-przewodnik/zrzuty.js   # → assets/shots/m-*.png, d-*.png (produkcja, telefon 390×844 @3x)
# zrzuty w repo to WebP (assets/shots/*.webp, z nich czyta film.js); po nowych zrzutach przekonwertuj:
#   for f in wideo-przewodnik/assets/shots/m-*.png wideo-przewodnik/assets/shots/*_viewport.png; do convert "$f" -quality 92 -define webp:method=6 "${f%.png}.webp"; done
# skrypty wtyczki Motion Reel (<skill> = folder wtyczki), z folderu waweye/:
uv run <skill>/scripts/beats.py wideo-przewodnik --synth --flavor house --mode major --tonic D --drop 2   # muzyka + beats.json
node <skill>/scripts/render.mjs --film wideo-przewodnik --format 16x9 --video-only
node <skill>/scripts/render.mjs --film wideo-przewodnik --format 9x16 --video-only
node <skill>/scripts/sfx.mjs wideo-przewodnik && node <skill>/scripts/mix.mjs wideo-przewodnik   # → out/wideo-przewodnik/final.mp4, final_9x16.mp4
```
Podgląd w przeglądarce: serwer HTTP w `wideo-przewodnik/` i `index.html` (spacja: odtwarzanie, `?format=9x16`).

## Pliki
- `film.js` – cała animacja: lista funkcji `FEAT` (uderzenie, zrzut, podpis, wycinek panelu), lista akcentów `HITS` (każdy dostaje dźwięk w `sfx.mjs`).
- `lib/motion.js` – sprężyny w postaci zamkniętej, układ glifów, kadrowanie zrzutów (z wtyczki Motion Reel).
- `zrzuty.js` – zrzuty każdej funkcji z produkcji; `beats.json` – zmierzona siatka rytmu.
- `fonts/` – Archivo i JetBrains Mono (SIL Open Font License), te same co w `wideo-promocyjne/`.
- `final_16x9.mp4`, `final_9x16.mp4` – gotowe filmy (przekodowane do CRF 22 dla repozytorium, ok. 13 MB; render CRF 16 jest w `out/wideo-przewodnik/`); `plakat_16x9.png`, `plakat_9x16.png` – plakaty (klatka z 26,1 s).

## Źródła danych
Pojazdy, tabor, parkingi, utrudnienia, zajęcia sportowe i wydarzenia: API m.st. Warszawy przez waweye.vercel.app. Mapa i metro: © współtwórcy OpenStreetMap (ODbL).
