<template>
  <!-- Web type: favicon with multi-source fallback -->
  <template v-if="source.type === 'web'">
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
    <!-- Globe fallback for web -->
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
      :style="iconStyle"
    >
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  </template>

  <!-- PDF: document with "PDF" label -->
  <svg
    v-else-if="source.type === 'pdf'"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    :style="iconStyle"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <text x="12" y="17" text-anchor="middle" fill="currentColor" stroke="none" font-size="6" font-weight="bold" font-family="sans-serif">PDF</text>
  </svg>

  <!-- Video: play button in rectangle -->
  <svg
    v-else-if="source.type === 'video'"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    :style="iconStyle"
  >
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none"/>
  </svg>

  <!-- Audio: music note -->
  <svg
    v-else-if="source.type === 'audio'"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    :style="iconStyle"
  >
    <path d="M9 18V5l12-2v13"/>
    <circle cx="6" cy="18" r="3"/>
    <circle cx="18" cy="16" r="3"/>
  </svg>

  <!-- Text: lines on paper -->
  <svg
    v-else-if="source.type === 'text'"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    :style="iconStyle"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/>
    <line x1="8" y1="17" x2="12" y2="17"/>
  </svg>

  <!-- Drive: cloud -->
  <svg
    v-else-if="source.type === 'drive'"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    :style="iconStyle"
  >
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
  </svg>

  <!-- File / unknown: generic folded-corner document -->
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
    :style="iconStyle"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
</template>

<script setup lang="ts">
import { ref, computed, watch, type CSSProperties } from 'vue'

interface SourceLike {
  type: string
  url?: string
}

interface Props {
  source: SourceLike
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 16,
})

const iconStyle = computed<CSSProperties>(() => ({
  color: '#7a6a56',
  width: props.size + 'px',
  height: props.size + 'px',
  flexShrink: 0,
}))

// --- Favicon logic for web type ---

const currentSrcIndex = ref(0)
const failed = ref(false)

const domain = computed(() => {
  if (props.source.type !== 'web' || !props.source.url) return ''
  try {
    return new URL(props.source.url).hostname
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
  () => props.source.url,
  () => {
    currentSrcIndex.value = 0
    failed.value = false
  },
)
</script>
