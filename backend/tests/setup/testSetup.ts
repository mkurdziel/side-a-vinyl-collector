import { beforeAll, afterAll } from 'vitest';
import { setupTestContainers, teardownTestContainers } from './testContainers';

// Setup test containers before all tests
beforeAll(async () => {
  console.log('🚀 Starting test containers...');
  await setupTestContainers();
  console.log('✅ Test containers ready');
}, 60000);

// Cleanup after all tests
afterAll(async () => {
  console.log('🧹 Cleaning up test containers...');
  await teardownTestContainers();
  console.log('✅ Cleanup complete');
});
