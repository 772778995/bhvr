<script setup lang="ts">
import { renderMarkdown } from "@/utils/markdown";
import type { ChatMessage } from "@/api/notebooks";

interface Props {
  messages: ChatMessage[];
}

defineProps<Props>();
</script>

<template>
  <section class="flex h-full w-full min-h-0 flex-col border border-[#d8cfbe] bg-[#f8f3ea] p-4">
    <div
      v-if="messages.length === 0"
      class="flex min-h-0 flex-1 items-center justify-center border border-[#ddd3c2] bg-[#f2eadc] px-5 text-center text-base leading-8 text-[#8b7a67]"
    >
      自动研究开始后，这里会按时间沉淀问题与回答，方便回看研究过程。
    </div>

    <ul v-else class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <li v-for="message in messages" :key="message.id">
        <div class="max-w-[90%] px-3.5 py-2.5 text-base leading-relaxed"
          :class="message.role === 'user'
            ? 'ml-auto rounded-2xl rounded-tr-sm bg-[#3a2e20] text-[#f5ede0]'
            : 'rounded-2xl rounded-tl-sm border border-[#e0d5c0] bg-[#fffaf2] text-[#2f271f]'"
        >
          <p v-if="message.role === 'user'" class="whitespace-pre-wrap">{{ message.content }}</p>
          <div v-else class="prose-warm" v-html="renderMarkdown(message.content)" />
        </div>
        <p class="mt-1 text-sm text-[#9a8a78]" :class="message.role === 'user' ? 'text-right' : ''">
          {{ message.createdAt }}
        </p>
      </li>
    </ul>
  </section>
</template>
