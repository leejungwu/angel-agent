export type PublishMode = "manual" | "scheduled";
export type FinalizeMode = "review" | "auto";
export function parseFinalizeMode(value: unknown, publishMode: unknown): FinalizeMode {
  if (value === undefined || value === "review") return "review";
  if (value !== "auto") throw new Error("최종 동작을 확인해 주세요.");
  if (publishMode !== "scheduled") throw new Error("자동 최종 동작은 예약 발행에서만 허용됩니다.");
  return "auto";
}
export type PublicationSchedule = { publishMode: PublishMode; scheduledAt: string | null };

export function defaultPublicationSchedule(now = Date.now()) {
  const rounded = Math.ceil((now + 20 * 60000) / 600000) * 600000;
  const seoul = new Date(rounded + 9 * 3600000).toISOString();
  return { date: seoul.slice(0, 10), time: seoul.slice(11, 16) };
}

// Explicit KST conversion; never interpret a datetime in the browser's timezone.
export function seoulScheduleToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("예약 날짜와 시간을 입력해 주세요.");
  const value = Date.parse(`${date}T${time}:00+09:00`);
  if (!Number.isFinite(value) || new Date(value + 9 * 3600000).toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error("예약 날짜와 시간이 올바르지 않습니다.");
  return new Date(value).toISOString();
}

export function parsePublicationSchedule(input: { publishMode?: unknown; scheduledAt?: unknown }, futureOnly = false, now = Date.now()): PublicationSchedule {
  const mode = input.publishMode === undefined ? "manual" : input.publishMode;
  if (mode !== "manual" && mode !== "scheduled") throw new Error("발행 방식을 확인해 주세요.");
  if (mode === "manual") {
    if (input.scheduledAt != null) throw new Error("일반 발행에는 예약 시간을 지정할 수 없습니다.");
    return { publishMode: mode, scheduledAt: null };
  }
  const value = input.scheduledAt;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("시간대가 포함된 예약 시간이 필요합니다.");
  const timestamp = Date.parse(value);
  const day = value.slice(0, 10);
  seoulScheduleToIso(day, value.slice(11, 16));
  if (!Number.isFinite(timestamp)) throw new Error("예약 시간이 올바르지 않습니다.");
  const normalized = futureOnly ? Math.floor(timestamp / 60000) * 60000 : timestamp;
  if (futureOnly && new Date(normalized).getUTCMinutes() % 10 !== 0) throw new Error("네이버 예약 발행은 10분 단위만 지원합니다.");
  if (futureOnly && normalized <= now) throw new Error("예약 시간은 현재보다 이후로 지정해 주세요.");
  return { publishMode: mode, scheduledAt: new Date(normalized).toISOString() };
}

export function formatScheduledAt(value: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")}.${part("month")}.${part("day")} ${part("hour")}:${part("minute")}`;
}
