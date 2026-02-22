import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const TEST_DATA_DIR = path.join(os.tmpdir(), 'trusty-track-screenshots');

export default async function globalSetup() {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  console.log(`\nCleaned screenshot test data directory: ${TEST_DATA_DIR}`);
}
