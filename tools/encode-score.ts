import { crc32, uuidBytes } from '../src/lib/pseq';
import { parseScore, type Score, type Note, type Page, type Measure, type Control, type Anchor } from '../src/lib/psc2';
import { RECORD_BYTES, PPQ } from '../src/lib/protocol';

export type ScoreSource = {
  id: string; revision: number; durationTicks: number; bpm: number; capabilities: number;
  meta: Record<string, unknown>; notes: Omit<Note, 'id'>[]; controls: Control[];
  measures: Measure[]; pages: Page[]; anchors: Anchor[]; safeStarts: number[];
};
const align = (n: number) => Math.ceil(n / 4) * 4;
/** Deterministic offline writer. Read-back validates semantics; independent vectors test layout. */
export function encodeScore(s: ScoreSource): Uint8Array {
  const integer = (n: number, max: number) => { if (!Number.isInteger(n) || n < 0 || n > max) throw Error('制谱字段不是范围内的无符号整数'); };
  const checkNumbers = (record: Record<string, unknown>) => { for (const v of Object.values(record)) if (typeof v === 'number') integer(v, 0xffffffff); };
  checkNumbers(s); integer(s.bpm, 65535);
  for (const n of s.notes) { checkNumbers(n); [n.pitch,n.dynamic,n.part,n.flags].forEach(v=>integer(v,255)); }
  for (const c of s.controls) { checkNumbers(c); [c.controller,c.value,c.flags].forEach(v=>integer(v,255)); }
  for (const m of s.measures) { checkNumbers(m); [m.numerator,m.denominatorPow].forEach(v=>integer(v,255)); }
  for (const a of s.anchors) { checkNumbers(a); [a.x,a.y,a.width,a.height].forEach(v=>integer(v,65535)); integer(a.notation,255); }
  for (const p of s.pages) { checkNumbers(p); [p.profile,p.width,p.height,p.stride].forEach(v=>integer(v,65535)); integer(p.notation,255); }
  s.safeStarts.forEach(t=>integer(t,0xffffffff));
  type Segment = { type: number; profile: number; count: number; data: Uint8Array; offset: number };
  const segments: Segment[] = [];
  const add = (type: number, count: number, write: (v: DataView, b: Uint8Array) => void, length = count * RECORD_BYTES[type]!) => {
    if (!count) return;
    const data = new Uint8Array(length), view = new DataView(data.buffer);
    write(view, data); segments.push({ type, profile: [5, 6, 7].includes(type) ? 1 : 0, count, data, offset: 0 });
  };
  const meta = new TextEncoder().encode(JSON.stringify(s.meta));
  add(1, 1, (_v, b) => b.set(meta), meta.length);
  add(2, s.notes.length, (v, b) => s.notes.forEach((n, i) => {
    const o = i * 16; v.setUint32(o, n.startTick, true); v.setUint32(o + 4, n.durationTicks, true);
    b.set([n.pitch, n.dynamic, n.part, n.flags], o + 8); v.setUint32(o + 12, n.group, true);
  }));
  add(3, s.controls.length, (v, b) => s.controls.forEach((c, i) => {
    v.setUint32(i * 8, c.tick, true); b.set([0, c.controller, c.value, c.flags], i * 8 + 4);
  }));
  add(4, s.measures.length, (v, b) => s.measures.forEach((m, i) => {
    const o = i * 16; v.setUint32(o, m.startTick, true); v.setUint32(o + 4, m.endTick, true); v.setUint32(o + 8, m.index, true);
    b.set([m.numerator, m.denominatorPow], o + 12);
  }));
  add(5, s.pages.length, () => {});
  if (s.pages.length) add(6, 1, (_v, b) => { let o = 0; for (const p of s.pages) { b.set(p.pixels, o); o += p.pixels.length; } }, s.pages.reduce((sum, p) => sum + p.pixels.length, 0));
  add(7, s.anchors.length, (v, b) => s.anchors.forEach((a, i) => {
    const o = i * 24; v.setUint32(o, a.startTick, true); v.setUint32(o + 4, a.pageId, true); v.setUint32(o + 8, a.measureIndex, true);
    [a.x, a.y, a.width, a.height].forEach((n, j) => v.setUint16(o + 12 + j * 2, n, true)); b[o + 20] = a.notation;
  }));
  add(8, s.safeStarts.length, v => s.safeStarts.forEach((t, i) => v.setUint32(i * 4, t, true)));
  let length = 64 + segments.length * 32;
  for (const section of segments) { section.offset = length; length = align(length + section.data.length); }
  const pageSegment = segments.find(d => d.type === 5), bitmap = segments.find(d => d.type === 6);
  if (pageSegment && bitmap) {
    const v = new DataView(pageSegment.data.buffer); let pixelOffset = bitmap.offset;
    s.pages.forEach((p, i) => {
      const o = i * 24; v.setUint32(o, p.id, true); v.setUint16(o + 4, p.profile, true);
      pageSegment.data.set([p.notation, 1], o + 6);
      [p.width, p.height, p.stride].forEach((n, j) => v.setUint16(o + 8 + 2 * j, n, true));
      v.setUint32(o + 16, pixelOffset, true); v.setUint32(o + 20, p.pixels.length, true); pixelOffset += p.pixels.length;
    });
  }
  const bytes = new Uint8Array(length), v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('PSC2')); v.setUint16(4, 2, true); v.setUint32(8, length, true); bytes.set(uuidBytes(s.id), 12);
  v.setUint32(28, s.revision, true); v.setUint32(32, s.durationTicks, true); v.setUint16(36, segments.length, true);
  v.setUint16(38, 64, true); v.setUint32(40, 64, true); v.setUint32(44, s.capabilities, true); v.setUint32(48, s.notes.length, true);
  v.setUint16(52, PPQ, true); v.setUint16(54, s.bpm, true);
  segments.forEach((d, i) => {
    const o = 64 + i * 32; v.setUint32(o, d.type, true); v.setUint16(o + 4, d.profile, true); v.setUint16(o + 6, 1, true);
    v.setUint32(o + 8, d.offset, true); v.setUint32(o + 12, d.data.length, true); v.setUint32(o + 16, d.count, true);
    v.setUint16(o + 20, RECORD_BYTES[d.type]!, true); v.setUint32(o + 24, crc32(d.data), true); bytes.set(d.data, d.offset);
  });
  parseScore(bytes);
  return bytes;
}

export function scoreSummary(s: Score) {
  return { id: s.id, total_bytes: s.bytes.length, file_crc: s.crc, total_blocks: Math.ceil(s.bytes.length / 512), tail_bytes: s.bytes.length % 512 || 512, duration_ticks: s.durationTicks, bpm: s.bpm, notes: s.notes.length, safe_starts: s.safeStarts, anchors: s.anchors };
}
