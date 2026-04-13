<script setup lang="ts">
interface Props {
  title: string;
  onShare?: () => void;
  onMore?: () => void;
}

const props = defineProps<Props>();
</script>

<template>
  <header class="border-b border-[#d7cfbf] bg-[#f6f0e3] px-4 py-3 text-[#2e261d] sm:px-6">
    <div class="flex items-center justify-between gap-4">
      <h1
        class="min-w-0 truncate text-[1.25rem] font-semibold text-[#2f2418] sm:text-[1.45rem] transition-opacity duration-200"
        style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
      >
        {{ title }}
      </h1>
      <div v-if="props.onShare || props.onMore" class="flex shrink-0 items-center gap-2">
        <button
          v-if="props.onShare"
          type="button"
          class="border border-[#cfc4af] bg-[#fbf7ef] px-3 py-1.5 text-[0.95rem] text-[#564738] transition-all duration-100 ease-in-out hover:bg-[#f1e8d8] active:scale-95"
          @click="props.onShare"
        >
          分享
        </button>
        <button
          v-if="props.onMore"
          type="button"
          class="border border-[#d8cfbf] bg-transparent px-3 py-1.5 text-[0.95rem] text-[#6a5b49] transition-all duration-100 ease-in-out hover:bg-[#efe7d7] active:scale-95"
          @click="props.onMore"
        >
          更多
        </button>
      </div>
    </div>
  </header>
</template>
