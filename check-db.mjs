import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const [s, sh] = await Promise.all([
  p.session.findFirst({ select: { shop: true, id: true } }),
  p.shop.findFirst({ select: { shopDomain: true, plan: true } }),
]);
console.log("Session:", s?.shop || "NONE", s?.id || "");
console.log("Shop:", sh?.shopDomain || "NONE", sh?.plan || "");
await p.$disconnect();
