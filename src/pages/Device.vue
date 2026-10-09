<script setup lang="ts">
import { reactive, ref } from "vue";
import { useDevice } from "../composables/useDevice";
import { formatBytes } from "../lib/pseq";
import type { Entry } from "../lib/device";
const d = reactive(useDevice()),
  deleting = ref<Entry>(),
  confirm = ref(false);
const supported =
  typeof navigator !== "undefined" &&
  !!navigator.bluetooth &&
  window.isSecureContext;
const states = {
  LIBRARY: "曲库管理",
  IMPORTING: "正在导入",
  READING: "谱面阅读",
  PERFORMING: "正在演奏",
};
</script>
<template>
  <div class="page-intro">
    <div class="eyebrow">YOUR PIANO, CONNECTED</div>
    <h1>让曲谱，来到琴边。</h1>
    <p>连接设备，查看已保存的曲目。下载完成后，就可以放下手机专心练习。</p>
  </div>
  <div class="device-grid">
    <UCard
      ><template #header
        ><div class="flex items-center gap-3">
          <UIcon name="i-lucide-bluetooth" class="size-6 text-teal-600" />
          <h2>蓝牙连接</h2>
          <UBadge color="warning" variant="soft" class="ml-auto"
            >待硬件联调</UBadge
          >
        </div></template
      >
      <p class="body-copy">
        使用 Windows 或 Android Chrome，开启系统蓝牙，选择运行配套固件的
        ESP32。当前 MIDI 转换固件尚不提供此 BLE 服务。
      </p>
      <UAlert
        v-if="!supported"
        title="当前环境不支持网页蓝牙"
        description="请使用 HTTPS 网站，或在 Windows / Android Chrome 中打开。你仍可使用演示设备。"
        color="warning"
        variant="soft"
        class="mt-4"
      />
      <div class="mt-6 flex flex-wrap gap-3">
        <UButton
          icon="i-lucide-bluetooth"
          :disabled="!supported || d.busy"
          :loading="d.busy && !d.link"
          @click="d.connect(false)"
          >连接真实设备</UButton
        ><UButton
          v-if="d.link"
          color="neutral"
          variant="outline"
          :disabled="d.busy"
          @click="d.disconnect"
          >断开连接</UButton
        >
      </div></UCard
    >
    <UCard class="demo-card"
      ><template #header
        ><div class="flex items-center gap-3">
          <UIcon name="i-lucide-flask-conical" class="size-6 text-amber-600" />
          <h2>先体验一下</h2>
        </div></template
      >
      <p class="body-copy">
        使用演示设备验证下载、取消、目录和删除流程。数据仅在当前网页内存中，刷新后清空，不会连接或写入任何硬件。
      </p>
      <UButton
        class="mt-6"
        color="neutral"
        variant="outline"
        icon="i-lucide-monitor-play"
        :disabled="d.busy"
        @click="d.connect(true)"
        >连接演示设备</UButton
      ></UCard
    >
  </div>
  <UAlert
    v-if="d.link?.kind === 'demo'"
    class="mt-6"
    color="warning"
    variant="soft"
    title="当前是演示设备"
    description="下面的容量和已保存曲目均为模拟状态，不代表 FPGA 上的真实内容。"
  />
  <section class="mt-8">
    <div class="section-title">
      <div>
        <h2>设备本地曲库</h2>
        <p class="muted mt-2">
          {{ d.link?.name || "连接后读取设备返回的曲目目录" }}
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :disabled="!d.link || d.busy"
        @click="d.refresh"
        >刷新目录</UButton
      >
    </div>
    <div v-if="d.link && d.status" class="device-summary">
      <div>
        <span>当前状态</span><strong>{{ states[d.status.state] }}</strong>
      </div>
      <div>
        <span>可用空间</span
        ><strong>{{ formatBytes(d.status.free_bytes) }}</strong>
      </div>
      <div>
        <span>已保存曲目</span><strong>{{ d.entries.length }} 首</strong>
      </div>
      <UButton
        v-if="d.link.kind === 'demo'"
        color="neutral"
        variant="outline"
        :disabled="d.busy"
        @click="d.toggleDemoState"
        >{{
          d.status.state === "PERFORMING"
            ? "演示：返回管理状态"
            : "演示：切换演奏状态"
        }}</UButton
      >
    </div>
    <div v-if="!d.entries.length" class="empty-state">
      <UIcon name="i-lucide-folder-open" class="size-10" />
      <h3>{{ d.link ? "这里还没有曲目" : "先连接你的设备" }}</h3>
      <p>
        {{
          d.link
            ? "从曲库打开一首曲目，然后发送到设备。"
            : "设备目录由 FPGA 返回，网站不会把线上曲库当成已下载内容。"
        }}
      </p>
      <UButton v-if="d.link" to="/" variant="soft">去挑一首曲子</UButton>
    </div>
    <div v-else class="device-list">
      <div v-for="e in d.entries" :key="e.id" class="device-row">
        <div class="file-icon"><UIcon name="i-lucide-file-music" /></div>
        <div>
          <strong>{{ e.title }}</strong>
          <p>
            {{ formatBytes(e.bytes) }} · v{{ e.revision }} ·
            {{
              [
                e.capabilities & 2 ? "五线谱" : "",
                e.capabilities & 4 ? "简谱" : "",
                e.capabilities & 1 ? "钢琴块" : "",
              ]
                .filter(Boolean)
                .join(" / ")
            }}
          </p>
        </div>
        <UButton
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :disabled="d.busy || d.status?.state !== 'LIBRARY'"
          :aria-label="'删除' + e.title"
          @click="
            deleting = e;
            confirm = true;
          "
          >删除</UButton
        >
      </div>
    </div>
  </section>
  <UModal
    v-model:open="confirm"
    title="删除设备曲目？"
    :description="
      '将从' +
      (d.link?.kind === 'demo' ? '演示设备' : '实际设备') +
      '删除「' +
      deleting?.title +
      '」。之后可以重新下载。'
    "
    ><template #footer
      ><UButton color="neutral" variant="outline" @click="confirm = false"
        >保留曲目</UButton
      ><UButton
        color="error"
        :disabled="d.busy"
        @click="
          deleting && d.remove(deleting);
          confirm = false;
        "
        >确认删除</UButton
      ></template
    ></UModal
  >
</template>
