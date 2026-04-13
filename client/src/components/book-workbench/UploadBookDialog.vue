<script setup lang="ts">
import { computed, ref, watch } from "vue";

interface Props {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onPickFile: (file: File) => void | Promise<void>;
}

const props = defineProps<Props>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const fileError = ref("");

const helperText = computed(() => {
  if (props.busy) {
    return "正在处理书籍，请保持页面开启。";
  }
  return "仅支持单个 PDF。上传后系统会自动整理书籍内容并接入当前工作台。";
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      fileError.value = "";
    }
  },
);

function closeDialog() {
  if (props.busy) {
    return;
  }
  fileError.value = "";
  props.onClose();
}

function openPicker() {
  if (props.busy) {
    return;
  }
  fileInputRef.value?.click();
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";

  if (!file) {
    return;
  }

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    fileError.value = "只能上传 PDF 文件。";
    return;
  }

  fileError.value = "";
  await props.onPickFile(file);
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-40 flex items-center justify-center px-4"
        style="background: rgba(34, 27, 19, 0.54)"
        @click.self="closeDialog"
      >
        <div class="w-full max-w-xl border border-[#d5c8b2] bg-[#f7f0e3] shadow-[0_24px_80px_rgba(57,42,23,0.22)]">
          <div class="border-b border-[#dbcdb7] px-6 py-5">
            <p class="text-xs uppercase tracking-[0.26em] text-[#8f7f68]">Single Book Mode</p>
            <h2
              class="mt-3 text-[1.65rem] leading-tight text-[#2f2418]"
              style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
            >
              上传当前书籍
            </h2>
            <p class="mt-3 text-base leading-7 text-[#5f503f]">
              {{ helperText }}
            </p>
          </div>

          <div class="px-6 py-6">
            <div class="border border-dashed border-[#c8b89a] bg-[#fcf8f0] px-5 py-6 text-center">
              <input
                ref="fileInputRef"
                type="file"
                accept="application/pdf,.pdf"
                class="hidden"
                :disabled="busy"
                @change="onFileChange"
              />

              <p class="text-sm uppercase tracking-[0.18em] text-[#9c8d78]">PDF Only</p>
              <p class="mt-3 text-base leading-7 text-[#544636]">
                选择一本书的 PDF 文件。上传完成后，左侧仅保留这一本书的状态与操作入口。
              </p>

              <button
                type="button"
                class="mt-5 inline-flex items-center justify-center border border-[#3a2e20] bg-[#3a2e20] px-5 py-2.5 text-base text-[#f8f3ea] transition-all duration-100 hover:bg-[#2e2418] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="busy"
                @click="openPicker"
              >
                选择 PDF
              </button>

              <p v-if="fileError" class="mt-4 text-sm leading-6 text-[#a54734]">
                {{ fileError }}
              </p>
            </div>
          </div>

          <div class="flex justify-end border-t border-[#dbcdb7] px-6 py-4">
            <button
              type="button"
              class="border border-[#cbbda6] px-4 py-2 text-base text-[#5c4d3d] transition-colors duration-100 hover:bg-[#efe6d7] disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="busy"
              @click="closeDialog"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
