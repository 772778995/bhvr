<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import { isWorkbenchRouteName } from "@/router/navigation";
import { getRouteTransition } from "@/router/route-motion";

const route = useRoute();
const isWorkbenchRoute = computed(() => isWorkbenchRouteName(route.name));
const routeTransition = computed(() => getRouteTransition({
  to: typeof route.name === "string" ? route.name : null,
}));
</script>

<template>
  <div :class="isWorkbenchRoute ? 'workbench-layout' : 'default-layout'">
    <header v-if="!isWorkbenchRoute" class="app-header">
      <div class="header-inner">
        <router-link to="/" class="brand-link">
          <span class="brand-mark">◈</span>
          <span class="brand-name">锐捷管理参谋</span>
        </router-link>
      </div>
    </header>
    <main :class="isWorkbenchRoute ? 'workbench-main' : 'default-main'">
      <RouterView v-slot="{ Component, route: activeRoute }">
        <Transition :name="routeTransition.name" mode="out-in">
          <component :is="Component" :key="activeRoute.fullPath" />
        </Transition>
      </RouterView>
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
  max-width: 960px;
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

:deep(.paper-route-enter-active) {
  transition: opacity v-bind('`${routeTransition.durationEnterMs}ms`') ease-out,
    transform v-bind('`${routeTransition.durationEnterMs}ms`') ease-out,
    filter v-bind('`${routeTransition.durationEnterMs}ms`') ease-out;
}

:deep(.paper-route-leave-active) {
  transition: opacity v-bind('`${routeTransition.durationLeaveMs}ms`') ease-in,
    transform v-bind('`${routeTransition.durationLeaveMs}ms`') ease-in,
    filter v-bind('`${routeTransition.durationLeaveMs}ms`') ease-in;
}

:deep(.paper-route-enter-from) {
  opacity: 0;
  transform: translate3d(0, v-bind('`${routeTransition.enterY}px`'), 0);
  filter: saturate(0.96);
}

:deep(.paper-route-leave-to) {
  opacity: 0;
  transform: translate3d(0, v-bind('`${routeTransition.leaveY}px`'), 0);
  filter: saturate(0.98);
}
</style>
