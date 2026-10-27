// Runs network-probe.js on every URL in targets.txt, saves each full output
// to results/, and tallies the verdicts. This tally is the spike's answer.
// Usage: node batch.js [targets-file]

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const targetsFile = process.argv[2] ?? path.join(__dirname, 'targets.txt');
const resultsDir = path.join(__dirname, 'results');

const targets = fs
  .readFileSync(targetsFile, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

// A fresh process per URL: the probe keeps its state in module-level
// variables, so separate processes keep one run from leaking into the next.
function probe(url) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(__dirname, 'network-probe.js'), url],
      { timeout: 180_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const note = err?.killed ? '\n(probe timed out after 180s)' : '';
        resolve(stdout + stderr + note);
      }
    );
  });
}

async function main() {
  fs.mkdirSync(resultsDir, { recursive: true });
  const tally = {};

  for (const [i, url] of targets.entries()) {
    const output = await probe(url);
    const verdict = output.match(/^Verdict:\s+(.*)$/m)?.[1] ?? 'NO VERDICT: probe crashed or timed out';
    const route = verdict.split(':')[0];
    tally[route] = (tally[route] ?? 0) + 1;

    const name = `${String(i + 1).padStart(2, '0')}-${new URL(url).hostname}.txt`;
    fs.writeFileSync(path.join(resultsDir, name), output);

    // Show the top data endpoint too, so a wrong verdict is easy to spot by eye.
    const topData = output.match(/^\s+DATA\s+(.*)$/m)?.[1];
    console.log(`[${i + 1}/${targets.length}] ${route.padEnd(14)} ${url}`);
    if (topData) console.log(`        ${topData.slice(0, 150)}`);
  }

  console.log('\n=== Tally ===');
  for (const [route, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`${route.padEnd(16)} ${count}`);
  }
}

main();
