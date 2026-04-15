const { spawn } = require('child_process');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`));
      }
    });
  });
}

async function main() {
  await run('npm', ['run', 'db:setup']);
  await run('npm', ['run', 'dev']);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});