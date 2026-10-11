import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseScore } from "../src/lib/pseq";
import { CMD } from "../src/lib/wire";
import type { useDevice } from "../src/composables/useDevice";
let d: ReturnType<typeof useDevice>;
const score = () =>
  parseScore(
    new Uint8Array(readFileSync("tests/fixtures/packages/engineering.pseq")),
  );
async function finish(p: Promise<void>) {
  await vi.runAllTimersAsync();
  await p;
  await vi.runAllTimersAsync();
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  d = (await import("../src/composables/useDevice")).useDevice();
  await finish(d.connect(true));
});
afterEach(async () => {
  d.disconnect();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("visible directory and transfer state", () => {
  it("keeps confirmed storage separate from failed directory refresh", async () => {
    const link = d.link.value!,
      original = link.request.bind(link);
    let committed = false;
    link.request = async (type, payload) => {
      if (type === CMD.LIST && committed) throw Error("LIST_FAILED");
      const r = await original(type, payload);
      if (type === CMD.COMMIT) committed = true;
      return r as never;
    };
    await finish(d.upload(score()));
    expect(d.stage.value).toBe("已保存");
    expect(d.directory.value).toBe("unknown");
    expect(d.error.value).toContain("目录");
  });
  it("reconciles COMMIT after disconnect/reconnect and never calls it cancelled", async () => {
    const link = d.link.value!,
      original = link.request.bind(link);
    link.request = async (type, payload) => {
      const r = await original(type, payload);
      if (type === CMD.COMMIT) {
        link.close();
        throw Error("disconnected");
      }
      return r as never;
    };
    await finish(d.upload(score()));
    expect(d.stage.value).toBe("保存结果未确认");
    expect(d.link.value).toBeUndefined();
    await finish(d.connect(true));
    expect(d.stage.value).toBe("已核对保存成功");
    expect(d.entries.value[0]!.entry_state).toBe(2);
  });
  it("pauses only after the in-flight block finishes and preserves partial directory state", async () => {
    const link = d.link.value!,
      original = link.request.bind(link);
    let blocks = 0;
    link.request = async (type, payload) => {
      if (type === CMD.DATA && ++blocks === 2) d.pause();
      return original(type, payload) as never;
    };
    await finish(d.upload(score()));
    expect(d.stage.value).toBe("已暂停，进度保留");
    expect(d.entries.value[0]!.entry_state).toBe(1);
    expect(d.entries.value[0]!.next_block).toBe(2);
    expect(d.savedBytes.value).toBe(1024);
    await finish(d.resume(d.entries.value[0]!));
    expect(d.stage.value).toBe("已保存");
  });
  it("reconciles an unknown re-download deletion before issuing any new BEGIN", async () => {
    await finish(d.upload(score()));
    const entry = d.entries.value[0]!,
      link = d.link.value!,
      original = link.request.bind(link);
    let begins = 0;
    link.request = async (type, payload) => {
      if (type === CMD.BEGIN) begins++;
      const r = await original(type, payload);
      if (type === CMD.DELETE) {
        link.close();
        throw Error("lost delete result");
      }
      return r as never;
    };
    await finish(d.redownload(entry));
    expect(begins).toBe(0);
    expect(d.stage.value).toContain("删除结果未确认");
    await finish(d.connect(true));
    expect(d.stage.value).toBe("已核对曲目不存在");
    expect(d.entries.value).toEqual([]);
  });
  it("stops on demo local mode notification and waits for explicit resume", async () => {
    const link = d.link.value!,
      original = link.request.bind(link);
    let first = true;
    link.request = async (type, payload) => {
      const r = await original(type, payload);
      if (type === CMD.DATA && first) {
        first = false;
        d.toggleDemoState();
      }
      return r as never;
    };
    await finish(d.upload(score()));
    expect(d.stage.value).toContain("手动续传");
    expect(d.status.value!.mode).toBe(3);
    d.toggleDemoState();
    await vi.runAllTimersAsync();
    expect(d.entries.value[0]!.next_block).toBe(1);
  });
  it("requeries a demo local deletion notification without a remote delete command", async () => {
    await finish(d.upload(score()));
    const link = d.link.value!,
      original = link.request.bind(link),
      calls: number[] = [];
    link.request = async (type, payload) => {
      calls.push(type);
      return original(type, payload) as never;
    };
    d.demoLocalDelete(d.entries.value[0]!);
    await vi.runAllTimersAsync();
    expect(d.directory.value).toBe("known");
    expect(d.entries.value).toEqual([]);
    expect(calls).not.toContain(CMD.DELETE);
  });
});
