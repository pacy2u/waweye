// Every timing number of the film lives here (frames at 30 fps).
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 450; // 15 s

// Beats: [from, to) in frames.
export const BEATS = {
  b1: { from: 0, to: 84 },
  b2: { from: 84, to: 234 },
  b3: { from: 234, to: 318 },
  b4: { from: 318, to: 450 },
} as const;

// Narration clips (public/vo/*.wav): the frame each clip starts on and its length in frames.
export const VO = {
  b1: { at: 9, len: 50, text: 'Warsaw never stops moving.' },
  b2a: { at: 88, len: 31, text: 'Your bus, live.' },
  b2b: { at: 126, len: 38, text: 'A free parking space.' },
  b2c: { at: 172, len: 53, text: 'Disruptions, before you hit them.' },
  b3: { at: 238, len: 61, text: "All of it, from the city's open data." },
  b4a: { at: 328, len: 20, text: 'wawEye.' },
  b4b: { at: 352, len: 64, text: 'Open data, open for investment.' },
} as const;

// On-screen words: each line enters with its narration and leaves before the next one.
export const TEXT = {
  enter: 14, // frames for a word to settle
  stagger: 3, // frames between words
  exit: 8, // frames to leave
  lead: 2, // words start this many frames before their narration
};

// Real data time: sample index (0..99 over 22:12–22:51) as a function of the film frame.
export const DATA_TIME = { from: 0, to: 450, s0: 0, s1: 99 };

// Map reveal in beat 1: traces fade in from the centre outwards.
export const REVEAL = { from: 0, to: 60, perTrace: 18 };

// Camera keyframes: frame, zoom, world focus (x, y) and where on screen it sits.
export const CAMERA = [
  { f: 0, z: 1.0, wx: 960, wy: 560, sx: 960, sy: 540 },
  { f: 70, z: 1.12, wx: 980, wy: 560, sx: 960, sy: 540 },
  { f: 100, z: 3.3, wx: 1000, wy: 600, sx: 1300, sy: 480 },
  { f: 225, z: 3.5, wx: 1004, wy: 606, sx: 1300, sy: 480 },
  { f: 252, z: 1.05, wx: 980, wy: 560, sx: 1010, sy: 520 },
  { f: 318, z: 1.0, wx: 980, wy: 560, sx: 1010, sy: 520 },
] as const;

// Beat 2 accents: which object holds the accent colour, and when it hands over.
export const ACCENT = { bus: 88, parking: 126, incident: 172, busAgain: 234 };

// Beat 3 stats: first number lands with "open data", stagger between columns.
export const STATS = { at: 262, stagger: 4, count: 16 };

// Beat 4 end card. Carrier into it: the camera pulls the whole city into the bus dot while the dot
// travels to the logo's place and grows into the logo's orange square; the real logo file then fades in on top.
export const END = { mapOut: 316, mapOutLen: 14, url: 376 };
// The square lands (to) before the wordmark and "Vav-Eye" start, so the two never overlap.
export const MORPH = { from: 316, to: 330, z: 0.12, logoIn: 328, logoInLen: 4 };
export const LOGO = { x: 96, y: 250, size: 128 }; // top-left and size of the logo on the end card

// Map brightness under the beat 3 numbers (1 = full); small text has a knockout outline, so it keeps 4.5:1 over the lines.
export const MAP_DIM_B3 = 0.5;
