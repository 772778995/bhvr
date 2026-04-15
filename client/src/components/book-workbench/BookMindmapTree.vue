<script setup lang="ts">
interface BookMindmapNode {
  label: string;
  note?: string;
  children?: BookMindmapNode[];
}

interface Props {
  title?: string;
  root: BookMindmapNode;
}

defineProps<Props>();
</script>

<template>
  <section class="mx-auto w-full max-w-5xl rounded-xl border border-[#ddd3c2] bg-[#fffaf1] px-4 py-5 sm:px-6">
    <header class="border-b border-[#e4d9c8] pb-4">
      <p class="text-sm tracking-[0.18em] text-[#8a7864] uppercase">阅读产出</p>
      <h2 class="mt-2 text-[1.35rem] leading-tight text-[#2f271f]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
        {{ title || root.label }}
      </h2>
    </header>

    <div class="mt-5 flex flex-col gap-4">
      <div class="rounded-lg border border-[#d9cfbe] bg-[#f7f0e3] px-4 py-4">
        <p class="text-lg leading-7 text-[#2f271f] font-medium">{{ root.label }}</p>
        <p v-if="root.note" class="mt-2 text-base leading-7 text-[#5d4f3d]">{{ root.note }}</p>
      </div>

      <div v-if="root.children?.length" class="space-y-4 border-l border-[#d8cfbe] pl-4 sm:pl-6">
        <div
          v-for="(branch, index) in root.children"
          :key="`${branch.label}-${index}`"
          class="relative rounded-lg border border-[#ddd3c2] bg-[#fffcf6] px-4 py-4"
        >
          <span class="absolute -left-[1.15rem] top-6 hidden h-px w-4 bg-[#d8cfbe] sm:block"></span>
          <p class="text-base leading-7 text-[#2f271f] font-medium">{{ branch.label }}</p>
          <p v-if="branch.note" class="mt-2 text-base leading-7 text-[#5d4f3d]">{{ branch.note }}</p>

          <div v-if="branch.children?.length" class="mt-4 space-y-3 border-l border-dashed border-[#ddd3c2] pl-4">
            <div
              v-for="(leaf, leafIndex) in branch.children"
              :key="`${leaf.label}-${leafIndex}`"
              class="rounded-md border border-[#e5dccd] bg-[#faf5ea] px-3 py-3"
            >
              <p class="text-base leading-7 text-[#34281d] font-medium">{{ leaf.label }}</p>
              <p v-if="leaf.note" class="mt-1 text-sm leading-6 text-[#6a5b49]">{{ leaf.note }}</p>

              <div v-if="leaf.children?.length" class="mt-3 space-y-2">
                <div
                  v-for="(twig, twigIndex) in leaf.children"
                  :key="`${twig.label}-${twigIndex}`"
                  class="rounded-md bg-[#f3ecdf] px-3 py-2"
                >
                  <p class="text-sm leading-6 text-[#34281d] font-medium">{{ twig.label }}</p>
                  <p v-if="twig.note" class="mt-1 text-sm leading-6 text-[#6a5b49]">{{ twig.note }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
