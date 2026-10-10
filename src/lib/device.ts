import { parseScore, crc32, type Score } from "./pseq";
import {
  CMD,
  SERVICE,
  RX,
  TX,
  FrameDecoder,
  encodeFrame,
  jsonBytes,
  readJson,
  type Frame,
} from "./wire";
export type Caps = {
  protocol: number;
  package_major: number;
  max_payload: number;
  max_write: number;
  max_file_bytes: number;
  max_notes: number;
  profiles: number[];
};
export type Status = {
  state: "LIBRARY" | "IMPORTING" | "READING" | "PERFORMING";
  free_bytes: number;
};
export type Entry = {
  id: string;
  revision: number;
  title: string;
  bytes: number;
  capabilities: number;
};
export interface DeviceLink {
  kind: "demo" | "ble";
  name: string;
  request<T>(type: number, payload?: Uint8Array, timeout?: number): Promise<T>;
  close(): void;
  onDisconnect?: () => void;
}
export class TransferCancelled extends Error {
  constructor() {
    super("下载已取消");
  }
}
export function validateCaps(x: Caps): Caps {
  if (
    !x ||
    x.protocol !== 1 ||
    x.package_major !== 1 ||
    !Number.isInteger(x.max_payload) ||
    x.max_payload < 64 ||
    x.max_payload > 1024 ||
    !Number.isInteger(x.max_write) ||
    x.max_write < 20 ||
    x.max_write > 512 ||
    !Number.isInteger(x.max_file_bytes) ||
    x.max_file_bytes <= 0 ||
    !Number.isInteger(x.max_notes) ||
    x.max_notes <= 0 ||
    !Array.isArray(x.profiles) ||
    !x.profiles.every((p) => Number.isInteger(p) && p > 0)
  )
    throw Error("设备能力格式错误或协议版本不兼容");
  return x;
}
export function validateStatus(x: Status): Status {
  if (
    !x ||
    !["LIBRARY", "IMPORTING", "READING", "PERFORMING"].includes(x.state) ||
    !Number.isSafeInteger(x.free_bytes) ||
    x.free_bytes < 0
  )
    throw Error("设备状态响应格式错误");
  return x;
}
export async function listEntries(link: DeviceLink): Promise<Entry[]> {
  let cursor: string | null = null,
    generation: number | undefined,
    entries: Entry[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 128; page++) {
    const r: { generation: number; next: string | null; items: Entry[] } =
      await link.request(CMD.LIST, jsonBytes({ cursor, generation }));
    if (
      !r ||
      !Number.isInteger(r.generation) ||
      !Array.isArray(r.items) ||
      r.items.length > 32
    )
      throw Error("设备目录格式错误");
    if (generation !== undefined && generation !== r.generation)
      throw Error("设备曲库已变化，请刷新后重试");
    generation = r.generation;
    for (const e of r.items) {
      if (
        !e ||
        typeof e.id !== "string" ||
        typeof e.title !== "string" ||
        e.title.length > 128 ||
        !Number.isInteger(e.revision) ||
        !Number.isInteger(e.bytes) ||
        e.bytes < 0 ||
        !Number.isInteger(e.capabilities)
      )
        throw Error("设备曲目记录错误");
      entries.push(e);
    }
    if (r.next === null) return entries;
    if (typeof r.next !== "string" || seen.has(r.next))
      throw Error("设备目录游标错误");
    seen.add(r.next);
    cursor = r.next;
  }
  throw Error("设备目录超过安全分页限制");
}
export async function transferScore(
  link: DeviceLink,
  score: Score,
  caps: Caps,
  signal: AbortSignal,
  progress: (offset: number, stage: string) => void,
) {
  const st = validateStatus(await link.request<Status>(CMD.STATUS));
  if (st.state !== "LIBRARY")
    throw Error("设备不在曲库管理状态，请先退出演奏或阅读");
  if (
    score.bytes.length > caps.max_file_bytes ||
    score.bytes.length > st.free_bytes
  )
    throw Error("设备可用空间不足或曲目超过单曲容量");
  if (score.notes.length > caps.max_notes)
    throw Error("曲目音符数量超过设备限制");
  if (score.pages.some((p) => !caps.profiles.includes(p.profile)))
    throw Error("设备不支持此曲目的谱面规格");
  let started = false,
    committing = false;
  try {
    signal.throwIfAborted();
    const beginPayload = jsonBytes({
      id: score.id,
      revision: score.revision,
      title: score.meta.title,
      total_bytes: score.bytes.length,
      crc32: score.crc,
      capabilities: score.capabilities,
    });
    if (beginPayload.length > caps.max_payload)
      throw Error("设备命令帧容量不足以接收曲目信息");
    started = true;
    const begin = await link.request<{ next_offset: number }>(
      CMD.BEGIN,
      beginPayload,
    );
    if (begin.next_offset !== 0)
      throw Error("首版只支持从头下载，设备起始偏移不匹配");
    for (let offset = 0; offset < score.bytes.length;) {
      signal.throwIfAborted();
      const n = Math.min(caps.max_payload - 4, score.bytes.length - offset),
        payload = new Uint8Array(n + 4);
      new DataView(payload.buffer).setUint32(0, offset, true);
      payload.set(score.bytes.subarray(offset, offset + n), 4);
      const ack = await link.request<{ next_offset: number }>(
        CMD.DATA,
        payload,
      );
      if (ack.next_offset !== offset + n)
        throw Error("设备确认偏移错误，下载已停止");
      offset += n;
      progress(offset, "正在传输");
    }
    signal.throwIfAborted();
    progress(score.bytes.length, "设备校验与保存中");
    committing = true;
    const done = await link.request<{
      state: string;
      id: string;
      revision: number;
      crc32: number;
    }>(CMD.COMMIT, new Uint8Array(), 30000);
    if (
      !done ||
      done.state !== "STORED" ||
      done.id !== score.id ||
      done.revision !== score.revision ||
      done.crc32 !== score.crc
    )
      throw Error("设备保存响应与曲目不匹配");
    progress(score.bytes.length, "已保存到设备");
  } catch (e) {
    if (committing)
      throw Error(
        `未收到匹配的最终保存确认；请刷新设备曲库核对（${e instanceof Error ? e.message : String(e)}）`,
      );
    let cancelled = !started;
    if (started) {
      const reply = await link
        .request<{ state: string }>(CMD.CANCEL)
        .catch(() => undefined);
      cancelled = reply?.state === "LIBRARY";
    }
    if (signal.aborted && cancelled) throw new TransferCancelled();
    if (signal.aborted) throw Error("未确认取消；请重连并刷新设备曲库");
    throw e;
  }
}
export class BleLink implements DeviceLink {
  kind = "ble" as const;
  name = "蓝牙设备";
  onDisconnect?: () => void;
  private device?: BluetoothDevice;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private decoder = new FrameDecoder();
  private seq = 0;
  private session = crypto.getRandomValues(new Uint32Array(1))[0]! || 1;
  private pending?: {
    seq: number;
    resolve: (f: Frame) => void;
    reject: (e: Error) => void;
  };
  private busy = false;
  private interrupt?: (error: Error) => void;
  private maxWrite = 20;
  private disconnected = () => {
    const error = Error("蓝牙连接已断开；请重连后核对曲库");
    this.interrupt?.(error);
    this.pending?.reject(error);
    this.pending = undefined;
    this.decoder.reset();
    this.onDisconnect?.();
  };
  private notification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    for (const f of this.decoder.push(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ))
      if (f.session === this.session && f.seq === this.pending?.seq)
        this.pending.resolve(f);
  };
  async connect() {
    if (!window.isSecureContext || !navigator.bluetooth)
      throw Error(
        "请使用 HTTPS 下的 Windows / Android Chrome；当前浏览器不支持 Web Bluetooth",
      );
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }],
    });
    this.name = this.device.name || "钢琴设备";
    try {
      this.device.addEventListener("gattserverdisconnected", this.disconnected);
      const server = await this.device.gatt!.connect(),
        service = await server.getPrimaryService(SERVICE);
      this.rx = await service.getCharacteristic(RX);
      this.tx = await service.getCharacteristic(TX);
      this.tx.addEventListener("characteristicvaluechanged", this.notification);
      await this.tx.startNotifications();
      const caps = validateCaps(await this.request<Caps>(CMD.CAPS));
      this.maxWrite = caps.max_write;
      return caps;
    } catch (e) {
      this.close();
      throw e;
    }
  }
  async request<T>(
    type: number,
    payload = new Uint8Array(),
    timeout = 5000,
  ): Promise<T> {
    if (this.busy) throw Error("设备正在处理上一条命令");
    if (!this.rx || !this.device?.gatt?.connected) throw Error("设备未连接");
    const seq = ++this.seq,
      encoded = encodeFrame({ type, payload, seq, session: this.session });
    this.busy = true;
    const stopped = new Promise<never>((_, reject) => {
      this.interrupt = reject;
    });
    stopped.catch(() => {});
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const answer = new Promise<Frame>((resolve, reject) => {
          this.pending = { seq, resolve, reject };
        });
        answer.catch(() => {});
        try {
          for (let o = 0; o < encoded.length; o += this.maxWrite) {
            try {
              // A native GATT write cannot be cancelled. Drop the connection on
              // failure so no new request can overlap an unfinished write.
              const deadline = new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(Error("蓝牙写入超时，请重新连接")),
                  5000,
                );
              });
              await Promise.race([
                this.rx.writeValueWithResponse(
                  encoded.slice(o, o + this.maxWrite),
                ),
                stopped,
                deadline,
              ]);
            } catch (e) {
              this.close();
              throw e;
            } finally {
              clearTimeout(timer);
            }
          }
          timer = setTimeout(
            () => this.pending?.reject(Error("ACK_TIMEOUT")),
            timeout,
          );
          const f = await answer;
          if (f.type === CMD.ERROR) {
            const r = readJson<{ code: string; message?: string }>(f.payload);
            throw Error(`${r.code}: ${r.message || "设备拒绝了请求"}`);
          }
          if (f.type !== CMD.ACK) throw Error("未知设备响应");
          return readJson<T>(f.payload);
        } catch (e) {
          this.decoder.reset();
          if (!(
            e instanceof Error &&
            e.message === "ACK_TIMEOUT" &&
            attempt < 2
          ))
            throw e;
        } finally {
          if (timer) clearTimeout(timer);
          this.pending = undefined;
        }
      }
      throw Error("设备响应超时");
    } finally {
      this.interrupt = undefined;
      this.busy = false;
    }
  }
  close() {
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.disconnected,
    );
    this.tx?.removeEventListener(
      "characteristicvaluechanged",
      this.notification,
    );
    this.device?.gatt?.disconnect();
    this.disconnected();
  }
}
export class DemoLink implements DeviceLink {
  kind = "demo" as const;
  name = "演示设备 · 当前浏览器内存";
  onDisconnect?: () => void;
  entries: Entry[] = [];
  generation = 0;
  state: Status["state"] = "LIBRARY";
  closed = false;
  private incoming?: {
    meta: { id: string; revision: number; total_bytes: number; crc32: number };
    bytes: Uint8Array;
    offset: number;
  };
  private capacity = 8 * 1048576;
  async request<T>(type: number, payload = new Uint8Array()): Promise<T> {
    await new Promise((r) => setTimeout(r, type === CMD.COMMIT ? 350 : 8));
    if (this.closed) throw Error("演示设备已断开");
    const free = this.capacity - this.entries.reduce((s, e) => s + e.bytes, 0);
    let result: unknown;
    switch (type) {
      case CMD.CAPS:
        result = {
          protocol: 1,
          package_major: 1,
          max_payload: 1024,
          max_write: 20,
          max_file_bytes: 4 * 1048576,
          max_notes: 20000,
          profiles: [1],
        };
        break;
      case CMD.STATUS:
        result = { state: this.state, free_bytes: free };
        break;
      case CMD.LIST:
        result = {
          generation: this.generation,
          next: null,
          items: this.entries,
        };
        break;
      case CMD.BEGIN: {
        if (this.state !== "LIBRARY") throw Error("BUSY：设备不在曲库管理状态");
        const meta = readJson<{
          id: string;
          revision: number;
          total_bytes: number;
          crc32: number;
        }>(payload);
        if (
          meta.total_bytes > free ||
          meta.total_bytes > 4 * 1048576 ||
          meta.total_bytes < 64
        )
          throw Error("NO_SPACE：剩余空间不足");
        this.incoming = {
          meta,
          bytes: new Uint8Array(meta.total_bytes),
          offset: 0,
        };
        this.state = "IMPORTING";
        result = { next_offset: 0 };
        break;
      }
      case CMD.DATA: {
        if (!this.incoming || payload.length < 5) throw Error("BAD_OFFSET");
        const offset = new DataView(
            payload.buffer,
            payload.byteOffset,
            payload.byteLength,
          ).getUint32(0, true),
          d = payload.subarray(4),
          t = this.incoming;
        if (offset !== t.offset || offset + d.length > t.bytes.length)
          throw Error("BAD_OFFSET");
        t.bytes.set(d, offset);
        t.offset += d.length;
        result = { next_offset: t.offset };
        break;
      }
      case CMD.COMMIT: {
        const t = this.incoming;
        if (
          !t ||
          t.offset !== t.bytes.length ||
          crc32(t.bytes) !== t.meta.crc32
        )
          throw Error("BAD_FILE_CRC");
        const s = parseScore(t.bytes);
        if (s.id !== t.meta.id || s.revision !== t.meta.revision)
          throw Error("BAD_PACKAGE");
        this.entries = this.entries.filter((e) => e.id !== s.id);
        this.entries.push({
          id: s.id,
          revision: s.revision,
          title: String(s.meta.title),
          bytes: s.bytes.length,
          capabilities: s.capabilities,
        });
        this.generation++;
        this.incoming = undefined;
        this.state = "LIBRARY";
        result = {
          state: "STORED",
          id: s.id,
          revision: s.revision,
          crc32: s.crc,
        };
        break;
      }
      case CMD.CANCEL:
        this.incoming = undefined;
        if (this.state === "IMPORTING") this.state = "LIBRARY";
        result = { state: this.state };
        break;
      case CMD.DELETE: {
        if (this.state !== "LIBRARY") throw Error("BUSY");
        const e = readJson<{ id: string; revision: number }>(payload);
        this.entries = this.entries.filter(
          (x) => !(x.id === e.id && x.revision === e.revision),
        );
        this.generation++;
        result = { deleted: true };
        break;
      }
      default:
        throw Error("UNSUPPORTED_COMMAND");
    }
    return result as T;
  }
  close() {
    this.closed = true;
    this.incoming = undefined;
    this.onDisconnect?.();
  }
}
