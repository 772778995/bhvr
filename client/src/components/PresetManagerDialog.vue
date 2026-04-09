<script setup lang="ts">
import { ref, computed } from "vue";
import { api, type SummaryPreset, type CreatePresetRequest, type UpdatePresetRequest } from "@/api/client";

const emit = defineEmits<{
  close: [];
  updated: [];
}>();

// ── State ─────────────────────────────────────────────────────────────────────

const presets = ref<SummaryPreset[]>([]);
const loading = ref(false);
const error = ref("");

type EditorMode = "none" | "view" | "edit" | "create";
const editorMode = ref<EditorMode>("none");
const editing = ref<Partial<SummaryPreset>>({});
const editorError = ref("");
const editorLoading = ref(false);

const deleteConfirmId = ref<string | undefined>(undefined);

// ── Computed ──────────────────────────────────────────────────────────────────

const READONLY_ID = "builtin-research-report";

const editorTitle = computed(() => {
  if (editorMode.value === "create") return "添加总结方式";
  if (editorMode.value === "view") return "查看总结方式";
  return "编辑总结方式";
});

const isReadonly = computed(() => editorMode.value === "view");

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadPresets() {
  loading.value = true;
  error.value = "";
  try {
    presets.value = await api.listPresets();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

loadPresets();

// ── Editor ────────────────────────────────────────────────────────────────────

function openView(preset: SummaryPreset) {
  editorMode.value = "view";
  editing.value = { ...preset };
  editorError.value = "";
}

function openEdit(preset: SummaryPreset) {
  editorMode.value = "edit";
  editing.value = { ...preset };
  editorError.value = "";
}

function openCreate() {
  editorMode.value = "create";
  editing.value = { name: "", description: "", prompt: "" };
  editorError.value = "";
}

function closeEditor() {
  editorMode.value = "none";
  editing.value = {};
  editorError.value = "";
}

async function saveEditor() {
  editorLoading.value = true;
  editorError.value = "";
  try {
    if (editorMode.value === "create") {
      const payload: CreatePresetRequest = {
        name: editing.value.name!,
        prompt: editing.value.prompt!,
      };
      if (editing.value.description) payload.description = editing.value.description;
      await api.createPreset(payload);
    } else if (editorMode.value === "edit") {
      const payload: UpdatePresetRequest = {};
      if (editing.value.name !== undefined) payload.name = editing.value.name;
      if (editing.value.description !== undefined) payload.description = editing.value.description ?? undefined;
      if (editing.value.prompt !== undefined) payload.prompt = editing.value.prompt;
      await api.updatePreset(editing.value.id!, payload);
    }
    await loadPresets();
    closeEditor();
    emit("updated");
  } catch (e) {
    editorError.value = e instanceof Error ? e.message : "保存失败";
  } finally {
    editorLoading.value = false;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function confirmDelete(id: string) {
  try {
    await api.deletePreset(id);
    if (editing.value.id === id) closeEditor();
    await loadPresets();
    deleteConfirmId.value = undefined;
    emit("updated");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "删除失败";
  }
}
</script>

<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/30"
    @click="emit('close')"
  />

  <!-- Dialog -->
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="relative bg-[#faf7f2] border border-[#d9cfc0] rounded shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
      @click.stop
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#d9cfc0]">
        <h2 class="text-base font-semibold text-[#2c2c2c]">管理总结方式</h2>
        <button
          class="text-[#6b6352] hover:text-[#2c2c2c] transition-colors text-lg leading-none"
          @click="emit('close')"
          aria-label="关闭"
        >×</button>
      </div>

      <!-- Body -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Preset list -->
        <div class="w-52 shrink-0 border-r border-[#d9cfc0] overflow-y-auto flex flex-col">
          <div class="flex-1 py-2">
            <div v-if="loading" class="px-4 py-3 text-sm text-[#9c8f7a]">加载中…</div>
            <div v-else-if="error" class="px-4 py-3 text-sm text-red-600">{{ error }}</div>
            <template v-else>
              <button
                v-for="p in presets"
                :key="p.id"
                :class="[
                  'w-full text-left px-4 py-2.5 text-sm transition-colors group',
                  editing.id === p.id
                    ? 'bg-[#ede8de] text-[#2c2c2c] font-medium'
                    : 'text-[#4a4235] hover:bg-[#f0ebe1]',
                ]"
                @click="p.id === READONLY_ID ? openView(p) : openEdit(p)"
              >
                <span class="block truncate">{{ p.name }}</span>
                <span v-if="p.isBuiltin" class="text-xs text-[#9c8f7a]">内置</span>
              </button>
            </template>
          </div>
          <div class="p-3 border-t border-[#d9cfc0]">
            <button
              class="w-full py-1.5 px-3 text-sm rounded border border-[#c4b89a] text-[#5c5240] hover:bg-[#ede8de] transition-colors"
              @click="openCreate"
            >
              + 添加总结方式
            </button>
          </div>
        </div>

        <!-- Editor panel -->
        <div class="flex-1 overflow-y-auto">
          <!-- Empty state -->
          <div
            v-if="editorMode === 'none'"
            class="h-full flex items-center justify-center text-sm text-[#9c8f7a] p-6"
          >
            从左侧选择一个总结方式进行编辑
          </div>

          <!-- Form -->
          <div v-else class="p-6 space-y-4">
            <h3 class="text-sm font-semibold text-[#2c2c2c]">{{ editorTitle }}</h3>

            <div v-if="editorError" class="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
              {{ editorError }}
            </div>

            <!-- Name -->
            <div>
              <label class="block text-sm font-medium text-[#4a4235] mb-1">
                名称 <span v-if="!isReadonly" class="text-red-500">*</span>
              </label>
              <input
                v-model="editing.name"
                :disabled="isReadonly"
                type="text"
                maxlength="20"
                placeholder="例如：快速读书"
                class="w-full rounded border border-[#c4b89a] bg-white px-3 py-2 text-sm text-[#2c2c2c] focus:outline-none focus:ring-2 focus:ring-[#8b7d5a] disabled:bg-[#f5f1ea] disabled:text-[#6b6352]"
              />
            </div>

            <!-- Description -->
            <div>
              <label class="block text-sm font-medium text-[#4a4235] mb-1">说明（可选）</label>
              <input
                v-model="editing.description"
                :disabled="isReadonly"
                type="text"
                maxlength="50"
                placeholder="简短说明这个总结方式的用途"
                class="w-full rounded border border-[#c4b89a] bg-white px-3 py-2 text-sm text-[#2c2c2c] focus:outline-none focus:ring-2 focus:ring-[#8b7d5a] disabled:bg-[#f5f1ea] disabled:text-[#6b6352]"
              />
            </div>

            <!-- Prompt -->
            <div>
              <label class="block text-sm font-medium text-[#4a4235] mb-1">
                Prompt <span v-if="!isReadonly" class="text-red-500">*</span>
              </label>
              <textarea
                v-model="editing.prompt"
                :disabled="isReadonly"
                rows="12"
                placeholder="输入发送给 NotebookLM 的总结提示词…"
                class="w-full rounded border border-[#c4b89a] bg-white px-3 py-2 text-sm text-[#2c2c2c] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#8b7d5a] resize-y disabled:bg-[#f5f1ea] disabled:text-[#6b6352]"
              />
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-3 pt-1">
              <template v-if="!isReadonly">
                <button
                  :disabled="editorLoading || !editing.name || !editing.prompt"
                  class="px-4 py-2 rounded bg-[#5c5240] text-[#faf7f2] text-sm font-medium hover:bg-[#4a4235] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  @click="saveEditor"
                >
                  {{ editorLoading ? "保存中…" : "保存" }}
                </button>
                <button
                  class="px-4 py-2 rounded border border-[#c4b89a] text-[#5c5240] text-sm hover:bg-[#f0ebe1] transition-colors"
                  @click="closeEditor"
                >
                  取消
                </button>
                <template v-if="editorMode === 'edit' && editing.id && !presets.find(p => p.id === editing.id)?.isBuiltin">
                  <!-- Show delete only for non-builtin presets -->
                    <button
                      v-if="deleteConfirmId !== editing.id"
                      class="ml-auto text-sm text-red-500 hover:text-red-700 transition-colors"
                      @click="deleteConfirmId = editing.id"
                    >
                      删除
                    </button>
                    <div v-else class="ml-auto flex items-center gap-2 text-sm">
                      <span class="text-[#6b6352]">确认删除？</span>
                      <button
                        class="text-red-600 font-medium hover:text-red-800"
                        @click="confirmDelete(editing.id!)"
                      >确认</button>
                      <button
                        class="text-[#6b6352] hover:text-[#2c2c2c]"
                        @click="deleteConfirmId = undefined"
                      >取消</button>
                    </div>
                </template>
              </template>
              <template v-else>
                <button
                  class="px-4 py-2 rounded border border-[#c4b89a] text-[#5c5240] text-sm hover:bg-[#f0ebe1] transition-colors"
                  @click="closeEditor"
                >
                  关闭
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
