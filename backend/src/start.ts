import { fileURLToPath } from 'node:url';

interface StartupSteps {
  migrate: () => Promise<number>;
  serve: () => Promise<unknown>;
}

export async function startAfterMigrations({ migrate, serve }: StartupSteps): Promise<number> {
  const exitCode = await migrate();
  if (exitCode !== 0) return exitCode;
  await serve();
  return 0;
}

if (import.meta.main) {
  const exitCode = await startAfterMigrations({
    // Migrations exit their process on completion. Run them as a child so the
    // server starts only after success, without requiring a container shell.
    migrate: async () => Bun.spawn([
      process.execPath,
      fileURLToPath(new URL('./db/migrate.ts', import.meta.url)),
    ], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }).exited,
    serve: () => import('./server'),
  });
  if (exitCode !== 0) process.exit(exitCode);
}
