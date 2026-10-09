<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import {
  parseScore,
  formatBytes,
  formatTime,
  MAX_FILE_BYTES,
  type Score,
} from "../lib/pseq";
import { useDevice } from "../composables/useDevice";
import ScorePreview from "../components/ScorePreview.vue";
type Item = {
  id: string;
  title: string;
  subtitle: string;
  level: string;
  tempo: number;
  duration: number;
  notes: number;
  bytes: number;
  crc: number;
  file: string;
  cover: string;
  capabilities: number;
  revision: number;
};
const items = ref<Item[]>([]),
  query = ref(""),
  mode = ref("全部格式"),
  level = ref("全部难度"),
  loading = ref(true),
  error = ref(""),
  opening = ref(""),
  modal = ref(false),
  selected = shallowRef<Score>(),
  input = ref<HTMLInputElement>(),
  d = reactive(useDevice());
const filtered = computed(() =>
  items.value.filter(
    (i) =>
      (i.title + i.subtitle)
        .toLowerCase()
        .includes(query.value.toLowerCase()) &&
      (level.value === "全部难度" || i.level === level.value) &&
      (mode.value === "全部格式" ||
        !!(
          i.capabilities & ({ 五线谱: 2, 简谱: 4, 钢琴块: 1 }[mode.value] || 0)
        )),
  ),
);
const base = import.meta.env.BASE_URL;
onMounted(async () => {
  try {
    const r = await fetch(base + "scores/catalog.json");
    if (!r.ok) throw Error("曲库加载失败，请稍后刷新");
    items.value = await r.json();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
});
async function openItem(item: Item) {
  opening.value = item.id;
  error.value = "";
  try {
    const r = await fetch(base + item.file);
    if (!r.ok) throw Error("曲目文件无法加载");
    const s = parseScore(new Uint8Array(await r.arrayBuffer()));
    if (
      s.crc !== item.crc ||
      s.id !== item.id ||
      s.revision !== item.revision ||
      s.bytes.length !== item.bytes
    )
      throw Error("曲目与目录校验不匹配");
    selected.value = s;
    modal.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    opening.value = "";
  }
}
async function importFile(event: Event) {
  error.value = "";
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  try {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pseq"))
      throw Error("请选择规定格式的 .pseq 文件");
    if (file.size > MAX_FILE_BYTES) throw Error("文件超过 32 MiB 上限");
    selected.value = parseScore(new Uint8Array(await file.arrayBuffer()));
    modal.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    el.value = "";
  }
}
function saveFile() {
  if (!selected.value) return;
  const url = URL.createObjectURL(new Blob([selected.value.bytes.slice()]));
  const a = document.createElement("a");
  a.href = url;
  a.download = selected.value.id + ".pseq";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <section class="hero">
    <div>
      <div class="eyebrow">
        <span class="tiny-line" /> 每一天，都可以是一段新旋律
      </div>
      <h1>从一首曲子，<br />开始今天的练习。</h1>
      <p>
        找到想弹的曲谱，预览旋律的走向，<br
          class="hidden sm:block"
        />再把它带到你的钢琴设备上。
      </p>
      <div class="hero-tags">
        <span><UIcon name="i-lucide-check" /> 五线谱与简谱</span
        ><span><UIcon name="i-lucide-check" /> 钢琴块预览</span
        ><span><UIcon name="i-lucide-bluetooth" /> 蓝牙传送</span>
      </div>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="art-caption">A LITTLE PRACTICE, EVERY DAY.</div>
      <div class="art-staff">
        <i v-for="i in 5" :key="i" /><b class="note n1">♪</b
        ><b class="note n2">♩</b><b class="note n3">♫</b>
      </div>
      <div class="art-keyboard">
        <span
          v-for="i in 12"
          :key="i"
          :class="{ 'has-black': ![3, 7, 10].includes(i) }"
        />
      </div>
      <div class="art-mark">C MAJOR <span>01 / 03</span></div>
    </div>
  </section>
  <div class="section-title">
    <div>
      <div class="eyebrow">THE COLLECTION</div>
      <h2>找一首，慢慢练</h2>
    </div>
    <UButton
      icon="i-lucide-upload"
      color="neutral"
      variant="outline"
      @click="input?.click()"
      >导入曲目包</UButton
    ><input
      ref="input"
      type="file"
      accept=".pseq"
      class="hidden"
      aria-label="导入本地曲目包"
      @change="importFile"
    />
  </div>
  <div class="filter-bar">
    <UInput
      v-model="query"
      icon="i-lucide-search"
      placeholder="搜索曲目或练习内容…"
      aria-label="搜索曲目"
      class="search-field"
      size="lg"
    /><USelect
      v-model="mode"
      :items="['全部格式', '五线谱', '简谱', '钢琴块']"
      aria-label="曲谱格式"
      size="lg"
    /><USelect
      v-model="level"
      :items="['全部难度', '入门', '基础']"
      aria-label="练习难度"
      size="lg"
    />
  </div>
  <div class="collection-meta">
    <span>{{ filtered.length }} 首曲目</span
    ><span>首批为自制测试练习 · 可直接预览</span>
  </div>
  <UAlert v-if="error" color="error" :title="error" class="mb-5" />
  <div v-if="loading" class="empty-state">正在打开曲库…</div>
  <div v-else-if="!filtered.length" class="empty-state">
    <UIcon name="i-lucide-search" class="size-10" />
    <h3>暂时没有匹配的曲目</h3>
    <p>换一个关键词，或重置筛选条件。</p>
    <UButton
      variant="soft"
      @click="
        query = '';
        mode = '全部格式';
        level = '全部难度';
      "
      >重置筛选</UButton
    >
  </div>
  <div v-else class="score-grid">
    <article
      v-for="(item, index) in filtered"
      :key="item.id"
      class="score-card"
    >
      <button
        class="score-cover"
        :class="'cover-' + (index % 3)"
        :aria-label="'预览' + item.title"
        @click="openItem(item)"
      >
        <span class="cover-number">{{
          String(index + 1).padStart(2, "0")
        }}</span
        ><img :src="base + item.cover" :alt="item.title + '五线谱节选'" /><span
          class="cover-preview"
          ><UIcon name="i-lucide-eye" /> 预览曲谱</span
        >
      </button>
      <div class="score-info">
        <div class="score-heading">
          <h3>{{ item.title }}</h3>
          <UBadge color="neutral" variant="soft">{{ item.level }}</UBadge>
        </div>
        <p>{{ item.subtitle }}</p>
        <div class="score-metrics">
          <span
            ><UIcon name="i-lucide-clock-3" />{{
              formatTime(item.duration)
            }}</span
          ><span>♩ = {{ item.tempo }}</span
          ><span>{{ item.notes }} 个音符</span>
        </div>
        <div class="score-formats">
          <span v-if="item.capabilities & 2">五线谱</span
          ><span v-if="item.capabilities & 4">简谱</span
          ><span v-if="item.capabilities & 1">钢琴块</span>
        </div>
        <div class="score-bottom">
          <span>{{ formatBytes(item.bytes) }}</span
          ><UButton
            variant="soft"
            trailing-icon="i-lucide-arrow-up-right"
            :loading="opening === item.id"
            @click="openItem(item)"
            >打开曲谱</UButton
          >
        </div>
      </div>
    </article>
  </div>
  <div class="how-strip">
    <div class="how-icon"><UIcon name="i-lucide-cable" class="size-6" /></div>
    <div>
      <strong>让曲谱来到你的琴边</strong>
      <p>预览曲目 → 连接设备 → 发送并等待保存确认。下载后，设备可独立选曲。</p>
    </div>
    <UButton
      to="/help"
      color="neutral"
      variant="ghost"
      trailing-icon="i-lucide-arrow-right"
      >查看指南</UButton
    >
  </div>
  <UModal
    v-model:open="modal"
    :title="String(selected?.meta.title || '曲目预览')"
    description="阅读谱面或播放无声钢琴块动画，再选择发送到设备。"
    :ui="{ content: 'sm:max-w-5xl' }"
    ><template #body
      ><ScorePreview v-if="selected" :score="selected" /></template
    ><template #footer
      ><div class="preview-footer">
        <span
          >{{ selected ? formatBytes(selected.bytes.length) : "" }} ·
          包校验通过</span
        >
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-download"
            @click="saveFile"
            >保存文件</UButton
          ><UButton
            v-if="d.link"
            icon="i-lucide-send"
            :loading="d.busy"
            :disabled="d.status?.state !== 'LIBRARY'"
            @click="
              selected && d.upload(selected);
              modal = false;
            "
            >{{
              d.link.kind === "demo" ? "发送到演示设备" : "发送到设备"
            }}</UButton
          ><UButton
            v-else
            to="/device"
            icon="i-lucide-bluetooth"
            @click="modal = false"
            >先连接设备</UButton
          >
        </div>
      </div></template
    ></UModal
  >
</template>
