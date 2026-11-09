# QQ 小程序地图原型

这个原型使用网站相同的静态底图和成员地图数据结构。可以用虚构成员测试点位、同城聚合、资料卡及状态。登录测试按钮只检查 `qq.login` 是否取得凭证，并在屏幕上显示结果。凭证不会发送或保存。

## 导入

1. 在 QQ 小程序开发者工具中使用手机 QQ 扫码登录。
2. 导入本目录，填写已注册的 QQ 小程序 AppID。
3. 点击地图标记或成员行，检查城市和资料。使用「测试 QQ 登录接口」检查当前 AppID 的登录能力。

已在本地模拟小程序 `Page` 和 `qq.login`，检查标记选择、资料展示及登录反馈。真机预览需要有权限的 AppID 和开发者账号。 [QQ 小程序开发者工具](https://q.qq.com/wiki/tools/devtool/) · [QQ 小程序目录结构](https://q.qq.com/wiki/develop/miniprogram/frame/catalog.html)

## 正式接入

- **地图与资料**。原生页面可继续使用静态底图和城市坐标。登录后向站点获取与网站相同的已过滤成员数据，复用服务端的时段判定、隐身和公开开关。 [QQ 小程序基础组件](https://q.qq.com/wiki/develop/miniprogram/component/)
- **登录与账号绑定**。由 `qq.login` 取得短时凭证，服务端调用 `code2Session` 后签发小程序会话。网站 QQ OpenID 与小程序 OpenID 分别属于各自的应用。开通并验证 UnionID 后可以关联 QQ 账号，也可以让成员先登录网站再主动绑定。MUA 账号可通过同一网站绑定流程接入。 [QQ 小程序登录](https://q.qq.com/wiki/develop/miniprogram/API/open_port/port_login.html) · [QQ 跨应用账号说明](https://q.qq.com/wiki/FAQ/devlop/#三-开发接入)
- **域名与网页容器**。真机网络请求需要在 QQ 小程序后台登记符合平台要求的 HTTPS 服务域名。官方 `web-view` 需要有权限的企业主体和已配置的业务域名。QQ 互联网站授权文档也对 App 内嵌 H5 登录有适用限制，原型采用原生页面。 [QQ 小程序网络要求](https://q.qq.com/wiki/develop/miniprogram/frame/basic_ability/basic_network.html) · [网页容器文档](https://q.qq.com/wiki/develop/miniprogram/component/open-ability/web-view.html) · [QQ 网站授权文档](https://wiki.connect.qq.com/使用authorization_code获取access_token/)
