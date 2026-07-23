import { PrismaClient } from "@prisma/client";

const p = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:wlUNMFezavqTaAzMPjJxkjzwGeSPOWaS@postgres.railway.internal:5432/railway" } },
});

const rows = await p.customer.findMany({ take: 5, select: { id: true, name: true, company: true, email: true } });
console.log(`Customer count: ${rows.length}`);
rows.forEach(r => console.log(`  ${r.id} | ${r.name} | ${r.company ?? "-"}`));

await p.$disconnect();
