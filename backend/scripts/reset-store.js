import { resetStore } from '../src/store.js';

resetStore()
  .then(() => {
    console.log('TrustVault store reset to seed data.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to reset TrustVault store:', error);
    process.exit(1);
  });
