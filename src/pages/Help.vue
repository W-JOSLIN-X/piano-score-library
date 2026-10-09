<template>
  <div class="page-intro">
    <div class="eyebrow">A SMALL GUIDE</div>
    <h1>从浏览，到开始弹奏。</h1>
    <p>网站负责选曲与传送，ESP32 接收转发，FPGA 保存曲目并完成显示与判分。</p>
  </div>
  <div class="guide-steps">
    <UCard
      v-for="(step, i) in [
        {
          title: '挑选与预览',
          text: '打开曲目，切换五线谱、简谱或钢琴块。钢琴块可以播放、暂停、拖动进度和调整速度，不发声。',
        },
        {
          title: '连接设备',
          text: '在我的设备页面点击连接真实设备，允许浏览器访问蓝牙。没有配套固件时，可选择明确标识的演示设备。',
        },
        {
          title: '传送与确认',
          text: '在曲目详情中发送，等待设备校验保存成功。演奏中禁止下载和删除，先在设备上返回曲库管理状态。',
        },
      ]"
      :key="step.title"
      ><span class="step-number">0{{ i + 1 }}</span>
      <h2 class="mt-4">{{ step.title }}</h2>
      <p class="body-copy mt-3">{{ step.text }}</p></UCard
    >
  </div>
  <div class="guide-details">
    <h2>本地曲目包</h2>
    <p>
      使用“导入曲目包”选择 PSC1 1.0 格式的 .pseq 文件，上限 32
      MiB。文件只在浏览器内解析，不上传到服务器。网页不会把任意 PDF、图片或 MIDI
      自动转换成设备曲目包。
    </p>
    <h2>真实设备与演示设备</h2>
    <p>
      真实蓝牙代码已提供，协议仍需与 ESP32 / FPGA
      固件联调。演示设备只存在于当前浏览器内存，不保存到实际硬件；刷新网页会清空。两者不会静默切换。
    </p>
    <h2>什么时候才算下载完成？</h2>
    <p>
      只有收到 FPGA 返回的整首校验与保存确认，网页才显示“已保存到设备”。发送到
      100%
      之后可能仍在校验。连接中断或取消后，请重新查询目录，不要把传输进度当成保存结果。
    </p>
    <h2>浏览器和隐私</h2>
    <p>
      支持目标为 Windows Chrome 与 Android Chrome。真实连接需要
      HTTPS、蓝牙权限和配套设备。首版没有账号、云端上传或统计追踪；曲目和页面由
      GitHub Pages 提供。GitHub 托管服务仍会处理正常访问请求。
    </p>
    <h2>本批练习内容</h2>
    <p>
      三首为项目自制测试练习，用于检验音符、谱面和传输流程。不是商业曲目，也不代表完整的音乐教学课程。谱面采用简单
      C 大调、四分音符和固定节奏，后续可加入经核对的真实曲库。
    </p>
    <h2>给开发者</h2>
    <p>
      网站基于 Nuxt UI 官方 Vue Dashboard 模板，使用 Vue、TypeScript 和
      Vite。仓库提供曲目包校验、样本生成器、BLE 对接规范与自动化测试。实时 MIDI
      固件本轮未修改。
    </p>
    <UButton
      to="https://github.com/W-JOSLIN-X/piano-score-library"
      target="_blank"
      variant="outline"
      trailing-icon="i-lucide-arrow-up-right"
      >查看代码与对接文档</UButton
    >
  </div>
</template>
