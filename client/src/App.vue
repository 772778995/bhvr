<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const isNotebookWorkbenchRoute = computed(() => route.name === "notebook-workbench");
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header v-if="!isNotebookWorkbenchRoute" class="bg-white border-b border-gray-200">
      <div class="max-w-4xl mx-auto px-4 py-4">
        <router-link to="/" class="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors">
          NotebookLM Research Engine
        </router-link>
      </div>
    </header>
    <main :class="isNotebookWorkbenchRoute ? 'min-h-screen' : 'max-w-4xl mx-auto px-4 py-6'">
      <RouterView />
    </main>
  </div>
</template>
