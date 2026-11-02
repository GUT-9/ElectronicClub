# 电子俱乐部 Logo

`electronic-club-logo.png` 为用户在当前对话中确认使用的第二张透明背景版本，对应源文件 `exec-72f5f2a0-e08c-49ef-8004-590e7ea89da2.png`。

资源按原文件直接复制，未进一步重绘、改色或修改比例。导航、首页和页脚通过 `BrandLogo.vue` 共用此文件；`brand.ts` 将同一 PNG 注册为 favicon。Vite 构建时输出带哈希的资源地址，浏览器复用缓存。
