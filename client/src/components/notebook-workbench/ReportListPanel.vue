<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import {
  type ReportEntry,
  notebooksApi,
} from "@/api/notebooks";
import { useToast } from "@/composables/useToast";

interface Props {
  notebookId: string;
  onSelect: (entryId: string) => void;
  onDelete: (entryId: string) => void;
  onSelectArtifact?: (artifactId: string) => void;
  /** Increment this to trigger a re-fetch. */
  refreshKey?: number;
  /** Called after every successful fetch so the parent can sync its cache. */
  onEntriesLoaded?: (entries: ReportEntry[]) => void;
}

const props = defineProps<Props>();
const { showToast } = useToast();

// ---------------------------------------------------------------------------
// Unified entries (research reports + artifacts from a single endpoint)
// ---------------------------------------------------------------------------

const entries = ref<ReportEntry[]>([]);
const loading = ref(false);

async function fetchEntries() {
  if (!props.notebookId) return;
  loading.value = true;
  try {
    entries.value = await notebooksApi.listEntries(props.notebookId);
    props.onEntriesLoaded?.(entries.value);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast("加载列表失败：" + msg, "error");
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(fetchEntries);
watch(() => props.notebookId, fetchEntries);
watch(() => props.refreshKey, () => { void fetchEntries(); });

// ---------------------------------------------------------------------------
// Unified item model (mapped from ReportEntry)
// ---------------------------------------------------------------------------

interface UnifiedItem {
  id: string;
  kind: "local-report" | "artifact";
  title: string;
  summary: string;
  time: string | null;
  artifactType?: string | null;
  artifactState?: "creating" | "ready" | "failed";
  fileUrl?: string | null;
  contentJson?: Record<string, unknown> | null;
}

function summarize(content: string | null | undefined, maxLen = 100): string {
  if (!content) return "（无内容）";
  const plain = content.replace(/[#*`>\-\[\]()!|]/g, "").trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}

const artifactTypeLabels: Record<string, string> = {
  unknown: "未知类型",
  report: "文档摘要",
  quiz: "测验",
  flashcards: "闪卡",
  mind_map: "思维导图",
  infographic: "信息图",
  slide_deck: "幻灯片",
  audio: "音频概述",
  video: "视频概述",
};

const artifactStateLabels: Record<string, string> = {
  creating: "生成中…",
  ready: "已就绪",
  failed: "生成失败",
};

// Map artifact type string → legacy numeric value (for SVG icon switching)
const artifactTypeToNum: Record<string, number> = {
  report: 1, quiz: 5, flashcards: 6, mind_map: 7, infographic: 8, slide_deck: 9, audio: 10, video: 11,
};

const unifiedItems = computed<UnifiedItem[]>(() => {
  return entries.value.map((e) => {
    if (e.entryType === "research_report") {
      return {
        id: e.id,
        kind: "local-report" as const,
        title: e.title || "未命名报告",
        summary: summarize(e.content),
        time: e.createdAt,
      };
    } else {
      const typeLabel = e.artifactType ? (artifactTypeLabels[e.artifactType] ?? "未知类型") : "未知类型";
      const stateLabel = e.state ? (artifactStateLabels[e.state] ?? "未知状态") : "未知状态";
      return {
        id: e.id,
        kind: "artifact" as const,
        title: e.title || typeLabel,
        summary: stateLabel,
        time: e.createdAt,
        artifactType: e.artifactType,
        artifactState: e.state,
        fileUrl: e.fileUrl,
        contentJson: e.contentJson,
      };
    }
  });
});

const isEmpty = computed(() => unifiedItems.value.length === 0 && !loading.value);

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function onItemClick(item: UnifiedItem) {
  if (item.kind === "local-report") {
    props.onSelect(item.id);
  } else if (props.onSelectArtifact && item.artifactType) {
    // Pass the local entry ID so the detail panel can fetch from unified endpoint
    props.onSelectArtifact(item.id);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTime(raw: string | null): string {
  if (!raw) return "未知时间";
  try {
    return new Date(raw).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// State dot color
// ---------------------------------------------------------------------------

function stateDotClass(item: UnifiedItem): string {
  if (item.kind !== "artifact") return "";
  switch (item.artifactState) {
    case "creating": return "bg-amber-500";
    case "ready": return "bg-emerald-600";
    case "failed": return "bg-red-500";
    default: return "bg-[#9a8a78]";
  }
}

// Map artifact type string → numeric for SVG icon
function artifactTypeNum(type: string | null | undefined): number {
  if (!type) return 0;
  return artifactTypeToNum[type] ?? 0;
}
</script>

<template>
  <section class="h-full min-h-0 flex flex-col overflow-hidden bg-[#f8f3ea] border border-[#d8cfbe] rounded-lg">
    <!-- Header -->
    <div class="shrink-0 px-5 pt-4 pb-3 border-b border-[#e0d5c0]">
      <h2
        class="text-lg font-semibold text-[#2f271f]"
        style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
      >
        报告与产物
      </h2>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading && unifiedItems.length === 0" class="flex-1 flex items-center justify-center px-6">
      <p class="text-sm text-[#9a8a78] animate-pulse">加载中…</p>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="isEmpty"
      class="flex-1 flex items-center justify-center px-6"
    >
      <p class="text-base leading-relaxed text-[#9a8a78] text-center">
        暂无报告或产物。在右侧 Studio 面板生成内容。
      </p>
    </div>

    <!-- Unified item list -->
    <TransitionGroup
      v-else
      tag="ul"
      class="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
    >
      <li
        v-for="item in unifiedItems"
        :key="item.kind + ':' + item.id"
        class="group relative rounded-md border border-[#ddd3c2] bg-[#fffbf4] px-4 py-3 cursor-pointer transition-all duration-100 hover:border-[#c4b89a] hover:bg-[#f5eed8]"
        @click="onItemClick(item)"
      >
        <!-- Title row -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <!-- Icon -->
            <span class="shrink-0 w-5 h-5 text-[#8a7b68] flex items-center justify-center" aria-hidden="true">
              <!-- Local report icon: book page -->
              <svg v-if="item.kind === 'local-report'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 2h8a2 2 0 012 2v8a2 2 0 01-2 2H3V2z" />
                <line x1="6" y1="5" x2="10" y2="5" />
                <line x1="6" y1="8" x2="10" y2="8" />
                <line x1="6" y1="11" x2="8" y2="11" />
              </svg>
              <!-- Artifact: REPORT -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 1" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="1" width="10" height="14" rx="1" />
                <line x1="5.5" y1="4.5" x2="10.5" y2="4.5" />
                <line x1="5.5" y1="7" x2="10.5" y2="7" />
                <line x1="5.5" y1="9.5" x2="8.5" y2="9.5" />
              </svg>
              <!-- Artifact: QUIZ -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 5" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M6 6a2 2 0 013.5 1.5c0 1-1.5 1.2-1.5 2.5" />
                <circle cx="8" cy="12" r="0.5" fill="currentColor" />
              </svg>
              <!-- Artifact: FLASHCARDS -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 6" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="10" height="8" rx="1" />
                <rect x="4" y="2" width="10" height="8" rx="1" />
              </svg>
              <!-- Artifact: MIND_MAP -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 7" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="2" />
                <line x1="10" y1="8" x2="14" y2="4" />
                <line x1="10" y1="8" x2="14" y2="12" />
                <line x1="6" y1="8" x2="2" y2="6" />
                <line x1="6" y1="8" x2="2" y2="10" />
              </svg>
              <!-- Artifact: INFOGRAPHIC -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 8" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="9" width="3" height="5" rx="0.5" />
                <rect x="6.5" y="5" width="3" height="9" rx="0.5" />
                <rect x="11" y="2" width="3" height="12" rx="0.5" />
              </svg>
              <!-- Artifact: SLIDE_DECK -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 9" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1.5" y="2" width="13" height="10" rx="1" />
                <line x1="8" y1="12" x2="8" y2="14.5" />
                <line x1="5.5" y1="14.5" x2="10.5" y2="14.5" />
              </svg>
              <!-- Artifact: AUDIO -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 10" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6v4h3l4 3V3L6 6H3z" />
                <path d="M12 5.5a3.5 3.5 0 010 5" />
              </svg>
              <!-- Artifact: VIDEO -->
              <svg v-else-if="artifactTypeNum(item.artifactType) === 11" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1.5" y="3" width="10" height="10" rx="1.5" />
                <polyline points="11.5 6 14.5 4.5 14.5 11.5 11.5 10" />
              </svg>
              <!-- Fallback -->
              <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="6.5" />
                <line x1="8" y1="5" x2="8" y2="8.5" />
                <circle cx="8" cy="11" r="0.5" fill="currentColor" />
              </svg>
            </span>

            <h3
              class="text-base font-medium text-[#2f271f] leading-snug truncate flex-1"
              style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
            >
              {{ item.title }}
            </h3>
          </div>

          <!-- Delete button -->
          <button
            type="button"
            class="shrink-0 opacity-0 group-hover:opacity-100 rounded p-1 text-[#9a8a78] transition-all duration-100 hover:text-[#b33c2a] hover:bg-[#f4ddd6]"
            title="删除"
            @click.stop="onDelete(item.id)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        <!-- Summary / state -->
        <p class="mt-1.5 text-sm leading-relaxed text-[#6f6354] line-clamp-2">
          <template v-if="item.kind === 'artifact'">
            <span
              class="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
              :class="stateDotClass(item)"
            />
          </template>
          {{ item.summary }}
        </p>

        <!-- Time -->
        <p class="mt-1.5 text-xs text-[#9a8a78]">
          {{ formatTime(item.time) }}
        </p>
      </li>
    </TransitionGroup>
  </section>
</template>
