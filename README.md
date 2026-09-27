# Canvas 每日作业邮件提醒

这是一个只读的 Cloudflare Worker。它每天在奥克兰时间 15:00 登录
`canvas.auckland.ac.nz`，检查今天、明天尚未提交的作业，以及截至第七个奥克兰当地日结束前的考试和大作业，并通过 Resend
向主邮箱发送提醒。绑定自有域名后还可通过密送同时投递到一个备用邮箱。

## 安全说明

- 奥大 Canvas 未开放个人 API Token，因此使用 Cloudflare Browser Run 登录；请更换曾在聊天中发送过的密码，并只把新专用密码存入 Cloudflare Secrets。
- 云端浏览器仅用于登录；登录后 Worker 只调用 Canvas 的同源 `GET` 接口。
- 发信使用 Resend API Key，与 Google 或学校账号密码无关，改密码不会导致发信失效。
- Canvas 凭据、Resend API Key 和邮箱地址全部放在 Cloudflare Secrets 中。
- 不要把 `.dev.vars`、`.env` 或任何真实密钥提交到 Git。

## 1. 创建 Resend 发信密钥

1. 用**接收提醒的邮箱**注册 [Resend](https://resend.com)（免费额度每月 3,000 封）。
2. 在 **API Keys** 中创建一个权限为 **Sending access** 的密钥（以 `re_` 开头）。
3. 未绑定域名时，发件人固定为 `onboarding@resend.dev`，并且只能发往注册 Resend 的邮箱，因此 `ALERT_TO_EMAIL` 必须与该邮箱完全一致。
4. 如需备用收件人或自定义发件人，先在 Resend 中验证自有域名，再设置 `RESEND_FROM_EMAIL` 和 `ALERT_BACKUP_TO_EMAIL`。

首次收到时可能进入垃圾邮件，请把发件人标记为“非垃圾邮件”。

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
pnpm exec wrangler secret put RESEND_API_KEY -c wrangler.jsonc
pnpm exec wrangler secret put ALERT_TO_EMAIL -c wrangler.jsonc
```

`ALERT_TO_EMAIL` 必须是注册 Resend 的邮箱。`RESEND_FROM_EMAIL`（自有域名下的发件地址）和 `ALERT_BACKUP_TO_EMAIL`（密送备用收件人）为可选项，只有在 Resend 中验证过域名后才生效。所有命令都会在终端中安全提示输入，不要把值写进命令行参数。

## 4. 确认后启用每天运行

真实只读 Canvas 检查和测试邮件成功后：

```sh
pnpm deploy:scheduled
```

`wrangler.cron.jsonc` 在 UTC 02:00 和 03:00 触发。Worker 使用 `Pacific/Auckland` 判断当地时间，只在对应 15:00 的一次运行；另一触发只记录 `cron_skipped`，不会查询 Canvas 或发送邮件。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
