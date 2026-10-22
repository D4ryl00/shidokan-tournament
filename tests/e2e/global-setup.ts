import fs from 'node:fs';

export default function globalSetup() {
  fs.rmSync('tmp/e2e', { recursive: true, force: true });
}
