<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import {
  type NotebookReport,
  type Artifact,
  type ArtifactTypeValue,
  type QuizQuestion,
  ArtifactType,
  ArtifactState,
  notebooksApi,
} from "@/api/notebooks";
import { renderMarkdown } from "@/utils/markdown";
import { useToast } from "@/composables/useToast";

interface Props {
  notebookId: string;
  report?: NotebookReport;
  artifact?: Artifact;
  onBack: () => void;
}

const props = defineProps<Props>();
const { showToast } = useToast();

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

const isArtifactMode = computed(() => !!props.artifact && !props.report);

// ---------------------------------------------------------------------------
// Local report rendering (existing behaviour)
// ---------------------------------------------------------------------------

const renderedHtml = computed(() => {
  if (!props.report?.content) return "";
  return renderMarkdown(props.report.content);
});

function downloadMarkdown() {
  if (!props.report) return;
  const content = props.report.content ?? "";
  const filename = (props.report.title || "report") + ".md";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Artifact full data (replaces the old `artifactContent: string | null`)
// ---------------------------------------------------------------------------

const fullArtifact = ref<Artifact | null>(null);
const artifactContentLoading = ref(false);

// REPORT: rendered HTML
const artifactRenderedHtml = computed(() => {
  if (!fullArtifact.value?.content) return "";
  return renderMarkdown(fullArtifact.value.content);
});

// AUDIO: blob URL management
const audioBlobUrl = ref<string | null>(null);

function base64ToBlob(b64: string, mime: string): Blob {
  const byteChars = atob(b64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function revokeAudioBlobUrl() {
  if (audioBlobUrl.value) {
    URL.revokeObjectURL(audioBlobUrl.value);
    audioBlobUrl.value = null;
  }
}

function downloadAudio() {
  if (!audioBlobUrl.value) return;
  const a = document.createElement("a");
  a.href = audioBlobUrl.value;
  const title = props.artifact?.title || "audio";
  a.download = title + ".mp3";
  a.click();
}

onUnmounted(() => {
  revokeAudioBlobUrl();
});

// QUIZ: interaction state
interface QuizState {
  /** Index of selected answer per question (-1 = not answered). */
  selected: number[];
  answeredCount: number;
  correctCount: number;
}

const quizState = ref<QuizState>({ selected: [], answeredCount: 0, correctCount: 0 });

function initQuizState(questions: QuizQuestion[]) {
  quizState.value = {
    selected: questions.map(() => -1),
    answeredCount: 0,
    correctCount: 0,
  };
}

function selectQuizOption(qIndex: number, optIndex: number, correctAnswer: number) {
  if (quizState.value.selected[qIndex] !== -1) return; // already answered
  quizState.value.selected[qIndex] = optIndex;
  quizState.value.answeredCount++;
  if (optIndex === correctAnswer) quizState.value.correctCount++;
}

// FLASHCARDS: navigation + flip state
const flashcardIndex = ref(0);
const flashcardFlipped = ref<boolean[]>([]);

function initFlashcards(count: number) {
  flashcardIndex.value = 0;
  flashcardFlipped.value = Array(count).fill(false);
}

function flipCard(idx: number) {
  flashcardFlipped.value[idx] = !flashcardFlipped.value[idx];
}

function prevCard() {
  if (flashcardIndex.value > 0) flashcardIndex.value--;
}

function nextCard(total: number) {
  if (flashcardIndex.value < total - 1) flashcardIndex.value++;
}

// ---------------------------------------------------------------------------
// Fetch full artifact data for READY artifacts of any supported type
// ---------------------------------------------------------------------------

async function fetchArtifactContent() {
  fullArtifact.value = null;
  revokeAudioBlobUrl();

  if (!props.artifact) return;
  if (props.artifact.state !== ArtifactState.READY) return;

  // Only fetch types we can display
  const fetchableTypes: ArtifactTypeValue[] = [
    ArtifactType.REPORT,
    ArtifactType.AUDIO,
    ArtifactType.QUIZ,
    ArtifactType.FLASHCARDS,
  ];
  if (!fetchableTypes.includes(props.artifact.type)) return;

  artifactContentLoading.value = true;
  try {
    const full = await notebooksApi.getArtifact(props.notebookId, props.artifact.artifactId);
    fullArtifact.value = full;

    // Post-process per type
    if (full.type === ArtifactType.AUDIO && full.audioData) {
      const blob = base64ToBlob(full.audioData, "audio/mp3");
      audioBlobUrl.value = URL.createObjectURL(blob);
    }

    if (full.type === ArtifactType.QUIZ && full.questions) {
      initQuizState(full.questions);
    }

    if (full.type === ArtifactType.FLASHCARDS && full.flashcards) {
      initFlashcards(full.flashcards.length);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast("加载 artifact 内容失败：" + msg, "error");
  } finally {
    artifactContentLoading.value = false;
  }
}

watch(
  () => props.artifact?.artifactId,
  (newId) => {
    if (newId) fetchArtifactContent();
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Artifact type labels & icons
// ---------------------------------------------------------------------------

const artifactTypeLabels: Record<number, string> = {
  [ArtifactType.UNKNOWN]: "未知类型",
  [ArtifactType.REPORT]: "研究报告",
  [ArtifactType.QUIZ]: "测验",
  [ArtifactType.FLASHCARDS]: "闪卡",
  [ArtifactType.MIND_MAP]: "思维导图",
  [ArtifactType.INFOGRAPHIC]: "信息图",
  [ArtifactType.SLIDE_DECK]: "幻灯片",
  [ArtifactType.AUDIO]: "音频概述",
  [ArtifactType.VIDEO]: "视频概述",
};

const artifactStateLabels: Record<number, string> = {
  [ArtifactState.UNKNOWN]: "未知状态",
  [ArtifactState.CREATING]: "生成中…",
  [ArtifactState.READY]: "已就绪",
  [ArtifactState.FAILED]: "生成失败",
};

const artifactTitle = computed(() => {
  if (!props.artifact) return "";
  return props.artifact.title || (artifactTypeLabels[props.artifact.type] ?? "未知类型");
});

const artifactStateText = computed(() => {
  if (!props.artifact) return "";
  return artifactStateLabels[props.artifact.state] ?? "未知状态";
});

const artifactStateColor = computed(() => {
  if (!props.artifact) return "text-[#9a8a78]";
  switch (props.artifact.state) {
    case ArtifactState.CREATING: return "text-amber-600";
    case ArtifactState.READY: return "text-emerald-700";
    case ArtifactState.FAILED: return "text-red-600";
    default: return "text-[#9a8a78]";
  }
});

const artifactTypeName = computed(() => {
  if (!props.artifact) return "";
  return artifactTypeLabels[props.artifact.type] ?? "未知类型";
});

const currentArtifactType = computed<ArtifactTypeValue | null>(() => {
  return props.artifact?.type ?? null;
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTime(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
</script>

<template>
  <section class="h-full min-h-0 flex flex-col overflow-hidden bg-[#f8f3ea] border border-[#d8cfbe] rounded-lg">
    <!-- Toolbar -->
    <div class="shrink-0 px-4 py-3 border-b border-[#e0d5c0] flex items-center gap-3">
      <!-- Back button -->
      <button
        type="button"
        class="flex items-center gap-1 rounded px-2 py-1 text-sm text-[#6a5b49] transition-all duration-100 hover:bg-[#efe7d7] active:scale-95"
        @click="onBack"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="10 3 5 8 10 13" />
        </svg>
        <span>返回列表</span>
      </button>

      <div class="flex-1" />

      <!-- Download .md — only for local reports with content -->
      <button
        v-if="report?.content"
        type="button"
        class="flex items-center gap-1 rounded px-2 py-1 text-sm text-[#6a5b49] transition-all duration-100 hover:bg-[#efe7d7] active:scale-95"
        @click="downloadMarkdown"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 10 8 14 12 10" />
          <line x1="8" y1="2" x2="8" y2="14" />
        </svg>
        <span>下载 .md</span>
      </button>

      <!-- Download MP3 — only for AUDIO with a blob URL -->
      <button
        v-if="artifact && artifact.type === ArtifactType.AUDIO && audioBlobUrl"
        type="button"
        class="flex items-center gap-1 rounded px-2 py-1 text-sm text-[#6a5b49] transition-all duration-100 hover:bg-[#efe7d7] active:scale-95"
        @click="downloadAudio"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 10 8 14 12 10" />
          <line x1="8" y1="2" x2="8" y2="14" />
        </svg>
        <span>下载 MP3</span>
      </button>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- LOCAL REPORT MODE -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-if="report && !isArtifactMode">
      <!-- Report title & metadata -->
      <div class="shrink-0 px-5 pt-4 pb-2">
        <h2
          class="text-lg font-semibold text-[#2f271f] leading-snug"
          style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
        >
          {{ report.title || "未命名报告" }}
        </h2>
        <p v-if="report.generatedAt" class="mt-1 text-xs text-[#9a8a78]">
          生成于 {{ formatTime(report.generatedAt) }}
        </p>
      </div>

      <!-- Markdown content -->
      <div class="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
        <div
          v-if="report.content"
          class="prose-warm"
          v-html="renderedHtml"
        />
        <p v-else class="text-base text-[#9a8a78] leading-relaxed">
          报告内容为空。
        </p>
      </div>
    </template>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- ARTIFACT MODE -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-else-if="artifact && isArtifactMode">
      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        <!-- Status card -->
        <div class="rounded-lg border border-[#ddd3c2] bg-[#fffbf4] px-6 py-5">
          <!-- Type icon + title -->
          <div class="flex items-center gap-3 mb-4">
            <span class="shrink-0 w-8 h-8 rounded-md bg-[#efe7d7] text-[#6a5b49] flex items-center justify-center">
              <!-- REPORT -->
              <svg v-if="currentArtifactType === 1" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="1" width="10" height="14" rx="1" />
                <line x1="5.5" y1="4.5" x2="10.5" y2="4.5" />
                <line x1="5.5" y1="7" x2="10.5" y2="7" />
                <line x1="5.5" y1="9.5" x2="8.5" y2="9.5" />
              </svg>
              <!-- QUIZ -->
              <svg v-else-if="currentArtifactType === 5" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M6 6a2 2 0 013.5 1.5c0 1-1.5 1.2-1.5 2.5" />
                <circle cx="8" cy="12" r="0.5" fill="currentColor" />
              </svg>
              <!-- FLASHCARDS -->
              <svg v-else-if="currentArtifactType === 6" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="10" height="8" rx="1" />
                <rect x="4" y="2" width="10" height="8" rx="1" />
              </svg>
              <!-- MIND_MAP -->
              <svg v-else-if="currentArtifactType === 7" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="2" />
                <line x1="10" y1="8" x2="14" y2="4" />
                <line x1="10" y1="8" x2="14" y2="12" />
                <line x1="6" y1="8" x2="2" y2="6" />
                <line x1="6" y1="8" x2="2" y2="10" />
              </svg>
              <!-- INFOGRAPHIC -->
              <svg v-else-if="currentArtifactType === 8" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="9" width="3" height="5" rx="0.5" />
                <rect x="6.5" y="5" width="3" height="9" rx="0.5" />
                <rect x="11" y="2" width="3" height="12" rx="0.5" />
              </svg>
              <!-- SLIDE_DECK -->
              <svg v-else-if="currentArtifactType === 9" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1.5" y="2" width="13" height="10" rx="1" />
                <line x1="8" y1="12" x2="8" y2="14.5" />
                <line x1="5.5" y1="14.5" x2="10.5" y2="14.5" />
              </svg>
              <!-- AUDIO -->
              <svg v-else-if="currentArtifactType === 10" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6v4h3l4 3V3L6 6H3z" />
                <path d="M12 5.5a3.5 3.5 0 010 5" />
              </svg>
              <!-- VIDEO -->
              <svg v-else-if="currentArtifactType === 11" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1.5" y="3" width="10" height="10" rx="1.5" />
                <polyline points="11.5 6 14.5 4.5 14.5 11.5 11.5 10" />
              </svg>
              <!-- Fallback -->
              <svg v-else width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="6.5" />
                <line x1="8" y1="5" x2="8" y2="8.5" />
                <circle cx="8" cy="11" r="0.5" fill="currentColor" />
              </svg>
            </span>
            <div>
              <h2
                class="text-lg font-semibold text-[#2f271f] leading-snug"
                style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
              >
                {{ artifactTitle }}
              </h2>
              <p class="text-xs text-[#9a8a78] mt-0.5">{{ artifactTypeName }}</p>
            </div>
          </div>

          <!-- State + time -->
          <div class="flex items-center gap-4 text-sm">
            <span :class="artifactStateColor" class="font-medium">{{ artifactStateText }}</span>
            <span v-if="artifact.createdAt" class="text-[#9a8a78] text-xs">
              创建于 {{ formatTime(artifact.createdAt) }}
            </span>
          </div>
        </div>

        <!-- Loading indicator -->
        <div v-if="artifactContentLoading" class="mt-5 text-sm text-[#9a8a78] animate-pulse">
          加载内容…
        </div>

        <!-- ── REPORT content ── -->
        <template v-else-if="artifact.type === ArtifactType.REPORT && artifact.state === ArtifactState.READY">
          <div v-if="fullArtifact?.content" class="mt-5 prose-warm" v-html="artifactRenderedHtml" />
          <p v-else class="mt-5 text-sm text-[#9a8a78]">报告内容为空。</p>
        </template>

        <!-- ── AUDIO preview ── -->
        <template v-else-if="artifact.type === ArtifactType.AUDIO && artifact.state === ArtifactState.READY">
          <div class="mt-5 rounded-lg border border-[#ddd3c2] bg-[#fffbf4] px-5 py-5">
            <p class="text-sm text-[#6a5b49] mb-3 font-medium">音频概述</p>

            <!-- Duration hint -->
            <p v-if="fullArtifact?.duration" class="text-xs text-[#9a8a78] mb-3">
              时长：{{ formatDuration(fullArtifact.duration) }}
            </p>

            <!-- Audio player -->
            <audio
              v-if="audioBlobUrl"
              :src="audioBlobUrl"
              controls
              class="w-full"
              style="accent-color: #6a5b49;"
            />
            <p v-else class="text-sm text-[#9a8a78]">音频数据不可用。</p>
          </div>
        </template>

        <!-- ── QUIZ preview ── -->
        <template v-else-if="artifact.type === ArtifactType.QUIZ && artifact.state === ArtifactState.READY">
          <div class="mt-5">
            <!-- Progress bar -->
            <div v-if="fullArtifact?.questions" class="mb-4 flex items-center gap-3">
              <span class="text-sm text-[#6a5b49] font-medium">
                答对 {{ quizState.correctCount }} / 已答 {{ quizState.answeredCount }} / 共 {{ fullArtifact.questions.length }} 题
              </span>
            </div>

            <!-- Question cards -->
            <div
              v-if="fullArtifact?.questions && fullArtifact.questions.length > 0"
              class="flex flex-col gap-4"
            >
              <div
                v-for="(q, qIdx) in fullArtifact.questions"
                :key="qIdx"
                class="rounded-lg border border-[#ddd3c2] bg-[#fffbf4] px-5 py-4"
              >
                <!-- Question -->
                <p class="text-base text-[#2f271f] leading-relaxed mb-3">
                  <span class="text-xs text-[#9a8a78] mr-2 font-medium">Q{{ qIdx + 1 }}</span>
                  {{ q.question }}
                </p>

                <!-- Options -->
                <div class="flex flex-col gap-2">
                  <button
                    v-for="(opt, optIdx) in q.options"
                    :key="optIdx"
                    type="button"
                    :disabled="quizState.selected[qIdx] !== -1"
                    :class="[
                      'w-full text-left px-4 py-2.5 rounded border text-base leading-relaxed transition-colors duration-150',
                      quizState.selected[qIdx] === -1
                        ? 'border-[#ddd3c2] text-[#2f271f] hover:bg-[#efe7d7] cursor-pointer'
                        : quizState.selected[qIdx] === optIdx
                          ? optIdx === q.correctAnswer
                            ? 'bg-emerald-100 border-emerald-400 text-emerald-900 cursor-default'
                            : 'bg-red-100 border-red-400 text-red-900 cursor-default'
                          : optIdx === q.correctAnswer && quizState.selected[qIdx] !== -1
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800 cursor-default'
                            : 'border-[#ddd3c2] text-[#9a8a78] cursor-default',
                    ]"
                    @click="selectQuizOption(qIdx, optIdx, q.correctAnswer)"
                  >
                    <span class="font-medium mr-2 text-xs">{{ String.fromCharCode(65 + optIdx) }}.</span>
                    {{ opt }}
                  </button>
                </div>

                <!-- Explanation -->
                <p
                  v-if="quizState.selected[qIdx] !== -1 && q.explanation"
                  class="mt-3 text-sm text-[#6a5b49] leading-relaxed border-t border-[#e0d5c0] pt-3"
                >
                  <span class="font-medium">解析：</span>{{ q.explanation }}
                </p>
              </div>
            </div>

            <p v-else class="text-sm text-[#9a8a78]">暂无题目数据。</p>
          </div>
        </template>

        <!-- ── FLASHCARDS preview ── -->
        <template v-else-if="artifact.type === ArtifactType.FLASHCARDS && artifact.state === ArtifactState.READY">
          <div class="mt-5">
            <div v-if="fullArtifact?.flashcards && fullArtifact.flashcards.length > 0">
              <!-- Navigation -->
              <div class="flex items-center justify-between mb-4">
                <span class="text-sm text-[#6a5b49] font-medium">
                  第 {{ flashcardIndex + 1 }} / {{ fullArtifact.flashcards.length }} 张
                </span>
                <div class="flex gap-2">
                  <button
                    type="button"
                    :disabled="flashcardIndex === 0"
                    class="px-3 py-1.5 rounded border border-[#ddd3c2] text-sm text-[#6a5b49] hover:bg-[#efe7d7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
                    @click="prevCard"
                  >
                    上一张
                  </button>
                  <button
                    type="button"
                    :disabled="flashcardIndex === fullArtifact.flashcards.length - 1"
                    class="px-3 py-1.5 rounded border border-[#ddd3c2] text-sm text-[#6a5b49] hover:bg-[#efe7d7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
                    @click="nextCard(fullArtifact!.flashcards!.length)"
                  >
                    下一张
                  </button>
                </div>
              </div>

              <!-- Flip card -->
              <div
                style="perspective: 600px; height: 220px;"
                class="cursor-pointer select-none"
                @click="flipCard(flashcardIndex)"
              >
                <div
                  :style="{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    transformStyle: 'preserve-3d',
                    transition: 'transform 0.45s ease',
                    transform: flashcardFlipped[flashcardIndex] ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  }"
                >
                  <!-- Front (question) -->
                  <div
                    style="
                      position: absolute;
                      inset: 0;
                      backface-visibility: hidden;
                      -webkit-backface-visibility: hidden;
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      justify-content: center;
                      border-radius: 8px;
                      border: 1px solid #ddd3c2;
                      background: #fffbf4;
                      padding: 28px 32px;
                    "
                  >
                    <p class="text-xs text-[#9a8a78] mb-3 uppercase tracking-wide">问题</p>
                    <p class="text-base text-[#2f271f] leading-relaxed text-center">
                      {{ fullArtifact.flashcards[flashcardIndex].question }}
                    </p>
                    <p class="text-xs text-[#c0b09a] mt-4">点击翻转查看答案</p>
                  </div>

                  <!-- Back (answer) -->
                  <div
                    style="
                      position: absolute;
                      inset: 0;
                      backface-visibility: hidden;
                      -webkit-backface-visibility: hidden;
                      transform: rotateY(180deg);
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      justify-content: center;
                      border-radius: 8px;
                      border: 1px solid #b5d1b8;
                      background: #f3faf4;
                      padding: 28px 32px;
                    "
                  >
                    <p class="text-xs text-emerald-600 mb-3 uppercase tracking-wide">答案</p>
                    <p class="text-base text-[#2f271f] leading-relaxed text-center">
                      {{ fullArtifact.flashcards[flashcardIndex].answer }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Dot indicators -->
              <div class="flex justify-center gap-1.5 mt-4">
                <button
                  v-for="(_, i) in fullArtifact.flashcards"
                  :key="i"
                  type="button"
                  :class="[
                    'w-2 h-2 rounded-full transition-colors duration-150',
                    i === flashcardIndex ? 'bg-[#6a5b49]' : 'bg-[#ddd3c2] hover:bg-[#c0b09a]',
                  ]"
                  :aria-label="`跳转到第 ${i + 1} 张`"
                  @click="flashcardIndex = i"
                />
              </div>
            </div>

            <p v-else class="text-sm text-[#9a8a78]">暂无闪卡数据。</p>
          </div>
        </template>

        <!-- ── Non-previewable types (VIDEO, MIND_MAP, INFOGRAPHIC, SLIDE_DECK) ── -->
        <p
          v-else-if="artifact.state === ArtifactState.READY"
          class="mt-5 text-sm text-[#9a8a78] leading-relaxed"
        >
          该产物类型的内容需在 NotebookLM 中查看。
        </p>
      </div>
    </template>

    <!-- Fallback: neither report nor artifact -->
    <template v-else>
      <div class="flex-1 flex items-center justify-center px-6">
        <p class="text-base text-[#9a8a78] leading-relaxed">未选择任何内容。</p>
      </div>
    </template>
  </section>
</template>
