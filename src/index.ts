import { appConfig } from "./config.js";
import { DiscordCodexBot } from "./discordBot.js";
import { AppDb } from "./db.js";
import {
  acquireSingleInstancePortLock,
  SingleInstanceError,
} from "./singleInstance.js";
import { createAppLogger } from "./logger.js";
import { getBuildLabel } from "./buildInfo.js";

const EXIT_SINGLE_INSTANCE = 10;

async function main(): Promise<void> {
  const build = getBuildLabel();
  console.log(`build: ${build}`);

  const releaseLock = await acquireSingleInstancePortLock(appConfig.instanceLockPort);
  const logger = createAppLogger(appConfig.logLevel);
  logger.info({ build }, "startup build");
  const shutdown = async (): Promise<void> => {
    try {
      await releaseLock();
    } catch (err) {
      logger.warn({ err }, "failed to release single-instance lock");
    }
  };
  process.once("SIGINT", () => {
    shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });

  const db = new AppDb(appConfig.sqlitePath);
  const cancelled = db.cancelInFlightExecutionsOnStartup();
  if (cancelled > 0) {
    logger.warn({ cancelled }, "in-flight executions were cancelled on startup");
  }
  setInterval(() => {
    try {
      db.cleanupOldData(90);
    } catch (err) {
      logger.warn({ err }, "cleanup failed");
    }
  }, 24 * 60 * 60 * 1000);

  const bot = new DiscordCodexBot({ db, logger });
  try {
    await bot.start();
  } catch (err) {
    await shutdown();
    throw err;
  }
}

main().catch((err) => {
  if (err instanceof SingleInstanceError) {
    console.error(`single-instance lock already in use: ${err.message}`);
    process.exit(EXIT_SINGLE_INSTANCE);
    return;
  }
  console.error(err);
  process.exit(1);
});
