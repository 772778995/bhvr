<script setup lang="ts">
import { renderMarkdown } from "@/utils/markdown";
import type { ChatMessage } from "@/api/notebooks";
import {
  getBookFinderAssistantBubbleClass,
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
</script>

<template>
  <section class="flex h-full w-full min-h-0 flex-col border border-[#d8cfbe] bg-[#f8f3ea] p-4">
    <ul class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <li v-for="message in messages" :key="message.id">
        <div class="max-w-[90%] px-3.5 py-2.5 text-base leading-relaxed"
          :class="message.role === 'user'
            ? getBookFinderUserBubbleClass()
            : getBookFinderAssistantBubbleClass()"
        >
          <p v-if="message.role === 'user'" class="whitespace-pre-wrap">{{ message.content }}</p>
          <div v-else class="prose-warm" v-html="renderMarkdown(message.content)" />
        </div>
        <p v-if="message.createdAt" class="mt-1 text-sm text-[#9a8a78]" :class="message.role === 'user' ? 'text-right' : ''">
          {{ message.createdAt }}
        </p>
      </li>
    </ul>

    <div class="mt-4 shrink-0 border-t border-[#dfd3c1] pt-4">
      <div class="flex items-end gap-3">
        <textarea
          :value="draft"
          rows="2"
          :disabled="sending"
          :placeholder="placeholder"
          class="min-h-[96px] flex-1 resize-none border border-[#d8cfbe] bg-[#fffaf2] px-3 py-3 text-base leading-7 text-[#2f271f] transition-colors duration-100 disabled:bg-[#f1eadf] disabled:text-[#8f816f]"
          @input="handleInput"
          @keydown="handleKeydown"
        />

        <button
          type="button"
          class="inline-flex h-[48px] shrink-0 items-center justify-center border border-[#bdaa8c] bg-[#efe2cd] px-4 text-base text-[#47392b] transition-colors duration-100 hover:bg-[#e8d9c2] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="sending || !draft.trim()"
          @click="handleSubmit"
        >
          {{ sending ? "检索中..." : "开始找书" }}
        </button>
      </div>
    </div>
  </section>
</template>
