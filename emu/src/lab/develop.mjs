// S-DEVELOP: a stand-in for the still's signal processing: the sensor's exposure and the development that makes the
// picture REC records (src/lab/rec.mjs S-JPEGENC writes its JPEG; src/lab/play.mjs picture_frame calls it). The
// camera's own path (the sensor's read-out, TAKE's capture sequences, the image library's kind 0 request on the
// pipeline unit at 0x9c200000, docs/hle-gaps.md 4.3.9) does not run in the lab, and none of the arithmetic here is
// read from it: the sensor model, the merges and the looks are the harness's own, chosen to be plausible, cheap and
// repeatable. What IS the camera's: which mode a shot is in and its parameters, read from the firmware's own
// settings through its property getter at S2 (src/fw/models.mjs develop_props; X on E147 fw 1.1, 2026-11-15: each id and value is what
// the menu's own item wrote when it was set in a session), and the exposure, the firmware's plan where S-EXPOSE
// publishes it (src/lab/scene.mjs exposureOf). Pure JS (no node imports): it runs in the browser Worker too.
//
//   sensor      S-SCENE's linear composite (scene.mjs renderLinear) times the exposure, sampled through an RGGB Bayer
//               mosaic, with photon and read noise (seeded by the frame number), clipped at the full well and
//               quantized to 12 bits. So an overexposed area loses its colour and detail as a raw file's does, which
//               the live view's stand-in (renderFrame: one gamma curve on the composite) does not show.
//   single      one frame: bilinear demosaic, the look, the transfer curve (gamma 1/2.2, as the live view's)
//   Live ND     (1709 = 1; 1710 the stops, 1..6: ND2..ND64, X) the set shutter time T is the whole exposure: 2^stops
//               frames of T / 2^stops each, spread over T and averaged, so motion smears over T at the brightness of
//               one sub-frame (the firmware's plan gives the frame count 1 << level, 0x502f9776; how the image
//               processor combines them is not read: the mean is I). shortcut: at most ND_FRAMES sub-frames are
//               rendered, each smeared over its share of T; upgrade when a test needs every sub-frame.
//   HDR         (471 = 30 HDR1, 31 HDR2: I, the next value; 25.. are the menu's 3f / 5f / 7f brackets, which make
//               separate files and are developed as single frames here) the menu's own text: "Takes 4 pictures at
//               different exposures and composites automatically into a high contrast image." Four frames at
//               HDR_EV around the plan's exposure (I: the steps are not read), merged per photosite into radiance
//               with each frame weighted down near its clip and its noise floor, then compressed by a global curve
//               (HDR2 stronger, with more colour: I, the manual's "more impressive").
//   High Res    (771 = 1 tripod, 2 handheld, X) a larger picture: 2x the frame's sides on a tripod
//               (the manual's 80M from the 20M sensor), 1.5x handheld (50M, 1.58x). shortcut: the shifted frames are
//               not rendered; every pixel is sampled in all three colours (no demosaic, as the half-pixel shifts
//               give) with the noise of HIRES_FRAMES frames averaged; upgrade to render the shifts when a test needs
//               their motion artefacts.
//   Live GND    (2166 = 1; 2167 the stops, 1..3: GND2..GND8, X; 2168 the type, 2 soft (a blank camera's, which the menu shows as Soft) and 1 medium, 0 hard: X) the
//               top of the frame darkened by the stops across a band at the centre (the firmware's
//               iseq_half_nd_func_calc_comp_prm 0x5087f3d1 makes the line from a position and an angle, which the
//               shooting screen's controls set; here the defaults, the centre and level, I; the band's widths I).
//   the look    the picture mode: 897 names the property that holds it at the creative dial's position (898 the
//               standard modes, 901 the colour profiles, 988 the monochrome profiles, 899 the art filters, 900 the
//               colour creator), and that property's value is the mode (MODES: X, each value read as the picture
//               mode screen stepped through its list and showed the name). What a mode does to the picture is
//               LOOKS: saturation, contrast, tone, grain, blur, vignette and so on, each a plain guess at the
//               mode's character from its name and the manual's description (I, every row). The camera's own
//               curves, a profile's edited values and a modified firmware's films are not read: those reach the
//               file through the firmware's own EXIF (S-EXIFPRM), not its pixels.
//   brackets    (471 = 25 3f 2.0EV, 26 5f 2.0EV, 27 7f 2.0EV, 28 3f 3.0EV, 29 5f 3.0EV, X) one release makes that many
//               files, each a single frame at its step from the plan's exposure, in the order 0, -, +, --, ++ (I: the
//               order; developShots gives the steps, camapp.mjs S-CARD records a file for each). The files' EXIF
//               is the firmware's for the release: it does not tell the frames apart.
//   Focus Stacking (1356 = 1; 1495 the number of shots, 8 on a blank camera, X) that many frames with the focus
//               stepped from in front of the set distance to behind it, and each pixel taken from the frame that
//               is sharpest around it (the local contrast of its luminance). The step is the menu's "Set focus
//               differential" (2123, 1..10, 5 on a blank camera, X) in depths of field (I: its unit). The camera
//               also records each frame and crops the composite; the lab records the composite alone, uncropped.
//   Multiple Exposure (266 = 2: X, the menu's On; 267 = 1 Auto Gain, X) two releases make one picture: the second
//               release's file is both exposures added on the sensor's scale, or their mean with Auto Gain. The
//               first release records no file (developShots gives none for it; I: the camera keeps the first
//               frame and records the composite). With Overlay (268 = 1, X: the menu takes it once a raw file is
//               on the card, and shows its picture selection) the first exposure is a raw picture from the card
//               and one release makes the composite: the lab takes the newest picture it recorded a raw file
//               for (play.mjs; I: which picture the selection screen chose is not read).
//   raw         (1366 = 14..17, a +RAW image quality, X) the release also records a raw file: one frame's sensor
//               exposure, the mosaic before any merge or look (developRaw), in the lab's own container
//               (src/lab/orf.mjs), written by REC_FILE natively as an ORF (src/lab/rec.mjs S-RAWFILE).
// Not developed (the stand-in has no model): image size and compression (the picture is the live view's frame
// size, or High Res's multiple).
import { renderLinear, exposureOf, MIN_FOCUS_M } from './scene.mjs';

// the picture mode by the property 897 names and its value (X: E147's)
export const MODES = {
  898: { 0: 'Vivid', 1: 'Natural', 2: 'Muted', 3: 'Monochrome', 5: 'Portrait', 6: 'Custom', 7: 'i-Enhance', 28: 'Underwater' },
  901: { 54: 'Color Profile 1', 55: 'Color Profile 2', 56: 'Color Profile 3', 64: 'Color Profile 4' },
  988: { 57: 'Monochrome Profile 1', 58: 'Monochrome Profile 2', 59: 'Monochrome Profile 3', 65: 'Monochrome Profile 4' },
  899: { 29: 'Pop Art I', 30: 'Pop Art II', 9: 'Soft Focus', 31: 'Pale&Light Color I', 32: 'Pale&Light Color II', 11: 'Light Tone',
    33: 'Grainy Film I', 34: 'Grainy Film II', 35: 'Pin Hole I', 36: 'Pin Hole II', 37: 'Pin Hole III', 38: 'Diorama I', 39: 'Diorama II',
    40: 'Cross Process I', 41: 'Cross Process II', 16: 'Gentle Sepia', 42: 'Dramatic Tone I', 43: 'Dramatic Tone II', 44: 'Key Line I',
    45: 'Key Line II', 46: 'Watercolor I', 47: 'Watercolor II', 48: 'Vintage I', 49: 'Vintage II', 50: 'Vintage III', 51: 'Partial Color I',
    52: 'Partial Color II', 53: 'Partial Color III', 61: 'Bleach Bypass I', 62: 'Bleach Bypass II', 63: 'Instant Film' },
  900: null,                                     // the colour creator: one look, whatever the property holds
};
// What a look does (I, every row). sat: saturation; con: contrast about mid-grey; ev: brightness in stops; mono; tint:
// [r, g, b] gains on the coded values; gamma: [r, g, b] exponents (a cross-processed film's crossed curves); fade: the
// blacks lifted and the whites lowered; soft: a blurred copy mixed in; tilt: the top and bottom blurred (a miniature);
// vig: darker corners; grain: noise (8-bit sigma); post: tone levels; edge: lines drawn at edges; keep: the hue kept
// (0..1, red 0) with the rest monochrome
export const LOOKS = {
  'Natural': {}, 'Custom': {}, 'Color Creator': {}, 'Color Profile 1': {},
  'Vivid': { sat: 1.35, con: 1.1 }, 'Muted': { sat: 0.75, con: 0.9 }, 'Portrait': { sat: 0.95, con: 0.92, tint: [1.03, 1, 0.97] },
  'i-Enhance': { sat: 1.2, con: 1.15 }, 'Underwater': { sat: 1.15, tint: [1.12, 1, 0.9] }, 'Monochrome': { mono: true },
  'Color Profile 2': { sat: 1.25, con: 1.2 }, 'Color Profile 3': { sat: 1.5, con: 1.1 }, 'Color Profile 4': { sat: 0.85, con: 0.8, fade: 0.06 },
  'Monochrome Profile 1': { mono: true }, 'Monochrome Profile 2': { mono: true, con: 1.35, grain: 9, vig: 0.25 },
  'Monochrome Profile 3': { mono: true, con: 1.5, ev: 0.4, grain: 5 }, 'Monochrome Profile 4': { mono: true, con: 0.75, fade: 0.08 },
  'Pop Art I': { sat: 1.7, con: 1.1 }, 'Pop Art II': { sat: 1.7, con: 1.25, ev: 0.3 },
  'Soft Focus': { soft: 0.5, ev: 0.2 }, 'Pale&Light Color I': { sat: 0.6, fade: 0.15, ev: 0.4, tint: [0.97, 1, 1.04] },
  'Pale&Light Color II': { sat: 0.6, fade: 0.15, ev: 0.4, tint: [1.04, 1, 0.96] }, 'Light Tone': { con: 0.65, fade: 0.1, sat: 0.85 },
  'Grainy Film I': { mono: true, con: 1.7, grain: 16 }, 'Grainy Film II': { mono: true, con: 1.25, grain: 12 },
  'Pin Hole I': { vig: 0.75, sat: 1.15, tint: [1.02, 1, 0.94] }, 'Pin Hole II': { vig: 0.75, sat: 0.9, tint: [0.94, 1, 1.06] },
  'Pin Hole III': { vig: 0.75, sat: 1.1, tint: [1.08, 0.98, 0.9] },
  'Diorama I': { tilt: 'y', sat: 1.4, con: 1.15 }, 'Diorama II': { tilt: 'x', sat: 1.4, con: 1.15 },
  'Cross Process I': { gamma: [0.85, 0.75, 1.25], sat: 1.2, con: 1.15 }, 'Cross Process II': { gamma: [0.75, 1.2, 0.9], sat: 1.2, con: 1.15 },
  'Gentle Sepia': { mono: true, tint: [1.08, 1, 0.82], con: 0.9, soft: 0.15 },
  'Dramatic Tone I': { con: 1.6, sat: 0.8, ev: -0.4, soft: -0.6 }, 'Dramatic Tone II': { mono: true, con: 1.7, ev: -0.4, soft: -0.6 },
  'Key Line I': { post: 5, edge: 1, sat: 1.2 }, 'Key Line II': { post: 4, edge: 1, sat: 0.7, fade: 0.08 },
  'Watercolor I': { post: 7, sat: 0.8, ev: 0.7, fade: 0.12, edge: 0.3 }, 'Watercolor II': { post: 7, sat: 0.8, ev: 0.7, fade: 0.12 },
  'Vintage I': { fade: 0.12, sat: 0.85, tint: [1.06, 1, 0.9] }, 'Vintage II': { fade: 0.14, sat: 0.8, tint: [0.95, 1.02, 1.05] },
  'Vintage III': { fade: 0.1, sat: 0.7, tint: [1.04, 1.02, 0.92], vig: 0.3 },
  'Partial Color I': { keep: 0 }, 'Partial Color II': { keep: 0.16 }, 'Partial Color III': { keep: 0.62 },
  'Bleach Bypass I': { sat: 0.45, con: 1.4 }, 'Bleach Bypass II': { sat: 0.5, con: 1.25, ev: 0.3, tint: [0.97, 1, 1.03] },
  'Instant Film': { fade: 0.1, con: 1.1, gamma: [0.95, 0.92, 1.1], vig: 0.2 },
};
const DEFAULT_LOOK = 'Natural';
export const HDR_MODES = { 30: 'hdr1', 31: 'hdr2' };
export const HDR_EV = [-3, -1, 1, 3];
export const BRACKETS = { 25: [3, 2], 26: [5, 2], 27: [7, 2], 28: [3, 3], 29: [5, 3] };   // 471: [frames, EV step]
export const STACK_STEP = 5, COC_MM = 0.015;      // a blank camera's focus differential; Four Thirds' circle of confusion
export const ND_FRAMES = 8, HIRES_FRAMES = { 1: 8, 2: 12 }, HIRES_SCALE = { 1: 2, 2: 1.5 };
const GND_TYPES = { 2: 'soft', 1: 'medium', 0: 'hard' };   // 2168's values
const GND_BAND = { soft: 0.3, medium: 0.12, hard: 0.02 };   // the transition's height as a fraction of the frame's
const BITS = 12, WHITE = (1 << BITS) - 1;
const FULL_WELL = 24000, READ_E = 3, BASE_ISO = 200;   // electrons at the clip at the base ISO; read noise

// The shot's development settings from the firmware's properties: props the model's ids (develop_props), get(id) ->
// value (lab.get). A value outside what the menu was seen to write is kept as read and developed as the plain case
// (report.unknown lists them). A body without develop_props develops every shot as the plain case (plainSettings).
export function developSettings(props, get) {
  const v = Object.fromEntries(Object.entries(props).map(([k, id]) => [k, get(id)]));
  const unknown = [];
  // the picture mode: the value of the property 897 names (a body's develop_props may give none: the plain look)
  let look = DEFAULT_LOOK;
  if (v.group !== undefined) {
    const group = MODES[v.group], mode = Object.hasOwn(MODES, v.group) ? get(v.group) : null;
    if (group === null) look = 'Color Creator';
    else if (group && group[mode]) look = group[mode];
    else unknown.push(group ? `picture mode ${v.group}=${mode}` : `group ${v.group}`);
    v.mode = mode;
  }
  const hdr = HDR_MODES[v.hdr] ?? null;
  const high_res = HIRES_SCALE[v.high_res] ? v.high_res : (v.high_res && unknown.push(`high_res ${v.high_res}`), 0);
  const nd = v.nd === 1 ? Math.min(Math.max(v.nd_stops, 1), 7) : 0;
  const gnd = v.gnd === 1 ? { stops: Math.min(Math.max(v.gnd_stops, 1), 5), type: GND_TYPES[v.gnd_type] ?? (unknown.push(`gnd_type ${v.gnd_type}`), 'soft') } : null;
  const bracket = BRACKETS[v.hdr] ?? null;
  if (v.hdr && !hdr && !bracket) unknown.push(`hdr ${v.hdr}`);
  const stack = v.stack === 1 ? { shots: Math.min(Math.max(v.stack_shots, 2), 15), step: Math.min(Math.max(v.stack_step ?? STACK_STEP, 1), 10) } : null;
  const multi = v.multi === 2 ? { auto_gain: v.multi_gain === 1, overlay: v.overlay === 1 } : (v.multi && unknown.push(`multi ${v.multi}`), null);
  // the image quality (1366: 10 LSF, 11 LF, 12 LN, 13 MN, and 14..17 the same with +RAW, X: the menu's list; RAW
  // alone, 9: I, the menu refused it on the blank camera)
  const q = v.quality ?? 11, raw = q === 9 || (q >= 14 && q <= 17), jpeg = q !== 9;
  if (v.quality !== undefined && (q < 9 || q > 17)) unknown.push(`quality ${q}`);
  return { look, hdr, bracket, high_res, nd, gnd, stack, multi, raw, jpeg, props: v, unknown };
}
export const plainSettings = () => ({ look: DEFAULT_LOOK, hdr: null, bracket: null, high_res: 0, nd: 0, gnd: null, stack: null, multi: null, raw: false, jpeg: true, props: null, unknown: [] });
// The raw of a capture: one frame's sensor exposure at the plan's exposure (ev: a bracket's step), the RGGB mosaic
// before any merge or look: { w, h, data: Uint16Array of 12-bit values } (src/lab/orf.mjs writes its file)
export function developRaw(view, width, height, ev = 0) {
  const sc = view.scene, e = exposureOf(sc), w = even(width), h = even(height);
  return { w, h, data: Uint16Array.from(expose(renderLinear(sc, w, h, view.t, e.shutter_s), e.exposure * 2 ** ev, e.iso, view.frame_no)) };
}
// The exposure steps (EV) of the files one release makes: a bracket's, else one frame at the plan's exposure
// (first: Multiple Exposure's first release, which records nothing)
export function developShots(settings, first = false) {
  if (settings.multi && first) return [];
  if (!settings.bracket) return [0];
  const [frames, ev] = settings.bracket, out = [0];
  for (let k = 1; out.length < frames; k++) out.push(-k * ev, k * ev);
  return out;
}
// |Laplacian| of the luminance of [R, G, B], box-summed over (2r + 1)^2: how sharp the picture is around each pixel
function sharpness([R, G, B], w, h, r = 4) {
  const n = w * h, L = new Float32Array(n), a = new Float32Array(n), t = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = R[i] + 2 * G[i] + B[i];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; a[i] = Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]); }
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += a[y * w + x]; if (x > 2 * r) s -= a[y * w + x - 2 * r - 1]; t[y * w + Math.max(x - r, 0)] = s; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) { s += t[y * w + x]; if (y > 2 * r) s -= t[(y - 2 * r - 1) * w + x]; a[Math.max(y - r, 0) * w + x] = s; } }
  return a;
}

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return () => (u() + u() + u() - 1.5) * 2;      // about a unit normal (variance 1)
}
// One exposure of the linear composite L ({w, h, R, G, B}) at `gain` on the sensor at `iso`: a Float32Array of w * h
// raw values 0..WHITE, RGGB (mosaic) or three planes (full: every colour at every pixel), `frames` exposures averaged
function expose(L, gain, iso, seed, { full = false, frames = 1 } = {}) {
  const { w, h } = L, n = w * h, well = FULL_WELL * BASE_ISO / Math.max(iso, 1), norm = rng(seed), k = 1 / Math.sqrt(frames);
  const site = (v) => {
    const e = Math.max(v * gain, 0) * well;
    const raw = Math.round((e + norm() * Math.sqrt(e + READ_E * READ_E) * k) / well * WHITE);
    return raw < 0 ? 0 : raw > WHITE ? WHITE : raw;
  };
  if (full) return [L.R, L.G, L.B].map((p) => Float32Array.from(p, site));
  const out = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = site(y & 1 ? (x & 1 ? L.B[i] : L.G[i]) : (x & 1 ? L.G[i] : L.R[i]));
  }
  return out;
}
// Bilinear demosaic of an RGGB mosaic: [R, G, B] planes, each missing colour the mean of its nearest sites
function demosaic(m, w, h) {
  const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
  const at = (x, y) => m[Math.min(Math.max(y, 0), h - 1) * w + Math.min(Math.max(x, 0), w - 1)];
  // (a clamped neighbour must keep its colour: step 2 back inside at an edge)
  const px = (x, d) => (x + d < 0 || x + d >= w ? x - d : x + d), py = (y, d) => (y + d < 0 || y + d >= h ? y - d : y + d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = m[i];
    const hz = (at(px(x, -1), y) + at(px(x, 1), y)) / 2, vt = (at(x, py(y, -1)) + at(x, py(y, 1))) / 2;
    const dg = (at(px(x, -1), py(y, -1)) + at(px(x, 1), py(y, -1)) + at(px(x, -1), py(y, 1)) + at(px(x, 1), py(y, 1))) / 4;
    if (!(y & 1) && !(x & 1)) { R[i] = v; G[i] = (hz + vt) / 2; B[i] = dg; }
    else if ((y & 1) && (x & 1)) { B[i] = v; G[i] = (hz + vt) / 2; R[i] = dg; }
    else if (!(y & 1)) { G[i] = v; R[i] = hz; B[i] = vt; }
    else { G[i] = v; B[i] = hz; R[i] = vt; }
  }
  return [R, G, B];
}
// A box blur of radius r, twice (about a Gaussian), of the plane p: a new plane
function blur(p, w, h, r) {
  const a = Float32Array.from(p), t = new Float32Array(p.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0, c = 0;
      for (let k = 0; k <= r && k < w; k++) { s += a[o + k]; c += 1; }
      for (let x = 0; x < w; x++) {
        t[o + x] = s / c;
        if (x + r + 1 < w) { s += a[o + x + r + 1]; c += 1; }
        if (x - r >= 0) { s -= a[o + x - r]; c -= 1; }
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let k = 0; k <= r && k < h; k++) { s += t[k * w + x]; c += 1; }
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / c;
        if (y + r + 1 < h) { s += t[(y + r + 1) * w + x]; c += 1; }
        if (y - r >= 0) { s -= t[(y - r) * w + x]; c -= 1; }
      }
    }
  }
  return a;
}
// A look's work on the coded picture E ([r, g, b] planes, 0..255), in place (LOOKS' fields)
function applyLook(E, w, h, K, seed) {
  const n = w * h, [R, G, B] = E;
  if (!Object.keys(K).length) return;
  const con = K.con ?? 1, sat = K.mono ? 0 : K.sat ?? 1, fade = K.fade ?? 0, tint = K.tint ?? [1, 1, 1], gm = K.gamma ?? null;
  for (let i = 0; i < n; i++) {
    let r = R[i], g = G[i], b = B[i];
    if (gm) { r = 255 * (r / 255) ** gm[0]; g = 255 * (g / 255) ** gm[1]; b = 255 * (b / 255) ** gm[2]; }
    let l = 0.299 * r + 0.587 * g + 0.114 * b, k = sat;
    if (K.keep !== undefined) {                    // the hue's distance from the one kept (a turn is 1)
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const hue = d < 12 ? -1 : (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
      const far = hue < 0 ? 1 : Math.min(Math.abs(hue - K.keep), 1 - Math.abs(hue - K.keep));
      k = far < 0.07 ? 1.2 : 0;
    }
    r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
    r = 127.5 + (r - 127.5) * con; g = 127.5 + (g - 127.5) * con; b = 127.5 + (b - 127.5) * con;
    if (fade) { r = 255 * fade + r * (1 - 1.6 * fade); g = 255 * fade + g * (1 - 1.6 * fade); b = 255 * fade + b * (1 - 1.6 * fade); }
    R[i] = r * tint[0]; G[i] = g * tint[1]; B[i] = b * tint[2];
  }
  const rad = Math.max(2, Math.round(w / 60));
  if (K.soft || K.tilt) {
    for (const p of E) {
      const q = blur(p, w, h, K.tilt ? Math.round(rad / 2) : rad);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // soft: the blurred copy mixed in (below 0: taken away, more local contrast); tilt: by the distance from the middle band
        const m = K.tilt ? Math.min(Math.max((Math.abs((K.tilt === 'y' ? y / h : x / w) - 0.5) - 0.12) / 0.2, 0), 1) : K.soft;
        p[i] = p[i] * (1 - m) + q[i] * m;
      }
    }
  }
  if (K.post) for (const p of E) for (let i = 0; i < n; i++) p[i] = Math.round(Math.min(Math.max(p[i], 0), 255) / 255 * (K.post - 1)) / (K.post - 1) * 255;
  if (K.edge) {
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    const S = blur(L, w, h, 1);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, d = Math.abs(S[i + 1] - S[i - 1]) + Math.abs(S[i + w] - S[i - w]);
      if (d > 14) { const k = 1 - K.edge * Math.min(1, (d - 14) / 20); R[i] *= k; G[i] *= k; B[i] *= k; }
    }
  }
  if (K.vig || K.grain) {
    const norm = rng(seed + 977);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, dx = x / w - 0.5, dy = y / h - 0.5, v = K.vig ? 1 - K.vig * Math.min(1, (dx * dx + dy * dy) * 2) ** 1.5 : 1;
      const gr = K.grain ? norm() * K.grain : 0;
      R[i] = R[i] * v + gr; G[i] = G[i] * v + gr; B[i] = B[i] * v + gr;
    }
  }
}
const even = (v) => 2 * Math.round(v / 2);

// The picture of a capture: view is S-SCENE's ({scene, t, frame_no}, src/lab/play.mjs scene_key), width x height the
// frame's size, settings developSettings'. Returns { frame: [w, h, rows] (YCbCr 4:2:2, the live-view bank's format),
// report: { mode, frames, size, look, shutter_s, iso, gnd, clipped (the fraction of photosites at the full well in
// the frame at the plan's exposure), unknown } }
// ev: the frame's step from the plan's exposure (a bracket's, developShots). A view with multi_first (play.mjs: the
// view of Multiple Exposure's first release) is the pair's second and develops both.
export function developFrame(view, width, height, settings = plainSettings(), ev = 0) {
  const sc = view.scene, e0 = exposureOf(sc), e = { ...e0, exposure: e0.exposure * 2 ** ev }, seed = view.frame_no;
  const mode = settings.high_res ? 'high-res' : settings.hdr ? settings.hdr : settings.nd ? 'live-nd' : settings.stack ? 'focus-stack'
    : settings.multi ? 'multi' : 'single';
  const scale = settings.high_res ? HIRES_SCALE[settings.high_res] : 1;
  const w = even(width * scale), h = even(height * scale), n = w * h;
  let planes, frames = 1, white = 1, clipped;
  const clip = (m) => { let c = 0; for (let i = 0; i < m.length; i++) if (m[i] >= WHITE) c += 1; return c / m.length; };
  if (mode === 'high-res') {
    frames = HIRES_FRAMES[settings.high_res];
    planes = expose(renderLinear(sc, w, h, view.t, e.shutter_s), e.exposure, e.iso, seed, { full: true, frames: frames / 4 });
    clipped = clip(planes[1]);
  } else if (mode === 'live-nd') {
    const total = 2 ** settings.nd, k = Math.min(total, ND_FRAMES), acc = new Float32Array(n);
    frames = total; clipped = 0;
    for (let i = 0; i < k; i++) {
      const L = renderLinear(sc, w, h, view.t + (i * e.shutter_s) / k, e.shutter_s / k);
      const m = expose(L, e.exposure / total, e.iso, seed + i, { frames: total / k });
      clipped = Math.max(clipped, clip(m));
      for (let j = 0; j < n; j++) acc[j] += m[j] / k;
    }
    planes = demosaic(acc, w, h);
  } else if (mode === 'hdr1' || mode === 'hdr2') {
    const L = renderLinear(sc, w, h, view.t, e.shutter_s), num = new Float32Array(n), den = new Float32Array(n);
    frames = HDR_EV.length; white = 2 ** -HDR_EV[0];
    for (const [i, ev] of HDR_EV.entries()) {
      const g = 2 ** ev, m = expose(L, e.exposure * g, e.iso, seed + i);
      // a site's weight: none at the clip, little in the noise, the rest by its exposure (the longer, the cleaner)
      for (let j = 0; j < n; j++) { const v = m[j] / WHITE, wt = v >= 0.98 ? 0 : (0.02 + v) * g; num[j] += wt * m[j] / g; den[j] += wt; }
      if (i === 0) for (let j = 0; j < n; j++) if (den[j] === 0) { num[j] = WHITE / g; den[j] = 1; }   // clipped in the shortest too
    }
    for (let j = 0; j < n; j++) num[j] /= den[j];
    clipped = clip(expose(L, e.exposure, e.iso, seed));
    planes = demosaic(num, w, h);
  } else if (mode === 'focus-stack') {
    // the focus stepped in dioptres, STACK_STEP depths of field a step (2 N c / f^2 each), a quarter of the frames
    // in front of the set distance
    const lens = { ...sc.lens, aperture: e.aperture }, f = lens.focal_mm;
    const step = settings.stack.step * 2 * lens.aperture * COC_MM / (f * f) * 1000, d0 = 1 / lens.focus_m;
    let best = null;
    frames = settings.stack.shots; clipped = 0;
    for (let i = 0; i < frames; i++) {
      const d = Math.min(Math.max(d0 + (Math.floor(frames / 4) - i) * step, 1e-4), 1 / MIN_FOCUS_M);
      const at = { ...sc, lens: { ...sc.lens, focus_m: 1 / d } };
      const m = expose(renderLinear(at, w, h, view.t, e.shutter_s), e.exposure, e.iso, seed + i), p = demosaic(m, w, h), s = sharpness(p, w, h);
      clipped = Math.max(clipped, clip(m));
      if (!best) { best = { p, s }; continue; }
      for (let j = 0; j < n; j++) if (s[j] > best.s[j]) { best.s[j] = s[j]; best.p[0][j] = p[0][j]; best.p[1][j] = p[1][j]; best.p[2][j] = p[2][j]; }
    }
    planes = best.p;
  } else {
    const m = expose(renderLinear(sc, w, h, view.t, e.shutter_s), e.exposure, e.iso, seed);
    clipped = clip(m);
    const first = mode === 'multi' ? view.multi_first ?? null : null;
    if (first) {                                   // Multiple Exposure's second frame: both, added (Auto Gain: their mean)
      const e1 = exposureOf(first.scene), m1 = expose(renderLinear(first.scene, w, h, first.t, e1.shutter_s), e1.exposure, e1.iso, first.frame_no);
      const k = settings.multi.auto_gain ? 0.5 : 1;
      for (let j = 0; j < n; j++) m[j] = Math.min((m[j] + m1[j]) * k, WHITE);
      frames = 2;
    }
    planes = demosaic(m, w, h);
  }
  const [R, G, B] = planes, g = settings.gnd;
  const look = settings.look, K = LOOKS[look] ?? {}, strong = mode === 'hdr2', gain = 2 ** (K.ev ?? 0);
  const enc = (v) => 255 * Math.pow(v < 0 ? 0 : v > 1 ? 1 : v, 1 / 2.2);
  const E = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < h; y++) {
    // Live GND: the gain of this row, 2^-stops above the band and 1 below it
    let nd = gain;
    if (g) { const band = GND_BAND[g.type], t = Math.min(Math.max((y / h - 0.5) / band + 0.5, 0), 1); nd *= 2 ** (-g.stops * (1 - t * t * (3 - 2 * t))); }
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r = R[i] / WHITE * nd, gg = G[i] / WHITE * nd, b = B[i] / WHITE * nd;
      if (white > 1) {                             // HDR: compress the luminance up to `white` into 0..1, keep the ratios
        const l = 0.299 * r + 0.587 * gg + 0.114 * b, a = strong ? 4 : 2;
        const lc = Math.min(1, (a * l * (1 + (a * l) / (a * white) ** 2)) / (1 + a * l)), kk = l > 0 ? lc / l : 0;
        r *= kk; gg *= kk; b *= kk;
        if (strong) { const l2 = 0.299 * r + 0.587 * gg + 0.114 * b; r = l2 + (r - l2) * 1.25; gg = l2 + (gg - l2) * 1.25; b = l2 + (b - l2) * 1.25; }
      }
      E[0][i] = enc(r); E[1][i] = enc(gg); E[2][i] = enc(b);
    }
  }
  applyLook(E, w, h, K, seed);
  const Yp = new Uint8Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const er = E[0][i], eg = E[1][i], eb = E[2][i];
    Yp[i] = Math.min(255, Math.max(0, Math.round(0.299 * er + 0.587 * eg + 0.114 * eb)));
    Cb[i] = 128 - 0.168736 * er - 0.331264 * eg + 0.5 * eb;
    Cr[i] = 128 + 0.5 * er - 0.418688 * eg - 0.081312 * eb;
  }
  const rows = [], u8 = (v) => Math.min(255, Math.max(0, Math.round(v)));
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(2 * w), o = y * w;
    for (let x = 0; x < w; x += 2) {
      row[2 * x] = Yp[o + x]; row[2 * x + 1] = u8((Cb[o + x] + Cb[o + x + 1]) / 2);
      row[2 * x + 2] = Yp[o + x + 1]; row[2 * x + 3] = u8((Cr[o + x] + Cr[o + x + 1]) / 2);
    }
    rows.push(row);
  }
  return { frame: [w, h, rows], report: { mode, frames, size: [w, h], look, shutter_s: e.shutter_s, aperture: e.aperture, iso: e.iso,
    gnd: g, ev, clipped: +clipped.toFixed(4), unknown: settings.unknown } };
}
