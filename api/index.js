// Vercel entry point. vercel.json routes /api/* and /share-target here; the
// static front end in public/ is served by Vercel directly.
import { handle } from '../server.js';

export default handle;
