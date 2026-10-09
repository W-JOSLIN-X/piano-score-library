import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { crc32, parseScore, uuidBytes } from "../src/lib/pseq";
const width = 960,
  height = 480,
  stride = width / 8;
const tunes = [
  {
    id: "10482001-4d65-4fe0-a62c-001000000001",
    title: "晨光小练习",
    subtitle: "轻盈的单音，熟悉每一次起落",
    level: "入门",
    tempo: 100,
    pitches: [60, 62, 64, 67, 64, 62, 60, 64, 65, 69, 67, 64, 62, 65, 64, 60],
  },
  {
    id: "10482001-4d65-4fe0-a62c-001000000002",
    title: "沿着琴键散步",
    subtitle: "上行与下行，找到均匀的节奏",
    level: "入门",
    tempo: 90,
    pitches: [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 64, 60],
  },
  {
    id: "10482001-4d65-4fe0-a62c-001000000003",
    title: "回声与重复",
    subtitle: "相同音符之间，也有不同的呼吸",
    level: "基础",
    tempo: 112,
    pitches: [
      60, 60, 64, 64, 67, 67, 64, 60, 62, 62, 65, 65, 69, 69, 65, 62, 64, 67,
      72, 67, 65, 64, 62, 60,
    ],
  },
];
function image(pitches: number[], numbered = false) {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480"><rect width="960" height="480" fill="white"/><g fill="#202824" stroke="#202824" stroke-width="2"><text x="42" y="35" stroke="none" font-family="sans-serif" font-size="17">${numbered ? "1 = C     4/4" : "C major     4/4"} / Original study</text>`;
  const diatonic: Record<number, number> = {
    0: 0,
    2: 1,
    4: 2,
    5: 3,
    7: 4,
    9: 5,
    11: 6,
  };
  for (let row = 0; row < 2; row++) {
    const top = 92 + row * 210;
    if (!numbered) {
      for (let l = 0; l < 5; l++)
        s += `<line x1="42" y1="${top + l * 12}" x2="918" y2="${top + l * 12}" stroke-width="2"/>`;
      s += `<text x="45" y="${top + 51}" stroke="none" font-family="Segoe UI Symbol,serif" font-size="70">𝄞</text>`;
    }
    for (let j = 0; j < 12; j++) {
      const i = row * 12 + j;
      if (i >= pitches.length) break;
      const pitch = pitches[i]!,
        x = 114 + j * 68,
        degree = diatonic[pitch % 12]!,
        steps = (Math.floor(pitch / 12) - 5) * 7 + degree,
        y = top + 60 - steps * 6;
      if (numbered) {
        s += `<text x="${x}" y="${top + 36}" text-anchor="middle" stroke="none" font-family="serif" font-size="30">${degree + 1}</text>`;
        if (pitch >= 72) s += `<circle cx="${x}" cy="${top + 2}" r="2"/>`;
      } else {
        s += `<ellipse cx="${x}" cy="${y}" rx="7" ry="5" transform="rotate(-20 ${x} ${y})"/><line x1="${x + 6}" y1="${y}" x2="${x + 6}" y2="${y - 34}" stroke-width="1.5"/>`;
        for (let ly = top + 60; ly <= y; ly += 12)
          s += `<line x1="${x - 11}" y1="${ly}" x2="${x + 11}" y2="${ly}"/>`;
        for (let ly = top - 12; ly >= y; ly -= 12)
          s += `<line x1="${x - 11}" y1="${ly}" x2="${x + 11}" y2="${ly}"/>`;
      }
      if (j % 4 === 3 || i === pitches.length - 1)
        s += `<line x1="${x + 34}" y1="${top - 3}" x2="${x + 34}" y2="${top + 50}"/>`;
    }
  }
  return s + "</g></svg>";
}
async function bitmap(svg: string) {
  const raw = await sharp(Buffer.from(svg))
    .flatten({ background: "#fff" })
    .greyscale()
    .raw()
    .toBuffer();
  const bits = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (raw[y * width + x]! < 180)
        bits[y * stride + (x >> 3)]! |= 128 >> (x & 7);
  return bits;
}
type Section = {
  type: number;
  profile: number;
  data: Uint8Array;
  count: number;
  size: number;
  start?: number;
};
await mkdir("public/scores", { recursive: true });
const catalog = [];
for (const [i, t] of tunes.entries()) {
  const beat = Math.round(60000 / t.tempo),
    duration = 2000 + t.pitches.length * beat + 1500;
  const staff = image(t.pitches),
    numbered = image(t.pitches, true),
    b1 = await bitmap(staff),
    b2 = await bitmap(numbered);
  const notes = new Uint8Array(t.pitches.length * 16),
    nv = new DataView(notes.buffer);
  t.pitches.forEach((p, j) => {
    const o = j * 16;
    nv.setUint32(o, 2000 + j * beat, true);
    nv.setUint32(o + 4, beat, true);
    notes.set([p, 88, 2, 1], o + 8);
    nv.setUint32(o + 12, j, true);
  });
  const pixels = new Uint8Array(b1.length + b2.length);
  pixels.set(b1);
  pixels.set(b2, b1.length);
  const sections: Section[] = [
    {
      type: 1,
      profile: 0,
      data: new TextEncoder().encode(
        JSON.stringify({
          title: t.title,
          source: "项目自制测试练习",
          generator_version: "1.0",
          tempo: t.tempo,
          license: "CC0-1.0",
        }),
      ),
      count: 1,
      size: 0,
    },
    { type: 2, profile: 0, data: notes, count: t.pitches.length, size: 16 },
    { type: 5, profile: 1, data: new Uint8Array(48), count: 2, size: 24 },
    { type: 6, profile: 1, data: pixels, count: 0, size: 0 },
  ];
  let cursor = 64 + sections.length * 32;
  for (const s of sections) {
    s.start = cursor;
    cursor += Math.ceil(s.data.length / 4) * 4;
  }
  const pv = new DataView(sections[2]!.data.buffer);
  for (let j = 0; j < 2; j++) {
    const o = j * 24;
    pv.setUint32(o, j + 1, true);
    pv.setUint16(o + 4, 1, true);
    pv.setUint8(o + 6, j + 1);
    pv.setUint8(o + 7, 1);
    pv.setUint16(o + 8, width, true);
    pv.setUint16(o + 10, height, true);
    pv.setUint16(o + 12, stride, true);
    pv.setUint32(o + 16, sections[3]!.start! + j * b1.length, true);
    pv.setUint32(o + 20, b1.length, true);
  }
  const bytes = new Uint8Array(cursor),
    v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PSC1"));
  v.setUint16(4, 1, true);
  v.setUint32(8, cursor, true);
  bytes.set(uuidBytes(t.id), 12);
  v.setUint32(28, 1, true);
  v.setUint32(32, duration, true);
  v.setUint16(36, sections.length, true);
  v.setUint16(38, 64, true);
  v.setUint32(40, 64, true);
  v.setUint32(44, 7, true);
  v.setUint32(48, t.pitches.length, true);
  for (const [j, s] of sections.entries()) {
    const o = 64 + j * 32;
    v.setUint32(o, s.type, true);
    v.setUint16(o + 4, s.profile, true);
    v.setUint16(o + 6, 1, true);
    v.setUint32(o + 8, s.start!, true);
    v.setUint32(o + 12, s.data.length, true);
    v.setUint32(o + 16, s.count, true);
    v.setUint16(o + 20, s.size, true);
    v.setUint32(o + 24, crc32(s.data), true);
    bytes.set(s.data, s.start!);
  }
  parseScore(bytes);
  const file = `scores/study-${i + 1}.pseq`,
    cover = `scores/study-${i + 1}.svg`;
  await writeFile("public/" + file, bytes);
  await writeFile("public/" + cover, staff);
  catalog.push({
    ...t,
    pitches: undefined,
    duration,
    notes: t.pitches.length,
    bytes: bytes.length,
    crc: crc32(bytes),
    file,
    cover,
    capabilities: 7,
    revision: 1,
  });
}
await writeFile(
  "public/scores/catalog.json",
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(
  "Generated and validated 3 original study packages (profile 1: 960×480 MONO1).",
);
