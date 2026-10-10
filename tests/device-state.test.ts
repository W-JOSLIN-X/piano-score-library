import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDevice } from "../src/composables/useDevice";
import { listEntries, type DeviceLink } from "../src/lib/device";
import { parseScore } from "../src/lib/pseq";
import { CMD } from "../src/lib/wire";

const score = () =>
  parseScore(new Uint8Array(readFileSync("public/scores/study-1.pseq")));
const d = useDevice();
async function finish(promise: Promise<void>) {
  await vi.runAllTimersAsync();
  await promise;
}
beforeEach(async () => {
  vi.useFakeTimers();
  await finish(d.connect(true));
});
afterEach(() => {
  d.disconnect();
  vi.useRealTimers();
});

describe("visible transfer and directory outcomes", () => {
  it("retains confirmed storage when the following LIST fails", async () => {
    const link = d.link.value!,
      original = link.request.bind(link);
    let committed = false;
    link.request = async (type, payload) => {
      if (type === CMD.LIST && committed) throw Error("LIST_FAILED");
      const result = await original(type, payload);
      if (type === CMD.COMMIT) committed = true;
      return result as never;
    };
    await finish(d.upload(score()));
    expect(d.stage.value).toBe("已保存到设备");
    expect(d.error.value).toContain("目录刷新失败");
    expect(d.status.value).toBeUndefined();
  });
  it("does not call a disconnect during COMMIT a cancellation", async () => {
    const link = d.link.value!,
      original = link.request.bind(link);
    link.request = async (type, payload) => {
      const result = await original(type, payload);
      if (type === CMD.COMMIT) {
        link.close();
        throw Error("Disconnected");
      }
      return result as never;
    };
    await finish(d.upload(score()));
    expect(d.stage.value).toBe("未确认保存");
    expect(d.error.value).toContain("核对");
    expect(d.link.value).toBeUndefined();
  });
  it.each([true, false])(
    "requires a CANCEL acknowledgement before showing cancellation (%s)",
    async (acknowledge) => {
      const link = d.link.value!,
        original = link.request.bind(link);
      let blocks = 0;
      link.request = async (type, payload) => {
        if (type === CMD.DATA && ++blocks === 2) d.cancel();
        if (type === CMD.CANCEL && !acknowledge) throw Error("CANCEL_TIMEOUT");
        return (await original(type, payload)) as never;
      };
      await finish(d.upload(score()));
      expect(d.stage.value).toBe(acknowledge ? "已取消" : "未确认保存");
      expect(d.error.value).toBe(
        acknowledge ? "" : "未确认取消；请重连并刷新设备曲库",
      );
      expect(d.entries.value).toEqual([]);
    },
  );
  it("rejects an unconfirmed DELETE", async () => {
    const link = d.link.value!,
      original = link.request.bind(link);
    link.request = async (type, payload) =>
      type === CMD.DELETE
        ? ({ deleted: false } as never)
        : ((await original(type, payload)) as never);
    await finish(
      d.remove({
        id: score().id,
        revision: 1,
        title: "Test",
        bytes: 1,
        capabilities: 7,
      }),
    );
    expect(d.error.value).toContain("未确认删除");
  });
  it("rejects generation changes without mixing directory pages", async () => {
    let generation = 0;
    const link: DeviceLink = {
      kind: "demo",
      name: "Paged",
      close() {},
      request: async () =>
        ({
          generation: ++generation,
          next: generation === 1 ? "next" : null,
          items: [],
        }) as never,
    };
    await expect(listEntries(link)).rejects.toThrow("曲库已变化");
  });
  it("rejects insufficient capacity before BEGIN", async () => {
    const link = d.link.value!,
      original = link.request.bind(link),
      commands: number[] = [];
    link.request = async (type, payload) => {
      commands.push(type);
      return type === CMD.STATUS
        ? ({ state: "LIBRARY", free_bytes: 0 } as never)
        : ((await original(type, payload)) as never);
    };
    await finish(d.upload(score()));
    expect(d.error.value).toContain("空间不足");
    expect(commands).not.toContain(CMD.BEGIN);
  });
  it("refuses deletion in performance state", async () => {
    await finish(d.toggleDemoState());
    await finish(
      d.remove({
        id: score().id,
        revision: 1,
        title: "Test",
        bytes: 1,
        capabilities: 7,
      }),
    );
    expect(d.error.value).toContain("曲库管理");
  });
});
