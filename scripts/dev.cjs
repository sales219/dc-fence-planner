const { spawn } = require('child_process');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const vite = spawn(npmCmd, ['run', 'vite:dev'], { stdio: 'inherit', shell: false });

const wait = setInterval(async () => {
  try {
    const res = await fetch('http://127.0.0.1:5173');
    if (res.ok) {
      clearInterval(wait);
      const electron = spawn(npmCmd, ['run', 'electron:dev'], { stdio: 'inherit', shell: false });
      electron.on('exit', (code) => {
        vite.kill();
        process.exit(code || 0);
      });
    }
  } catch (_) {
    // Vite is still starting.
  }
}, 500);

vite.on('exit', (code) => {
  clearInterval(wait);
  if (code) process.exit(code);
});
