# 面基地图（Meep）

面向社区成员的城市级世界地图。成员可以设置老家、常驻地和外出时段，查看其他成员公开的城市与可约状态。

- 新账号默认隐身。成员可以单独设置头像和资料的公开范围，QQ 号和微信号默认不公开。
- 个人资料支持上传 5 MB 以内的 JPG、PNG 或 WebP 头像。启用 QQ 登录后，成员也可以授权同步 QQ 头像。
- 管理员可以设置全站可填写的资料项，以及登录城市与计划不一致时的临时地点有效期。

## 本地运行

需要 Node.js 24 或更新版本。项目使用 Node.js 自带的 HTTP 和 SQLite 模块，无需安装 npm 依赖。

```sh
npm run demo
```

打开 [本机演示站](http://127.0.0.1:4173/)，点「体验成员」或「体验管理员」。演示使用虚构资料和内存数据库，重启后恢复初始数据。登录时会模拟一次城市不符，可体验保留原地点或临时更新。端口被占用时，可设置 `DEMO_PORT` 再启动。

## 正式部署

Linux 服务器可以通过 GitHub Actions 自动测试并发布。首次配置见 [CI/CD 部署指南](deploy/README.md)。

### 配置 QQ 登录

1. 在 QQ 互联创建网站应用，开通 `get_user_info` 接口。登记完整的 HTTPS 回调地址，例如 `https://map.example.com/auth/qq/callback`。 [QQ 互联管理中心](https://connect.qq.com/manage.html#/) · [回调地址说明](https://wiki.connect.qq.com/回调地址常见问题及修改方法/)
2. 将 [`.env.example`](.env.example) 复制为 `.env`，把示例域名和应用凭据换成实际值。

   ```dotenv
   APP_ORIGIN=https://map.example.com
   QQ_CLIENT_ID=你的AppID
   QQ_CLIENT_SECRET=你的AppKey
   ```

3. 配置 HTTPS 反向代理，将网站请求转发到 Node.js，默认地址为 `127.0.0.1:4173`。在项目目录运行 `npm start`，然后打开公网域名测试 QQ 登录。

`APP_ORIGIN` 填网站的源地址，程序会自动拼接 `/auth/qq/callback`。应用密钥保存在服务器的 `.env` 中。

### 数据和管理员

数据库默认位于 `data/mianji.sqlite`，可用 `DATABASE_PATH` 指定持久化路径。备份可使用 SQLite 在线备份，或停止服务后备份整个数据目录。

首次登录后，从个人资料页底部复制账号标识，填入 `ADMIN_ACCOUNTS` 并重启。多个账号标识用英文逗号分隔。

## 可选配置

### MUA 登录

MUA Union OAuth 是为项目作者的个人使用场景保留的可选登录方式。常规部署只配置 QQ 即可，`MUA_CLIENT_ID` 和 `MUA_CLIENT_SECRET` 可以留空。

有 MUA 接入需求时，按 Union OAuth 文档申请客户端，登记 `APP_ORIGIN` 下的 `/auth/mua/callback`，再填写上述两项。默认以 `sub`（`皮肤站代码:账号编号`）识别账号，`nickname` 用于初始昵称。已有部署如配置了自定义标识字段，升级时保留原 `MUA_ID_FIELD`。 [MUA Union OAuth 文档](https://docs.mualliance.cn/dev/union/oauth)

### 登录城市识别

可以通过可信反向代理或 IP 查询服务识别登录城市。

- **可信反向代理**。在 `TRUST_PROXY` 中填写 Node.js 直接连接到的代理 IP。代理可提供 `CF-IPCity`、`CF-IPCountry` 和可选的 `CF-Region-Code` 或 `CF-Region`。代理需覆盖或移除访客自行提交的定位请求头。
- **IP 查询服务**。将 `GEOIP_URL` 设为包含 `{ip}` 的 HTTPS 地址。接口返回 `city`、两字母国家代码 `country_code`，以及可选的 `region_code` 或 `region`。服务使用直连 IP，或可信代理提供的 `CF-Connecting-IP`、`X-Real-IP`。

地图优先使用生效的临时地点和计划时段。没有匹配时段时，依次使用最近一次识别到的登录城市、常驻地和老家。

## 开发和数据来源

运行 `npm test` 执行测试。地点判定和资料公开规则见 [项目规格](SPEC.md)，小程序导入步骤见 [QQ 小程序原型](qq-miniprogram/README.md)。

- 静态底图来自 Natural Earth 1:110m Land。 [Natural Earth 使用条款](https://www.naturalearthdata.com/about/terms-of-use/)
- 城市目录来自 GeoNames 的 `cities5000.zip` 和 `admin1CodesASCII.txt`，并补充了常用中文地名。 [GeoNames 数据及署名](https://www.geonames.org/export)

底图和城市目录随项目提供。要更新数据，将 Natural Earth 的 `ne_110m_land.geojson` 保存为 `land.geojson`，与上述两个 GeoNames 文件放在同一目录，然后运行 `python scripts/prepare-geography.py <数据目录>`。
