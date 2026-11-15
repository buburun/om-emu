// S-DEVELOP, the still's signal-processing stand-in (src/lab/develop.mjs), and the JPEG writer's whole-DCT coding
// (src/lab/jpeg.mjs jpegOfFrame with a quality):
//   developUnits (pure)  the settings from the properties' values; each mode on a small frame: one frame the same for
//                        the same view, a clipped highlight that HDR holds, Live ND's smear at one sub-frame's
//                        brightness, High Res's size, Live GND's darker top, MONO without colour; the whole-DCT JPEG
//                        read back by both decoders (the lab's and refs/jpeg.mjs) close to its frame
//   node emu/test/test_develop.mjs
import * as SC from '../src/lab/scene.mjs';
import * as D from '../src/lab/develop.mjs';
import { jpegOfFrame, decodeJpeg } from '../src/lab/jpeg.mjs';
import { orfOfRaw, readOrf } from '../src/lab/orf.mjs';
import { decodeJpeg as refDecode } from '../refs/jpeg.mjs';

const PROPS = { overlay: 14, quality: 15,  group: 1, high_res: 2, nd: 3, nd_stops: 4, gnd: 5, gnd_stops: 6, gnd_type: 7, hdr: 8, stack: 9, stack_shots: 10, multi: 11, multi_gain: 12, stack_step: 13 };

export function developUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  // the settings
  const st = (v) => D.developSettings(PROPS, (id) => v[id] ?? (id === 898 ? 1 : id === 899 ? 29 : id === 988 ? 57 : id === 901 ? 54 : id === 15 ? 11 : 0));
  const s0 = st({ 1: 898 });
  ok(s0.look === 'Natural' && !s0.hdr && !s0.nd && !s0.gnd && !s0.high_res && !s0.unknown.length, `a blank camera is the plain case: ${JSON.stringify(s0)}`);
  ok(st({ 1: 988 }).look === 'Monochrome Profile 1' && st({ 1: 899 }).look === 'Pop Art I' && st({ 1: 901 }).look === 'Color Profile 1' && st({ 1: 900 }).look === 'Color Creator', 'the creative dial\'s groups, each with its own property\'s mode');
  ok(st({ 1: 898, 898: 0 }).look === 'Vivid' && st({ 1: 899, 899: 63 }).look === 'Instant Film' && st({ 1: 898, 898: 4 }).unknown[0] === 'picture mode 898=4', 'the mode is the value of the property the group names');
  ok(Object.values(D.MODES).every((g) => g === null || Object.values(g).every((name) => D.LOOKS[name])), 'every mode has a look');
  ok(st({ 1: 898, 3: 1, 4: 4 }).nd === 4 && st({ 1: 898, 3: 0, 4: 4 }).nd === 0, 'Live ND: its stops only when it is on');
  ok(JSON.stringify(st({ 1: 898, 5: 1, 6: 3, 7: 1 }).gnd) === '{"stops":3,"type":"medium"}', 'Live GND: stops and type');
  ok(st({ 1: 898, 8: 30 }).hdr === 'hdr1' && st({ 1: 898, 8: 25 }).hdr === null && String(st({ 1: 898, 8: 25 }).bracket) === '3,2', 'HDR1 is a composite, 3f 2.0EV a bracket');
  ok(String(D.developShots(st({ 1: 898, 8: 27 }))) === '0,-2,2,-4,4,-6,6' && String(D.developShots(st({ 1: 898, 8: 28 }))) === '0,-3,3' && String(D.developShots(s0)) === '0', 'a bracket\'s steps: 7f 2.0EV, 3f 3.0EV, none');
  ok(st({ 1: 898, 9: 1, 10: 8 }).stack?.shots === 8 && st({ 1: 898, 10: 8 }).stack === null, 'Focus Stacking: its shots only when it is on');
  ok(String(D.developShots({ ...s0, multi: { auto_gain: false } }, true)) === '' && String(D.developShots({ ...s0, multi: { auto_gain: false } })) === '0', 'Multiple Exposure\'s first release records no file, its second one');
  ok(st({ 1: 898, 11: 2, 14: 1 }).multi?.overlay === true && st({ 1: 898, 15: 15 }).raw === true && st({ 1: 898, 15: 11 }).raw === false && st({ 1: 898 }).jpeg === true, 'Overlay, and a +RAW image quality');
  ok(st({ 1: 898, 11: 2, 12: 1 }).multi?.auto_gain === true && st({ 1: 898, 11: 2 }).multi?.auto_gain === false && st({ 1: 898 }).multi === null, 'Multiple Exposure and Auto Gain');
  ok(st({ 1: 5 }).unknown[0] === 'group 5' && st({ 1: 5 }).look === 'Natural', 'a group the menu was not seen to write: the plain look, reported');
  // the modes, on a small frame
  const W = 96, H = 64, P = D.plainSettings();
  const view = (change, more = {}) => ({ scene: SC.applySceneChange(SC.defaultScene(), change), t: 0.5, frame_no: 7, ...more });
  const dev = (v, s) => D.developFrame(v, W, H, s);
  const luma = (f, y0 = 0, y1 = f[1]) => { let a = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < f[0]; x++) { a += f[2][y][2 * x]; n += 1; } return a / n; };
  const chroma = (f) => { let a = 0; for (const r of f[2]) for (let x = 1; x < r.length; x += 2) a = Math.max(a, Math.abs(r[x] - 128)); return a; };
  const same = (a, b) => a[2].every((r, y) => r.every((v, i) => v === b[2][y][i]));
  const one = dev(view({}), P);
  ok(one.frame[0] === W && one.frame[1] === H && one.frame[2].length === H && one.frame[2][0].length === 2 * W && one.report.mode === 'single', `a single frame is ${W} x ${H}, 4:2:2: ${JSON.stringify(one.report)}`);
  ok(same(one.frame, dev(view({}), P).frame), 'the same view develops to the same frame');
  ok(!same(one.frame, dev(view({}, { frame_no: 8 }), P).frame), 'another frame number: another noise');
  ok(chroma(one.frame) > 20 && chroma(dev(view({}), { ...P, look: 'Monochrome Profile 1' }).frame) <= 1, 'a monochrome profile has no colour, Natural has');
  // every look develops, differs from Natural unless it is plain, and stays a picture (not black, not white)
  for (const [name, K] of Object.entries(D.LOOKS)) {
    const f = dev(view({}), { ...P, look: name }).frame, m = luma(f);
    ok(m > 40 && m < 235 && (Object.keys(K).length === 0) === same(f, one.frame), `the look ${name}: mean Y ${m.toFixed(1)}`);
  }
  ok(chroma(dev(view({}), { ...P, look: 'Vivid' }).frame) > chroma(dev(view({}), { ...P, look: 'Muted' }).frame), 'Vivid has more colour than Muted');
  // a grey chart overexposed 3 stops clips; HDR keeps it below white
  const hot = { preset: 'chart', mode: 'manual', aperture: 2.8, iso: 200, shutter_s: 8 * 2.8 * 2.8 / (2 ** 12 * 2) };
  const over = dev(view(hot), P), hdr = dev(view(hot), { ...P, hdr: 'hdr1' });
  const white = (f) => { let n = 0; for (const r of f[2]) for (let x = 0; x < r.length; x += 2) if (r[x] >= 250) n += 1; return n / (f[0] * f[1]); };
  ok(over.report.clipped > 0.5 && white(over.frame) > 0.5, `3 stops over clips the sensor: clipped ${over.report.clipped}, white ${white(over.frame).toFixed(2)}`);
  ok(hdr.report.frames === 4 && white(hdr.frame) < white(over.frame) / 2, `HDR holds most of it: ${hdr.report.frames} frames, white ${white(hdr.frame).toFixed(2)}`);
  // Live ND at 4 stops over a 16x longer time: as bright as the single frame, the moving layers smeared
  const base = { preset: 'moving', mode: 'manual', aperture: 8, iso: 200, shutter_s: 1 / 125, ev: 12 };
  const short = dev(view(base), P), nd = dev(view({ ...base, shutter_s: 16 / 125 }), { ...P, nd: 4 }), long = dev(view({ ...base, shutter_s: 16 / 125 }), P);
  ok(nd.report.mode === 'live-nd' && nd.report.frames === 16, `Live ND 4 stops: ${JSON.stringify(nd.report)}`);
  ok(Math.abs(luma(nd.frame) - luma(short.frame)) < 6 && luma(long.frame) > luma(short.frame) + 40, `Live ND is as bright as the short frame (${luma(nd.frame).toFixed(1)} against ${luma(short.frame).toFixed(1)}), the long frame without it brighter (${luma(long.frame).toFixed(1)})`);
  // High Res and Live GND
  const hr = dev(view({ preset: 'chart' }), { ...P, high_res: 1 }), hh = dev(view({ preset: 'chart' }), { ...P, high_res: 2 });
  ok(hr.frame[0] === 2 * W && hr.frame[1] === 2 * H && hr.frame[2].length === 2 * H && hh.frame[0] === 1.5 * W, `High Res: ${hr.report.size} on a tripod, ${hh.report.size} handheld`);
  const flat = view({ preset: 'chart', focus_m: 0.25 }), g0 = dev(flat, P).frame, g3 = dev(flat, { ...P, gnd: { stops: 3, type: 'hard' } }).frame;
  ok(luma(g3, 0, H / 4) < luma(g0, 0, H / 4) * 0.6 && Math.abs(luma(g3, 3 * H / 4) - luma(g0, 3 * H / 4)) < 2, 'Live GND darkens the top and leaves the bottom');
  // a bracket's frame a stop under is darker; Focus Stacking keeps near and far sharp; Multiple Exposure adds two frames
  ok(luma(D.developFrame(view({}), W, H, P, -1).frame) < luma(one.frame) - 10, 'a frame at -1 EV is darker');
  const edges = (f, y0, y1) => { let a = 0; for (let y = y0; y < y1; y++) for (let x = 1; x < f[0]; x++) a += Math.abs(f[2][y][2 * x] - f[2][y][2 * x - 2]); return a; };
  const wide = { aperture: 1.2, focus_m: 1.5, af_point: [0.72, 0.35] }, near = dev(view(wide), P), far = dev(view({ ...wide, focus_m: 200 }), P), fs = dev(view(wide), { ...P, stack: { shots: 8, step: 5 } });
  const sharp = (f) => edges(f.frame, 0, H);
  ok(fs.report.mode === 'focus-stack' && fs.report.frames === 8 && sharp(fs) > sharp(near) && sharp(fs) > sharp(far) * 0.98, `Focus Stacking is sharper than either focus alone: ${sharp(fs)} against ${sharp(near)} (near) and ${sharp(far)} (far)`);
  const dark = { preset: 'chart', mode: 'manual', aperture: 2.8, iso: 200, shutter_s: 2.8 * 2.8 / (2 ** 12 * 2) / 4 };
  const v1 = view(dark), v2 = { ...view(dark, { frame_no: 9 }), multi_first: v1 };
  const m1 = dev(v1, { ...P, multi: { auto_gain: false } }), m2 = dev(v2, { ...P, multi: { auto_gain: false } }), mg = dev(v2, { ...P, multi: { auto_gain: true } });
  ok(m1.report.frames === 1 && m2.report.mode === 'multi' && m2.report.frames === 2 && luma(m2.frame) > luma(m1.frame) + 15, `Multiple Exposure's second file is both frames added: mean Y ${luma(m2.frame).toFixed(1)} against ${luma(m1.frame).toFixed(1)}`);
  ok(Math.abs(luma(mg.frame) - luma(m1.frame)) < 3, 'with Auto Gain it is their mean');
  // the raw: the mosaic of the frame, and the lab's raw file read back
  const rw = D.developRaw(view({}), W, H), orf = orfOfRaw(rw), back = readOrf(orf);
  ok(rw.w === W && rw.h === H && rw.data.length === W * H && rw.data.every((x) => x <= 4095), 'the raw is the frame\'s mosaic, 12 bits a photosite');
  ok(back.w === W && back.h === H && back.model === 'OM-3' && back.data.every((x, i) => x === rw.data[i]) && orf.length > W * H * 1.5, 'the lab\'s raw file reads back to the same mosaic');
  // the whole-DCT JPEG
  const jpg = jpegOfFrame(one.frame, { quality: 90 }), a = decodeJpeg(jpg), b = refDecode(jpg);
  let err = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) err += Math.abs(a.components[0].samples[y * W + x] - one.frame[2][y][2 * x]);
  ok(a.width === W && a.height === H && b.width === W && b.height === H && err / (W * H) < 2, `the JPEG decodes on both decoders, mean luma error ${(err / (W * H)).toFixed(2)}`);
  ok(jpegOfFrame(one.frame).length < jpg.length, 'without a quality the blocks are their means, as before');
  let refused = false;
  try { jpegOfFrame(one.frame, { quality: 0 }); } catch (e) { refused = e instanceof RangeError; }
  ok(refused, 'a quality outside 1..100 is refused');
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = developUnits();
  console.log(`develop units: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
