// The lab's raw file: S-DEVELOP's sensor exposure (src/lab/develop.mjs developRaw: the RGGB mosaic of one frame, 12
// bits a photosite) in a TIFF container with the ORF's byte-order word ("IIRO"), uncompressed. It is the lab's own
// file content for a picture recorded with a +RAW image quality (src/lab/rec.mjs S-RAWFILE), not the camera's ORF:
// the camera's raw compression and its maker notes are not read, so the camera's own raw development would not
// take it. It is laid out as the uncompressed 12-bit ORFs of older bodies are, which LibRaw reads (X, 2026-11-15:
// LibRaw 0.22.2 through rawpy opened the file REC_FILE recorded and gave back the mosaic value for value; the
// packing below is the one that made it do so, dcraw's packed_load_raw with load_flags 24). Pure JS.
//   orfOfRaw({ w, h, data: Uint16Array }, { make, model }) -> Uint8Array
//   readOrf(bytes) -> { w, h, data, make, model }       (the reader of the lab's own files, for its tests)
// IFD0: ImageWidth 256, ImageLength 257, BitsPerSample 258 (12), Compression 259 (1), PhotometricInterpretation 262
// (32803, a colour filter array), Make 271, Model 272, StripOffsets 273, SamplesPerPixel 277, RowsPerStrip 278,
// StripByteCounts 279, CFARepeatPatternDim 33421 (2 x 2), CFAPattern 33422 (0 1 1 2: R G G B). The strip is the
// photosites' 12-bit values as one bit stream, high bits first, in 32-bit words stored low byte first.
const swap32 = (b) => { for (let o = 0; o + 4 <= b.length; o += 4) { const x = b[o], y = b[o + 1]; b[o] = b[o + 3]; b[o + 1] = b[o + 2]; b[o + 2] = y; b[o + 3] = x; } return b; };
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(0));

export function orfOfRaw({ w, h, data }, { make = 'OM Digital Solutions', model = 'OM-3' } = {}) {
  if (!(w > 0 && h > 0 && w % 2 === 0 && data.length === w * h)) throw new RangeError(`orfOfRaw: ${w} x ${h}, ${data.length} photosites`);
  const bytes = w * h * 3 / 2, strip = new Uint8Array(bytes + 3 & ~3);      // (whole words: up to 2 bytes past the count)
  for (let i = 0, o = 0; i < data.length; i += 2, o += 3) {
    const a = data[i] & 0xFFF, b = data[i + 1] & 0xFFF;
    strip[o] = a >> 4; strip[o + 1] = (a & 15) << 4 | b >> 8; strip[o + 2] = b & 255;
  }
  swap32(strip);
  const mk = ascii(make), md = ascii(model);
  const tags = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 1, 12], [259, 3, 1, 1], [262, 3, 1, 32803], [271, 2, mk.length, mk], [272, 2, md.length, md],
    [273, 4, 1, null], [277, 3, 1, 1], [278, 4, 1, h], [279, 4, 1, bytes], [33421, 3, 2, [2, 2]], [33422, 1, 4, [0, 1, 1, 2]]];
  const ifd = 8, dataAt = ifd + 2 + 12 * tags.length + 4, extra = [];
  let at = dataAt;
  for (const t of tags) if (t[3] instanceof Uint8Array) { extra.push([at, t[3]]); t[4] = at; at += t[3].length + (t[3].length & 1); }
  const stripAt = at, out = new Uint8Array(stripAt + strip.length), v = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x52, 0x4F]); v.setUint32(4, ifd, true); v.setUint16(ifd, tags.length, true);
  tags.forEach(([tag, type, count, value, off], k) => {
    const p = ifd + 2 + 12 * k;
    v.setUint16(p, tag, true); v.setUint16(p + 2, type, true); v.setUint32(p + 4, count, true);
    if (off !== undefined) v.setUint32(p + 8, off, true);
    else if (tag === 273) v.setUint32(p + 8, stripAt, true);
    else if (Array.isArray(value)) value.forEach((x, i) => (type === 1 ? v.setUint8(p + 8 + i, x) : v.setUint16(p + 8 + 2 * i, x, true)));
    else if (type === 3) v.setUint16(p + 8, value, true);
    else v.setUint32(p + 8, value, true);
  });
  for (const [o, b] of extra) out.set(b, o);
  out.set(strip, stripAt);
  return out;
}

export function readOrf(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), no = (why) => { throw new RangeError(`readOrf: ${why}`); };
  if (bytes[0] !== 0x49 || bytes[1] !== 0x49 || bytes[2] !== 0x52 || bytes[3] !== 0x4F) no('not the lab\'s raw file (no IIRO)');
  const ifd = v.getUint32(4, true), n = v.getUint16(ifd, true), t = new Map();
  for (let k = 0; k < n; k++) { const p = ifd + 2 + 12 * k; t.set(v.getUint16(p, true), { type: v.getUint16(p + 2, true), count: v.getUint32(p + 4, true), at: p + 8 }); }
  const num = (tag) => { const e = t.get(tag) ?? no(`no tag ${tag}`); return e.type === 3 ? v.getUint16(e.at, true) : v.getUint32(e.at, true); };
  const text = (tag) => { const e = t.get(tag); if (!e) return null; const o = e.count > 4 ? v.getUint32(e.at, true) : e.at; return String.fromCharCode(...bytes.subarray(o, o + e.count - 1)); };
  const w = num(256), h = num(257), at = num(273);
  const count = num(279), words = count + 3 & ~3;
  if (num(258) !== 12 || num(259) !== 1 || count !== w * h * 3 / 2 || at + words > bytes.length) no('not a 12-bit packed strip of the whole frame');
  const s = swap32(bytes.slice(at, at + words)), data = new Uint16Array(w * h);
  for (let i = 0, o = 0; i < data.length; i += 2, o += 3) { data[i] = s[o] << 4 | s[o + 1] >> 4; data[i + 1] = (s[o + 1] & 15) << 8 | s[o + 2]; }
  return { w, h, data, make: text(271), model: text(272) };
}
