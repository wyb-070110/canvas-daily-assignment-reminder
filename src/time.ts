export const AUCKLAND_TIME_ZONE = "Pacific/Auckland";

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AUCKLAND_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function partsFor(date: Date): DateParts {
  const values = Object.fromEntries(
    dateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function aucklandDateKey(date: Date): string {
  const parts = partsFor(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function isAucklandThreePm(date: Date): boolean {
  const parts = partsFor(date);
  return parts.hour === 15 && parts.minute === 0;
}

export function formatAucklandDateTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: AUCKLAND_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}
