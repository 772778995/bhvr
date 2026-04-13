<script setup lang="ts">
import NotebookWorkbenchShell from "@/components/notebook-workbench/NotebookWorkbenchShell.vue";
</script>

<template>
  <NotebookWorkbenchShell
    title="Book 工作台"
    :loading="false"
    error=""
    :has-data="true"
    left-storage-key="book-workbench-left-width"
    right-storage-key="book-workbench-right-width"
    :on-share="undefined"
    :on-more="undefined"
  >
    <template #left>
      <section class="flex h-full items-center justify-center border border-[#d8cfbe] bg-[#f6f0e6] px-6 text-center text-base leading-relaxed text-[#7a6c59]">
        书籍资料区待后续任务接入。
      </section>
    </template>

    <template #center>
      <section class="flex h-full flex-col justify-center border border-[#d8cfbe] bg-[#fbf7ef] px-8 py-10 text-center text-[#3d3126]">
        <p class="text-xs uppercase tracking-[0.28em] text-[#8d7f6d]">
          Book Workbench
        </p>
        <h2
          class="mt-4 text-[1.9rem] leading-tight text-[#2f2418] sm:text-[2.2rem]"
          style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
        >
          中间研究区已接入共享壳层
        </h2>
        <p class="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#615444] sm:text-[1.05rem]">
          当前仅验证书籍工作台能够复用顶栏、三栏布局、拖拽分栏与通用挂载位。
          具体的书籍来源、阅读工具和快速能力留给后续任务补齐。
        </p>
      </section>
    </template>

    <template #right>
      <section class="flex h-full items-center justify-center border border-[#d8cfbe] bg-[#f3ecdf] px-6 text-center text-base leading-relaxed text-[#7a6c59]">
        右侧扩展区暂时留白。
      </section>
    </template>
  </NotebookWorkbenchShell>
</template>
