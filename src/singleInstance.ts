import net from "node:net";

export class SingleInstanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SingleInstanceError";
  }
}

export async function acquireSingleInstancePortLock(
  port: number,
): Promise<() => Promise<void>> {
  const server = net.createServer();
  server.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new SingleInstanceError(
            `another instance is already running (lock port: ${port})`,
          ),
        );
        return;
      }
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });

  return async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };
}
