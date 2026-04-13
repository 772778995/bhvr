<script setup lang="ts">
import type { ReportEntry } from "@/api/notebooks";
import ReportDetailPanel from "@/components/notebook-workbench/ReportDetailPanel.vue";

interface Props {
  notebookId: string;
  entry: ReportEntry | null;
}

defineProps<Props>();
</script>

<template>
  <section class="flex h-full min-h-0 flex-col">
    <div v-if="entry" class="min-h-0 flex-1">
      <ReportDetailPanel :notebook-id="notebookId" :entry="entry" />
    </div>
  </section>
</template>
