import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crc32, parseScore } from "../src/lib/pseq";

function sample() {
  const bytes = new Uint8Array(readFileSync("public/scores/study-1.pseq"));
  return { bytes, view: new DataView(bytes.buffer) };
}
function section(view: DataView, type: number) {
  for (let o = 64; o < 64 + view.getUint16(36, true) * 32; o += 32)
    if (view.getUint32(o, true) === type) return o;
  throw Error("Missing fixture section");
}
function repair(bytes: Uint8Array, view: DataView, entry: number) {
  const start = view.getUint32(entry + 8, true);
  view.setUint32(
    entry + 24,
    crc32(bytes.subarray(start, start + view.getUint32(entry + 12, true))),
    true,
  );
}

describe("package semantic boundaries", () => {
  it("rejects a profile 1 page with a different size, even with a valid CRC", () => {
    const { bytes, view } = sample(),
      entry = section(view, 5),
      start = view.getUint32(entry + 8, true);
    view.setUint16(start + 10, 479, true);
    view.setUint32(start + 20, 120 * 479, true);
    repair(bytes, view, entry);
    expect(() => parseScore(bytes)).toThrow("profile 1");
  });
  it.each(["source", "generator_version"])("requires META %s", (field) => {
    const { bytes, view } = sample(),
      entry = section(view, 1),
      start = view.getUint32(entry + 8, true);
    const text = new TextDecoder().decode(
      bytes.subarray(start, start + view.getUint32(entry + 12, true)),
    );
    bytes.set(
      new TextEncoder().encode(
        text.replace(`"${field}"`, `"${"x".repeat(field.length)}"`),
      ),
      start,
    );
    repair(bytes, view, entry);
    expect(() => parseScore(bytes)).toThrow("元数据");
  });
  it("rejects nonzero alignment padding", () => {
    const { bytes, view } = sample(),
      entry = section(view, 1);
    const end =
      view.getUint32(entry + 8, true) + view.getUint32(entry + 12, true);
    expect(end % 4).not.toBe(0);
    bytes[end] = 1;
    expect(() => parseScore(bytes)).toThrow("填充");
  });
  it("rejects pitches out of order at the same start", () => {
    const { bytes, view } = sample(),
      entry = section(view, 2),
      start = view.getUint32(entry + 8, true);
    view.setUint32(start + 16, view.getUint32(start, true), true);
    bytes[start + 8] = 65;
    repair(bytes, view, entry);
    expect(() => parseScore(bytes)).toThrow("排序");
  });
  it("rejects duplicate targets for the same pitch and start", () => {
    const { bytes, view } = sample(),
      entry = section(view, 2),
      start = view.getUint32(entry + 8, true);
    view.setUint32(start + 16, view.getUint32(start, true), true);
    bytes[start + 24] = bytes[start + 8]!;
    repair(bytes, view, entry);
    expect(() => parseScore(bytes)).toThrow("同起点同音");
  });
  it.each(["time", "flags"])(
    "validates BEAT %s beyond record length and CRC",
    (field) => {
      const { bytes, view } = sample(),
        entry = section(view, 2),
        start = view.getUint32(entry + 8, true);
      view.setUint32(44, 6, true);
      view.setUint32(48, 0, true);
      view.setUint32(entry, 4, true);
      view.setUint32(entry + 16, view.getUint32(entry + 12, true) / 8, true);
      view.setUint16(entry + 20, 8, true);
      bytes.fill(0, start, start + view.getUint32(entry + 12, true));
      if (field === "time")
        view.setUint32(start, view.getUint32(32, true) + 1, true);
      else bytes[start + 7] = 2;
      repair(bytes, view, entry);
      expect(() => parseScore(bytes)).toThrow("拍点");
    },
  );
});
