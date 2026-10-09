import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";
export default defineConfig({
  base: "/piano-score-library/",
  plugins: [
    vue(),
    ui({ ui: { colors: { primary: "teal", neutral: "slate" } } }),
  ],
  build: { chunkSizeWarningLimit: 850 },
});
