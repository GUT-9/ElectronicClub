# Linux 服务器包与重大更新交付

当前只准备服务器版和工具，不执行生产迁移。现有云部署继续使用，七牛文件和原地址保留。未来迁移由用户另行提出后再操作。

## 两种部署的发布规则

共用业务代码。重大功能、数据库、权限/认证或部署架构更新时提升 `release/major.json` 的generation，运行 `npm run release:refresh`；CI也会在检查通过后处理。小修不提升generation，不更新Linux/工具归档。内容摘要没有变化的部分保留原文件和SHA256。仓库AGENTS.md记录这一约定。

稳定交付文件为deployment-packages中的electronicclub-linux.tar.gz及electronicclub-operations.tar.gz，各有SHA256；新版本覆盖同名文件，Git保留历史。Linux包包含全部运行依赖、前端、后端、PostgreSQL17配置、Caddy HTTPS和操作脚本；首次拉取Docker基础镜像仍需要网络，不是包含Docker镜像的离线系统镜像。operations包用于更新已有安装的工具，不能代替完整Linux包初次安装。云函数ZIP只有自身运行内容变化时更新。

## 将来首次部署

Linux x86_64/ARM64服务器需要Docker Engine、Compose v2、Bash、curl、OpenSSL、tar、sha256sum、flock和realpath；建议至少2核4GB、SSD与足够备份空间。域名指向服务器，放行80/443。数据库没有公网端口，后端也不直接对公网开放。

核对归档SHA256后解压到固定目录，例如/opt/electronicclub，再执行：

```sh
./club.sh configure club.example.com
# 在新建的.env中填写七牛配置；密钥只在服务器后端。
./club.sh up
```

Caddy自动申请并续期HTTPS证书，前端同源调用/api，SPA刷新回退与真实API/静态资源404分开处理。需要公网DNS和证书机构可访问80/443，初次签发不能在尚未切DNS时保证成功。服务器版的同源Cookie有助于改善QQ/微信内置浏览器限制，但不能保证各版本WebView都能登录，网页仍提示使用系统浏览器。

configure生成服务端密钥，不创建成员。新空系统可显式执行 `./club.sh bootstrap`，交互输入初始管理员，只允许未初始化数据库；已有系统拒绝重建。迁移现有数据时不要执行bootstrap，应导入原数据以保留UID、密码哈希、权限和历史记录。CloudBase当前导出能力/凭据需要在实际迁移时单独确认，本包不宣称已获得云数据库备份或能绕过托管平台限制。

生产数据库通过共享Unix socket连接，使用scram密码和受限service_role。没有为了容器连接关闭远端TCP TLS检查。应用进程读完仅应用所需密钥后降为UID1000；数据库管理密码仅提供给临时admin工具。反向代理覆盖客户端IP并附内部验证标记，伪造客户端IP头不被直接信任。

## 备份和恢复

```sh
./club.sh backup
./club.sh restore /安全目录/club-xxx.dump.enc
# 上一步只恢复到独立临时数据库、核对，不替换在线数据库。
./club.sh restore /安全目录/club-xxx.dump.enc --replace
# 从可信来源导入原生PostgreSQL custom-format备份：
./club.sh restore /安全目录/migration.dump --plain --replace
```

备份是pg_dump一致性快照，以AES-256-GCM流式加密，附SHA256；文件权限600。解密认证通过后才交给pg_restore。恢复先进入新数据库，事务内恢复并检查迁移/角色计数/管理员，失败不替换原库。--replace是明确的替换操作，会先备份原库，停后端并切换；原数据库保留为eclub_previous开头名称，不自动删除。导入的SQL/PG备份必须来自可信管理员，恢复数据库备份会执行其中的DDL。

必须另行妥善保管 `.state/secrets/backup_key`，丢失后无法解密备份；它不会被打入发布包或数据库备份。.env、数据库/应用密钥、Caddy证书数据均属于服务器配置，需另行安全备份。七牛对象不在数据库备份内，其元数据和原URL随数据库保留，空间文件继续留在七牛。实际CloudBase到本机的导出/恢复与域名切换仅在用户提出迁移后执行。

## 一条命令升级

```sh
./club.sh upgrade
# 或使用已经下载并核对的指定归档：
./club.sh upgrade /安全目录/electronicclub-linux.tar.gz
```

下载最新稳定Linux包及校验，验证后放进不可变代码版本目录，构建新镜像，自动做加密备份，短暂停后端，执行新增迁移并切换代码。数据库、七牛配置、密钥、备份、证书和旧代码版本保留。脚本不运行docker compose down -v、不清表、不重置成员密码。升级脚本与其他操作使用文件锁，防止同时恢复/升级。迁移失败会中止且保留备份；不盲目自动还原数据库，需根据日志和受控恢复步骤处理。

后端、数据库与HTTPS代理的可用性由健康检查验证。CI使用隔离数据库及内置信任证书验证TLS，不使用生产配置、不发送生产邮件或执行生产迁移。普通提交只做临时构建和测试，不刷新稳定服务器归档。

## 本次验证

`npm ci`、`npm run check`通过，64项业务/安全测试全部通过、0跳过，含原生PostgreSQL与CloudBase HTTPS-RPC回归、类型、Lint及前后端构建。另在隔离Docker项目的PostgreSQL17.11、Node22和Caddy上实际执行首次安装、HTTPS证书链验证、成员登录与Cookie恢复、RBAC/CSRF、SPA刷新和API/资源404、代理IP覆盖、加密备份、篡改备份拒绝、独立库恢复、保留原库切换、同版本不升级和新版本真实升级。升级后成员、活动报名、原密码、配置及密钥保持。当前验证架构为Linux x86_64，未在真实QQ/微信客户端或ARM64机器上验收。

手机浏览器标识下已检查新增登录提示布局；这不代表真实QQ/微信WebView已通过登录。未新增运行依赖，现有依赖审计仍有3项moderate、0 high/critical。未执行任何生产迁移、切域名或新建收费资源；现有CloudBase ZIP的内容摘要核对为未变化。
