import { readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL com a conexão PostgreSQL de destino.');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  const state = JSON.parse(await readFile(new URL('./data.json', import.meta.url), 'utf8'));
  await pool.query('CREATE TABLE IF NOT EXISTS skyline_state (id smallint PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL)');
  const migrated = await pool.query('INSERT INTO skyline_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [JSON.stringify(state)]);
  if (!migrated.rowCount) throw new Error('O banco já contém dados. A migração foi cancelada sem sobrescrevê-los.');
  console.log(`Estado local transferido: ${state.items.length} itens, ${state.entries.length} inscrições e ${state.results.length} resultados.`);
} catch (error) {
  console.error(`Não foi possível transferir o estado: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
