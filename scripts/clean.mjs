import { rm } from 'node:fs/promises';

// Only generated library output; a failed build must not leave stale declarations.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
