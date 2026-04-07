import { ref } from "vue";

export type ToastType = "info" | "error";

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const current = ref<ToastItem | null>(null);
let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
let idCounter = 0;

function clearTimer() {
  if (autoHideTimer !== null) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
}

function scheduleHide(delayMs = 3000) {
  clearTimer();
  autoHideTimer = setTimeout(() => {
    current.value = null;
    autoHideTimer = null;
  }, delayMs);
}

function showToast(message: string, type: ToastType = "info") {
  clearTimer();
  current.value = { id: ++idCounter, message, type };
  scheduleHide();
}

function dismissToast() {
  clearTimer();
  current.value = null;
}

function pauseHide() {
  clearTimer();
}

function resumeHide() {
  if (current.value) {
    scheduleHide(2000);
  }
}

export function useToast() {
  return { current, showToast, dismissToast, pauseHide, resumeHide };
}
