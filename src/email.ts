import { CANVAS_BASE_URL } from "./canvas.ts";
import type {
  AssignmentWithCourse,
  MajorReminderItem,
  PrimaryReminderItem,
  ReminderResult,
  RenderedEmail
} from "./types.ts";
import { formatAucklandDateTime } from "./time.ts";
import type { ErrorCategory } from "./http.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAssignmentUrl(item: AssignmentWithCourse): string {
  if (item.assignment.html_url) {
    try {
      const url = new URL(item.assignment.html_url);
      if (url.protocol === "https:" && url.hostname === "canvas.auckland.ac.nz") {
        return url.toString();
      }
    } catch {
      // Fall through to a deterministic Canvas URL.
    }
  }
  return `${CANVAS_BASE_URL}/courses/${item.course.id}/assignments/${item.assignment.id}`;
}

function itemHtml(
  item: AssignmentWithCourse,
  status: string,
  reason?: string
): string {
  const url = escapeHtml(safeAssignmentUrl(item));
  const reasonHtml = reason ? `<br><small>${escapeHtml(reason)}</small>` : "";
  return `<li><strong>${escapeHtml(item.course.name)}</strong> — <a href="${url}">${escapeHtml(item.assignment.name)}</a><br>${escapeHtml(formatAucklandDateTime(item.dueAt))} · ${escapeHtml(status)}${reasonHtml}</li>`;
}

function itemText(
  item: AssignmentWithCourse,
  status: string,
  reason?: string
): string {
  const suffix = reason ? ` · ${reason}` : "";
  return `- ${item.course.name} — ${item.assignment.name}\n  ${formatAucklandDateTime(item.dueAt)} · ${status}${suffix}\n  ${safeAssignmentUrl(item)}`;
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#172033"><h2>${escapeHtml(title)}</h2>${body}<p style="color:#667085;font-size:12px">此邮件由只读 Canvas 自动检查生成，时间均为奥克兰时间。</p></body></html>`;
}

function renderPrimary(items: PrimaryReminderItem[]): RenderedEmail {
  const today = items.filter((item) => item.group === "today");
  const tomorrow = items.filter((item) => item.group === "tomorrow");
  const sectionsHtml = [
    today.length
      ? `<h3>今天</h3><ul>${today
          .map((item) => itemHtml(item, item.overdue ? "未提交 · 已逾期" : "未提交"))
          .join("")}</ul>`
      : "",
    tomorrow.length
      ? `<h3>明天</h3><ul>${tomorrow
          .map((item) => itemHtml(item, "未提交"))
          .join("")}</ul>`
      : ""
  ].join("");
  const sectionsText = [
    today.length
      ? `今天\n${today
          .map((item) => itemText(item, item.overdue ? "未提交 · 已逾期" : "未提交"))
          .join("\n")}`
      : "",
    tomorrow.length
      ? `明天\n${tomorrow.map((item) => itemText(item, "未提交")).join("\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  const subject = `Canvas：今天/明天有 ${items.length} 项未完成`;
  return {
    subject,
    html: wrapHtml(subject, sectionsHtml),
    text: `${subject}\n\n${sectionsText}\n\n时间均为奥克兰时间。`
  };
}

function renderMajor(items: MajorReminderItem[]): RenderedEmail {
  const subject = "Canvas：未来一周大作业提醒";
  const html = `<p>今天和明天没有未提交作业；以下项目可能需要提前安排：</p><ul>${items
    .map((item) =>
      itemHtml(item, item.probable ? "可能的大作业" : "大作业", item.reason)
    )
    .join("")}</ul>`;
  const text = items
    .map((item) =>
      itemText(item, item.probable ? "可能的大作业" : "大作业", item.reason)
    )
    .join("\n");
  return {
    subject,
    html: wrapHtml(subject, html),
    text: `${subject}\n\n今天和明天没有未提交作业；以下项目可能需要提前安排：\n${text}\n\n时间均为奥克兰时间。`
  };
}

export function renderReminderEmail(result: ReminderResult): RenderedEmail {
  if (result.kind === "primary") return renderPrimary(result.items);
  if (result.kind === "major") return renderMajor(result.items);

  const subject = "Canvas：近期没有发现未完成作业";
  const message = "今天和明天没有未提交作业，未来七天内也没有识别到大作业。";
  return {
    subject,
    html: wrapHtml(subject, `<p>${message}</p>`),
    text: `${subject}\n\n${message}`
  };
}

const FAILURE_MESSAGE: Record<ErrorCategory, string> = {
  AUTH: "Canvas 登录已失效或被拒绝，请检查云端保存的账号和专用密码。",
  RATE_LIMIT: "Canvas 暂时限制了请求频率，请稍后查看 Cloudflare 运行记录。",
  UPSTREAM: "Canvas 返回异常或分页不完整，本次未发送可能不完整的作业结果。",
  NETWORK: "连接 Canvas 时发生网络或超时错误，本次未发送可能不完整的作业结果。",
  CONFIG: "云端密钥配置不完整，请检查 Worker 的 Secrets。",
  UNKNOWN: "检查过程中发生未知错误，本次未发送可能不完整的作业结果。"
};

export function renderFailureEmail(category: ErrorCategory): RenderedEmail {
  const subject = "Canvas 检查失败";
  const message = FAILURE_MESSAGE[category];
  return {
    subject,
    html: wrapHtml(subject, `<p>${escapeHtml(message)}</p>`),
    text: `${subject}\n\n${message}`
  };
}
