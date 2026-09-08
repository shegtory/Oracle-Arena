// Some constrained Windows CI hosts make os.userInfo() fail before tsx starts.
// Preserve normal behavior and provide a deterministic username only on that host error.
const os = require('node:os');
const original = os.userInfo;
try { original(); } catch { os.userInfo = () => ({ uid: -1, gid: -1, username: process.env.USERNAME || 'ci', homedir: process.env.USERPROFILE || process.cwd(), shell: null }); }
