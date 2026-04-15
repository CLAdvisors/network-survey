const fs = require('fs');
const path = require('path');
const treeKill = require('tree-kill');

const repoRoot = path.resolve(__dirname, '..');
const stateFilePath = path.join(repoRoot, '.local-dev.state.json');
const stoppingFilePath = path.join(repoRoot, '.local-dev.stopping');

function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid || !isProcessRunning(pid)) {
      resolve();
      return;
    }

    treeKill(pid, 'SIGTERM', () => resolve());
  });
}

async function main() {
  if (!fs.existsSync(stateFilePath)) {
    console.log('No active local dev runner found.');
    return;
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch (error) {
    fs.unlinkSync(stateFilePath);
    console.log('Removed an unreadable local dev state file.');
    return;
  }

  fs.writeFileSync(stoppingFilePath, 'stopping', 'utf8');

  const servicePids = (state.services || [])
    .map((service) => service.pid)
    .filter(Boolean)
    .filter((pid, index, values) => values.indexOf(pid) === index)
    .filter((pid) => pid !== process.pid);

  // Stop children before the runner so the runner can exit through its graceful signal path.
  const pids = [...servicePids, state.runnerPid]
    .filter(Boolean)
    .filter((pid, index, values) => values.indexOf(pid) === index)
    .filter((pid) => pid !== process.pid);

  for (const pid of pids) {
    await killProcessTree(pid);
  }

  if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
  }

  if (fs.existsSync(stoppingFilePath)) {
    fs.unlinkSync(stoppingFilePath);
  }

  console.log('Stopped local development services.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});