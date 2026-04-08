<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  type NotebookReport,
  type Artifact,
  type ArtifactTypeValue,
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
// Artifact detail: fetch full content for REPORT type
// ---------------------------------------------------------------------------

const artifactContent = ref<string | null>(null);
const artifactContentLoading = ref(false);

const artifactRenderedHtml = computed(() => {
  if (!artifactContent.value) return "";
  return renderMarkdown(artifactContent.value);
});

async function fetchArtifactContent() {
  artifactContent.value = null;
  if (!props.artifact) return;
  if (props.artifact.type !== ArtifactType.REPORT) return;
  if (props.artifact.state !== ArtifactState.READY) return;

  artifactContentLoading.value = true;
  try {
    const full = await notebooksApi.getArtifact(props.notebookId, props.artifact.artifactId);
    // The full artifact may carry a `content` field (not in the base type, but returned by the API)
    const anyFull = full as Artifact & { content?: string };
    if (anyFull.content) {
      artifactContent.value = anyFull.content;
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

      <!-- Download button — only for local reports with content -->
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

        <!-- Content for REPORT type -->
        <template v-if="artifact.type === 1 && artifact.state === 2">
          <div v-if="artifactContentLoading" class="mt-5 text-sm text-[#9a8a78] animate-pulse">
            加载报告内容…
          </div>
          <div v-else-if="artifactContent" class="mt-5 prose-warm" v-html="artifactRenderedHtml" />
        </template>

        <!-- Informational note for non-content types -->
        <p
          v-if="artifact.type !== 1 && artifact.state === 2"
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
