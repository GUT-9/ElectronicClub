# 登录“JSON格式错误”接入层补丁

本次只修改EdgeOne代理的请求体表示。SQL、CloudBase函数代码、环境变量及Linux部署脚本不变；不重新生成稳定部署归档。

## 现有环境操作清单

1. SQL：无需执行。
2. CloudBase：无需再次上传ZIP，沿用已上传的同源登录版本；原完整包和校验文件仍在deployment-packages。
3. 环境变量：无需新增或重新生成密钥。保留两端已有ECLUB_PROXY_SECRET和原来源/Cookie配置。
4. EdgeOne：从最新main重新部署，必须包含根目录edge-functions，工作目录、安装/构建命令、输出目录沿用现有设置。只更新静态dist不会替换代理。
5. 检查官网/api/health的响应头 `X-EClub-API-Revision: json-text-v2`，确认新边缘函数已生效，再重新登录。

## 修复范围与证据

旧代理把JSON正文读成Uint8Array后直接交给fetch。Node接受该类型；如果边缘环境将它按二进制处理或转成逗号分隔字节串，后端JSON.parse会失败。本地原先使用Node Response解码测试正文，会掩盖这一兼容差异。

新代理仍先逐块限制原始字节数，再将application/json正文严格按UTF-8解码为字符串后转发，避免TypedArray跨运行时表示差异；不重新JSON.stringify、不修改字段、密码或转义字符。非JSON正文使用标准ArrayBuffer。原3.1MB上限、Cookie、签名、CSRF、状态码和附件传输保持。

新增回归先在旧实现失败，再验证新实现的JSON字符串类型、跨块中文/emoji、引号/反斜杠/换行、无效UTF-8拒绝以及非JSON字节不变。诊断版本头同时出现在成功与错误响应中，便于区分旧部署缓存。

验证：npm ci、npm run check通过，71项测试通过、0失败、0跳过，含原生PostgreSQL/HTTPS RPC及已有业务回归、类型、Lint、前后端构建和Web API边缘函数编译。npm audit --omit=dev仍为既有3项moderate、0 high/critical。重复发布检查确认原云函数ZIP、Linux包、运维包及校验/版本文件内容与时间戳全部不变。

生产入口与原始网关在当前执行环境均被出站网络策略拒绝，无法直接取得线上请求正文；本地证据确认修复了代理的可移植性问题，具体生产失败原因与上线效果仍需实际请求日志确认。不要将账号密码、Cookie或密钥写入调试日志。
