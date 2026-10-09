# 网页实现边界

已由用户确定：公开仓库piano-score-library、中文站名琴谱库、Windows/Android客户端、浅色曲库、少量自制测试曲目、允许本地.pseq导入、五线谱/简谱预览及无声钢琴块播放、真实BLE代码本轮实现而硬件联调后续完成。ESP32固件本轮不修改。

选用MIT许可的官方Nuxt UI Vue Dashboard模板，来源 https://github.com/nuxt-ui-templates/dashboard-vue ，基准commit `09531f496893f3b409a0fb4d61c22ca2bc799aa6`。沿用Vue/Vite/Nuxt UI、UApp、DashboardGroup/Sidebar/Panel/Navbar、导航、按钮、模态框及表单组件，移除演示邮件/销售页面。不是自行搭建一套组件框架。

评估过的替代项：Vue Vben Admin适合复杂后台，当前无需其权限与多应用结构；Astro适合静态内容，但本项目设备状态与预览交互较多；shadcn/ui Blocks也可用，但需要另组装React应用骨架。官方Vue Dashboard直接提供合适的应用布局，选择它减少基础页面与组件工作。

GitHub Pages使用Vite静态构建，base固定为/piano-score-library/，路由采用hash，避免刷新子页面404。没有账号、后端数据库或任意曲谱转码服务。导入在浏览器本地完成，文件不上传服务器；文件只有在用户明确发送时才进入所选设备。

浏览器演示设备与真实设备使用同一业务接口，但入口、状态和完成提示明确区分。真实连接失败不会自动切到模拟。演示设备的目录只存在当前浏览器内存，与ESP32/FPGA无关。

模板许可保留于LICENSE。新增测试曲目为项目自制，用于工程验证，内容以CC0-1.0提供；不能以它们的简单排版宣称已具备任意MusicXML/PDF自动转换能力。
