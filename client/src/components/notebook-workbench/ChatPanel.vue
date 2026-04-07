<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ChatMessage } from "@/api/notebooks";

interface Props {
  messages: ChatMessage[];
  sending: boolean;
  onSend: (content: string) => void;
}

const props = defineProps<Props>();
const draft = ref("");
const listRef = ref<HTMLUListElement | null>(null);

function renderMarkdown(content: string): string {
  const raw = marked.parse(content);
  return DOMPurify.sanitize(typeof raw === "string" ? raw : "");
}

function handleSubmit() {
  const value = draft.value.trim();
  if (!value || props.sending) {
    return;
  }

  props.onSend(value);
  draft.value = "";
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  event.preventDefault();
  handleSubmit();
}

// Auto-scroll to bottom when new messages arrive
watch(
  () => props.messages.length,
  () => {
    void nextTick(() => {
      if (listRef.value) {
        listRef.value.scrollTop = listRef.value.scrollHeight;
      }
    });
  },
);
</script>

<template>
  <section class="h-full bg-white border border-gray-200 rounded-lg p-4 flex flex-col min-h-0">
    <h2 class="mb-3 text-base font-semibold text-gray-900 shrink-0">对话</h2>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <div
        v-if="messages.length === 0"
        class="h-full flex items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 text-base leading-relaxed text-gray-500"
      >
        还没有对话内容，输入问题即可开始。
      </div>

      <TransitionGroup
        v-else
        ref="listRef"
        tag="ul"
        class="space-y-4 pr-1"
        enter-active-class="transition-all duration-180 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
      >
        <li v-for="message in messages" :key="message.id">
          <div
            class="max-w-[88%] px-3.5 py-2.5 text-base leading-relaxed"
            :class="
              message.role === 'user'
                ? 'ml-auto rounded-2xl rounded-tr-sm bg-[#3a2e20] text-[#f5ede0]'
                : 'rounded-2xl rounded-tl-sm bg-[#f8f3ea] text-[#2f271f] border border-[#e0d5c0]'
            "
          >
            <!-- User messages: plain text -->
            <p v-if="message.role === 'user'" class="whitespace-pre-wrap">{{ message.content }}</p>
            <!-- Assistant messages: rendered Markdown -->
            <div
              v-else
              class="prose-warm"
              v-html="renderMarkdown(message.content)"
            />
          </div>
          <p
            class="mt-1 text-sm text-[#9a8a78]"
            :class="message.role === 'user' ? 'text-right' : ''"
          >
            {{ message.createdAt }}
          </p>
        </li>
      </TransitionGroup>
    </div>

    <div class="pt-3 mt-3 border-t border-gray-100 flex items-center gap-2 shrink-0">
      <textarea
        v-model="draft"
        rows="2"
        :disabled="sending"
        placeholder="输入消息..."
        class="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2.5 text-base text-gray-900 disabled:bg-gray-50 disabled:text-gray-500 transition-colors duration-100"
        @keydown="handleKeydown"
      />
      <button
        type="button"
        class="rounded-md bg-gray-900 px-3 py-2.5 text-base text-white transition-all duration-100 hover:bg-gray-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-400"
        :disabled="sending || !draft.trim()"
        @click="handleSubmit"
      >
        {{ sending ? "发送中..." : "发送" }}
      </button>
    </div>
  </section>
</template>
