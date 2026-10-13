#!/usr/bin/env bash
# Checks a rendered file: format, loudness, black / frozen / flash frames, and writes a frame sheet (one frame per second).
# Usage: scripts/kontrola-wideo.sh <file.mp4> <frame-sheet.png> <min-height>
set -uo pipefail
F=$1; SHEET=$2; MINH=${3:-1080}
echo "== format"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels -show_entries format=duration -of compact "$F"
echo "== loudness (target -14 LUFS ±1, true peak <= -1 dBTP)"
ffmpeg -hide_banner -nostats -i "$F" -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary/,$p' | grep -E "I:|Peak:"
echo "== black frames (none expected)"
ffmpeg -hide_banner -nostats -i "$F" -vf blackdetect=d=0.05:pix_th=0.06 -an -f null - 2>&1 | grep -c black_start | sed 's/^/black segments: /'
echo "== frozen stretches over 1 s (the end-card hold is expected)"
ffmpeg -hide_banner -nostats -i "$F" -vf freezedetect=n=0.0005:d=1 -an -f null - 2>&1 | grep -E "freeze_(start|end)" | sed 's/.*lavfi.freezedetect.//'
echo "== flashes (frame-to-frame mean luma jump > 40)"
ffmpeg -hide_banner -nostats -i "$F" -vf signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=- -an -f null - 2>/dev/null \
  | awk -F= '/YAVG/{y=$2; if (n++ && (y-p>40 || p-y>40)) {c++; print "jump at frame " n-1 ": " p " -> " y}; p=y} END {print "flash jumps: " c+0 "; luma range checked over " n " frames"}'
echo "== frame sheet: one frame per second -> $SHEET"
ffmpeg -v error -y -i "$F" -vf "select='not(mod(n\,30))',scale=480:-1,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:text='%{eif\:n*1\:d} s':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=0x000000AA,tile=4x4:padding=4:color=0x111111" -frames:v 1 -vsync vfr "$SHEET"
echo "== near-empty frames (fewer than 1 % of pixels differ from the background; added after the animatic's frame 0)"
ffmpeg -v error -i "$F" -vf "select='not(mod(n\,15))',scale=320:180" -fps_mode vfr -f rawvideo -pix_fmt rgb24 - | node -e "
  const W = 320 * 180 * 3; let buf = Buffer.alloc(0), k = 0, bad = 0;
  process.stdin.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= W) { const f = buf.subarray(0, W); buf = buf.subarray(W);
    let n = 0; for (let i = 0; i < W; i += 3) if (Math.abs(f[i] - 0x24) + Math.abs(f[i + 1] - 0x24) + Math.abs(f[i + 2] - 0x28) > 30) n++;
    const pct = n / (W / 3) * 100; if (pct < 1) { bad++; console.log('near-empty at ' + (k * 0.5).toFixed(1) + ' s: ' + pct.toFixed(2) + ' %'); } k++; } });
  process.stdin.on('end', () => console.log('near-empty frames: ' + bad + ' of ' + k + ' checked (every 0.5 s)'));"
echo "== brand colour (accent #FC4C02 and background #242428 after decoding, each channel within 3; added after Remotion's encoder shifted the orange to #FF5800)"
col() { ffmpeg -v error -ss 14 -i "$F" -frames:v 1 -vf "crop=$1,scale=1:1:flags=area" -f rawvideo -pix_fmt rgb24 - | od -An -tx1 | tr -d ' \n'; }
H=$(ffprobe -v error -select_streams v -show_entries stream=height -of default=nw=1:nk=1 "$F" | head -1); K=$(node -e "console.log($H/1080)")
cr() { node -e "const k=$K;console.log([$1].map(v=>Math.round(v*k)).join(':'))"; }
for pair in "fc4c02 $(cr 40,8,140,254) logo" "242428 $(cr 20,20,1700,600) background"; do set -- $pair
  got=$(col "$2"); node -e "const e='$1',g='$got';const d=[0,2,4].map(i=>Math.abs(parseInt(e.slice(i,i+2),16)-parseInt(g.slice(i,i+2),16)));console.log((Math.max(...d)<=3?'pass':'FAIL')+'  $3 expected #'+e+' got #'+g)"; done
