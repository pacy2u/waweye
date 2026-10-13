# wawEye – film dla inwestorów smart city (15 s, 16:9)

**`final/waweye-inwestorzy-16x9-1080p.mp4`**: 1920×1080, 30 kl./s, H.264 (BT.709) + AAC 48 kHz, −14 LUFS, true peak −1,5 dBTP, 15,0 s.
Arkusz klatek (1 klatka/s): `final/arkusz-klatek-1080p.png`.

Przesłanie: otwarte dane Warszawy już napędzają aplikację miejską na żywo; wawEye jest otwarte na inwestycję.
Mapa to prawdziwe ślady GPS 1 142 pojazdów z migawki 2 października 2026 (22:12–22:51 czasu warszawskiego); liczby na ekranie pochodzą z tej samej migawki.

## Bramki
Brief → scenariusz (`design/SCENARIUSZ.md`) → klatki stylu (`design/style-frames/`, wygląd: `design/LOOK.md`) → przejścia (`design/PRZEJSCIA.md`, `design/przejscia/`) → animatik 720p (`design/animatik-720p.mp4`) → build → finał. Każdą bramkę zatwierdzał właściciel. Kontrole: `design/KONTROLE.md`.

## Jak odtworzyć
```bash
cd video && npm install
npm run dane                          # src/dane.json z ../../wideo-promocyjne/zasoby (raz)
node scripts/muzyka.mjs               # public/audio: muzyka i SFX syntezowane w kodzie
# lektor (opcjonalnie, pliki są w public/vo): pip install kokoro-onnx soundfile; python scripts/lektor.py <katalog z modelem>
scripts/renderuj.sh out/film.mp4 1    # klatki PNG z Remotion + dźwięk → ffmpeg (BT.709, −14 LUFS)
scripts/kontrola-wideo.sh out/film.mp4 out/arkusz.png 1080
node scripts/kontrola-synchronizacji.mjs
GHOST=1 node scripts/klatki.mjs /tmp/k 60 155 205 300 440 && node scripts/kontrola-tekstu.mjs /tmp/k
```
Wszystkie liczby czasu są w `video/src/timing.ts`; jedna scena na beat w `video/src/scenes/`. Render nie korzysta z sieci.
Licencje: Archivo i JetBrains Mono (SIL OFL), lektor Kokoro-82M (Apache-2.0), zarys Wisły © współtwórcy OpenStreetMap (ODbL). Remotion: licencja darmowa dla osób prywatnych i firm do 3 pracowników.
