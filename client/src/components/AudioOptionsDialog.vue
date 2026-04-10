<script setup lang="ts">
import { ref } from "vue";

// ---------------------------------------------------------------------------
// Emits & types
// ---------------------------------------------------------------------------

export interface AudioCreateOptions {
  customization: {
    format: 0 | 1 | 2 | 3;
    language: string;
    length: 1 | 2;
  };
  instructions?: string;
}

const emit = defineEmits<{
  close: [];
  confirm: [options: AudioCreateOptions];
}>();

// ---------------------------------------------------------------------------
// Format options
// ---------------------------------------------------------------------------

const FORMAT_OPTIONS = [
  {
    value: 0 as const,
    label: "深度对话",
    desc: "两位主持人层层展开，深入解析来源内容",
  },
  {
    value: 1 as const,
    label: "简要概述",
    desc: "快速掌握来源核心要点，言简意赅",
  },
  {
    value: 2 as const,
    label: "专家点评",
    desc: "专业评审与建设性反馈，助你完善素材",
  },
  {
    value: 3 as const,
    label: "观点辩论",
    desc: "两位主持人就不同观点展开辩论对话",
  },
];

// ---------------------------------------------------------------------------
// Language options (curated common languages)
// ---------------------------------------------------------------------------

const LANGUAGE_OPTIONS = [
  { label: "中文（简体）", value: "zh" },
  { label: "中文（繁体）", value: "zh-TW" },
  { label: "English", value: "en" },
  { label: "日本語", value: "ja" },
  { label: "한국어", value: "ko" },
  { label: "Español", value: "es" },
  { label: "Français", value: "fr" },
  { label: "Deutsch", value: "de" },
  { label: "Italiano", value: "it" },
  { label: "Português", value: "pt" },
  { label: "Русский", value: "ru" },
  { label: "العربية", value: "ar" },
  { label: "हिन्दी", value: "hi" },
  { label: "Türkçe", value: "tr" },
  { label: "Tiếng Việt", value: "vi" },
  { label: "Bahasa Indonesia", value: "id" },
  { label: "ภาษาไทย", value: "th" },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const format = ref<0 | 1 | 2 | 3>(0);
const language = ref("zh");
const length = ref<1 | 2>(2);
const instructions = ref("");

function handleConfirm() {
  emit("confirm", {
    customization: {
      format: format.value,
      language: language.value,
      length: length.value,
    },
    instructions: instructions.value.trim() || undefined,
  });
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit("close");
}
</script>

<template>
  <teleport to="body">
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      @click="handleBackdropClick"
    >
      <!-- Dialog -->
      <div
        class="relative w-full max-w-xl mx-4 rounded-lg border border-[#d8cfbe] bg-[#f8f3ea] shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#e0d5c0]">
          <div class="flex items-center gap-2">
            <!-- Headphone icon -->
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6a5b49" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6M3 18a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H4a3 3 0 0 0-3 3zm18 0a3 3 0 0 1-3 3h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a3 3 0 0 1 3 3z" />
            </svg>
            <h2
              class="text-base font-semibold text-[#2f271f]"
              style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
            >
              定制音频概述
            </h2>
          </div>
          <button
            type="button"
            class="rounded p-1 text-[#9a8a78] hover:bg-[#efe7d7] hover:text-[#2f271f] transition-colors"
            @click="emit('close')"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>

        <div class="px-6 py-5 space-y-5">
          <!-- Format -->
          <div>
            <p class="text-sm font-medium text-[#5a4b3a] mb-2.5">格式</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="opt in FORMAT_OPTIONS"
                :key="opt.value"
                type="button"
                class="text-left rounded-md border px-3.5 py-3 transition-all"
                :class="format === opt.value
                  ? 'border-[#b89e84] bg-[#efe7d7] text-[#2f271f]'
                  : 'border-[#ddd3c2] bg-white/50 text-[#5a4b3a] hover:border-[#c8b89a] hover:bg-[#faf6ef]'"
                @click="format = opt.value"
              >
                <div class="flex items-center justify-between mb-1">
                  <span class="text-sm font-medium">{{ opt.label }}</span>
                  <svg
                    v-if="format === opt.value"
                    width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#7a6548" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  >
                    <polyline points="2 8 6 12 14 4" />
                  </svg>
                </div>
                <p class="text-xs text-[#9a8a78] leading-relaxed">{{ opt.desc }}</p>
              </button>
            </div>
          </div>

          <!-- Language + Length (side by side) -->
          <div class="flex gap-5">
            <!-- Language -->
            <div class="flex-1">
              <p class="text-sm font-medium text-[#5a4b3a] mb-2">语言</p>
              <div class="relative">
                <select
                  v-model="language"
                  class="w-full appearance-none rounded-md border border-[#ddd3c2] bg-white/70 px-3 py-2 pr-8 text-sm text-[#2f271f] focus:border-[#b89e84] focus:outline-none cursor-pointer"
                >
                  <option v-for="lang in LANGUAGE_OPTIONS" :key="lang.value" :value="lang.value">
                    {{ lang.label }}
                  </option>
                </select>
                <!-- Dropdown arrow -->
                <svg class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#9a8a78" stroke-width="1.5" stroke-linecap="round">
                  <polyline points="2 4 6 8 10 4" />
                </svg>
              </div>
            </div>

            <!-- Length -->
            <div>
              <p class="text-sm font-medium text-[#5a4b3a] mb-2">时长</p>
              <div class="flex rounded-md border border-[#ddd3c2] overflow-hidden">
                <button
                  type="button"
                  class="px-4 py-2 text-sm transition-colors"
                  :class="length === 1
                    ? 'bg-[#efe7d7] text-[#2f271f] font-medium'
                    : 'bg-white/50 text-[#6a5b49] hover:bg-[#faf6ef]'"
                  @click="length = 1"
                >
                  简短
                </button>
                <button
                  type="button"
                  class="px-4 py-2 text-sm transition-colors border-l border-[#ddd3c2]"
                  :class="length === 2
                    ? 'bg-[#efe7d7] text-[#2f271f] font-medium'
                    : 'bg-white/50 text-[#6a5b49] hover:bg-[#faf6ef]'"
                  @click="length = 2"
                >
                  标准
                </button>
              </div>
            </div>
          </div>

          <!-- Instructions -->
          <div>
            <p class="text-sm font-medium text-[#5a4b3a] mb-2">
              内容聚焦
              <span class="ml-1 font-normal text-[#9a8a78]">（可选）</span>
            </p>
            <textarea
              v-model="instructions"
              placeholder="告诉主持人本期应重点讨论什么，例如：深入解析第三章的核心论点，并联系实际案例说明。"
              rows="3"
              class="w-full resize-none rounded-md border border-[#ddd3c2] bg-white/70 px-3 py-2.5 text-sm text-[#2f271f] placeholder-[#b8a898] focus:border-[#b89e84] focus:outline-none leading-relaxed"
            />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-3 px-6 pb-5">
          <button
            type="button"
            class="rounded px-4 py-2 text-sm text-[#6a5b49] hover:bg-[#efe7d7] transition-colors"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded px-5 py-2 text-sm font-medium bg-[#5a4b3a] text-[#f8f3ea] hover:bg-[#4a3d2f] active:scale-95 transition-all"
            @click="handleConfirm"
          >
            生成
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
