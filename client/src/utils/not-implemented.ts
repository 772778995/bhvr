const NOT_IMPLEMENTED_MESSAGE = "功能正在建设中";

export function getNotImplementedMessage(label?: string): string {
  if (!label) {
    return NOT_IMPLEMENTED_MESSAGE;
  }
  return `${label}：${NOT_IMPLEMENTED_MESSAGE}`;
}
