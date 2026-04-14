<script setup lang="ts">
import type { ReportEntry } from "@/api/notebooks";
import BookSummaryListPanel from "@/components/book-workbench/BookSummaryListPanel.vue";
import ReportDetailPanel from "@/components/notebook-workbench/ReportDetailPanel.vue";
import { getBookDetailTransition } from "@/views/book-motion";
import { getBookSummaryDetailLayout } from "./book-layout";

interface Props {
  notebookId: string;
  entries: ReportEntry[];
  entry: ReportEntry | null;
  onSelectEntry: (entryId: string) => void;
}

defineProps<Props>();

const layout = getBookSummaryDetailLayout();
const detailTransition = getBookDetailTransition();
</script>

<template>
  <section :class="layout.shellClass">
    <BookSummaryListPanel
      :entries="entries"
      :selected-entry-id="entry?.id ?? null"
      :on-select="onSelectEntry"
    />

    <div :class="layout.detailPaneClass">
      <Transition :name="layout.detailTransitionName" mode="out-in">
        <ReportDetailPanel
          v-if="entry"
          :key="entry.id"
          :notebook-id="notebookId"
          :entry="entry"
        />
        <div v-else key="empty" class="flex h-full items-center justify-center px-6 text-base leading-7 text-[#8a7864]">
          先从左侧列表选择一份书籍总结。
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.folio-note-enter-active {
  transition: opacity v-bind('`${detailTransition.durationEnterMs}ms`') ease-out,
    transform v-bind('`${detailTransition.durationEnterMs}ms`') ease-out;
}

.folio-note-leave-active {
  transition: opacity v-bind('`${detailTransition.durationLeaveMs}ms`') ease-in,
    transform v-bind('`${detailTransition.durationLeaveMs}ms`') ease-in;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.folio-note-enter-from {
  opacity: 0;
  transform: translate3d(v-bind('`${detailTransition.enterX}px`'), v-bind('`${detailTransition.enterY}px`'), 0);
}

.folio-note-leave-to {
  opacity: 0;
  transform: translate3d(v-bind('`${detailTransition.leaveX}px`'), 0, 0);
}
</style>
