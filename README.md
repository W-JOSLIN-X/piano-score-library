# 琴谱库

面向 Windows 与 Android 的静态曲库网站。浏览自制练习，预览五线谱、简谱和无声钢琴块，导入 `.pseq`，并通过 BLE 将曲目交给 ESP32 转发到 FPGA。曲目持久保存、目录、显示与判分均属于 FPGA；网页和 ESP32 不充当设备曲库。

## 使用

公开站点：https://w-joslin-x.github.io/piano-score-library/

1. 在曲库打开曲目，切换两种谱面或钢琴块。动画支持播放/暂停、进度拖动和倍速，不发声。
2. 在“我的设备”连接真实设备，或明确选择“演示设备”。
3. 返回曲目详情并发送，等待设备最终校验保存确认。取消会在当前块请求结束后执行。
4. 在设备目录刷新或删除曲目。设备演奏/阅读状态禁止下载和删除，先在设备上返回管理状态。

**真实 BLE 路径已编写，但尚未与 ESP32/FPGA 硬件联调。现有 MIDI 固件不含该 BLE 服务。** 演示设备只使用当前网页内存，刷新或重新连接演示设备会清空，不代表实际硬件内容。真实连接失败不会切换到演示模式。

本地导入只支持 PSC1 1.0 `.pseq`，上限32MiB，在浏览器中校验，不上传服务器。首版不转换任意PDF/MIDI/MusicXML。样本谱面profile 1为960×480单色，两种记谱资源分别保存。

## 技术基础与来源

基于官方 [Nuxt UI Vue Dashboard](https://github.com/nuxt-ui-templates/dashboard-vue) MIT模板，Vue + TypeScript + Vite + Nuxt UI。沿用仪表盘、导航、表单、按钮和模态框组件，保留上游LICENSE。模板基准、选型与确认范围见 [DECISIONS.md](docs/DECISIONS.md)。

使用hash路由和仓库子路径base，可由GitHub Pages纯静态托管。没有登录系统、后端API、曲谱上传服务器或访问统计代码；用户设备授权由浏览器Web Bluetooth完成。

## 本地开发

建议 Node.js 24 LTS（至少22.19），npm。依赖版本由package-lock.json锁定。

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

访问终端显示的 `/piano-score-library/` 地址。首次使用无需生成样本，三份确定的二进制包已在仓库中。

修改自制练习后执行 `npm run generate:scores`，会重新生成包、目录和SVG封面并用正式解析器校验。该生成器只用于当前固定节奏测试练习，不能当作通用音乐排版器。图像栅格化使用sharp，本地字体差异可能导致像素与CRC变化；因此部署使用已提交样本，不在CI重新栅格化。

项目级.npmrc采用legacy-peer-deps，避免本机npm 10解析上游可选peer依赖时的edgesOut异常。通过锁文件、类型检查、构建及测试核验当前依赖组合，不需要全局修改npm配置。

## 项目结构

- `src/pages`：曲库、设备管理、使用指南。
- `src/components/ScorePreview.vue`：来自最终包的谱面与钢琴块预览。
- `src/lib/pseq.ts`：包校验、位图和音符解析。
- `src/lib/wire.ts`：帧封装、CRC、分片重组与GATT UUID。
- `src/lib/device.ts`：真实BLE、演示设备、逐块传输及最终保存确认。
- `src/composables/useDevice.ts`：共享设备状态、取消与错误处理。
- `tools/generate-scores.ts`：自制测试曲目生成器。
- `tests/protocol.test.ts`：CRC、解析、重组、取消和保存语义测试。
- `.github/workflows/deploy.yml`：测试、构建并部署GitHub Pages。

## 固件对接

先阅读 [BLE_PROTOCOL.md](docs/BLE_PROTOCOL.md)，包含固定UUID、应用帧、命令编号、请求与响应、超时和幂等语义。网页—ESP32控制载荷使用有界JSON；ESP32可将字段转换成FPGA的UART二进制控制命令。文件DATA保持二进制，不要求FPGA解析JSON。

包结构见 [PSEQ_FORMAT.md](docs/PSEQ_FORMAT.md)。其中UART部分是此前团队草案，最终命令载荷需与FPGA开发者冻结，不能把BLE控制JSON当作已经实现的FPGA UART协议。

演奏期间不下载/删除。现有SPI六字节实时演奏通道与曲目传输独立，本轮没有修改ESP32 MIDI转换固件。真实性能、设备持久化和5ms桥接延迟都需硬件验收。

## 发布与内容维护

推送main触发GitHub Actions；仓库Settings → Pages的Source应为GitHub Actions。流程运行npm ci、测试、构建，再发布dist。更换仓库名时同步修改vite.config.ts的base、首页源码链接及文档站点链接。

新增曲目须发布已校验的包并更新public/scores/catalog.json，包含ID、revision、大小、CRC与资源路径。确保标识的显示模式确实有对应资源；不发布无授权的第三方曲谱。

代码沿用MIT许可；本仓库三首原创工程测试练习与其生成谱面采用CC0-1.0。验证结果见 [VALIDATION.md](docs/VALIDATION.md)。
