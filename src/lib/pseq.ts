export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export type Note = {
  id: number;
  start: number;
  duration: number;
  pitch: number;
  velocity: number;
  hand: number;
  flags: number;
  group: number;
};
export type Page = {
  id: number;
  profile: number;
  notation: number;
  width: number;
  height: number;
  stride: number;
  pixels: Uint8Array;
};
export type Score = {
  id: string;
  revision: number;
  duration: number;
  capabilities: number;
  notes: Note[];
  pages: Page[];
  meta: Record<string, unknown>;
  bytes: Uint8Array;
  crc: number;
};
const decoder = new TextDecoder("utf-8", { fatal: true });
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function uuid(bytes: Uint8Array): string {
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function uuidBytes(id: string): Uint8Array {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw Error("曲目 ID 格式错误");
  return Uint8Array.from(id.replaceAll("-", "").match(/../g)!, (h) =>
    parseInt(h, 16),
  );
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(`曲目包无效：${message}`);
}
export function parseScore(input: Uint8Array): Score {
  check(
    input.length >= 64 && input.length <= MAX_FILE_BYTES,
    "文件大小不支持（上限 32 MiB）",
  );
  const bytes = input.slice(),
    v = new DataView(bytes.buffer);
  const u16 = (o: number) => v.getUint16(o, true),
    u32 = (o: number) => v.getUint32(o, true);
  check(
    decoder.decode(bytes.subarray(0, 4)) === "PSC1" &&
      u16(4) === 1 &&
      u16(6) === 0,
    "仅支持 PSC1 1.0",
  );
  check(
    u32(8) === bytes.length && u16(38) === 64 && u32(40) === 64,
    "文件头长度不匹配",
  );
  check(
    bytes.subarray(52, 64).every((b) => b === 0),
    "头部保留字段必须为零",
  );
  const count = u16(36),
    duration = u32(32),
    caps = u32(44);
  check(
    count > 0 && count <= 128 && 64 + count * 32 <= bytes.length,
    "分段目录越界",
  );
  check(duration > 0 && caps > 0 && !(caps & ~7), "时长或模式标志错误");
  const sections: {
    type: number;
    profile: number;
    start: number;
    end: number;
    count: number;
    size: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    const o = 64 + i * 32,
      type = u32(o),
      profile = u16(o + 4),
      flags = u16(o + 6);
    const start = u32(o + 8),
      len = u32(o + 12),
      n = u32(o + 16),
      size = u16(o + 20);
    check(
      !(flags & ~1) && u16(o + 22) === 0 && u32(o + 28) === 0,
      "目录保留字段错误",
    );
    check(
      start % 4 === 0 &&
        start >= 64 + count * 32 &&
        len > 0 &&
        start + len <= bytes.length,
      "数据段越界或未对齐",
    );
    check(
      !sections.some((s) => start < s.end && start + len > s.start),
      "数据段重叠",
    );
    check(type >= 1 && (type <= 7 || !(flags & 1)), "不支持的必需数据段");
    const sizes: Record<number, number> = { 2: 16, 3: 8, 4: 8, 5: 24, 7: 24 };
    if (sizes[type])
      check(size === sizes[type] && n * size === len, "记录长度与数量不符");
    check(
      crc32(bytes.subarray(start, start + len)) === u32(o + 24),
      "数据段 CRC 不匹配",
    );
    sections.push({ type, profile, start, end: start + len, count: n, size });
  }
  const metas = sections.filter((s) => s.type === 1),
    ns = sections.filter((s) => s.type === 2);
  check(
    metas.length === 1 && metas[0]!.end - metas[0]!.start <= 65536,
    "必须有一份有限长度的元数据",
  );
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(
      decoder.decode(bytes.subarray(metas[0]!.start, metas[0]!.end)),
    );
  } catch {
    throw Error("曲目包无效：元数据不是合法 UTF-8 JSON");
  }
  check(
    meta &&
      typeof meta === "object" &&
      !Array.isArray(meta) &&
      typeof meta.title === "string" &&
      meta.title.length > 0 &&
      meta.title.length <= 128,
    "标题格式错误",
  );
  check(
    ns.length <= 1 &&
      (!(caps & 1) || ns.length === 1) &&
      ns.every((s) => s.profile === 0),
    "音符段缺失或重复",
  );
  const notes: Note[] = [],
    groups = new Map<number, number>();
  for (const s of ns)
    for (let j = 0; j < s.count; j++) {
      const o = s.start + j * 16,
        start = u32(o),
        length = u32(o + 4),
        pitch = bytes[o + 8]!,
        group = u32(o + 12);
      check(
        length > 0 &&
          start + length <= duration &&
          pitch <= 127 &&
          bytes[o + 9]! > 0 &&
          bytes[o + 9]! <= 127 &&
          bytes[o + 10]! <= 3 &&
          !(bytes[o + 11]! & ~1),
        "音符字段错误",
      );
      check(
        !notes.length || start >= notes[notes.length - 1]!.start,
        "音符时间未排序",
      );
      check(
        !groups.has(group) || groups.get(group) === start,
        "和弦分组起点不一致",
      );
      groups.set(group, start);
      notes.push({
        id: j,
        start,
        duration: length,
        pitch,
        velocity: bytes[o + 9]!,
        hand: bytes[o + 10]!,
        flags: bytes[o + 11]!,
        group,
      });
    }
  check(
    notes.length === u32(48) && (!(caps & 1) || notes.length > 0),
    "音符总数不符",
  );
  const pages: Page[] = [];
  for (const s of sections.filter((s) => s.type === 5))
    for (let j = 0; j < s.count; j++) {
      const o = s.start + j * 24,
        id = u32(o),
        profile = u16(o + 4),
        notation = bytes[o + 6]!,
        width = u16(o + 8),
        height = u16(o + 10),
        stride = u16(o + 12),
        start = u32(o + 16),
        len = u32(o + 20);
      check(
        !pages.some((p) => p.id === id) &&
          profile === s.profile &&
          profile > 0 &&
          (notation === 1 || notation === 2),
        "谱面 ID、规格或类型错误",
      );
      check(
        bytes[o + 7] === 1 &&
          width > 0 &&
          height > 0 &&
          width <= 4096 &&
          height <= 4096 &&
          stride === Math.ceil(width / 8) &&
          stride * height === len &&
          u16(o + 14) === 0,
        "谱面布局错误",
      );
      check(
        sections.some(
          (b) =>
            b.type === 6 &&
            b.profile === profile &&
            start >= b.start &&
            start + len <= b.end,
        ),
        "谱面像素越界",
      );
      if (width % 8)
        for (let row = 0; row < height; row++)
          check(
            !(
              bytes[start + (row + 1) * stride - 1]! &
              ((1 << (8 - (width % 8))) - 1)
            ),
            "像素行末填充错误",
          );
      pages.push({
        id,
        profile,
        notation,
        width,
        height,
        stride,
        pixels: bytes.subarray(start, start + len),
      });
    }
  check(!(caps & 2) || pages.some((p) => p.notation === 1), "缺少五线谱资源");
  check(!(caps & 4) || pages.some((p) => p.notation === 2), "缺少简谱资源");
  for (const s of sections.filter((s) => s.type === 3))
    for (let o = s.start; o < s.end; o += 8)
      check(
        u32(o) <= duration &&
          bytes[o + 5]! <= 127 &&
          bytes[o + 6]! <= 127 &&
          bytes[o + 7] === 0,
        "CC 记录错误",
      );
  for (const s of sections.filter((s) => s.type === 7))
    for (let o = s.start; o < s.end; o += 24) {
      const p = pages.find((p) => p.id === u32(o + 4));
      check(
        p &&
          u32(o) <= duration &&
          bytes[o + 20] === p.notation &&
          u16(o + 12) + u16(o + 16) <= p.width &&
          u16(o + 14) + u16(o + 18) <= p.height &&
          bytes.subarray(o + 21, o + 24).every((b) => b === 0),
        "小节索引错误",
      );
    }
  return {
    id: uuid(bytes.subarray(12, 28)),
    revision: u32(28),
    duration,
    capabilities: caps,
    notes,
    pages,
    meta,
    bytes,
    crc: crc32(bytes),
  };
}
export const formatBytes = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MiB`
    : `${(n / 1024).toFixed(1)} KiB`;
export const formatTime = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
