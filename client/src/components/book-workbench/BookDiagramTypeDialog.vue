<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  open: boolean
  onGenerate: (diagramType: string) => void
  onClose: () => void
}>()

const diagramTypes = [
  { key: 'mindmap', name: '思维导图', desc: '以树状结构展示书籍核心概念' },
  { key: 'flowchart', name: '流程图', desc: '展示书中的步骤、决策或因果链' },
  { key: 'timeline', name: '时间线', desc: '按时间顺序排列书中关键事件' },
  { key: 'sequenceDiagram', name: '时序图', desc: '展示核心角色或概念的交互顺序' },
  { key: 'classDiagram', name: '类图', desc: '展示书中核心概念与关系结构' },
  { key: 'gantt', name: '甘特图', desc: '展示书中涉及的项目或阶段规划' },
]

const selected = ref('mindmap')

function handleGenerate() {
  props.onGenerate(selected.value)
  props.onClose()
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
        @click.self="onClose"
      >
        <div class="w-full max-w-xl border border-[#d5c8b2] bg-[#f7f0e3] shadow-[0_24px_80px_rgba(57,42,23,0.22)]">
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-[#dbcdb7] px-6 py-5">
            <h2 class="font-serif text-lg font-semibold text-[#2f2418]">选择图表类型</h2>
            <button
              class="flex h-7 w-7 items-center justify-center border border-[#cbbda6] text-[#5c4d3d] hover:bg-[#efe6d7] transition-colors"
              @click="onClose"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="px-6 py-6">
            <div class="grid grid-cols-3 gap-3">
              <button
                v-for="type in diagramTypes"
                :key="type.key"
                class="border p-3 text-left transition-colors"
                :class="selected === type.key
                  ? 'border-[#3a2e20] bg-[#faf5eb]'
                  : 'border-[#d5c8b2] bg-[#fcf8f0] hover:border-[#a89880]'"
                @click="selected = type.key"
              >
                <div class="text-base font-medium text-[#2f2418]">{{ type.name }}</div>
                <div class="mt-1 text-sm leading-snug text-[#8f7f68]">{{ type.desc }}</div>
              </button>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex justify-end gap-3 border-t border-[#dbcdb7] px-6 py-4">
            <button
              class="border border-[#cbbda6] px-4 py-2 text-sm text-[#5c4d3d] hover:bg-[#efe6d7] transition-colors"
              @click="onClose"
            >
              关闭
            </button>
            <button
              class="bg-[#3a2e20] px-4 py-2 text-sm text-[#f8f3ea] hover:bg-[#2e2418] transition-colors"
              @click="handleGenerate"
            >
              生成
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
