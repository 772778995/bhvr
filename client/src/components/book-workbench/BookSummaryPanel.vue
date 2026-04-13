<script setup lang="ts">
import type { ReportEntry } from "@/api/notebooks";
import BookSummaryListPanel from "@/components/book-workbench/BookSummaryListPanel.vue";
import ReportDetailPanel from "@/components/notebook-workbench/ReportDetailPanel.vue";

interface Props {
  notebookId: string;
  entries: ReportEntry[];
  entry: ReportEntry | null;
  onSelectEntry: (entryId: string) => void;
}

defineProps<Props>();
</script>

<template>
  <section class="flex h-full min-h-0 border border-[#d8cfbe] bg-[#fbf6ed]">
    <BookSummaryListPanel
      :entries="entries"
      :selected-entry-id="entry?.id ?? null"
      :on-select="onSelectEntry"
    />

    <div class="min-h-0 flex-1">
      <ReportDetailPanel v-if="entry" :notebook-id="notebookId" :entry="entry" />
      <div v-else class="flex h-full items-center justify-center px-6 text-base leading-7 text-[#8a7864]">
        先从左侧列表选择一份书籍总结。
      </div>
    </div>
  </section>
</template>
