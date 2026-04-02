export function formatTime(ts: string | null): string {
  if (!ts) return "-";
  if (!isNaN(Number(ts))) {
    return new Date(Number(ts) * 1000).toLocaleString("zh-CN");
  }
  return new Date(ts).toLocaleString("zh-CN");
}
