# Canvas 每日作业 Gmail 提醒

这是一个只读的 Cloudflare Worker。它每天在奥克兰时间 15:00 登录
`canvas.auckland.ac.nz`，检查今天和明天尚未提交的作业，并通过 Gmail API
从邮箱 A 向邮箱 B 发送提醒。

## 安全说明

- 奥大 Canvas 未开放个人 API Token，因此使用 Cloudflare Browser Run 登录；请更换曾在聊天中发送过的密码，并只把新专用密码存入 Cloudflare Secrets。
- 云端浏览器仅用于登录；登录后 Worker 只调用 Canvas 的同源 `GET` 接口。
- Gmail OAuth 只申请 `https://www.googleapis.com/auth/gmail.send`，不读取邮箱。
- Canvas 凭据、Google OAuth 凭据、刷新令牌和两个邮箱地址全部放在 Cloudflare Secrets 中。
- 不要把 `.dev.vars`、`.env` 或任何真实密钥提交到 Git。

## 1. 创建 Gmail 发送授权

1. 在 Google Cloud Console 创建个人项目并启用 Gmail API。
2. 配置 OAuth consent screen，只添加 `gmail.send` 权限；把发布状态改为 **In production**，避免 Testing 状态的刷新令牌七天后失效。
3. 创建 Web application OAuth client，并添加授权重定向地址：
   `https://developers.google.com/oauthplayground`。
4. 在 Google OAuth 2.0 Playground 的设置中启用 **Use your own OAuth credentials**，输入 Client ID 和 Client Secret。
5. 授权 `https://www.googleapis.com/auth/gmail.send`，交换授权码并取得 Refresh Token。

个人用途可以不提交 Google 验证，但首次授权会显示未验证应用警告。

## 2. 安装与验证

```sh
pnpm install
pnpm check
```

如需本地真实冒烟测试，复制 `.dev.vars.example` 为 `.dev.vars`，仅在该忽略文件中填入真实值，然后运行：

```sh
pnpm dev
```

## 3. 部署无定时器版本并配置 Secrets

```sh
pnpm deploy:preview
pnpm exec wrangler secret put CANVAS_USERNAME -c wrangler.jsonc
pnpm exec wrangler secret put CANVAS_PASSWORD -c wrangler.jsonc
pnpm exec wrangler secret put GMAIL_CLIENT_ID -c wrangler.jsonc
pnpm exec wrangler secret put GMAIL_CLIENT_SECRET -c wrangler.jsonc
pnpm exec wrangler secret put GMAIL_REFRESH_TOKEN -c wrangler.jsonc
pnpm exec wrangler secret put ALERT_FROM_EMAIL -c wrangler.jsonc
pnpm exec wrangler secret put ALERT_TO_EMAIL -c wrangler.jsonc
```

`ALERT_FROM_EMAIL` 必须是授予 OAuth 权限的 Gmail 地址，或该 Gmail 账号中已验证的发件别名。所有命令都会在终端中安全提示输入，不要把值写进命令行参数。

## 4. 确认后启用每天运行

真实只读 Canvas 检查和 Gmail 测试邮件成功后：

```sh
pnpm deploy:scheduled
```

`wrangler.cron.jsonc` 在 UTC 02:00 和 03:00 触发。Worker 使用 `Pacific/Auckland` 判断当地时间，只在对应 15:00 的一次运行；另一触发只记录 `cron_skipped`，不会查询 Canvas 或发送邮件。
