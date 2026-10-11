/** Applies pending SQL migrations to the configured database. Safe to run repeatedly. */
import { loadConfig } from '../server/config/env.ts';
import { Database } from '../server/db/database.ts';

const config = loadConfig();
const db = new Database(config.databasePath);
const applied = db.migrate();
console.log(applied.length ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Database is up to date.');
console.log(`Database: ${config.databasePath}`);
db.close();
