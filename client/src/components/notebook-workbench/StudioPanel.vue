<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import {
  type ResearchState,
  ArtifactState,
  notebooksApi,
} from "@/api/notebooks";
import { api, type SummaryPreset } from "@/api/client";
import { useToast } from "@/composables/useToast";
import PresetManagerDialog from "@/components/PresetManagerDialog.vue";
import AudioOptionsDialog, {
  type AudioCreateOptions,
} from "@/components/AudioOptionsDialog.vue";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  notebookId: string;
  researchState: ResearchState;
  hasResearchAssets: boolean;
  messageCount: number;
  /** True when sources exist but all are still processing — block research start. */
  sourcesAllProcessing?: boolean;
  onStartResearch: () => void;
  /** Generates a research report from local Q&A data (our system). */
  onGenerateReport: (presetId?: string) => Promise<void>;
  /** Called when a Studio artifact finishes generating (READY). */
  onArtifactReady?: () => void;
}

const props = defineProps<Props>();
const { showToast } = useToast();

// ---------------------------------------------------------------------------
// Research toggle (preserved from original)
// ---------------------------------------------------------------------------

const running = computed(() => props.researchState.status === "running");
const toggleOn = computed(() => running.value);

function handleToggle() {
  props.onStartResearch();
}

const countLabel = computed(() => {
  const turns = Math.floor(props.messageCount / 2);
  if (turns <= 0) return "暂无问答数据";
  return `共 ${turns} 轮问答`;
});

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

interface StepDef {
  step: string;
  label: string;
  /** SVG path data (24x24 viewBox, stroke-based) */
  iconPath: string;
}

const STEP_DEFS: StepDef[] = [
  {
    step: "starting",
    label: "启动中",
    // loader circle
    iconPath: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
  },
  {
    step: "generating_question",
    label: "正在生成问题",
    // pencil / edit icon
    iconPath: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  },
  {
    step: "waiting_answer",
    label: "等待 NotebookLM 回答",
    // hourglass icon
    iconPath: "M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12M7 22v-4.172a2 2 0 0 1 .586-1.414L12 12M17 2v4.172a2 2 0 0 1-.586 1.414L12 12M7 2v4.172a2 2 0 0 0 .586 1.414L12 12",
  },
  {
    step: "refreshing_messages",
    label: "同步回答内容",
    // refresh / rotate icon
    iconPath: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  },
];

const currentStepDef = computed<StepDef | null>(() => {
  const step = props.researchState.step;
  if (!step || step === "idle") {
    // Show a generic "preparing" entry when running but step not set
    return running.value
      ? {
          step: "idle",
          label: "准备中",
          iconPath: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
        }
      : null;
  }
  return STEP_DEFS.find((d) => d.step === step) ?? null;
});

// ---------------------------------------------------------------------------
// Waiting-answer timer
// ---------------------------------------------------------------------------

const waitingSeconds = ref<number>(0);
let waitingTimer: ReturnType<typeof setInterval> | null = null;

function clearWaitingTimer() {
  if (waitingTimer !== null) {
    clearInterval(waitingTimer);
    waitingTimer = null;
  }
}

watch(
  () => props.researchState.step,
  (step) => {
    if (step === "waiting_answer") {
      waitingSeconds.value = 0;
      clearWaitingTimer();
      waitingTimer = setInterval(() => {
        waitingSeconds.value += 1;
      }, 1000);
    } else {
      clearWaitingTimer();
      waitingSeconds.value = 0;
    }
  },
);

// ---------------------------------------------------------------------------
// Artifact definitions
// ---------------------------------------------------------------------------

interface ArtifactDef {
  key: string;
  label: string;
  /** The type string sent to the API, or null for unsupported types. */
  apiType: string | null;
  icon: string; // inline SVG path data
  /** Whether this feature is experimental (未经完整测试). */
  experimental?: boolean;
}

const artifacts: ArtifactDef[] = [
  {
    key: "audio",
    label: "音频概述",
    apiType: "audio",
    experimental: true,
    // headphones icon
    icon: "M3 18v-6a9 9 0 0 1 18 0v6M3 18a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H4a3 3 0 0 0-3 3zm18 0a3 3 0 0 1-3 3h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a3 3 0 0 1 3 3z",
  },
  {
    key: "slide_deck",
    label: "幻灯片",
    apiType: "slide_deck",
    experimental: true,
    // presentation/slide icon
    icon: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm8 16v-3m-4 3h8",
  },
  {
    key: "video",
    label: "视频概述",
    apiType: "video",
    experimental: true,
    // film/clapboard icon
    icon: "M15 10l5-3v10l-5-3M3 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
  },
  {
    key: "mind_map",
    label: "思维导图",
    apiType: "mind_map",
    experimental: true,
    // network/graph icon
    icon: "M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm14 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 8v3m-5 3l4-3m6 3l-4-3",
  },
  {
    key: "report",
    label: "文档摘要",
    apiType: "report",
    experimental: true,
    // document/page icon
    icon: "M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 0v6h6M8 13h8M8 17h5",
  },
  {
    key: "flashcards",
    label: "闪卡",
    apiType: "flashcards",
    experimental: true,
    // stacked cards icon
    icon: "M5 6h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM7 3h10a1 1 0 0 1 1 1v1H6V4a1 1 0 0 1 1-1z",
  },
  {
    key: "quiz",
    label: "测验",
    apiType: "quiz",
    experimental: true,
    // question mark circle icon
    icon: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-6v.01M12 8a2 2 0 0 1 1.71 3.04L12 13",
  },
  {
    key: "infographic",
    label: "信息图",
    apiType: "infographic",
    experimental: true,
    // bar chart icon
    icon: "M4 20h16M4 20V10m0 10h4V14m-4-4h4v4m0 0h4V8m0 12h4V4m0 16h4v-8",
  },
  {
    key: "datatable",
    label: "数据表",
    apiType: null, // unsupported
    // table/grid icon
    icon: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 5h18M3 14h18M9 5v14M15 5v14",
  },
];

// ---------------------------------------------------------------------------
// Generation state per artifact
// ---------------------------------------------------------------------------

/** Tracks in-flight generation for each artifact key. */
const generating = reactive<Record<string, boolean>>({});

/** True when any artifact is currently being generated. Disables all other cards. */
const generatingAny = computed(() => Object.values(generating).some(Boolean));
/** Track active poll timers so we can clean them up on unmount. */
const pollTimers = new Set<ReturnType<typeof setTimeout>>();

function clearAllTimers() {
  for (const t of pollTimers) clearTimeout(t);
  pollTimers.clear();
}

onUnmounted(() => {
  clearAllTimers();
  clearWaitingTimer();
});

// ---------------------------------------------------------------------------
// Poll helper
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 60; // 3 min total

async function pollArtifact(
  notebookId: string,
  artifactId: string,
  label: string,
  key: string,
) {
  let attempts = 0;

  const poll = async () => {
    if (attempts >= MAX_POLLS) {
      generating[key] = false;
      showToast(`${label} 生成超时`, "error");
      return;
    }
    attempts++;
    try {
      const artifact = await notebooksApi.getArtifact(notebookId, artifactId);
      if (artifact.state === ArtifactState.READY) {
        generating[key] = false;
        showToast(`${label} 已生成`, "info");
        props.onArtifactReady?.();
        return;
      }
      if (artifact.state === ArtifactState.FAILED) {
        generating[key] = false;
        showToast(`${label} 生成失败`, "error");
        return;
      }
      // Still creating – schedule next poll
      const timer = setTimeout(poll, POLL_INTERVAL_MS);
      pollTimers.add(timer);
    } catch {
      generating[key] = false;
      showToast(`${label} 状态查询失败`, "error");
    }
  };

  const timer = setTimeout(poll, POLL_INTERVAL_MS);
  pollTimers.add(timer);
}

// ---------------------------------------------------------------------------
// Card click handler
// ---------------------------------------------------------------------------

async function handleArtifactClick(def: ArtifactDef) {
  // Unsupported type
  if (def.apiType === null) {
    showToast("功能正在建设中…", "info");
    return;
  }

  // Already generating this type
  if (generating[def.key]) return;

  // Audio: open customization dialog first
  if (def.key === "audio") {
    showAudioDialog.value = true;
    return;
  }

  generating[def.key] = true;
  showToast(`正在生成 ${def.label}…`, "info");

  try {
    const res = await notebooksApi.createArtifact(
      props.notebookId,
      def.apiType,
    );
    await pollArtifact(props.notebookId, res.artifactId, def.label, def.key);
  } catch (err) {
    generating[def.key] = false;
    const msg = err instanceof Error ? err.message : String(err);
    showToast(`${def.label} 创建失败：${msg}`, "error");
  }
}

async function handleAudioConfirm(options: AudioCreateOptions) {
  showAudioDialog.value = false;
  const def = artifacts.find((a) => a.key === "audio")!;
  generating[def.key] = true;
  showToast(`正在生成 ${def.label}…`, "info");
  try {
    const res = await notebooksApi.createArtifact(
      props.notebookId,
      "audio",
      options as Record<string, unknown>,
    );
    await pollArtifact(props.notebookId, res.artifactId, def.label, def.key);
  } catch (err) {
    generating[def.key] = false;
    const msg = err instanceof Error ? err.message : String(err);
    showToast(`${def.label} 创建失败：${msg}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Generate research report (our own system, based on local Q&A)
// ---------------------------------------------------------------------------

const generatingReport = ref(false);
const presets = ref<SummaryPreset[]>([]);
const presetsLoading = ref(false);
const presetMenuOpen = ref(false);
const showPresetManager = ref(false);
const showAudioDialog = ref(false);

async function loadPresets() {
  presetsLoading.value = true;
  try {
    presets.value = await api.listPresets();
  } catch {
    // non-fatal: fall back to empty list; user can still use the default
  } finally {
    presetsLoading.value = false;
  }
}

onMounted(loadPresets);

async function handleGenerateReport(presetId?: string) {
  if (generatingReport.value || !props.hasResearchAssets) return;
  presetMenuOpen.value = false;
  generatingReport.value = true;
  try {
    await props.onGenerateReport(presetId);
  } finally {
    generatingReport.value = false;
  }
}

function selectPreset(preset: SummaryPreset) {
  handleGenerateReport(preset.id);
}

function togglePresetMenu() {
  if (!props.hasResearchAssets || generatingReport.value) return;
  presetMenuOpen.value = !presetMenuOpen.value;
}
</script>

<template>
  <section
    class="h-full min-h-0 bg-[#f8f3ea] border border-[#d8cfbe] rounded-lg flex flex-col overflow-hidden"
  >
    <!-- Scrollable content -->
    <div class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5">
      <!-- ─── Panel title ─── -->
      <h2
        class="text-lg font-semibold text-[#2f271f] shrink-0"
        style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
      >
        Studio
      </h2>

      <!-- ─── 自动课题研究 ─── -->
      <div class="flex flex-col gap-2.5 shrink-0">
        <div class="flex items-center justify-between">
          <span
            class="text-base font-medium text-[#2f271f]"
            style="
              font-family: 'Noto Serif SC', 'Source Han Serif SC', serif;
            "
          >
            自动课题研究
          </span>

          <!-- Toggle switch -->
          <button
            type="button"
            role="switch"
            :aria-checked="toggleOn"
            :disabled="!!sourcesAllProcessing && !running"
            class="relative inline-flex h-5.5 w-10 shrink-0 rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3a2e20]/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40"
            :class="[toggleOn ? 'bg-[#3a2e20]' : 'bg-[#c4b89a]', sourcesAllProcessing && !running ? '' : 'cursor-pointer']"
            @click="handleToggle"
          >
            <span
              class="pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow ring-0 transition-transform duration-150 ease-in-out"
              :class="toggleOn ? 'translate-x-4.5' : 'translate-x-0'"
            />
          </button>
        </div>

        <!-- Sources-still-loading notice -->
        <p
          v-if="sourcesAllProcessing && !running"
          class="text-xs text-[#9a8a78] leading-snug"
        >
          来源正在处理中，完成后方可开始研究
        </p>

        <!-- Step indicator card (running) -->
        <div
          v-if="running && currentStepDef"
          class="flex flex-col gap-1.5 bg-[#fffbf4] border border-[#ddd3c2] rounded-md px-3 py-2"
        >
          <!-- Active step row -->
          <div class="flex items-center gap-2 min-w-0">
            <!-- Pulse dot -->
            <span class="relative flex shrink-0 h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#9a8a78] opacity-60" />
              <span class="relative inline-flex rounded-full h-2 w-2 bg-[#7a6c5a]" />
            </span>

            <!-- Step icon -->
            <svg
              class="shrink-0 w-4 h-4 text-[#7a6c5a]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="currentStepDef.iconPath" />
            </svg>

            <!-- Step label -->
            <span class="text-sm text-[#564738] leading-snug flex-1 truncate">
              {{ currentStepDef.label }}
            </span>

            <!-- Elapsed time (only for waiting_answer) -->
            <span
              v-if="researchState.step === 'waiting_answer'"
              class="shrink-0 text-xs text-[#9a8a78] tabular-nums ml-1"
            >
              已等 {{ waitingSeconds }}s
            </span>
          </div>

          <!-- Turn count sub-line -->
          <p class="text-xs text-[#9a8a78] leading-relaxed pl-4">
            {{ countLabel }}
          </p>
        </div>

        <!-- Static count label (not running) -->
        <p v-else class="text-sm text-[#9a8a78] leading-relaxed">{{ countLabel }}</p>

        <p
          v-if="researchState.lastError"
          class="text-sm text-[#b33c2a] leading-relaxed"
        >
          {{ researchState.lastError }}
        </p>
      </div>

      <!-- ─── Divider ─── -->
      <div
        class="border-t border-[#d8cfbe] shrink-0"
        aria-hidden="true"
      />

      <!-- ─── 生成产物 ─── -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2 shrink-0">
          <h3
            class="text-base font-medium text-[#2f271f]"
            style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
          >
            生成产物
          </h3>
          <span class="rounded px-1.5 py-0.5 text-[10px] leading-none font-medium bg-[#e4dac8] text-[#8a7b68]">
            NotebookLM 原生
          </span>
        </div>

        <!-- 2-col grid -->
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="art in artifacts"
            :key="art.key"
            type="button"
            :disabled="generatingAny"
            class="group relative flex flex-col items-center gap-1.5 rounded-md border bg-[#fffbf4] border-[#ddd3c2] px-2 py-3 text-[#2f271f] transition-all duration-150 ease-in-out hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60"
            @click="handleArtifactClick(art)"
          >
            <!-- Experimental badge -->
            <span
              v-if="art.experimental"
              class="absolute top-1 right-1 rounded px-1 py-0.5 text-[9px] leading-none font-medium bg-[#e8ddc8] text-[#9a8a78]"
            >
              实验
            </span>

            <!-- Icon -->
            <span class="relative flex items-center justify-center w-7 h-7 text-[#7a6c5a]">
              <!-- Spinner overlay when generating -->
              <svg
                v-if="generating[art.key]"
                class="absolute inset-0 w-7 h-7 animate-spin text-[#9a8a78]"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-dasharray="50 14"
                  stroke-linecap="round"
                />
              </svg>
              <svg
                v-else
                class="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path :d="art.icon" />
              </svg>
            </span>

            <!-- Label -->
            <span
              class="text-sm leading-snug"
              :class="generating[art.key] ? 'text-[#9a8a78]' : 'text-[#564738]'"
            >
              {{ generating[art.key] ? "生成中…" : art.label }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- ─── Generate research report (pinned footer) ─── -->
    <div class="shrink-0 border-t border-[#d8cfbe]">
      <!-- Preset accordion panel (expands above the button) -->
      <div
        v-if="presetMenuOpen"
        class="border-b border-[#d8cfbe] bg-[#f5efe2] max-h-60 overflow-y-auto"
      >
        <!-- Manage link -->
        <button
          type="button"
          class="w-full text-left flex items-center gap-1.5 px-4 py-2 text-xs text-[#9a8a78] border-b border-[#e0d8c8] hover:bg-[#ede6d6] transition-colors"
          @click="showPresetManager = true; presetMenuOpen = false"
        >
          <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          管理总结方式…
        </button>
        <!-- Loading state -->
        <div v-if="presetsLoading" class="px-4 py-3 text-xs text-[#9a8a78]">加载中…</div>
        <!-- Preset items -->
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          :disabled="generatingReport"
          class="w-full text-left px-4 py-2.5 border-b border-[#ece4d4] last:border-0 hover:bg-[#ede6d6] transition-colors disabled:opacity-50 disabled:pointer-events-none"
          @click="selectPreset(preset)"
        >
          <div class="text-sm text-[#3a2e20] leading-snug">{{ preset.name }}</div>
          <div v-if="preset.description" class="text-xs text-[#9a8a78] mt-0.5 leading-snug">{{ preset.description }}</div>
        </button>
        <!-- Empty state -->
        <div v-if="!presetsLoading && presets.length === 0" class="px-4 py-3 text-xs text-[#9a8a78]">
          暂无总结方式，请先添加
        </div>
      </div>

      <!-- Button row -->
      <div class="p-4">
        <button
          type="button"
          :disabled="!hasResearchAssets || generatingReport"
          class="w-full flex items-center justify-center gap-2 rounded-md border border-[#b8a98a] bg-[#ede2cc] px-4 py-2.5 text-sm font-medium text-[#3a2e20] transition-all duration-150 ease-in-out hover:bg-[#e0d4b8] hover:border-[#a89878] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          @click="togglePresetMenu"
        >
          <!-- Spinner when generating -->
          <svg
            v-if="generatingReport"
            class="w-4 h-4 animate-spin shrink-0"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray="50 14"
              stroke-linecap="round"
            />
          </svg>
          <!-- Document icon -->
          <svg
            v-else
            class="w-4 h-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          <span>{{ generatingReport ? "正在生成报告…" : "总结" }}</span>
          <!-- Chevron (toggle indicator) -->
          <svg
            v-if="!generatingReport"
            class="w-3.5 h-3.5 shrink-0 ml-auto transition-transform duration-150"
            :class="presetMenuOpen ? 'rotate-180' : ''"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
        <p class="mt-1.5 text-xs text-[#9a8a78] text-center leading-relaxed">
          基于本次课题研究的问答数据
        </p>
      </div>
    </div>
  </section>

  <!-- Preset manager dialog (fixed overlay, works outside overflow:hidden) -->
  <PresetManagerDialog
    v-if="showPresetManager"
    @close="showPresetManager = false; loadPresets()"
  />

  <!-- Audio customization dialog -->
  <AudioOptionsDialog
    v-if="showAudioDialog"
    @close="showAudioDialog = false"
    @confirm="handleAudioConfirm"
  />
</template>
