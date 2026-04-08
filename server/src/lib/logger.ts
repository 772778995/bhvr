import pino from "pino";

// Treat as dev unless explicitly running in production.
// This means `tsx watch src/index.ts` (no NODE_ENV set) gets pretty-print + debug
// level automatically, without needing NODE_ENV=development.
const isDev = process.env.NODE_ENV !== "production";

const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  }),
});

export default logger;
