<template>
  <img
    v-if="!showFallback"
    :src="faviconSrc"
    :width="size"
    :height="size"
    :style="{ width: size + 'px', height: size + 'px' }"
    class="rounded-sm object-contain shrink-0"
    alt=""
    @error="onError"
  />
  <svg
    v-else
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    :style="{ color: '#7a6a56', width: size + 'px', height: size + 'px', flexShrink: 0 }"
  >
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface Props {
  url?: string
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  url: undefined,
  size: 16,
})

const currentSrcIndex = ref(0)
const failed = ref(false)

const domain = computed(() => {
  if (!props.url) return ''
  try {
    return new URL(props.url).hostname
  } catch {
    return ''
  }
})

const candidates = computed(() => {
  const d = domain.value
  if (!d) return []
  return [
    `https://www.google.com/s2/favicons?domain=${d}&sz=32`,
    `https://icons.duckduckgo.com/ip3/${d}.ico`,
    `https://${d}/favicon.ico`,
  ]
})

const showFallback = computed(() => {
  return !domain.value || failed.value
})

const faviconSrc = computed(() => {
  const index = currentSrcIndex.value
  if (index >= candidates.value.length) return ''
  return candidates.value[index]
})

function onError() {
  const next = currentSrcIndex.value + 1
  if (next >= candidates.value.length) {
    failed.value = true
  } else {
    currentSrcIndex.value = next
  }
}

watch(
  () => props.url,
  () => {
    currentSrcIndex.value = 0
    failed.value = false
  }
)
</script>
