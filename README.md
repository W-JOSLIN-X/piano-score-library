# 琴谱库

[打开网站](https://w-joslin-x.github.io/piano-score-library/) · [版本发布](https://github.com/W-JOSLIN-X/piano-score-library/releases)

浏览三首自制练习，预览五线谱、简谱和无声钢琴块，导入或保存 PSC1 1.0 `.pseq` 曲目包，并通过 Web Bluetooth 发送到配套设备。

真实 BLE 尚未完成 ESP32/FPGA 硬件联调。演示设备仅使用浏览器内存，刷新后清空；演示保存不代表硬件保存。网页不转换 PDF、MIDI 或 MusicXML。

## 运行

建议 Node.js 24 LTS（最低 22.19）。

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

访问终端显示的 `/piano-score-library/` 路径。推送 `main` 后，GitHub Actions 运行测试、构建并部署 Pages。版本使用 Git 标签和 GitHub Releases 管理。

## 来源与许可

基于官方 [Nuxt UI Vue Dashboard](https://github.com/nuxt-ui-templates/dashboard-vue)，使用 Vue、TypeScript、Vite 和 Nuxt UI。代码保留 [MIT 许可](LICENSE)；三首原创测试练习及其生成谱面采用 CC0-1.0。
