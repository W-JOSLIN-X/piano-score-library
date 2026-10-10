<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { formatTime, type Score } from "../lib/pseq";
const props = defineProps<{ score: Score }>(),
  tab = ref("五线谱"),
  pageIndex = ref(0),
  canvas = ref<HTMLCanvasElement>(),
  playing = ref(false),
  time = ref(0),
  speed = ref("1"),
  profile = ref("");
const profiles = computed(() => [
  ...new Set(
    props.score.pages
      .filter((p) => props.score.capabilities & (1 << p.notation))
      .map((p) => String(p.profile)),
  ),
]);
const available = computed(() => [
  ...(props.score.capabilities & 2 &&
  props.score.pages.some(
    (p) => p.profile === Number(profile.value) && p.notation === 1,
  )
    ? ["五线谱"]
    : []),
  ...(props.score.capabilities & 4 &&
  props.score.pages.some(
    (p) => p.profile === Number(profile.value) && p.notation === 2,
  )
    ? ["简谱"]
    : []),
  ...(props.score.capabilities & 1 ? ["钢琴块"] : []),
]);
const pages = computed(() =>
  props.score.pages.filter(
    (p) =>
      p.profile === Number(profile.value) &&
      p.notation === (tab.value === "五线谱" ? 1 : 2),
  ),
);
const page = computed(() => pages.value[pageIndex.value]);
async function draw() {
  await nextTick();
  const p = page.value,
    c = canvas.value;
  if (!p || !c) return;
  c.width = p.width;
  c.height = p.height;
  const ctx = c.getContext("2d")!;
  const image = ctx.createImageData(p.width, p.height);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const black = p.pixels[y * p.stride + (x >> 3)]! & (128 >> (x & 7)),
        o = (y * p.width + x) * 4;
      image.data.set(black ? [31, 42, 40, 255] : [255, 255, 255, 255], o);
    }
  ctx.putImageData(image, 0, 0);
}
watch(
  () => props.score,
  () => {
    playing.value = false;
    time.value = 0;
    pageIndex.value = 0;
    profile.value = profiles.value[0] || "";
    tab.value = available.value[0] || "钢琴块";
  },
  { immediate: true },
);
watch([tab, profile], () => {
  pageIndex.value = 0;
  playing.value = false;
  if (!available.value.includes(tab.value))
    tab.value = available.value[0] || "钢琴块";
});
watch([page, canvas], draw, { flush: "post", immediate: true });
let raf = 0,
  last = 0;
function tick(t: number) {
  if (playing.value) {
    if (last)
      time.value = Math.min(
        props.score.duration,
        time.value + (t - last) * Number(speed.value),
      );
    if (time.value >= props.score.duration) playing.value = false;
  }
  last = t;
  if (playing.value) raf = requestAnimationFrame(tick);
}
watch(playing, (active) => {
  cancelAnimationFrame(raf);
  last = 0;
  if (active) raf = requestAnimationFrame(tick);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
const keys = Array.from({ length: 88 }, (_, i) => {
  const pitch = i + 21;
  return { pitch, black: [1, 3, 6, 8, 10].includes(pitch % 12), x: 0, w: 0 };
});
let white = 0;
for (const k of keys) {
  if (k.black) {
    k.x = (white * 920) / 52 - 5.2;
    k.w = 10.4;
  } else {
    k.x = (white++ * 920) / 52;
    k.w = 920 / 52;
  }
}
const outsideKeyboard = computed(() =>
  props.score.notes.some((n) => n.pitch < 21 || n.pitch > 108),
);
const visibleNotes = computed(() =>
  props.score.notes.filter(
    (n) =>
      n.pitch >= 21 &&
      n.pitch <= 108 &&
      n.start + n.duration >= time.value &&
      n.start <= time.value + 4000,
  ),
);
const blocks = computed(() =>
  visibleNotes.value.slice(0, 512).map((n) => {
    const k = keys[n.pitch - 21]!;
    return {
      id: n.id,
      x: k.x,
      w: k.w,
      y: 350 - (n.start - time.value) * 0.075,
      h: Math.max(4, n.duration * 0.075),
      color: n.hand === 1 ? "#e9a255" : "#218a7d",
    };
  }),
);
function toggle() {
  if (time.value >= props.score.duration) time.value = 0;
  playing.value = !playing.value;
}
</script>
<template>
  <div class="preview-tabs">
    <UButton
      v-for="name in available"
      :key="name"
      :variant="tab === name ? 'solid' : 'ghost'"
      :color="tab === name ? 'primary' : 'neutral'"
      @click="tab = name"
      >{{ name }}</UButton
    >
  </div>
  <template v-if="tab !== '钢琴块'"
    ><div class="sheet-container">
      <canvas
        v-if="page"
        ref="canvas"
        :aria-label="tab + '第' + (pageIndex + 1) + '页'"
        role="img"
      />
    </div>
    <div class="preview-controls">
      <UButton
        color="neutral"
        variant="outline"
        :disabled="pageIndex === 0"
        @click="pageIndex--"
        >上一页</UButton
      ><span>{{ pageIndex + 1 }} / {{ pages.length }} 页</span
      ><USelect
        v-if="profiles.length > 1"
        v-model="profile"
        :items="profiles"
        aria-label="谱面规格"
      /><UButton
        color="neutral"
        variant="outline"
        :disabled="pageIndex >= pages.length - 1"
        @click="pageIndex++"
        >下一页</UButton
      >
    </div></template
  >
  <template v-else
    ><p v-if="outsideKeyboard" class="preview-note">
      预览显示 88 键范围，范围外音符仍保留在文件中。
    </p>
    <p v-if="visibleNotes.length > 512" class="preview-note">
      预览最多显示 512 个音符，文件保持完整。
    </p>
    <div class="roll-container">
      <svg viewBox="0 0 920 412" role="img" aria-label="无声钢琴块预览">
        <defs>
          <clipPath id="roll-clip"><rect width="920" height="350" /></clipPath>
        </defs>
        <rect width="920" height="412" fill="#f2f7f5" />
        <g v-for="k in keys.filter((k) => !k.black)" :key="k.pitch">
          <line :x1="k.x" y1="0" :x2="k.x" y2="350" stroke="#dfebe6" />
        </g>
        <g clip-path="url(#roll-clip)">
          <rect
            v-for="b in blocks"
            :key="b.id"
            :x="b.x + 1"
            :y="b.y - b.h"
            :width="b.w - 2"
            :height="b.h"
            :fill="b.color"
            rx="3"
          />
        </g>
        <line
          x1="0"
          y1="350"
          x2="920"
          y2="350"
          stroke="#218a7d"
          stroke-width="3"
        />
        <rect
          v-for="k in keys.filter((k) => !k.black)"
          :key="k.pitch"
          :x="k.x"
          y="354"
          :width="k.w - 1"
          height="57"
          fill="white"
          stroke="#b9cbc5"
        />
        <rect
          v-for="k in keys.filter((k) => k.black)"
          :key="k.pitch"
          :x="k.x"
          y="354"
          :width="k.w"
          height="34"
          fill="#253d38"
        />
      </svg>
    </div>
    <div class="preview-controls">
      <UButton
        :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
        @click="toggle"
        >{{ playing ? "暂停" : "播放" }}</UButton
      ><span class="time-label"
        >{{ formatTime(time) }} / {{ formatTime(score.duration) }}</span
      ><USelect
        v-model="speed"
        :items="[
          { label: '0.5×', value: '0.5' },
          { label: '1×', value: '1' },
          { label: '1.5×', value: '1.5' },
        ]"
        aria-label="预览速度"
      /><span class="muted">无声预览</span>
    </div>
    <input
      v-model.number="time"
      type="range"
      :max="score.duration"
      min="0"
      step="10"
      class="timeline"
      aria-label="预览进度"
    />
    <p class="preview-note">绿色：右手／未分手 · 橙色：左手</p></template
  >
</template>
