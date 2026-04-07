<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  drag: [delta: number];
}>();

const dragging = ref(false);
let startX = 0;

function onMousedown(e: MouseEvent) {
  e.preventDefault();
  dragging.value = true;
  startX = e.clientX;

  const onMousemove = (ev: MouseEvent) => {
    const delta = ev.clientX - startX;
    startX = ev.clientX;
    emit("drag", delta);
  };

  const onMouseup = () => {
    dragging.value = false;
    window.removeEventListener("mousemove", onMousemove);
    window.removeEventListener("mouseup", onMouseup);
  };

  window.addEventListener("mousemove", onMousemove);
  window.addEventListener("mouseup", onMouseup);
}
</script>

<template>
  <div
    class="group relative flex w-3 shrink-0 cursor-col-resize items-center justify-center"
    :class="dragging ? 'z-10' : ''"
    @mousedown="onMousedown"
  >
    <!-- Hit area (wider than visual line for easy grabbing) -->
    <div
      class="h-full w-px bg-[#d7cfbf] transition-all duration-150 group-hover:w-[3px] group-hover:bg-[#b8a98a]"
      :class="dragging ? 'w-[3px] bg-[#b8a98a]' : ''"
    />
  </div>
</template>
