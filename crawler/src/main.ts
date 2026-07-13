import { fileURLToPath } from 'node:url';

import { loadSourceConfig } from './config.js';
import { CrawlError } from './errors.js';
import { formatConfigSummary } from './summary.js';

const configPath = fileURLToPath(new URL('../config/sources.json', import.meta.url));

try {
  const config = await loadSourceConfig(configPath);
  console.log(formatConfigSummary(config));
} catch (error) {
  if (error instanceof CrawlError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
