#!/usr/bin/env bash
# Render + master. Usage: scripts/renderuj.sh <out.mp4> [scale]   (scale 0.6666666666666666 = 720p animatic, 1 = 1080p final)
# Remotion renders picture and the mix; ffmpeg brings the mix to -14 LUFS / -1 dBTP (two-pass, linear) and keeps the video stream.
set -euo pipefail
OUT=$1; SCALE=${2:-1}
mkdir -p out
npx remotion render src/index.ts Film out/surowy.mp4 --scale="$SCALE" --codec=h264 --crf=16 --audio-codec=aac --audio-bitrate=320k --log=error
M=$(ffmpeg -hide_banner -i out/surowy.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$M" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)['$1']))"; }
ffmpeg -v error -y -i out/surowy.mp4 -c:v copy \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000" \
  -c:a aac -b:a 256k -ar 48000 -t 15 -movflags +faststart "$OUT"
echo "$OUT"
