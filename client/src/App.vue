<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const isNotebookWorkbenchRoute = computed(() => route.name === "notebook-workbench");
</script>

<template>
  <div :class="isNotebookWorkbenchRoute ? 'h-screen overflow-hidden bg-gray-50' : 'min-h-screen bg-gray-50'">
    <header v-if="!isNotebookWorkbenchRoute" class="bg-white border-b border-gray-200">
      <div class="max-w-4xl mx-auto px-4 py-4">
        <router-link to="/" class="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors">
          NotebookLM 自动化研究引擎
        </router-link>
      </div>
    </header>
    <main :class="isNotebookWorkbenchRoute ? 'h-full overflow-hidden' : 'max-w-4xl mx-auto px-4 py-6'">
      <RouterView />
    </main>
  </div>
</template>
