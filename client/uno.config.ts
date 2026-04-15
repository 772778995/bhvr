import { defineConfig, presetWind4 } from "unocss";

export default defineConfig({
  content: {
    pipeline: {
      include: [/\.(vue|ts|tsx|js|jsx|html)($|\?)/],
    },
  },
  presets: [presetWind4()],
  theme: {
    colors: {
      ink: {
        50: "#f6f7f8",
        100: "#eceef1",
        200: "#d7dce2",
        300: "#b5bec8",
        400: "#7d8a99",
        500: "#5d6977",
        600: "#45505d",
        700: "#323a45",
        800: "#1f252d",
        900: "#11161c",
      },
    },
  },
});
