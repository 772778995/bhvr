export function showNotImplemented(label?: string) {
  const base = "功能正在建设中";
  alert(label ? `${label}：${base}` : base);
}
