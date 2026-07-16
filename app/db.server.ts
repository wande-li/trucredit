import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

const PROD_CONNECTION_LIMIT = 8;

function buildDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  if (!url.searchParams.has("pgbouncer")) {
    url.searchParams.set("pgbouncer", "true");
  }
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", String(PROD_CONNECTION_LIMIT));
  }
  return url.toString();
}

const prismaConfig = {
  log: ["warn", "error"] as Array<"warn" | "error">,
  ...(process.env.NODE_ENV === "production" && {
    datasourceUrl: buildDatasourceUrl(),
  }),
};

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient(prismaConfig);
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient(prismaConfig);

export default prisma;
