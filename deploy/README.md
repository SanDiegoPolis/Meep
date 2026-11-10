# GitHub Actions 部署 Meep

拉取请求和推送到 main 的提交会运行测试。设置仓库变量 DEPLOY_ENABLED=true 后，main 上通过测试的提交会自动部署到 Linux 服务器。也可以在 Actions → CI/CD → Run workflow 手动运行 main。

## 服务器初始化

以下命令适用于使用 systemd 的 Linux。使用有 sudo 权限的账号登录服务器，准备 Node.js 24 或更新版本、Git、curl、Bash、tar、flock 和 OpenSSH。Node.js 要能从系统 PATH 找到，以便 systemd 启动服务。将 `DEPLOY_ROOT` 换成你选择的绝对路径，路径使用字母、数字、斜杠、点、连字符或下划线。

```sh
git clone https://github.com/SanDiegoPolis/Meep.git
cd Meep
DEPLOY_ROOT=/srv/meep
sudo useradd --system --create-home --home-dir /var/lib/meep --shell /bin/sh meep
sudo install -d -m 0750 -o meep -g meep "$DEPLOY_ROOT" "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/shared" "$DEPLOY_ROOT/shared/data"
sudo install -d -m 0700 -o meep -g meep /var/lib/meep/.ssh
if ! sudo test -e "$DEPLOY_ROOT/shared/.env"; then
  sudo install -m 0600 -o meep -g meep .env.example "$DEPLOY_ROOT/shared/.env"
fi
sudo install -m 0755 deploy/release.sh /usr/local/bin/meep-deploy
sed "s|/srv/meep|$DEPLOY_ROOT|g" deploy/meep.service |
  sudo tee /etc/systemd/system/meep.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable meep.service
```

通过 sudo visudo -f /etc/sudoers.d/meep 添加下面一行，让部署账号可以重启服务和停止启动失败的首个版本。

```sudoers
meep ALL=(root) NOPASSWD: /usr/bin/systemctl restart meep.service, /usr/bin/systemctl stop meep.service
```

部署账号 `meep` 需要能穿过部署目录的所有父目录。如果选择其他用户的私有家目录，可用 ACL 给 `meep` 添加相应父目录的遍历权限。

编辑部署目录中的 `shared/.env`，设置以下值，并按需填写 QQ 和 MUA 的应用凭据。将数据库路径中的 `/srv/meep` 改成实际部署目录。配置公网域名的 HTTPS 反向代理，将请求转发至 `127.0.0.1:4173`。回调地址与平台登记值一致。 [登录配置](../README.md#正式部署)

```dotenv
APP_ORIGIN=https://map.example.com
HOST=127.0.0.1
PORT=4173
DATABASE_PATH=/srv/meep/shared/data/mianji.sqlite
```

## SSH 和 GitHub 配置

1. 生成一对专用的 ED25519 部署密钥，留空密钥口令，供 Actions 无人值守使用。

   ```sh
   ssh-keygen -t ed25519 -f meep-ci -C meep-ci
   ```

2. 把 `meep-ci.pub` 的完整内容追加到服务器的 `/var/lib/meep/.ssh/authorized_keys`，添加以下前缀，并把其中的 `/srv/meep` 改成实际部署目录。保留其他已有公钥。将文件所有者设为 `meep:meep`，权限设为 `0600`。 [OpenSSH 公钥限制说明](https://man.openbsd.org/sshd#AUTHORIZED_KEYS_FILE_FORMAT)

   ```text
   restrict,command="/usr/local/bin/meep-deploy /srv/meep" ssh-ed25519 <公钥内容> meep-ci
   ```

   如果修改了服务的 `PORT`，请把同一端口填到反向代理，并加到强制命令的部署目录之后，例如 `/usr/local/bin/meep-deploy /srv/meep 28081`。

3. 从能连接服务器的终端运行 ssh-keyscan -t ed25519 -p <SSH端口> <SSH地址>，保存输出。使用 ssh-keygen -lf <保存的文件> 查看指纹，对照服务器上 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 的输出。指纹一致后，使用整行主机公钥配置 DEPLOY_KNOWN_HOSTS。
4. 在 GitHub 仓库 Settings → Environments 创建 production，并添加以下变量和密钥。 [GitHub Environments 说明](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

   | 类型 | 名称 | 填写内容 |
   | --- | --- | --- |
   | Variable | DEPLOY_HOST | SSH 地址 |
   | Variable | DEPLOY_PORT | SSH 端口，省略时使用 22 |
   | Secret | DEPLOY_SSH_KEY | meep-ci 私钥的完整内容 |
   | Secret | DEPLOY_KNOWN_HOSTS | 已核对的主机公钥行 |

5. 到 Settings → Secrets and variables → Actions → Variables 添加**仓库变量** DEPLOY_ENABLED，值为 true。进入 Actions → CI/CD → Run workflow，选择 main 启动首次部署。

发布只打包应用文件。部署目录中的 `shared` 保存配置和 SQLite 数据，`current` 指向当前版本。部署脚本检查本机 `/api/session`。后续版本启动失败时，会切回上一版代码并使用当前数据库。可以用 `sudo journalctl -u meep.service -n 80` 查看服务日志。
