<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const isNotebookWorkbenchRoute = computed(() => route.name === "notebook-workbench");
</script>

<template>
  <div :class="isNotebookWorkbenchRoute ? 'workbench-layout' : 'default-layout'">
    <header v-if="!isNotebookWorkbenchRoute" class="app-header">
      <div class="header-inner">
        <router-link to="/" class="brand-link">
          <span class="brand-mark">◈</span>
          <span class="brand-name">NotebookLM 研究引擎</span>
        </router-link>
      </div>
    </header>
    <main :class="isNotebookWorkbenchRoute ? 'workbench-main' : 'default-main'">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.default-layout {
  min-height: 100vh;
  background-color: #efe5d6;
}

.workbench-layout {
  height: 100vh;
  overflow: hidden;
  background-color: #e9dfcf;
}

/* ─── 顶部导航 ────────────────────────────────────── */
.app-header {
  background-color: #efe5d6;
  border-bottom: 1px solid rgba(47, 39, 31, 0.18);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 52px;
  display: flex;
  align-items: center;
}

.brand-link {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  color: #2f271f;
  transition: opacity 0.15s ease;
}

.brand-link:hover {
  opacity: 0.7;
}

.brand-mark {
  font-size: 1rem;
  opacity: 0.6;
  line-height: 1;
}

.brand-name {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
}

/* ─── 主内容区 ───────────────────────────────────── */
.default-main {
  /* 内容由页面组件自己控制版心 */
}

.workbench-main {
  height: 100%;
  overflow: hidden;
}
</style>
