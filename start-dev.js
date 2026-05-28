const { spawn } = require('child_process');
const path = require('path');

// Delete ELECTRON_RUN_AS_NODE from the environment and set NODE_ENV
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.NODE_ENV = 'development';

const electronPath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');

const child = spawn(electronPath, ['.'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env }
});

child.on('close', (code) => {
  process.exit(code);
});
