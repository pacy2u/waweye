#!/usr/bin/env bash
# Render + master. Usage: scripts/renderuj.sh <out.mp4> [scale]   (scale 0.6666666666666666 = 720p animatic, 1 = 1080p final)
# Remotion renders PNG frames and the audio mix; ffmpeg encodes the picture (BT.709, limited range, so the brand orange
# #FC4C02 survives: Remotion's own H.264 path decoded it as #FF5800) and brings the mix to -14 LUFS / -1 dBTP (two-pass, linear).
set -euo pipefail
OUT=$1; SCALE=${2:-1}
rm -rf out/klatki && mkdir -p out/klatki
npx remotion render src/index.ts Film out/klatki --sequence --image-format=png --scale="$SCALE" --log=error
npx remotion render src/index.ts Film out/mix.wav --codec=wav --log=error
M=$(ffmpeg -hide_banner -i out/mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$M" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)['$1']))"; }
ffmpeg -v error -y -framerate 30 -i out/klatki/element-%03d.png -i out/mix.wav \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 16 -profile:v high -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000" \
  -c:a aac -b:a 256k -ar 48000 -t 15 -movflags +faststart "$OUT"
echo "$OUT"
