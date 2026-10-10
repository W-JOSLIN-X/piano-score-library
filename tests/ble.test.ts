import { afterEach, describe, expect, it, vi } from "vitest";
import { BleLink, type Caps } from "../src/lib/device";
import {
  CMD,
  RX,
  FrameDecoder,
  encodeFrame,
  jsonBytes,
  type Frame,
} from "../src/lib/wire";

const caps: Caps = {
  protocol: 1,
  package_major: 1,
  max_payload: 1024,
  max_write: 20,
  max_file_bytes: 4194304,
  max_notes: 20000,
  profiles: [1],
};
async function bluetooth() {
  const device = new EventTarget();
  const tx = Object.assign(new EventTarget(), {
    value: new DataView(new ArrayBuffer(0)),
    startNotifications: async () => {},
  });
  const frames: Frame[] = [],
    decoder = new FrameDecoder();
  function reply(f: Frame, value: unknown = {}, type: number = CMD.ACK) {
    const bytes = encodeFrame({ ...f, type, payload: jsonBytes(value) });
    for (let offset = 0; offset < bytes.length; offset += 7) {
      tx.value = new DataView(bytes.slice(offset, offset + 7).buffer);
      tx.dispatchEvent(new Event("characteristicvaluechanged"));
    }
  }
  const state = { handle: (f: Frame) => reply(f) };
  const rx = {
    writeValueWithResponse: vi.fn(async (bytes: Uint8Array) => {
      for (const f of decoder.push(bytes)) {
        frames.push(f);
        if (f.type === CMD.CAPS) reply(f, caps);
        else state.handle(f);
      }
    }),
  };
  const gatt = {
    connected: false,
    connect: async () => {
      gatt.connected = true;
      return gatt;
    },
    getPrimaryService: async () => ({
      getCharacteristic: async (id: string) => (id === RX ? rx : tx),
    }),
    disconnect: () => {
      gatt.connected = false;
      device.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
  Object.assign(device, { name: "Test BLE", gatt });
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", {
    bluetooth: { requestDevice: async () => device },
  });
  const link = new BleLink();
  await link.connect();
  return { link, rx, gatt, state, frames, reply };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("real BLE client with mocked GATT", () => {
  it("bounds a hanging GATT write and disconnects instead of leaving busy locked", async () => {
    vi.useFakeTimers();
    const { link, rx, gatt } = await bluetooth();
    rx.writeValueWithResponse.mockImplementation(() => new Promise(() => {}));
    const result = link.request(CMD.STATUS).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(5001);
    expect(
      await Promise.race([result, Promise.resolve("still pending")]),
    ).toBeInstanceOf(Error);
    expect(gatt.connected).toBe(false);
    link.close();
  });
  it("releases a request when disconnected during a hanging write", async () => {
    const { link, rx, gatt } = await bluetooth();
    rx.writeValueWithResponse.mockImplementation(() => new Promise(() => {}));
    const result = link.request(CMD.STATUS).catch((error: Error) => error);
    gatt.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      await Promise.race([result, Promise.resolve("still pending")]),
    ).toBeInstanceOf(Error);
    link.close();
  });
  it("does not lock busy after a locally invalid payload", async () => {
    const { link } = await bluetooth();
    await expect(link.request(CMD.BEGIN, new Uint8Array(1025))).rejects.toThrow(
      "过长",
    );
    await expect(link.request(CMD.STATUS)).resolves.toEqual({});
    link.close();
  });
  it("retries identical bytes and ignores stale responses for other sequences", async () => {
    vi.useFakeTimers();
    const { link, state, frames, reply } = await bluetooth();
    let attempt = 0;
    state.handle = (f) => {
      if (++attempt === 2) {
        reply({ ...f, seq: f.seq - 1 }, { stale: true });
        reply(f, { state: "LIBRARY" });
        reply(f, { duplicate: true });
      }
    };
    const result = link.request(CMD.STATUS, new Uint8Array(), 50);
    await vi.advanceTimersByTimeAsync(51);
    await expect(result).resolves.toEqual({ state: "LIBRARY" });
    expect(frames[1]).toEqual(frames[2]);
    link.close();
  });
});
