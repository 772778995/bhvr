export interface ProgressEvent {
  step: string;
  message: string;
}

export interface StreamResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  timedOut?: boolean;
}

function parseSSEFrame(raw: string): { eventName: string; data: string } | null {
  let eventName = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) data = line.slice(5).trim();
  }
  return eventName && data ? { eventName, data } : null;
}

export async function streamPostSSE<T = unknown>(
  url: string,
  body: object | FormData,
  onProgress: (p: ProgressEvent) => void
): Promise<StreamResult<T>> {
  const isFormData = body instanceof FormData;
  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: isFormData
      ? { Accept: 'text/event-stream' }
      : { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: isFormData ? body : JSON.stringify(body),
  };

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>;
      const message = (errBody.error ?? errBody.message ?? `HTTP ${response.status}`) as string;
      return { success: false, error: message };
    }

    if (!response.body) {
      return { success: false, error: '响应体为空' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSSEFrame(frame);
        if (!parsed) continue;
        if (parsed.eventName === 'progress') {
          try {
            const p = JSON.parse(parsed.data) as ProgressEvent;
            onProgress(p);
          } catch { /* ignore malformed progress */ }
        } else if (parsed.eventName === 'complete') {
          try {
            return JSON.parse(parsed.data) as StreamResult<T>;
          } catch {
            return { success: false, error: '无法解析完成事件数据' };
          }
        }
      }
    }

    return { success: false, error: '连接已关闭，未收到完成信号' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
