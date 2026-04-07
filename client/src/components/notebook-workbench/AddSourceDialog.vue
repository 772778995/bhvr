<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  canShowValidationError,
  getRequiredFieldError,
  getUrlFieldError,
  isValidHttpUrl,
  normalizeSearchQuery,
  shouldDisableSubmitAction,
} from "@/utils/add-source-validators";

interface Props {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onAddUrl: (payload: { url: string; title?: string }) => void | Promise<void>;
  onAddText: (payload: { title: string; content: string }) => void | Promise<void>;
  onSearch: (payload: { query: string; sourceType: "web" | "drive"; mode: "fast" | "deep" }) => void | Promise<void>;
  onPickFile: (file: File) => void | Promise<void>;
}

const props = defineProps<Props>();

const url = ref("");
const urlTitle = ref("");

const textTitle = ref("");
const textContent = ref("");

const searchQuery = ref("");
const searchSourceType = ref<"web" | "drive">("web");
const searchMode = ref<"fast" | "deep">("fast");

const urlTouched = ref(false);
const textTitleTouched = ref(false);
const textContentTouched = ref(false);
const searchTouched = ref(false);

const urlSubmitAttempted = ref(false);
const textSubmitAttempted = ref(false);
const searchSubmitAttempted = ref(false);

const fileInputRef = ref<HTMLInputElement | null>(null);

const urlValid = computed(() => isValidHttpUrl(url.value));
const searchQueryNormalized = computed(() => normalizeSearchQuery(searchQuery.value));
const urlError = computed(() => getUrlFieldError(url.value));
const searchError = computed(() => getRequiredFieldError(searchQuery.value, "搜索词"));
const textTitleError = computed(() => getRequiredFieldError(textTitle.value, "标题"));
const textContentError = computed(() => getRequiredFieldError(textContent.value, "文本内容"));
const showUrlError = computed(() => canShowValidationError(urlError.value, urlTouched.value, urlSubmitAttempted.value));
const showSearchError = computed(() => canShowValidationError(searchError.value, searchTouched.value, searchSubmitAttempted.value));
const showTextTitleError = computed(() => canShowValidationError(textTitleError.value, textTitleTouched.value, textSubmitAttempted.value));
const showTextContentError = computed(() => canShowValidationError(textContentError.value, textContentTouched.value, textSubmitAttempted.value));
const searchModeEffective = computed<"fast" | "deep">(() => {
  if (searchSourceType.value === "drive" && searchMode.value === "deep") {
    return "fast";
  }
  return searchMode.value;
});

function resetValidationState() {
  urlTouched.value = false;
  textTitleTouched.value = false;
  textContentTouched.value = false;
  searchTouched.value = false;
  urlSubmitAttempted.value = false;
  textSubmitAttempted.value = false;
  searchSubmitAttempted.value = false;
}

watch(
  () => props.open,
  (open, previousOpen) => {
    if (open && !previousOpen) {
      resetValidationState();
    }
  },
);

function closeDialog() {
  if (props.busy) {
    return;
  }
  props.onClose();
}

async function submitUrl() {
  urlSubmitAttempted.value = true;
  if (!urlValid.value || props.busy) {
    return;
  }
  await props.onAddUrl({
    url: url.value.trim(),
    ...(urlTitle.value.trim() ? { title: urlTitle.value.trim() } : {}),
  });
}

async function submitText() {
  textSubmitAttempted.value = true;
  if (!textTitle.value.trim() || !textContent.value.trim() || props.busy) {
    return;
  }
  await props.onAddText({
    title: textTitle.value.trim(),
    content: textContent.value.trim(),
  });
}

async function submitSearch() {
  searchSubmitAttempted.value = true;
  if (!searchQueryNormalized.value || props.busy) {
    return;
  }
  await props.onSearch({
    query: searchQueryNormalized.value,
    sourceType: searchSourceType.value,
    mode: searchModeEffective.value,
  });
}

function openFilePicker() {
  if (props.busy) {
    return;
  }
  fileInputRef.value?.click();
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || props.busy) {
    return;
  }
  await props.onPickFile(file);
  input.value = "";
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" @click.self="closeDialog">
    <div class="w-full max-w-3xl rounded-xl border border-gray-200 bg-white shadow-xl">
      <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 class="text-base font-semibold text-gray-900">添加来源</h2>
        <button type="button" class="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100" :disabled="busy" @click="closeDialog">
          关闭
        </button>
      </div>

      <div class="space-y-4 p-4">
        <section class="rounded-lg border border-gray-200 p-3">
          <p class="mb-2 text-sm font-semibold text-gray-700">搜索 Web / Drive</p>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_120px_110px_130px]">
            <input
              v-model="searchQuery"
              type="text"
              :disabled="busy"
              placeholder="输入搜索词..."
              @blur="searchTouched = true"
              :class="[
                'w-full rounded-md border px-3 py-2.5 text-base',
                showSearchError ? 'border-red-300 focus:border-red-400' : 'border-gray-300',
              ]"
            />
            <select v-model="searchSourceType" :disabled="busy" class="rounded-md border border-gray-300 px-2 py-2.5 text-base">
              <option value="web">Web</option>
              <option value="drive">Drive</option>
            </select>
            <select v-model="searchMode" :disabled="busy || searchSourceType === 'drive'" class="rounded-md border border-gray-300 px-2 py-2.5 text-base">
              <option value="fast">Fast</option>
              <option value="deep">Deep</option>
            </select>
            <button
              type="button"
              :disabled="shouldDisableSubmitAction(busy)"
              class="rounded-md bg-gray-900 px-3 py-2.5 text-base text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              @click="submitSearch"
            >
              搜索并添加
            </button>
          </div>
          <p v-if="showSearchError" class="mt-2 text-sm text-red-600">{{ searchError }}</p>
        </section>

        <section class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div class="rounded-lg border border-gray-200 p-3">
            <p class="mb-2 text-sm font-semibold text-gray-700">网站 URL</p>
            <div class="space-y-2">
              <input
                v-model="url"
                type="text"
                :disabled="busy"
                placeholder="https://example.com/article"
                @blur="urlTouched = true"
                :class="[
                  'w-full rounded-md border px-3 py-2.5 text-base',
                  showUrlError ? 'border-red-300 focus:border-red-400' : 'border-gray-300',
                ]"
              />
              <input v-model="urlTitle" type="text" :disabled="busy" placeholder="可选标题" class="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base" />
              <p v-if="showUrlError" class="text-sm text-red-600">{{ urlError }}</p>
              <button
                type="button"
                :disabled="shouldDisableSubmitAction(busy)"
                class="rounded-md bg-gray-900 px-3 py-2.5 text-base text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                @click="submitUrl"
              >
                添加网站
              </button>
            </div>
          </div>

          <div class="rounded-lg border border-gray-200 p-3">
            <p class="mb-2 text-sm font-semibold text-gray-700">上传文件</p>
            <input ref="fileInputRef" type="file" class="hidden" :disabled="busy" @change="onFileChange" />
            <button
              type="button"
              :disabled="busy"
              class="rounded-md border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              @click="openFilePicker"
            >
              选择文件并上传
            </button>
          </div>
        </section>

        <section class="rounded-lg border border-gray-200 p-3">
          <p class="mb-2 text-sm font-semibold text-gray-700">复制文本</p>
          <div class="space-y-2">
            <input
              v-model="textTitle"
              type="text"
              :disabled="busy"
              placeholder="标题"
              @blur="textTitleTouched = true"
              :class="[
                'w-full rounded-md border px-3 py-2.5 text-base',
                showTextTitleError ? 'border-red-300 focus:border-red-400' : 'border-gray-300',
              ]"
            />
            <p v-if="showTextTitleError" class="text-sm text-red-600">{{ textTitleError }}</p>
            <textarea
              v-model="textContent"
              :disabled="busy"
              rows="5"
              placeholder="粘贴文本内容..."
              @blur="textContentTouched = true"
              :class="[
                'w-full rounded-md border px-3 py-2.5 text-base',
                showTextContentError ? 'border-red-300 focus:border-red-400' : 'border-gray-300',
              ]"
            />
            <p v-if="showTextContentError" class="text-sm text-red-600">{{ textContentError }}</p>
            <button
              type="button"
              :disabled="shouldDisableSubmitAction(busy)"
              class="rounded-md bg-gray-900 px-3 py-2.5 text-base text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              @click="submitText"
            >
              添加文本
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
