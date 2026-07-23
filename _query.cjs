const { Client } = require("pg");
const c = new Client({
  connectionString: "postgresql://postgres:wlUNMFezavqTaAzMPjJxkjzwGeSPOWaS@tokaido.proxy.rlwy.net:38449/railway",
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await c.connect();
  const r = await c.query(`SELECT id, name, company FROM "Customer" LIMIT 5`);
  console.log("Count:", r.rows.length);
  r.rows.forEach(row => console.log(row.id, "|", row.name, "|", row.company ?? "-"));
  await c.end();
}
main().catch(e => console.error(e.message));
