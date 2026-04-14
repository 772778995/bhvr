<script setup lang="ts">
import { onMounted, nextTick, ref, watch } from "vue";
import { renderMarkdown } from "@/utils/markdown";
import type { ChatMessage } from "@/api/notebooks";
import {
  getBookFinderAssistantBubbleClass,
  getBookFinderSubmitButtonClass,
  getBookFinderTextareaClass,
  getBookFinderUserBubbleClass,
  shouldSubmitBookFinderKeydown,
} from "./book-finder-panel";

interface Props {
  messages: ChatMessage[];
  draft: string;
  placeholder: string;
  sending?: boolean;
  onDraftChange?: (value: string) => void;
  onSubmit?: () => void | Promise<void>;
}

const props = withDefaults(defineProps<Props>(), {
  sending: false,
  onDraftChange: undefined,
  onSubmit: undefined,
});

const scrollContainerRef = ref<HTMLUListElement | null>(null);

function handleSubmit() {
  if (props.sending || !props.draft.trim()) {
    return;
  }

  void props.onSubmit?.();
}

function handleKeydown(event: KeyboardEvent) {
  if (!shouldSubmitBookFinderKeydown(event)) {
    return;
  }

  event.preventDefault();
  handleSubmit();
}

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  props.onDraftChange?.(target.value);
}

function scrollToBottom() {
  void nextTick(() => {
    const el = scrollContainerRef.value;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  });
}

watch(
  () => props.messages.length,
  () => {
    scrollToBottom();
  },
);

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <section class="flex h-full w-full min-h-0 flex-col border border-[#d8cfbe] bg-[#f8f3ea] p-4">
    <div class="relative min-h-0 flex-1">
      <ul ref="scrollContainerRef" class="min-h-0 h-full space-y-4 overflow-y-auto pr-3 scroll-smooth">
        <li v-for="message in messages" :key="message.id" class="flex flex-col">
          <div :class="message.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
            <div class="px-3.5 py-2.5 text-base leading-relaxed"
              :class="message.role === 'user'
                ? getBookFinderUserBubbleClass()
                : getBookFinderAssistantBubbleClass()"
            >
              <p v-if="message.role === 'user'" class="whitespace-pre-wrap">{{ message.content }}</p>
              <div v-else class="prose-warm" v-html="renderMarkdown(message.content)" />
            </div>
          </div>
          <p v-if="message.createdAt" class="mt-1 text-sm text-[#9a8a78]" :class="message.role === 'user' ? 'text-right' : ''">
            {{ message.createdAt }}
          </p>
        </li>
      </ul>

      <button
        v-if="messages.length > 0"
        class="absolute bottom-2 right-2 z-10 rounded-md border border-[#d8cfbf] bg-white/80 px-3 py-1.5 text-[0.95rem] text-[#6a5b49] backdrop-blur-sm transition-all duration-100 ease-in-out hover:bg-[#efe7d7] active:scale-95"
        @click="scrollToBottom"
      >
        ⇩
      </button>
    </div>

    <div class="mt-4 shrink-0 border-t border-[#dfd3c1] pt-4">
      <div class="flex items-end gap-3">
        <textarea
          :value="draft"
          rows="2"
          :disabled="sending"
          :placeholder="placeholder"
          :class="getBookFinderTextareaClass()"
          @input="handleInput"
          @keydown="handleKeydown"
        />

        <button
          type="button"
          :class="getBookFinderSubmitButtonClass()"
          :disabled="sending || !draft.trim()"
          @click="handleSubmit"
        >
          {{ sending ? "检索中..." : "发送" }}
        </button>
      </div>
    </div>
  </section>
</template>
