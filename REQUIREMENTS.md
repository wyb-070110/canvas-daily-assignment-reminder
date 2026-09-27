# Canvas 每日作业提醒系统需求规格说明书

## 1. 文档信息

- 项目名称：Canvas 每日作业邮件提醒
- Canvas 站点：`https://canvas.auckland.ac.nz`
- 运行平台：Cloudflare Worker + Browser Run + Cron Trigger
- 通知渠道：Resend API 邮件，通过手机邮箱客户端产生消息提醒
- 当前收件地址：`**@aucklanduni.ac.nz`
- 时区：`Pacific/Auckland`
- 文档状态：按当前已部署版本整理
- 最后更新：2026-09-25（发信渠道由 Gmail API 改为 Resend）

## 2. 项目目标

系统必须每天在奥克兰当地时间 15:00 自动登录 University of Auckland Canvas，读取当前用户的有效课程和作业状态，识别今天、明天及未来一周需要关注的未完成作业，并通过邮件发送到指定收件地址。

系统的核心目标是：

1. 不依赖用户的 Mac 开机或本地程序持续运行。
2. 不要求用户每天手动打开 Canvas 检查。
3. 只读取 Canvas 信息，不提交作业、不修改课程数据。
4. 在 Canvas 检查失败时明确告警，不把不完整结果误报为“没有作业”。
5. 邮件能够在手机邮箱客户端中产生通知。

## 3. 范围

### 3.1 包含范围

- 自动登录 `canvas.auckland.ac.nz`。
- 动态读取所有当前有效的 student 课程。
- 读取每门课程的全部作业及当前用户 submission 状态。
- 处理 Canvas 分页和个人、分组日期覆盖后返回的有效 `due_at`。
- 筛选奥克兰当地今天和明天截止的未完成作业。
- 在今天和明天没有结果时，检查截至第七个奥克兰当地日结束前的考试和大作业。
- 发送 HTML 和纯文本两种格式的提醒邮件。
- 在认证、网络、Canvas、分页或邮件发送失败时记录脱敏日志并告警。
- 支持夏令时和冬令时下的奥克兰 15:00 定时运行。

### 3.2 不包含范围

- 提交作业、参加 Quiz、修改答案或上传文件。
- 修改课程、作业、截止时间或 Canvas 用户资料。
- 读取或发送 Canvas 私信。
- 自动处理 MFA、验证码或 CAPTCHA。
- 提供独立手机 App、短信或专用推送服务。
- 把密码、令牌或 OAuth 密钥写入代码、仓库、日志或本文档。

## 4. 系统架构要求

### AR-001 云端运行

系统必须运行在 Cloudflare Worker，不依赖本地 Mac 的开机状态。

### AR-002 Canvas 登录

由于目标 Canvas 当前没有可用的个人 API Token 功能，系统使用 Cloudflare Browser Run 完成网页登录。登录成功后，数据读取必须通过 Canvas 同源的 `GET` API 完成。

### AR-003 邮件发送

系统必须通过 Resend API 发送邮件，使用仅具备 Sending access 权限的 API Key。发信凭据不得依赖 Google 或学校账号密码，账号改密码后发信不得因此失效。

### AR-004 模块划分

实现应保持以下职责分离：

- 定时入口与运行编排；
- Canvas 浏览器登录；
- Canvas 同源只读客户端与分页；
- 完成状态判断；
- 大作业分类；
- 奥克兰时区处理；
- 邮件 HTML/纯文本渲染；
- Resend 发送客户端；
- 网络超时、重试和安全错误分类。

## 5. 定时要求

### TR-001 每日执行时间

系统必须每天在奥克兰当地时间 15:00 执行一次有效检查。

### TR-002 夏令时兼容

Cloudflare Cron 使用 UTC，因此生产环境必须配置：

- `0 2 * * *`
- `0 3 * * *`

Worker 必须使用 `Pacific/Auckland` 判断实际当地时间，只允许当地 15:00 的一次触发继续执行；另一触发必须安全跳过，不查询 Canvas，也不发送邮件。

### TR-003 正式定时保护

测试不得长期修改生产 Cron。手动测试应使用预览环境或一次性测试入口，测试完成后必须确认生产定时仍为上述两个 UTC 表达式。

## 6. Canvas 数据读取要求

### CR-001 课程范围

系统必须动态读取 enrollment type 为 `student`、enrollment state 为 `active`、课程 state 为 `available` 的课程，不得在代码中固定课程编号。

### CR-002 作业范围

系统必须逐课程读取 Assignments，并包含当前用户的 `submission` 和 Canvas 返回的日期覆盖信息。每页最多请求 100 项，并继续处理所有 `Link: rel="next"` 分页。

### CR-003 分页完整性

系统必须：

- 仅跟随 `https://canvas.auckland.ac.nz` 同源分页链接；
- 拒绝跨域或无效分页链接；
- 检测分页循环；
- 限制最多 100 页；
- 任一分页失败时终止本次结果，不能发送“没有作业”。

### CR-004 只读限制

Canvas 数据请求只能使用 `GET`。系统不得调用提交、修改、删除或上传接口。

### CR-005 无截止时间

没有有效 `due_at` 的项目不进入日期提醒或未来一周重要任务提醒。

## 7. 作业状态与筛选要求

### SR-001 未完成定义

满足以下任一情况时视为未完成：

- 没有 submission；
- submission state 为 `unsubmitted`；
- 没有提交时间，且状态未被识别为完成。

以下情况不得提醒：

- `submitted`；
- `graded`；
- `pending_review`；
- `excused`；
- 已存在 `submitted_at`。

### SR-002 今天和明天

系统首先按奥克兰当地日期筛选截止日在今天或明天的未完成作业，并按截止时间升序排列。

### SR-003 当日逾期

如果今天截止时间早于本次 15:00 检查时间，邮件中必须标记为“未提交 · 已逾期”。

### SR-004 重要任务回退

只有今天和明天均没有未完成作业时，系统才检查从运行时刻起至第七个奥克兰当地日结束前的考试和大作业。范围按奥克兰日历日期计算，不按严格的 168 小时计算。

### SR-005 明确的大作业

标题或说明包含以下类型时，应识别为大作业：

- exam、examination、test、midterm、mid-semester exam/test、final exam/test 及对应中文考试关键词；
- report、lab report、technical/design/research/final/project report；
- essay、research paper、term paper；
- project、capstone；
- journal、diary、logbook；
- portfolio；
- presentation；
- 对应的中文长任务关键词。

Quiz 元数据中的时间限制大于 60 分钟时，也应识别为大作业。恰好 60 分钟不算。
带有 `quiz_id` 的项目始终视为 Quiz 作业，不得仅因标题或说明出现 exam、test、examination 等词而标记为考试。

### SR-006 可能的大作业

标题包含 case study、reflection、design、investigation 或对应中文类型，但信息不足时，应标记为“可能的大作业”，不得伪造预计时长或工作量。

## 8. 邮件要求

### ER-001 收件人

当前生产主收件地址在文档中匿名显示为 `**@aucklanduni.ac.nz`。实际地址必须保存在 Cloudflare Secret `ALERT_TO_EMAIL` 中，不得硬编码到 Worker 源码。未在 Resend 验证自有域名时，`ALERT_TO_EMAIL` 必须是注册 Resend 的邮箱。验证域名后，系统可以通过 Cloudflare Secret `ALERT_BACKUP_TO_EMAIL` 配置一个备用收件地址，并以密送方式发送，使主、备用收件人互不可见。

### ER-002 发件人

未验证域名时发件地址固定为 `onboarding@resend.dev`。验证域名后，可在 `RESEND_FROM_EMAIL` 中设置该域名下的发件地址。

### ER-003 今天／明天提醒

- 主题：`Canvas：今天/明天有 X 项未完成`
- 正文：按“今天”和“明天”分组。
- 每项显示：课程、作业名称、奥克兰截止时间、状态和 Canvas 直达链接。

### ER-004 未来一周重要任务提醒

- 主题：`Canvas：未来一周重要任务提醒`
- 正文说明今天和明天没有未提交作业，并列出识别到的考试或大作业、截止时间、分类理由和直达链接。

### ER-005 无结果提醒

- 主题：`Canvas：近期没有发现未完成作业`
- 正文必须明确今天、明天及未来一周考试或大作业检查均无结果。

### ER-006 失败提醒

- 主题：`Canvas 检查失败`
- 正文只描述安全的故障类别和处理建议。
- 不得包含密码、令牌、OAuth 响应、Canvas 敏感响应正文或完整异常堆栈。

### ER-007 邮件安全

- 必须同时生成纯文本和 HTML 内容。
- Canvas 返回的课程名、作业名和说明必须进行 HTML 转义。
- 直达链接只允许 `https://canvas.auckland.ac.nz`；跨域链接必须替换为系统生成的同源作业链接。
- 邮件头必须防止换行注入并使用 UTF-8 编码。

### ER-008 手机通知

收件账号必须已添加到手机邮箱客户端，并开启该账号的邮件通知。邮件到达收件箱后，由手机邮箱客户端产生消息提示；Cloudflare Worker 本身不直接发送系统级手机推送。

## 9. 安全与密钥要求

### SEC-001 Cloudflare Secrets

以下值必须只保存在 Cloudflare 加密 Secrets 中：

- `CANVAS_USERNAME`
- `CANVAS_PASSWORD`
- `RESEND_API_KEY`
- `ALERT_TO_EMAIL`
- `RESEND_FROM_EMAIL`（可选，需已验证域名）
- `ALERT_BACKUP_TO_EMAIL`（可选备用收件地址，需已验证域名）

### SEC-002 凭据保护

- 曾经在聊天中暴露的 Canvas 密码必须视为已泄露并更换。
- 密钥不得写入 Git、README、要求文档、测试数据、命令行参数或日志。
- 本地真实测试值只能放在已被 Git 忽略的 `.dev.vars` 中。

### SEC-003 登录挑战

如果 Canvas 要求 MFA、验证码、身份确认或 CAPTCHA，本次运行必须失败并发送认证告警，不得尝试绕过。

### SEC-004 最小权限

- Canvas 仅允许只读 `GET` 请求。
- Resend API Key 仅允许 Sending access。
- Worker 不得读取收件箱内容。

## 10. 可靠性与错误处理要求

### RR-001 超时

- Canvas 页面导航超时：30 秒。
- Canvas 同源 API 单次超时：15 秒。
- Resend 发送请求单次超时：10 秒。

### RR-002 重试

临时网络错误、408、425、429 和 5xx 最多尝试三次，并采用有限指数退避。401、403、无效 API Key 及其他明确的非临时错误不得反复重试。邮件发送的重试必须共用同一个 `Idempotency-Key`，避免重复投递。

### RR-003 响应保护

- Canvas 单个响应正文不得超过 2,000,000 字符。
- 无效 JSON、意外数据结构或分页不完整必须视为失败。

### RR-004 日志

Cloudflare 日志应记录事件类型、阶段、错误类别、提醒类型和项目数量，但不得记录密钥、账号密码、访问令牌或敏感响应正文。

### RR-005 邮件发送失败

邮件发送失败时必须记录 `email_delivery_failed` 类别日志，并让本次 Worker 运行以失败结束，便于 Cloudflare 后台发现。

## 11. 测试与验收要求

### AT-001 自动测试

部署前必须通过 TypeScript 类型检查和全部单元测试。至少覆盖：

- Canvas 分页；
- 跨域分页拒绝；
- Canvas 401 不重试；
- 登录跳转期间页面读取重试；
- 已提交、已评分、待审核和免除状态；
- 今日逾期和明日截止；
- 大作业与 60 分钟以上 Quiz；
- 无作业结果；
- HTML 转义和安全链接；
- Resend 请求内容与 UTF-8 正文；
- API Key 只出现在 Authorization 头中；
- 无效 API Key 不重试，重试复用幂等键；
- 奥克兰冬令时和夏令时；
- 跨月日期计算。

### AT-002 真实冒烟测试

启用或修改生产配置后，必须执行一次真实只读 Canvas 检查，并向生产收件地址发送测试邮件。测试应验证：

1. Canvas 登录成功；
2. 活跃课程和作业读取完整；
3. 提醒分类和时间正确；
4. Resend API 返回发送成功；
5. 邮件实际出现在收件邮箱；
6. 邮件没有落入垃圾邮件；
7. 手机能够收到邮箱通知。

### AT-003 当前验收记录

2026-08-08 已完成真实端到端测试：

- 16 项本地自动测试全部通过；
- Canvas 只读登录和检查成功；
- 识别到未来一周 1 项大作业；
- 自动提醒于 17:01 到达 `**@aucklanduni.ac.nz` 收件箱；
- 邮件内容包含 ELECTENG/COMPSYS 209 的 Lab 2 及 Canvas 直达链接；
- 生产 Cron 保持为 UTC 02:00 和 03:00，由奥克兰 15:00 时间门控避免重复发送。

## 12. 已知限制与运维要求

### OP-001 Canvas 登录变化

Canvas 或 University 登录页面结构发生变化时，浏览器选择器可能失效，需要更新登录自动化。

### OP-002 密码与挑战

Canvas 密码变更、账号锁定、MFA 恢复或交互式验证出现时，必须更新 Secret 或人工处理后重新测试。

### OP-003 Resend API Key

API Key 与账号密码无关。仅当密钥被删除、轮换或疑似泄露时，才需要在 Resend 中重新创建并更新 `RESEND_API_KEY`。

### OP-004 垃圾邮件

首次投递可能被收件邮箱判为垃圾邮件。出现此情况时，应在收件邮箱中把发件人标记为“非垃圾邮件”，并视需要建立“永不归入垃圾邮件”的过滤规则。每次更改收件人后必须重新做实际投递测试。

### OP-005 Cloudflare Browser Run

Browser Run 可能发生临时启动失败。此类运行必须发送失败告警；后续定时运行可恢复，但不允许将失败运行解释为无作业。

### OP-006 配置变更验收

修改收件地址、Canvas 密码、Resend API Key、Worker 代码或 Cron 后，必须重新运行自动测试和真实投递测试，并同时检查 Cloudflare 日志与收件邮箱。

## 13. 完成标准

只有同时满足以下条件，任务才可视为正常运行：

1. Worker 已部署到正确 Cloudflare 账号；
2. 七项 Secrets 均存在且有效；
3. Cron 为 UTC 02:00 和 03:00；
4. 奥克兰 15:00 时间门控测试通过；
5. Canvas 读取全程只读且分页完整；
6. 类型检查和自动测试全部通过；
7. 真实自动提醒已到达 `**@aucklanduni.ac.nz` 收件箱；
8. 手机邮箱通知已开启；
9. Cloudflare 日志中没有持续的认证、Canvas 或邮件发送错误。
