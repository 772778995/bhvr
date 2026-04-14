<script setup lang="ts">
import { onMounted, ref, nextTick, watch } from "vue";
import { renderMarkdown } from "@/utils/markdown";
import type { ChatMessage } from "@/api/notebooks";
import {
  getBookChatAssistantBubbleClass,
  getBookChatPrimaryButtonClass,
  getBookChatTextareaClass,
  getBookChatUserBubbleClass,
} from "@/components/book-workbench/book-chat";

interface Props {
  messages: ChatMessage[];
  sending: boolean;
  onSend: (content: string) => void;
}

const props = defineProps<Props>();
const draft = ref("");
const scrollContainerRef = ref<HTMLDivElement | null>(null);

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

// Auto-scroll to bottom with smooth animation when messages change
watch(
  () => props.messages.length,
  () => {
    void nextTick(() => {
      const el = scrollContainerRef.value;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    });
  },
);

function scrollToBottom() {
  void nextTick(() => {
    const el = scrollContainerRef.value;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  });
}

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <section class="h-full w-full bg-[#f8f3ea] border border-[#d8cfbe] rounded-lg p-4 flex flex-col min-h-0">
     <div class="flex-1 min-h-0 relative">
       <div ref="scrollContainerRef" class="absolute inset-0 overflow-y-auto scroll-smooth">
         <div
           v-if="messages.length === 0"
            class="h-full flex items-center justify-center rounded-md border border-dashed border-[#d8cfbe] bg-[#f0e8d8] px-4 text-base leading-relaxed text-[#9a8a78]"
         >
           还没有对话内容，输入问题即可开始。
         </div>

          <TransitionGroup
            v-else
            tag="ul"
            class="space-y-4 pr-3"
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-3"
            enter-to-class="opacity-100 translate-y-0"
          >
            <li v-for="message in messages" :key="message.id" class="flex flex-col">
              <div :class="message.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
                <div class="px-3.5 py-2.5 text-base leading-relaxed"
                  :class="message.role === 'user'
                    ? getBookChatUserBubbleClass()
                    : getBookChatAssistantBubbleClass()"
                >
                  <p v-if="message.role === 'user'" class="whitespace-pre-wrap">{{ message.content }}</p>
                  <div
                    v-else
                    class="prose-warm"
                    v-html="renderMarkdown(message.content)"
                  />
                </div>
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

       <!-- Scroll to bottom button — outside scroll container, fixed to wrapper bottom-right -->
       <button
         v-if="messages.length > 0"
         class="absolute bottom-2 right-2 z-10 rounded-md border border-[#d8cfbf] bg-white/80 backdrop-blur-sm px-3 py-1.5 text-[0.95rem] text-[#6a5b49] transition-all duration-100 ease-in-out hover:bg-[#efe7d7] active:scale-95"
         @click="scrollToBottom"
       >
         ⇩
       </button>
     </div>

    <div class="mt-3 shrink-0 border-t border-[#e0d5c0] pt-3">
      <div class="flex items-end gap-3">
      <textarea
        v-model="draft"
        rows="2"
        :disabled="sending"
        placeholder="输入消息..."
        :class="getBookChatTextareaClass()"
        @keydown="handleKeydown"
      />
      <button
        type="button"
        :class="getBookChatPrimaryButtonClass()"
        :disabled="sending || !draft.trim()"
        @click="handleSubmit"
      >
        {{ sending ? "发送中..." : "发送" }}
      </button>
      </div>
    </div>
  </section>
</template>
