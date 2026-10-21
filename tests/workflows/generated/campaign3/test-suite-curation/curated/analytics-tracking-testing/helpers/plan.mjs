import { readFileSync } from 'node:fs';
// The versioned tracking plan, derived from the application contract.
export const plan = JSON.parse(readFileSync(new URL('../tracking-plan.json', import.meta.url), 'utf8'));
