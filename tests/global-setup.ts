import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// SQLite resuelve "file:./test.db" relativo a prisma/schema.prisma.
const TEST_DB_FILES = ["prisma/test.db", "prisma/test.db-journal"];

// Crea una base SQLite de pruebas nueva antes de ejecutar la suite.
export default function setup(): void {
  for (const file of TEST_DB_FILES) rmSync(file, { force: true });
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
  });
}
