import 'dotenv/config';
import { ensureDatabaseSchemaReady, prisma } from '../server/prisma.js';
import { ensureSeededAccounts, getConfiguredSeededAccounts } from '../server/seed.js';

async function main() {
  await ensureDatabaseSchemaReady();
  const configured = getConfiguredSeededAccounts();
  console.log(`[Seed Accounts] Configured emails (${configured.length}):`);
  for (const acc of configured) {
    console.log(`  - ${acc.name} <${acc.email}>`);
  }

  const result = await ensureSeededAccounts(true);
  console.log(
    `[Seed Accounts] Complete: ${result.created.length} created, ${result.existing.length} already present.`
  );
  if (result.created.length > 0) {
    console.log(`  Created: ${result.created.join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error('[Seed Accounts] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
