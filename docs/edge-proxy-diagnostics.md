# EdgeOne无日志时的502诊断

CloudBase原始健康检查返回200而同源健康检查返回API_PROXY_UNAVAILABLE，只能证明边缘代理或边缘到上游的链路失败，不能直接归因数据库、CORS或七牛。API_UPSTREAM_ORIGIN不填时已有固定CloudBase默认地址，无需为了诊断反复新增或更换配置。

本次只更新EdgeOne代码：无需SQL、无需更换CloudBase函数ZIP、无需新增或修改环境变量。重新部署最新main到EdgeOne生产环境，再打开官网`/api/health`。故障响应保留原错误码，新增`error.stage`、`error.reason`及`X-EClub-Proxy-Diagnostics: stages-v1`响应头。

## prepare/type_error兼容性修复

生产已反馈prepare/type_error，意味着错误发生在发送上游请求之前。公开副本分支原先对所有GET请求执行`Object.fromEntries(url.searchParams)`，依赖运行时实现迭代协议。现在只对公开内容路径处理查询参数，改用forEach，健康检查、配置查询及私人API不经过该转换。独立回归模拟了只有forEach、没有Symbol.iterator的URLSearchParams，复现原始TypeError并验证修复后的健康检查、公开查询、配置读取、鉴权及固定上游。该模拟验证兼容性缺陷，真实生产结果仍需EdgeOne重新部署后核对；如仍有问题，新增public_query阶段可继续区分。

- signature：客户端IP元数据签名阶段失败。
- fetch：向CloudBase发送请求阶段失败。
- response：收到上游响应后构造同源响应失败。
- prepare / headers / body：请求准备、请求头或正文处理失败。

reason只返回受控分类，不返回异常正文、URL、Cookie、密钥、用户输入或成员信息。type_error是运行时类型错误的分类，不能据此直接断言DNS或证书问题。诊断不绕过签名、不改认证、不引入跨站浏览器请求，不把健康检查改成假成功。

源码及本地回归通过后推送main；用户仍需在EdgeOne重新部署才能生效。此次为小修复，Linux和运维归档保持不变。
