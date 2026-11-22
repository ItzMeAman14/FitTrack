import { createApiApp } from '../server/app.js';

const app = createApiApp({ includeErrorHandler: true });

export default app;
