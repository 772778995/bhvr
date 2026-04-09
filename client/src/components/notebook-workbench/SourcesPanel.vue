<script setup lang="ts">
import type { Source } from "@/api/notebooks";
import SourceIcon from '@/components/notebook-workbench/SourceIcon.vue'

interface Props {
  sources: Source[];
  onAddSource: () => void;
  onDeleteSource?: (sourceId: string) => void;
}

defineProps<Props>();

function canOpen(source: Source): boolean {
  return (source.type === "web" || source.type === "youtube") && Boolean(source.url);
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    web: "网页",
    file: "文件",
    text: "文本",
    drive: "云端硬盘",
    pdf: "PDF",
    youtube: "YouTube",
    image: "图片",
    video: "视频",
    audio: "音频",
  };
  return map[type] ?? type;
}
</script>

<template>
  <section class="h-full min-h-0 bg-[#f8f3ea] border border-[#d8cfbe] rounded-lg p-4 flex flex-col overflow-hidden">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <h2
        class="text-base font-semibold text-[#2f271f]"
        style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
      >来源</h2>
      <button
        type="button"
        class="px-2.5 py-1.5 text-sm rounded-md bg-[#3a2e20] text-[#f8f3ea] transition-all duration-100 hover:bg-[#2a1e10] active:scale-95"
        @click="onAddSource"
      >
        添加
      </button>
    </div>

    <div
      v-if="sources.length === 0"
      class="rounded-md border border-dashed border-[#c4b89a] bg-[#fffbf4] p-4 text-base leading-relaxed text-[#9a8a78]"
    >
      暂无来源，请添加后开始对话。
    </div>

    <TransitionGroup
      v-else
      tag="ul"
      class="space-y-2 overflow-y-auto min-h-0 flex-1 pr-1"
      enter-active-class="transition-all duration-150 ease-out"
      enter-from-class="opacity-0 -translate-x-1"
      enter-to-class="opacity-100 translate-x-0"
    >
      <li
        v-for="source in sources"
        :key="source.id"
        class="group relative border border-[#ddd3c2] rounded-md p-3 bg-[#fffbf4] transition-colors duration-100 hover:border-[#c4b89a] hover:bg-[#fdf7ed]"
      >
        <button
          v-if="onDeleteSource"
          type="button"
          class="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded text-[#9a8a78] opacity-0 group-hover:opacity-100 transition-opacity duration-100 hover:bg-[#e4dac8] hover:text-[#564738]"
          title="删除来源"
          @click.stop.prevent="onDeleteSource(source.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
        <a
          v-if="canOpen(source)"
          :href="source.url"
          :title="source.title"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1.5 min-w-0 pr-5 text-base font-medium text-[#5a4a3a] hover:text-[#3a2e20] hover:underline"
        >
          <SourceIcon :source="source" :size="16" />
          <span class="truncate">{{ source.title }}</span>
        </a>
        <p v-else class="flex items-center gap-1.5 min-w-0 pr-5 text-base font-medium text-[#2f271f]" :title="source.title">
          <SourceIcon :source="source" :size="16" />
          <span class="truncate">{{ source.title }}</span>
        </p>
        <p class="mt-1 text-sm text-[#9a8a78]">{{ typeLabel(source.type) }} · {{ source.status }}</p>
      </li>
    </TransitionGroup>
  </section>
</template>
