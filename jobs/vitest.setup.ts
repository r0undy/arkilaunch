import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });
