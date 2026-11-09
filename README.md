# 面基地图

面向社区成员的城市级世界地图。成员可设置老家、常驻地、日期时段、临时外出和可约状态。站点在本地加载底图和城市目录。

## 本机体验

使用 Node.js 24 或更新版本。项目直接使用 Node.js 自带的 HTTP 和 SQLite 模块，无需安装 npm 依赖。

```sh
npm run demo
```

在浏览器打开 [本机演示站](http://127.0.0.1:4173/)，选择「体验成员」或「体验管理员」。演示使用虚构资料和内存数据库。登录时会模拟一次城市不符，可测试保持原地或临时更新。管理员可测试八项资料的显示开关和临时地点天数。若端口被占用，设置 `DEMO_PORT` 后重新启动。

```sh
npm test
```

## 正式站点

1. 将 `.env.example` 复制为 `.env`。将 `APP_ORIGIN` 设为网站的 HTTPS 源地址，并让 HTTPS 反向代理转发到 `HOST` 和 `PORT`。源地址只包括协议、域名及需要的端口。
2. 在 QQ 互联注册网站应用，并按 Union OAuth 文档向 MUA 申请客户端。向两边登记下表对应的完整 HTTPS 回调地址，在 `.env` 填写各自的 Client ID 和 Client Secret。QQ 应用需要 `get_user_info` 权限。
3. 执行 `npm start`。数据库默认位于 `data/mianji.sqlite`。备份时使用 SQLite 在线备份，或停止服务后备份整个数据目录。
4. 登录后，复制个人资料底部的账号标识，填入 `ADMIN_ACCOUNTS` 并重启。可用英文逗号分隔多个账号标识。

| 登录来源 | 注册回调路径 | 稳定标识 |
| --- | --- | --- |
| QQ | `/auth/qq/callback` | 当前 QQ 网站应用的 OpenID |
| MUA | `/auth/mua/callback` | Union 账号 `sub`，格式为 `皮肤站代码:账号编号` |

QQ 使用 QQ 互联网站授权码流程。MUA 请求 `/api/union/oauth2/authorize`、`/api/union/oauth2/token` 和 `/api/union/oauth2/user`，默认读取 `sub` 和 `nickname`。如已有部署显式配置了其他稳定标识字段，升级时保留 `MUA_ID_FIELD` 的配置。配置示例列出了 scope、PKCE 和资料字段的可选覆盖项。

两个 OAuth 的回调和协议已用模拟上游验证。实际联调需要在已注册的 HTTPS 回调域名和真实客户端上完成。 [QQ 互联授权码文档](https://wiki.connect.qq.com/使用authorization_code获取access_token/) · [MUA Union OAuth 文档](https://docs.mualliance.cn/dev/union/oauth)

在个人资料页可上传 5 MB 以内的 JPG、PNG 或 WebP，预览后点击「保存资料」。启用 QQ OAuth 后，QQ 和 MUA 成员也可选择「同步 QQ 头像」，授权后直接更新头像。自选头像会保留到下次主动更换，并遵守资料页的「允许公开」设置。

## 登录城市识别

部署时可配置以下任一种方式。成功登录后识别城市。打开地图时用相同来源识别国家，未识别时依次使用账号当前显示城市和浏览器时区。

- **可信反向代理**。代理可以提供 `CF-IPCity`、`CF-IPCountry`，以及可选的 `CF-Region-Code` 或 `CF-Region`。在 `TRUST_PROXY` 填写实际连接到 Node.js 的代理 IP。代理应覆盖或移除来自访客的上述请求头，并限制服务端口只接收可信代理的请求。
- **IP 城市查询**。将 `GEOIP_URL` 设为支持 `{ip}` 占位符的 HTTPS API 地址。返回 JSON 对象，包含字符串 `city`、两字母 `country_code`，以及可选的 `region_code` 或 `region`。服务通过直连地址识别访客，也可通过可信代理覆盖的 `CF-Connecting-IP` 或 `X-Real-IP` 获得访客地址。

有生效时段时按时段显示。没有匹配时段时，使用最近一次已识别的登录城市，或依次回退到常驻地和老家。新账号初始隐身，成员可在个人资料中自行选择公开状态。QQ 号和微信号初始只在本人资料中可见。

## 数据来源

- 静态底图从 Natural Earth 1:110m Land 生成。 [Natural Earth 使用条款](https://www.naturalearthdata.com/about/terms-of-use/)
- 城市数据来自 GeoNames 的 `cities5000.zip` 和 `admin1CodesASCII.txt`，并添加中文常用名、去重及压缩。 [GeoNames 数据及署名](https://www.geonames.org/export)

底图和目录随项目提供。更新时，把 Natural Earth 的 `ne_110m_land.geojson` 保存为 `land.geojson`，与两个 GeoNames 原文件放在同一目录。执行 `python scripts/prepare-geography.py <数据目录>` 重新生成。

## QQ 小程序

原生地图原型和导入说明见 [QQ 小程序原型](qq-miniprogram/README.md)。
