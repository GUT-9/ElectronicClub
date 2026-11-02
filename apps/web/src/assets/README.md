# 正式 Logo 资源

本轮云端仅可读到上一轮生成的图片，无法读取用户最初上传的原图。生成图没有作为正式标志提交。

请将原始图片不经重绘地保存为 `electronic-club-logo.png`。`BrandLogo.vue` 通过 Vite glob 自动接入该原图，导航、首页和页脚共用同一资源；资源缺失时明确显示“原图待补充”。当前未生成 favicon，避免将生成图或虚构图案作为官方标志。

原图可以保留黑色背景，组件通过圆形容器与 overflow 裁剪显示，内部比例使用 object-fit: contain 保持不变。收到原图后 `brand.ts` 将同一 PNG 注册为 favicon，直接复用原始像素、不重绘图案。当前原图缺失时不注册虚构 favicon；不能使用上轮生成图替代。
