<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import {
  type NotebookReport,
  type Artifact,
  type ArtifactTypeValue,
  type ArtifactStateValue,
  ArtifactType,
  ArtifactState,
  notebooksApi,
} from "@/api/notebooks";
import { useToast } from "@/composables/useToast";

interface Props {
  notebookId: string;
  reports: NotebookReport[];
  onSelect: (reportId: string) => void;
  onDelete: (reportId: string) => void;
  onSelectArtifact?: (artifactId: string) => void;
  /** Increment this to trigger a re-fetch of the SDK artifact list. */
  refreshKey?: number;
}

const props = defineProps<Props>();
const { showToast } = useToast();

// ---------------------------------------------------------------------------
// SDK artifacts
// ---------------------------------------------------------------------------

const artifacts = ref<Artifact[]>([]);
const loadingArtifacts = ref(false);

async function fetchArtifacts() {
  if (!props.notebookId) return;
  loadingArtifacts.value = true;
  try {
    artifacts.value = await notebooksApi.listArtifacts(props.notebookId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast("加载 artifact 列表失败：" + msg, "error");
    artifacts.value = [];
  } finally {
    loadingArtifacts.value = false;
  }
}

onMounted(fetchArtifacts);
watch(() => props.notebookId, fetchArtifacts);
watch(() => props.refreshKey, () => { void fetchArtifacts(); });

// ---------------------------------------------------------------------------
// Unified item model
// ---------------------------------------------------------------------------

interface UnifiedItem {
  id: string;
  kind: "local-report" | "artifact";
  title: string;
  summary: string;
  time: string | null;
  artifactType?: ArtifactTypeValue;
  artifactState?: ArtifactStateValue;
}

function summarize(content: string | null, maxLen = 100): string {
  if (!content) return "（无内容）";
  const plain = content.replace(/[#*`>\-\[\]()!|]/g, "").trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}

// ---------------------------------------------------------------------------
// Artifact type labels & state labels
// ---------------------------------------------------------------------------

const artifactTypeLabels: Record<number, string> = {
  [ArtifactType.UNKNOWN]: "未知类型",
  [ArtifactType.REPORT]: "文档摘要",
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

function artifactTypeLabel(type: ArtifactTypeValue): string {
  return artifactTypeLabels[type] ?? "未知类型";
}

function artifactStateLabel(state: ArtifactStateValue): string {
  return artifactStateLabels[state] ?? "未知状态";
}

// ---------------------------------------------------------------------------
// Merge + sort
// ---------------------------------------------------------------------------

const unifiedItems = computed<UnifiedItem[]>(() => {
  const localItems: UnifiedItem[] = props.reports.map((r) => ({
    id: r.id,
    kind: "local-report" as const,
    title: r.title || "未命名报告",
    summary: summarize(r.content),
    time: r.generatedAt,
  }));

  const sdkItems: UnifiedItem[] = artifacts.value.map((a) => ({
    id: a.artifactId,
    kind: "artifact" as const,
    title: a.title || artifactTypeLabel(a.type),
    summary: artifactStateLabel(a.state),
    time: a.createdAt ?? null,
    artifactType: a.type,
    artifactState: a.state,
  }));

  return [...localItems, ...sdkItems].sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return tb - ta; // descending
  });
});

const isEmpty = computed(() => unifiedItems.value.length === 0 && !loadingArtifacts.value);

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function onItemClick(item: UnifiedItem) {
  if (item.kind === "local-report") {
    props.onSelect(item.id);
  } else if (props.onSelectArtifact) {
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
    case ArtifactState.CREATING: return "bg-amber-500";
    case ArtifactState.READY: return "bg-emerald-600";
    case ArtifactState.FAILED: return "bg-red-500";
    default: return "bg-[#9a8a78]";
  }
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
    <div v-if="loadingArtifacts && unifiedItems.length === 0" class="flex-1 flex items-center justify-center px-6">
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
              <svg v-else-if="item.artifactType === 1" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="1" width="10" height="14" rx="1" />
                <line x1="5.5" y1="4.5" x2="10.5" y2="4.5" />
                <line x1="5.5" y1="7" x2="10.5" y2="7" />
                <line x1="5.5" y1="9.5" x2="8.5" y2="9.5" />
              </svg>
              <!-- Artifact: QUIZ -->
              <svg v-else-if="item.artifactType === 5" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M6 6a2 2 0 013.5 1.5c0 1-1.5 1.2-1.5 2.5" />
                <circle cx="8" cy="12" r="0.5" fill="currentColor" />
              </svg>
              <!-- Artifact: FLASHCARDS -->
              <svg v-else-if="item.artifactType === 6" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="10" height="8" rx="1" />
                <rect x="4" y="2" width="10" height="8" rx="1" />
              </svg>
              <!-- Artifact: MIND_MAP -->
              <svg v-else-if="item.artifactType === 7" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="2" />
                <line x1="10" y1="8" x2="14" y2="4" />
                <line x1="10" y1="8" x2="14" y2="12" />
                <line x1="6" y1="8" x2="2" y2="6" />
                <line x1="6" y1="8" x2="2" y2="10" />
              </svg>
              <!-- Artifact: INFOGRAPHIC -->
              <svg v-else-if="item.artifactType === 8" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="9" width="3" height="5" rx="0.5" />
                <rect x="6.5" y="5" width="3" height="9" rx="0.5" />
                <rect x="11" y="2" width="3" height="12" rx="0.5" />
              </svg>
              <!-- Artifact: SLIDE_DECK -->
              <svg v-else-if="item.artifactType === 9" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1.5" y="2" width="13" height="10" rx="1" />
                <line x1="8" y1="12" x2="8" y2="14.5" />
                <line x1="5.5" y1="14.5" x2="10.5" y2="14.5" />
              </svg>
              <!-- Artifact: AUDIO -->
              <svg v-else-if="item.artifactType === 10" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6v4h3l4 3V3L6 6H3z" />
                <path d="M12 5.5a3.5 3.5 0 010 5" />
              </svg>
              <!-- Artifact: VIDEO -->
              <svg v-else-if="item.artifactType === 11" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
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

          <!-- Delete button — only for local reports -->
          <button
            v-if="item.kind === 'local-report'"
            type="button"
            class="shrink-0 opacity-0 group-hover:opacity-100 rounded p-1 text-[#9a8a78] transition-all duration-100 hover:text-[#b33c2a] hover:bg-[#f4ddd6]"
            title="删除报告"
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
