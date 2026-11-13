const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronPath = require('electron');
const targetApp = electronPath;
const args = ['.'];

const child = spawn(targetApp, args, {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit'
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

