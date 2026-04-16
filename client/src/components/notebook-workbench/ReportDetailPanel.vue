<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  type ReportEntry,
  type QuizQuestion,
  type FlashcardPair,
  ArtifactType,
  notebooksApi,
} from "@/api/notebooks";
import { renderMarkdown } from "@/utils/markdown";
import { getAudioPlayerKey } from "./report-detail-audio";
import {
  isBookMindmapReportEntry,
  resolveReportDetailContentRequest,
  shouldRenderResearchReportMarkdown,
} from "./report-detail-content";
import BookMindmapMermaid from "@/components/book-workbench/BookMindmapMermaid.vue";

interface Props {
  notebookId: string;
  entry?: ReportEntry;
  onBack?: () => void;
  compact?: boolean;
}

const props = defineProps<Props>();
const activeEntry = computed(() => props.entry);

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

const isResearchReport = computed(() => props.entry?.entryType === 'research_report');
const isArtifact = computed(() => props.entry?.entryType === 'artifact');
const isBookMindmapReport = computed(() => isBookMindmapReportEntry(props.entry));
const hasMermaidMindmapJson = computed(() =>
  isBookMindmapReport.value && props.entry?.contentJson?.kind === "mermaid_mindmap"
);

const mermaidMindmapCode = computed<string | null>(() => {
  if (!hasMermaidMindmapJson.value) return null;
  const payload = activeEntry.value?.contentJson as Record<string, unknown> | undefined;
  if (!payload || typeof payload.code !== "string") return null;
  return payload.code;
});

const mermaidMindmapTitle = computed<string | undefined>(() => {
  if (!hasMermaidMindmapJson.value) return undefined;
  return activeEntry.value?.title ?? undefined;
});

// ---------------------------------------------------------------------------
// Artifact type mapping: string → numeric ArtifactType
// ---------------------------------------------------------------------------

const ARTIFACT_TYPE_STR_TO_NUM: Record<string, number> = {
  audio: ArtifactType.AUDIO,
  video: ArtifactType.VIDEO,
  slide_deck: ArtifactType.SLIDE_DECK,
  mind_map: ArtifactType.MIND_MAP,
  report: ArtifactType.REPORT,
  flashcards: ArtifactType.FLASHCARDS,
  quiz: ArtifactType.QUIZ,
  infographic: ArtifactType.INFOGRAPHIC,
};

const currentArtifactType = computed(() => {
  return ARTIFACT_TYPE_STR_TO_NUM[activeEntry.value?.artifactType ?? ''] ?? 0;
});

// ---------------------------------------------------------------------------
// Research report: on-demand content fetching
// ---------------------------------------------------------------------------

/** Cache fetched markdown keyed by entry ID to avoid redundant requests.
 *  Cleared when notebookId changes (see watch below). */
const contentCache = new Map<string, string>();
const fetchedContent = ref<string | null>(null);
const contentLoading = ref(false);
const contentError = ref(false);

// Clear cache when switching notebooks to avoid stale data from a different notebook
watch(
  () => props.notebookId,
  () => { contentCache.clear(); },
);

watch(
  () => props.entry?.id,
  async (newId) => {
    // Reset for every entry change
    fetchedContent.value = null;
    contentLoading.value = false;
    contentError.value = false;

    if (!newId) return;

    const request = resolveReportDetailContentRequest(activeEntry.value, contentCache, notebooksApi.fetchEntryContent);
    if (request.kind === "skip") {
      return;
    }

    if (request.kind === "inline" || request.kind === "cache") {
      fetchedContent.value = request.content;
      return;
    }

    contentLoading.value = true;
    try {
      const text = await request.load();
      // Guard: entry may have changed while awaiting
      if (props.entry?.id === newId) {
        fetchedContent.value = text;
      }
    } catch {
      // Mark as error so template can distinguish from "empty content"
      if (props.entry?.id === newId) {
        contentError.value = true;
      }
    } finally {
      if (props.entry?.id === newId) {
        contentLoading.value = false;
      }
    }
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Research report rendering
// ---------------------------------------------------------------------------

const renderedHtml = computed(() => {
  if (!fetchedContent.value) return "";
  return renderMarkdown(fetchedContent.value);
});

/** True when the current entry has loadable markdown content (research report OR report artifact). */
// ---------------------------------------------------------------------------
// Artifact: rendered HTML for REPORT-type artifacts
// ---------------------------------------------------------------------------

const artifactRenderedHtml = computed(() => {
  // Prefer fetchedContent (loaded from fileUrl) over legacy inline contentJson
  const md = fetchedContent.value ?? (activeEntry.value?.contentJson?.content as string | undefined);
  if (typeof md !== "string" || !md) return "";
  return renderMarkdown(md);
});

// ---------------------------------------------------------------------------
// Artifact: AUDIO
// ---------------------------------------------------------------------------

const audioSrc = computed(() => activeEntry.value?.fileUrl ?? null);

const audioPlayerKey = computed(() => getAudioPlayerKey({
  id: activeEntry.value?.id,
  fileUrl: activeEntry.value?.fileUrl,
  updatedAt: activeEntry.value?.updatedAt,
}));

const isAudioArtifact = computed(() => currentArtifactType.value === ArtifactType.AUDIO);

function downloadAudio() {
  const src = activeEntry.value?.fileUrl;
  if (!src) return;
  const a = document.createElement("a");
  a.href = src;
  const title = activeEntry.value?.title || "audio";
  a.download = title + ".mp3";
  a.click();
}

// ---------------------------------------------------------------------------
// QUIZ: interaction state
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// FLASHCARDS: navigation + flip state
// ---------------------------------------------------------------------------

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
// Watch entry changes to initialize quiz / flashcard state
// ---------------------------------------------------------------------------

const quizQuestions = computed(() => {
  if (currentArtifactType.value !== ArtifactType.QUIZ) return null;
  const q = props.entry?.contentJson?.questions;
  return Array.isArray(q) ? (q as QuizQuestion[]) : null;
});

const flashcards = computed(() => {
  if (currentArtifactType.value !== ArtifactType.FLASHCARDS) return null;
  const f = props.entry?.contentJson?.flashcards;
  return Array.isArray(f) ? (f as FlashcardPair[]) : null;
});

watch(
  () => props.entry?.id,
  () => {
    if (quizQuestions.value) {
      initQuizState(quizQuestions.value);
    }
    if (flashcards.value) {
      initFlashcards(flashcards.value.length);
    }
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Artifact type labels & state labels
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

const artifactStateLabels: Record<string, string> = {
  creating: "生成中…",
  ready: "已就绪",
  failed: "生成失败",
};

const artifactTitle = computed(() => {
  if (!activeEntry.value) return "";
  return activeEntry.value.title || (artifactTypeLabels[currentArtifactType.value] ?? "未知类型");
});

const artifactStateText = computed(() => {
  if (!activeEntry.value) return "";
  return artifactStateLabels[activeEntry.value.state] ?? "未知状态";
});

const artifactStateColor = computed(() => {
  if (!activeEntry.value) return "text-[#9a8a78]";
  switch (activeEntry.value.state) {
    case "creating": return "text-amber-600";
    case "ready": return "text-emerald-700";
    case "failed": return "text-red-600";
    default: return "text-[#9a8a78]";
  }
});

const artifactTypeName = computed(() => {
  return artifactTypeLabels[currentArtifactType.value] ?? "未知类型";
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
  <section class="h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#f8f3ea]">
    <!-- ════════════════════════════════════════════════════════ -->
    <!-- RESEARCH REPORT MODE -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-if="entry && isResearchReport">
      <div :class="compact ? 'min-h-0 min-w-0 flex-1 overflow-y-auto' : 'min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5'">
        <BookMindmapMermaid
          v-if="isBookMindmapReport && hasMermaidMindmapJson && mermaidMindmapCode"
          :code="mermaidMindmapCode"
          :title="mermaidMindmapTitle"
          :compact="compact"
        />
        <p v-else-if="contentLoading" class="text-base text-[#9a8a78] leading-relaxed italic">
          正在加载报告内容…
        </p>
        <p v-else-if="contentError" class="text-base text-red-700 leading-relaxed">
          报告内容加载失败，请刷新页面重试。
        </p>
        <div
          v-else-if="shouldRenderResearchReportMarkdown(entry, fetchedContent)"
          class="min-w-0 max-w-full prose-warm"
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
    <template v-else-if="entry && isArtifact">
      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5">
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
            <button
              v-if="isAudioArtifact && audioSrc"
              type="button"
              class="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-[#6a5b49] transition-all duration-100 hover:bg-[#efe7d7] active:scale-95"
              @click="downloadAudio"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 10 8 14 12 10" />
                <line x1="8" y1="2" x2="8" y2="14" />
              </svg>
              <span>下载 MP3</span>
            </button>
          </div>

          <!-- State + time -->
          <div class="flex items-center gap-4 text-sm">
            <span :class="artifactStateColor" class="font-medium">{{ artifactStateText }}</span>
            <span v-if="entry.createdAt" class="text-[#9a8a78] text-xs">
              创建于 {{ formatTime(entry.createdAt) }}
            </span>
          </div>
        </div>

        <!-- ── REPORT content ── -->
        <template v-if="currentArtifactType === ArtifactType.REPORT && entry.state === 'ready'">
          <p v-if="contentLoading" class="mt-5 text-sm text-[#9a8a78] italic">正在加载报告内容…</p>
          <p v-else-if="contentError" class="mt-5 text-sm text-red-700">报告内容加载失败，请刷新页面重试。</p>
          <div v-else-if="artifactRenderedHtml" class="mt-5 min-w-0 max-w-full prose-warm" v-html="artifactRenderedHtml" />
          <p v-else class="mt-5 text-sm text-[#9a8a78]">报告内容为空。</p>
        </template>

        <!-- ── AUDIO preview ── -->
        <template v-else-if="currentArtifactType === ArtifactType.AUDIO && entry.state === 'ready'">
          <div class="mt-5 rounded-lg border border-[#ddd3c2] bg-[#fffbf4] px-5 py-5">
            <p class="text-sm text-[#6a5b49] mb-3 font-medium">音频概述</p>

            <!-- Duration hint -->
            <p v-if="entry.contentJson?.duration" class="text-xs text-[#9a8a78] mb-3">
              时长：{{ formatDuration(entry.contentJson.duration as number | undefined) }}
            </p>

            <!-- Audio player -->
            <audio
              v-if="audioSrc"
              :key="audioPlayerKey"
              :src="audioSrc"
              controls
              class="w-full"
              style="accent-color: #6a5b49;"
            />
            <p v-else class="text-sm text-[#9a8a78]">音频文件尚未就绪或生成失败。</p>
          </div>
        </template>

        <!-- ── QUIZ preview ── -->
        <template v-else-if="currentArtifactType === ArtifactType.QUIZ && entry.state === 'ready'">
          <div class="mt-5">
            <!-- Progress bar -->
            <div v-if="quizQuestions" class="mb-4 flex items-center gap-3">
              <span class="text-sm text-[#6a5b49] font-medium">
                答对 {{ quizState.correctCount }} / 已答 {{ quizState.answeredCount }} / 共 {{ quizQuestions.length }} 题
              </span>
            </div>

            <!-- Question cards -->
            <div
              v-if="quizQuestions && quizQuestions.length > 0"
              class="flex flex-col gap-4"
            >
              <div
                v-for="(q, qIdx) in quizQuestions"
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
        <template v-else-if="currentArtifactType === ArtifactType.FLASHCARDS && entry.state === 'ready'">
          <div class="mt-5">
            <div v-if="flashcards && flashcards.length > 0">
              <!-- Navigation -->
              <div class="flex items-center justify-between mb-4">
                <span class="text-sm text-[#6a5b49] font-medium">
                  第 {{ flashcardIndex + 1 }} / {{ flashcards.length }} 张
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
                    :disabled="flashcardIndex === flashcards.length - 1"
                    class="px-3 py-1.5 rounded border border-[#ddd3c2] text-sm text-[#6a5b49] hover:bg-[#efe7d7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
                    @click="nextCard(flashcards.length)"
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
                      {{ flashcards[flashcardIndex].question }}
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
                      {{ flashcards[flashcardIndex].answer }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Dot indicators -->
              <div class="flex justify-center gap-1.5 mt-4">
                <button
                  v-for="(_, i) in flashcards"
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
        <template v-else-if="entry.state === 'ready'">
          <!-- Slides/PDF: if server has saved the file, show a download button -->
          <div v-if="entry.fileUrl && currentArtifactType === ArtifactType.SLIDE_DECK" class="mt-5 rounded-lg border border-[#ddd3c2] bg-[#fffbf4] px-5 py-5">
            <p class="text-sm text-[#6a5b49] mb-3 font-medium">幻灯片文档</p>
            <a
              :href="entry.fileUrl"
              download
              class="inline-flex items-center gap-1.5 rounded px-4 py-2 text-sm font-medium text-[#6a5b49] border border-[#ddd3c2] hover:bg-[#efe7d7] transition-colors duration-100"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 10 8 14 12 10" />
                <line x1="8" y1="2" x2="8" y2="14" />
              </svg>
              下载 PDF
            </a>
          </div>
          <p v-else class="mt-5 text-sm text-[#9a8a78] leading-relaxed">
            该产物类型的内容需在 NotebookLM 中查看。
          </p>
        </template>
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
