import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { crc32, parseScore } from "../src/lib/pseq";
import { CMD, encodeFrame, FrameDecoder, jsonBytes } from "../src/lib/wire";
import {
  DemoLink,
  transferScore,
  validateCaps,
  type Caps,
} from "../src/lib/device";
const sample = () => new Uint8Array(readFileSync("public/scores/study-1.pseq"));
describe("package and wire contracts", () => {
  it("keeps all five staff lines after MONO1 rasterization", () => {
    const p = parseScore(sample()).pages[0]!;
    for (const y of [92, 104, 116, 128, 140])
      for (const x of [80, 300, 700, 900])
        expect(p.pixels[y * p.stride + (x >> 3)]! & (128 >> (x & 7))).not.toBe(
          0,
        );
  });
  it("matches the published CRC vector and sample semantics", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const s = parseScore(sample());
    expect(s.notes).toHaveLength(16);
    expect(s.pages.map((p) => p.notation)).toEqual([1, 2]);
    expect(s.notes[0]).toMatchObject({ start: 2000, pitch: 60, velocity: 88 });
    expect(s.pages[0]!.pixels.length).toBe(57600);
  });
  it("rejects truncation, unsupported versions, overlaps and changed content", () => {
    const original = sample();
    for (const n of [0, 63, 64, 180, original.length - 1])
      expect(() => parseScore(original.slice(0, n))).toThrow();
    for (const offset of [4, 8, 64 + 8, original.length - 4]) {
      const b = original.slice();
      b[offset] ^= 255;
      expect(() => parseScore(b)).toThrow();
    }
  });
  it("decodes arbitrary notification splits and resynchronizes after corrupt frames", () => {
    const frame = encodeFrame({
      type: CMD.DATA,
      seq: 7,
      session: 12,
      payload: Uint8Array.from([0xa5, 0x5a, 1, 2, 3]),
    });
    for (let cut = 0; cut <= frame.length; cut++) {
      const d = new FrameDecoder();
      const decoded = [
        ...d.push(frame.slice(0, cut)),
        ...d.push(frame.slice(cut)),
      ];
      expect(decoded).toHaveLength(1);
      expect(decoded[0]).toMatchObject({ seq: 7, session: 12 });
    }
    const bad = frame.slice();
    bad[16] ^= 1;
    const d = new FrameDecoder();
    expect(d.push(new Uint8Array([...bad, ...frame, ...frame]))).toHaveLength(
      2,
    );
  });
  it("validates capabilities before accepting chunk and capacity limits", () => {
    expect(() =>
      validateCaps({
        protocol: 1,
        package_major: 1,
        max_payload: 0,
        max_write: 20,
        max_file_bytes: 5,
        max_notes: 1,
        profiles: [1],
      }),
    ).toThrow();
  });
});
describe("end-to-end transfer semantics", () => {
  it("cancels an accepted BEGIN whose acknowledgement is lost", async () => {
    const link = new DemoLink(),
      original = link.request.bind(link),
      caps = await link.request<Caps>(CMD.CAPS);
    link.request = async (type, payload) => {
      const r = await original(type, payload);
      if (type === CMD.BEGIN) throw Error("ACK_TIMEOUT");
      return r as never;
    };
    await expect(
      transferScore(
        link,
        parseScore(sample()),
        caps,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("ACK_TIMEOUT");
    expect(link.state).toBe("LIBRARY");
    expect(link.entries).toHaveLength(0);
  });
  it("publishes only after COMMIT; replacement and deletion are reflected", async () => {
    const link = new DemoLink(),
      caps = await link.request<Caps>(CMD.CAPS),
      s = parseScore(sample()),
      stages: string[] = [];
    await transferScore(
      link,
      s,
      caps,
      new AbortController().signal,
      (_, stage) => {
        stages.push(stage);
        if (stage === "设备校验与保存中") expect(link.entries).toHaveLength(0);
      },
    );
    expect(stages.at(-1)).toBe("已保存到设备");
    expect(link.entries).toHaveLength(1);
    await transferScore(link, s, caps, new AbortController().signal, () => {});
    expect(link.entries).toHaveLength(1);
    await link.request(
      CMD.DELETE,
      jsonBytes({ id: s.id, revision: s.revision }),
    );
    expect(link.entries).toHaveLength(0);
  });
  it("cancelled transfers do not publish partial files", async () => {
    const link = new DemoLink(),
      caps = await link.request<Caps>(CMD.CAPS),
      abort = new AbortController();
    await expect(
      transferScore(link, parseScore(sample()), caps, abort.signal, () =>
        abort.abort(),
      ),
    ).rejects.toThrow();
    expect(link.entries).toHaveLength(0);
    expect(link.state).toBe("LIBRARY");
  });
  it("rejects performance state and unsupported profiles", async () => {
    const link = new DemoLink(),
      caps = await link.request<Caps>(CMD.CAPS);
    link.state = "PERFORMING";
    await expect(
      transferScore(
        link,
        parseScore(sample()),
        caps,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("曲库管理");
    link.state = "LIBRARY";
    await expect(
      transferScore(
        link,
        parseScore(sample()),
        { ...caps, profiles: [2] },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("谱面规格");
  });
  it("does not claim success when the device COMMIT reply is wrong", async () => {
    const link = new DemoLink(),
      original = link.request.bind(link),
      caps = await link.request<Caps>(CMD.CAPS);
    link.request = async (type, payload) =>
      type === CMD.COMMIT
        ? ({ state: "QUEUED" } as never)
        : original(type, payload);
    await expect(
      transferScore(
        link,
        parseScore(sample()),
        caps,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("最终保存确认");
  });
});
