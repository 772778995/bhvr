<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import mermaid from "mermaid";

interface Props {
  code: string;
  title?: string;
}

const props = defineProps<Props>();

const svgHtml = ref<string>("");
const renderError = ref(false);
const containerId = `mermaid-${crypto.randomUUID().replace(/-/g, "")}`;

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  mindmap: { useMaxWidth: true },
});

async function renderDiagram(code: string) {
  renderError.value = false;
  svgHtml.value = "";
  try {
    const { svg } = await mermaid.render(containerId, code);
    svgHtml.value = svg;
  } catch {
    renderError.value = true;
  }
}

onMounted(() => {
  renderDiagram(props.code);
});

watch(() => props.code, (newCode) => {
  renderDiagram(newCode);
});
</script>

<template>
  <section class="mx-auto w-full max-w-5xl">
    <!-- Header -->
    <div
      v-if="title"
      class="mb-5 pb-3 border-b border-[#ddd3c2] flex items-baseline gap-3"
    >
      <h2
        class="text-xl font-semibold text-[#2f271f] leading-snug"
        style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
      >
        {{ title }}
      </h2>
      <span class="text-xs text-[#9a8a78] tracking-wide">阅读导图</span>
    </div>

    <!-- SVG render area -->
    <div
      v-if="svgHtml && !renderError"
      class="overflow-x-auto rounded-lg border border-[#ddd3c2] bg-[#fffbf4] px-4 py-6"
    >
      <div
        class="flex justify-center min-w-0"
        v-html="svgHtml"
      />
    </div>

    <!-- Fallback: raw code -->
    <div
      v-else-if="renderError"
      class="rounded-lg border border-[#ddd3c2] bg-[#f3ece0] px-4 py-5"
    >
      <p class="text-sm text-[#9a8a78] mb-3">导图渲染失败，显示原始代码：</p>
      <pre
        class="text-sm text-[#2f271f] font-mono leading-relaxed whitespace-pre-wrap break-words overflow-x-auto"
      >{{ code }}</pre>
    </div>

    <!-- Loading state (before first render) -->
    <div
      v-else
      class="rounded-lg border border-[#ddd3c2] bg-[#fffbf4] px-4 py-8 flex items-center justify-center"
    >
      <p class="text-base text-[#9a8a78] italic">正在渲染导图…</p>
    </div>
  </section>
</template>
