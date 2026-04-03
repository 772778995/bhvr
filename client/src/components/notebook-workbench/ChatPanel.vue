<script setup lang="ts">
import type { ChatMessage } from "@/api/notebooks";

interface Props {
  messages: ChatMessage[];
  onSend: () => void;
}

defineProps<Props>();
</script>

<template>
  <section class="h-full bg-white border border-gray-200 rounded-lg p-4 flex flex-col">
    <h2 class="text-sm font-semibold text-gray-900 mb-3">对话</h2>

    <div class="flex-1 overflow-auto">
      <div
        v-if="messages.length === 0"
        class="h-full flex items-center justify-center text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-md"
      >
        还没有对话内容，输入问题即可开始。
      </div>

      <ul v-else class="space-y-3 pr-1">
        <li v-for="message in messages" :key="message.id">
          <div
            class="max-w-[90%] rounded-lg px-3 py-2 text-sm"
            :class="message.role === 'user' ? 'ml-auto bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'"
          >
            <p class="whitespace-pre-wrap">{{ message.content }}</p>
          </div>
          <p class="text-[11px] text-gray-500 mt-1">{{ message.createdAt }}</p>
        </li>
      </ul>
    </div>

    <div class="pt-3 mt-3 border-t border-gray-100 flex items-center gap-2">
      <input
        type="text"
        readonly
        value="输入消息（即将支持）"
        class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-500 bg-gray-50"
      />
      <button
        type="button"
        class="px-3 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-gray-800"
        @click="onSend"
      >
        发送
      </button>
    </div>
  </section>
</template>
