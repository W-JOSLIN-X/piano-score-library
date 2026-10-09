import { ref, shallowRef } from "vue";
import {
  BleLink,
  DemoLink,
  validateCaps,
  validateStatus,
  listEntries,
  transferScore,
  type DeviceLink,
  type Caps,
  type Status,
  type Entry,
} from "../lib/device";
import { CMD, jsonBytes } from "../lib/wire";
import type { Score } from "../lib/pseq";
const link = shallowRef<DeviceLink>(),
  caps = ref<Caps>(),
  status = ref<Status>(),
  entries = ref<Entry[]>([]),
  busy = ref(false),
  error = ref(""),
  progress = ref(0),
  stage = ref(""),
  transferTitle = ref("");
let abort: AbortController | undefined;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function refresh() {
  if (!link.value) return;
  status.value = validateStatus(await link.value.request<Status>(CMD.STATUS));
  entries.value = await listEntries(link.value);
}
async function guarded(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = message(e);
  } finally {
    busy.value = false;
  }
}
function bind(l: DeviceLink) {
  l.onDisconnect = () => {
    if (link.value === l) {
      link.value = undefined;
      caps.value = undefined;
      status.value = undefined;
      entries.value = [];
      abort?.abort();
      error.value = "连接已断开；设备中的实际曲目请重连后查询";
    }
  };
  link.value = l;
}
export function useDevice() {
  return {
    link,
    caps,
    status,
    entries,
    busy,
    error,
    progress,
    stage,
    transferTitle,
    connect: (demo = false) =>
      guarded(async () => {
        link.value?.close();
        stage.value = "";
        progress.value = 0;
        error.value = "";
        const l = demo ? new DemoLink() : new BleLink();
        const c =
          l instanceof BleLink
            ? await l.connect()
            : validateCaps(await l.request<Caps>(CMD.CAPS));
        bind(l);
        caps.value = c;
        await refresh();
      }),
    refresh: () => guarded(refresh),
    disconnect: () => {
      if (!busy.value) {
        link.value?.close();
        error.value = "";
        stage.value = "";
      }
    },
    upload: (score: Score) =>
      guarded(async () => {
        if (!link.value || !caps.value)
          throw Error("请先在设备页面连接真实设备或演示设备");
        abort = new AbortController();
        progress.value = 0;
        stage.value = "准备传输";
        transferTitle.value = String(score.meta.title);
        try {
          await transferScore(
            link.value,
            score,
            caps.value,
            abort.signal,
            (o, s) => {
              progress.value = (o / score.bytes.length) * 100;
              stage.value = s;
            },
          );
          await refresh();
        } catch (e) {
          stage.value = abort.signal.aborted ? "已取消" : "未确认保存";
          await refresh().catch(() => {});
          throw e;
        } finally {
          abort = undefined;
        }
      }),
    cancel: () => {
      stage.value = "正在取消，等待当前数据块结束";
      abort?.abort(new Error("用户已取消下载"));
    },
    remove: (e: Entry) =>
      guarded(async () => {
        if (!link.value) throw Error("设备未连接");
        const s = validateStatus(await link.value.request<Status>(CMD.STATUS));
        if (s.state !== "LIBRARY") throw Error("设备不在曲库管理状态");
        await link.value.request(
          CMD.DELETE,
          jsonBytes({ id: e.id, revision: e.revision }),
        );
        await refresh();
      }),
    toggleDemoState: () =>
      guarded(async () => {
        if (link.value instanceof DemoLink) {
          link.value.state =
            link.value.state === "LIBRARY" ? "PERFORMING" : "LIBRARY";
          await refresh();
        }
      }),
  };
}
