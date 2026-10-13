# Narration: one trimmed clip per phrase -> public/vo/<key>.wav (Kokoro-82M, voice af_heart, Apache-2.0).
# Model files (GitHub release of kokoro-onnx, not needed at render time):
#   curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
#   curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
# pip install kokoro-onnx soundfile; python scripts/lektor.py <dir with model files>
# Text matches VO in src/timing.ts; "wawEye" is spelled "Vav-Eye" (Polish W) only for the speech engine.
import sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

MODEL = sys.argv[1] if len(sys.argv) > 1 else "."
k = Kokoro(f"{MODEL}/kokoro-v1.0.onnx", f"{MODEL}/voices-v1.0.bin")
PHRASES = {"b1": "Warsaw never stops moving.", "b2a": "Your bus, live.", "b2b": "A free parking space.",
           "b2c": "Disruptions, before you hit them.", "b3": "All of it, from the city's open data.",
           "b4a": "Vav-Eye.", "b4b": "Open data, open for investment."}
for key, text in PHRASES.items():
    s, sr = k.create(text, voice="af_heart", speed=1.0, lang="en-us")
    nz = np.where(np.abs(s) > 0.01)[0]
    s = s[max(0, nz[0] - 240): nz[-1] + 2400]  # trim silence, keep 10 ms before and 100 ms after
    sf.write(f"public/vo/{key}.wav", s, sr)
    print(key, round(len(s) / sr, 3), "s")
