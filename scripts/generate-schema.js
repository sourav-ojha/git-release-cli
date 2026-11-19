import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { configSchema } from '../src/config/schema.js';

const schema = z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any' });
await writeFile(new URL('../schemas/release-config.schema.json', import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
