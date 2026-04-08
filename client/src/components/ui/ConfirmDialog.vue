<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }>(),
  {
    confirmText: "确认",
    cancelText: "取消",
    danger: false,
  }
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.visible) {
    emit("cancel");
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  }
);

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});
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
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center"
        style="background: rgba(32, 24, 18, 0.55)"
        @click.self="emit('cancel')"
      >
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-2"
          appear
        >
          <div
            v-if="visible"
            class="rounded-lg shadow-xl max-w-md w-[calc(100%-2rem)] px-6 py-5"
            style="background: #f5ead1; border: 1px solid #d7c29a"
            @click.stop
          >
            <!-- Title -->
            <h3
              class="text-lg font-semibold leading-snug"
              style="color: #2f271f; font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
            >
              {{ title }}
            </h3>

            <!-- Message -->
            <p class="mt-3 text-base leading-relaxed" style="color: #4a3f33">
              {{ message }}
            </p>

            <!-- Actions -->
            <div class="mt-5 flex justify-end gap-3">
              <button
                type="button"
                class="px-4 py-1.5 text-sm rounded border transition-colors cursor-pointer"
                style="
                  color: #5a4e40;
                  border-color: #c4b89a;
                  background: transparent;
                "
                @mouseenter="($event.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)'"
                @mouseleave="($event.currentTarget as HTMLButtonElement).style.background = 'transparent'"
                @click="emit('cancel')"
              >
                {{ cancelText }}
              </button>
              <button
                type="button"
                class="px-4 py-1.5 text-sm rounded border transition-colors cursor-pointer"
                :style="{
                  color: '#fff',
                  borderColor: danger ? '#b33c2a' : '#3a2e20',
                  background: danger ? '#b33c2a' : '#3a2e20',
                }"
                @mouseenter="($event.currentTarget as HTMLButtonElement).style.background = danger ? '#952e1e' : '#2a2018'"
                @mouseleave="($event.currentTarget as HTMLButtonElement).style.background = danger ? '#b33c2a' : '#3a2e20'"
                @click="emit('confirm')"
              >
                {{ confirmText }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
