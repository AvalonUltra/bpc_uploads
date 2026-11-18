// The upstream sync (tools/sync-upstream.mjs), on repositories made for the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RELEASE_FILE, applySync, commitMessage, newestChanges, plainLines, planSync } from '../../tools/sync-upstream.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bpc-sync-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A Chrome release zip like upstream's: one folder with manifest.json and changelog.txt.
function chromeZip(file, version, changes) {
  const dir = fs.mkdtempSync(path.join(tmp, 'zip-'));
  const root = path.join(dir, 'bypass-paywalls-chrome-clean-master');
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, version }));
  fs.writeFileSync(path.join(root, 'custom', 'manifest.json'), JSON.stringify({ version: '0.0.1' }));
  fs.writeFileSync(path.join(root, 'changelog.txt'), `Changelog Bypass Paywalls Clean - Chrome\nUpdates: https://example.invalid\n\nPost-release\n${changes.join('\n')}\n\n* v1.0.0 (2026-01-01)\nFix Older\n`);
  execFileSync('zip', ['-q', '-r', '-X', file, 'bypass-paywalls-chrome-clean-master'], { cwd: dir });
}

function repository(name, files, { links = {} } = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    if (typeof content === 'function') content(path.join(dir, rel));
    else fs.writeFileSync(path.join(dir, rel), content);
  }
  for (const [rel, target] of Object.entries(links)) fs.symlinkSync(target, path.join(dir, rel));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Release latest');
  return dir;
}

const tracked = (dir) => git(dir, 'ls-files').split('\n').filter(Boolean).sort();
const noRetry = { attempts: 1 };

test('release file names', () => {
  for (const name of ['bypass-paywalls-chrome-clean-master.zip', 'bypass_paywalls_clean-4.4.9.5-custom.xpi', 'bypass-paywalls-chrome-clean-4.4.9.5.crx', 'release-hashes.txt'])
    assert.ok(RELEASE_FILE.test(name), name);
  for (const name of ['README.md', '.gitignore', '.github', 'safari', 'evil.sh', 'x.zip.sh', '-rf.zip', '.hidden.zip', 'a b.zip', 'a/b.zip', 'release-hashes.txt.sh', 'package.json'])
    assert.ok(!RELEASE_FILE.test(name), name);
});

test('text of upstream is made plain', () => {
  assert.deepEqual(plainLines('Fix A (thanks @someone)\n\n```\n::error::x\n<b>bold</b>\t tab\n' + 'x'.repeat(300)), [
    'Fix A (thanks (at)someone)', "'''", ': :error: :x', "'b'bold'/b' tab", 'x'.repeat(157) + '...',
  ]);
  assert.deepEqual(plainLines('a\nb\nc\nd', { maxLines: 2 }), ['a', 'b', '... (2 more)']);
  assert.deepEqual(newestChanges('Changelog\nUpdates: x\n\nPost-release\nFix A\nRemove B\n\n* v1.0 (2026)\nFix Old\n'), ['Fix A', 'Remove B']);
  assert.deepEqual(newestChanges('Changelog\n\n* v2.0 (2026)\nFix New\n\n* v1.0 (2026)\nFix Old\n'), ['Fix New']);
  assert.deepEqual(newestChanges('nothing here'), []);
});

test('sync: takes the release files of upstream and nothing else', () => {
  const upstream = repository('upstream', {
    'README.md': 'upstream readme\n',
    'bypass-paywalls-chrome-clean-master.zip': (f) => chromeZip(f, '2.0.1', ['Fix Old One', 'Fix New One (thanks @someone)']),
    'bypass-paywalls-firefox-clean-master.zip': 'firefox 2.0.1',
    'bypass-paywalls-chrome-clean-2.0.1.crx': 'crx 2.0.1',
    'bypass-paywalls-chrome-clean-latest.crx': 'crx 2.0.1',
    'bypass_paywalls_clean-2.0.1.xpi': 'the same xpi under a new name\n'.repeat(50),
    'release-hashes.txt': 'hashes 2.0.1\n',
    // What an upstream commit must never get into this repository:
    '.github/workflows/evil.yml': 'on: push\n',
    'safari/build.mjs': 'process.exit(1)\n',
    'tools/sync-upstream.mjs': 'process.exit(1)\n',
    'evil.sh': '#!/bin/sh\n',
    'package.json': '{}\n',
  }, { links: { 'linked.zip': '/etc/passwd' } });
  const fork = repository('fork', {
    'README.md': 'our readme\n',
    '.gitignore': 'build/\n',
    '.github/workflows/own.yml': 'on: workflow_dispatch\n',
    'safari/build.mjs': '// ours\n',
    'tools/sync-upstream.mjs': '// ours\n',
    'bypass-paywalls-chrome-clean-master.zip': (f) => chromeZip(f, '2.0.0', ['Fix Old One']),
    'bypass-paywalls-firefox-clean-master.zip': 'firefox 2.0.0',
    'bypass-paywalls-chrome-clean-2.0.0.crx': 'crx 2.0.0',
    'bypass-paywalls-chrome-clean-latest.crx': 'crx 2.0.0',
    'bypass_paywalls_clean-2.0.0.xpi': 'the same xpi under a new name\n'.repeat(50),
    'release-hashes.txt': 'hashes 2.0.1\n', // the same as upstream's
  });
  const before = tracked(fork);

  const plan = planSync({ dir: fork, upstream, fetch: noRetry });
  assert.equal(plan.changed, true);
  assert.equal(plan.version, '2.0.1');
  assert.equal(plan.previousVersion, '2.0.0');
  assert.equal(plan.upstream, git(upstream, 'rev-parse', 'HEAD').trim());
  assert.deepEqual(plan.added, ['bypass-paywalls-chrome-clean-2.0.1.crx', 'bypass_paywalls_clean-2.0.1.xpi']);
  assert.deepEqual(plan.updated, ['bypass-paywalls-chrome-clean-latest.crx', 'bypass-paywalls-chrome-clean-master.zip', 'bypass-paywalls-firefox-clean-master.zip']);
  assert.deepEqual(plan.removed, ['bypass-paywalls-chrome-clean-2.0.0.crx', 'bypass_paywalls_clean-2.0.0.xpi']);
  assert.deepEqual(plan.changes, ['Fix New One (thanks (at)someone)']);
  assert.deepEqual(plan.ignored.sort(), ['.github (a directory)', 'evil.sh (not a release file)', 'linked.zip (a symbolic link)', 'package.json (not a release file)', 'safari (a directory)', 'tools (a directory)']);
  // Planning changes nothing.
  assert.equal(git(fork, 'status', '--porcelain'), '');

  applySync(plan, { dir: fork });
  assert.deepEqual(git(fork, 'status', '--porcelain', '--no-renames').split('\n').filter(Boolean).sort(), [
    'A  bypass-paywalls-chrome-clean-2.0.1.crx',
    'A  bypass_paywalls_clean-2.0.1.xpi',
    'D  bypass-paywalls-chrome-clean-2.0.0.crx',
    'D  bypass_paywalls_clean-2.0.0.xpi',
    'M  bypass-paywalls-chrome-clean-latest.crx',
    'M  bypass-paywalls-chrome-clean-master.zip',
    'M  bypass-paywalls-firefox-clean-master.zip',
  ].sort());
  const message = commitMessage(plan);
  assert.match(message, /^Sync with upstream bpc_uploads \(2\.0\.1\)\n\n/);
  assert.match(message, new RegExp(`commit \\(${plan.upstream.slice(0, 7)}, from 2\\.0\\.0\\)`));
  assert.match(message, /New in upstream's changelog:\n  Fix New One \(thanks \(at\)someone\)\n/);
  assert.ok(!message.includes('@'));
  git(fork, 'commit', '-q', '-m', message);

  // Our own files are as they were; of upstream's, only release files arrived.
  assert.deepEqual(tracked(fork), [...before.filter((f) => !/2\.0\.0\.(crx|xpi)$/.test(f)), 'bypass-paywalls-chrome-clean-2.0.1.crx', 'bypass_paywalls_clean-2.0.1.xpi'].sort());
  assert.equal(fs.readFileSync(path.join(fork, 'README.md'), 'utf8'), 'our readme\n');
  assert.equal(fs.readFileSync(path.join(fork, 'safari/build.mjs'), 'utf8'), '// ours\n');
  assert.equal(fs.readFileSync(path.join(fork, 'tools/sync-upstream.mjs'), 'utf8'), '// ours\n');
  assert.deepEqual(fs.readdirSync(path.join(fork, '.github/workflows')), ['own.yml']);
  for (const gone of ['evil.sh', 'package.json', 'linked.zip']) assert.ok(!fs.existsSync(path.join(fork, gone)), gone);
  // The release files are upstream's, byte for byte, as plain files.
  for (const name of ['bypass-paywalls-chrome-clean-master.zip', 'bypass-paywalls-firefox-clean-master.zip', 'bypass-paywalls-chrome-clean-2.0.1.crx', 'bypass-paywalls-chrome-clean-latest.crx', 'bypass_paywalls_clean-2.0.1.xpi', 'release-hashes.txt']) {
    assert.ok(fs.readFileSync(path.join(fork, name)).equals(fs.readFileSync(path.join(upstream, name))), name);
    assert.equal(git(fork, 'ls-files', '-s', '--', name).slice(0, 6), '100644', name);
  }

  // Once synced there is nothing to do, and nothing is touched.
  const again = planSync({ dir: fork, upstream, fetch: noRetry });
  assert.equal(again.changed, false);
  assert.deepEqual([again.added, again.updated, again.removed, again.changes], [[], [], [], []]);
  assert.equal(again.version, '2.0.1');
  assert.equal(git(fork, 'status', '--porcelain'), '');
});

test('sync: an upstream that does not look like a release is refused', () => {
  const fork = repository('fork2', {
    'bypass-paywalls-chrome-clean-master.zip': (f) => chromeZip(f, '2.0.0', []),
    'bypass-paywalls-firefox-clean-master.zip': 'firefox',
  });
  const noChrome = repository('upstream-no-chrome', { 'bypass-paywalls-firefox-clean-master.zip': 'firefox', 'README.md': 'x' });
  assert.throws(() => planSync({ dir: fork, upstream: noChrome, fetch: noRetry }), /upstream has no bypass-paywalls-chrome-clean-master\.zip/);
  // The Chrome zip replaced by a link.
  const linked = repository('upstream-linked', { 'bypass-paywalls-firefox-clean-master.zip': 'firefox' }, { links: { 'bypass-paywalls-chrome-clean-master.zip': '/etc/passwd' } });
  assert.throws(() => planSync({ dir: fork, upstream: linked, fetch: noRetry }), /upstream has no bypass-paywalls-chrome-clean-master\.zip/);
  const notAZip = repository('upstream-not-a-zip', { 'bypass-paywalls-chrome-clean-master.zip': 'not a zip', 'bypass-paywalls-firefox-clean-master.zip': 'firefox' });
  assert.throws(() => planSync({ dir: fork, upstream: notAZip, fetch: noRetry }));
  const oddVersion = repository('upstream-odd-version', {
    'bypass-paywalls-chrome-clean-master.zip': (f) => chromeZip(f, '1.0\nchanged=false', []),
    'bypass-paywalls-firefox-clean-master.zip': 'firefox',
  });
  assert.throws(() => planSync({ dir: fork, upstream: oddVersion, fetch: noRetry }), /unexpected version/);
  const huge = repository('upstream-huge', {
    'bypass-paywalls-chrome-clean-master.zip': (f) => chromeZip(f, '2.0.1', []),
    'bypass-paywalls-firefox-clean-master.zip': 'x'.repeat(5000),
  });
  assert.throws(() => planSync({ dir: fork, upstream: huge, maxBytes: 1000, fetch: noRetry }), /more than a release file can be/);
  assert.throws(() => planSync({ dir: fork, upstream: path.join(tmp, 'missing'), fetch: noRetry }), /could not fetch main/);
  assert.throws(() => planSync({ dir: fork, upstream: noChrome, branch: '--upload-pack=x', fetch: noRetry }), /unexpected branch name/);
  assert.equal(git(fork, 'status', '--porcelain'), '');
});

// --- The steps of the workflow (.github/workflows/upstream-sync.yml) ----------
// tools/ci/*.sh, run as the workflow runs them, against a repository that
// stands in for the one on GitHub and a gh command that records what it is
// asked to do.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const haveTools = ['bash', 'jq', 'zip', 'unzip'].every((tool) => spawnSync(tool, ['--version'], { stdio: 'ignore' }).error === undefined);

const fakeBin = path.join(tmp, 'bin');
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const { execFileSync } = require('child_process');
const args = process.argv.slice(2);
const entry = { args };
const bodyFile = args.indexOf('--body-file');
if (bodyFile >= 0) entry.body = fs.readFileSync(args[bodyFile + 1], 'utf8');
fs.appendFileSync(process.env.GH_FAKE_LOG, JSON.stringify(entry) + '\\n');
if (args[0] === 'issue' && args[1] === 'list' && process.env.GH_FAKE_ISSUES_OFF) {
  process.stderr.write("the 'owner/repo' repository has disabled issues\\n");
  process.exit(1);
}
if (args[0] === 'issue' && args[1] === 'list' && process.env.GH_FAKE_LIST_ERROR) {
  process.stderr.write('HTTP 502: Bad Gateway\\n');
  process.exit(1);
}
if (args[0] === 'issue' && args[1] === 'list') {
  const jq = args.indexOf('--jq');
  process.stdout.write(execFileSync('jq', ['-r', jq >= 0 ? args[jq + 1] : '.', process.env.GH_FAKE_ISSUES], { encoding: 'utf8' }));
}
if (args[0] === 'issue' && args[1] === 'create' && args.includes('--assignee') && process.env.GH_FAKE_NO_ASSIGNEE) process.exit(1);
`, { mode: 0o755 });

let stepCount = 0;
// Runs one of the scripts; returns its exit status, output, GITHUB_OUTPUT values and the gh calls.
function step(script, dir, env, issues = []) {
  const id = ++stepCount;
  const files = { out: path.join(tmp, `output-${id}`), log: path.join(tmp, `gh-${id}.log`), issues: path.join(tmp, `issues-${id}.json`), summary: path.join(tmp, `summary-${id}.md`) };
  fs.writeFileSync(files.out, '');
  fs.writeFileSync(files.summary, '');
  fs.writeFileSync(files.log, '');
  fs.writeFileSync(files.issues, JSON.stringify(issues));
  const res = spawnSync('bash', [path.join(repoRoot, 'tools', 'ci', script)], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GITHUB_OUTPUT: files.out, RUNNER_TEMP: tmp, GH_FAKE_LOG: files.log, GH_FAKE_ISSUES: files.issues,
      GITHUB_STEP_SUMMARY: files.summary,
      CANDIDATE_BRANCH: 'upstream-sync', ISSUE_LABEL: 'upstream-sync', GITHUB_REPOSITORY_OWNER: 'owner', ...env,
    },
  });
  return {
    status: res.status,
    text: res.stdout + res.stderr,
    outputs: Object.fromEntries(fs.readFileSync(files.out, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])),
    gh: fs.readFileSync(files.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    summary: fs.readFileSync(files.summary, 'utf8'),
  };
}

test('workflow steps: a new release goes to the candidate branch and, once accepted, to main', { skip: haveTools ? false : 'bash, jq, zip or unzip is missing' }, () => {
  const upstream = repository('ci-upstream', {
    'README.md': 'upstream readme\n',
    'bypass-paywalls-chrome-clean-master.zip': (f) => chromeZip(f, '3.0.1', ['Fix Something']),
    'bypass-paywalls-firefox-clean-master.zip': 'firefox 3.0.1',
    'release-hashes.txt': 'hashes 3.0.1\n',
  });
  const seed = repository('ci-seed', {
    'README.md': 'our readme\n',
    'safari/build.mjs': '// ours\n',
    'bypass-paywalls-chrome-clean-master.zip': (f) => chromeZip(f, '3.0.0', []),
    'bypass-paywalls-firefox-clean-master.zip': 'firefox 3.0.0',
    'release-hashes.txt': 'hashes 3.0.0\n',
  });
  // The repository on GitHub.
  const origin = path.join(tmp, 'ci-origin.git');
  git(tmp, 'clone', '-q', '--bare', seed, origin);
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const remote = (...args) => git(origin, ...args).trim();
  const branches = () => remote('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort();
  // A checkout as actions/checkout makes it: one commit of history, or two.
  let checkouts = 0;
  const checkout = (ref, depth = 1) => {
    const dir = path.join(tmp, `ci-checkout-${++checkouts}`);
    fs.mkdirSync(dir);
    git(dir, 'init', '-q');
    git(dir, 'fetch', '-q', `--depth=${depth}`, `file://${origin}`, ref);
    git(dir, 'checkout', '-q', '--detach', 'FETCH_HEAD');
    return dir;
  };
  // The first job up to its last step: upstream's files are staged, the message written.
  const staged = () => {
    const dir = checkout('main');
    const plan = planSync({ dir, upstream, fetch: noRetry });
    if (plan.changed) applySync(plan, { dir });
    const message = path.join(dir, '.git', 'sync-message.txt');
    fs.writeFileSync(message, commitMessage(plan));
    return { dir, plan, env: { CHANGED: String(plan.changed), UPSTREAM: plan.upstream, MESSAGE_FILE: message, PUSH_URL: origin } };
  };
  const main0 = remote('rev-parse', 'main');

  // A failure of this release on this main is on record: a scheduled run does not try again...
  let job = staged();
  const marker = `<!-- upstream=${job.plan.upstream} base=${main0} -->`;
  const reported = [{ number: 4, body: null }, { number: 7, body: `failed\n\n${marker}\n` }];
  let res = step('candidate.sh', job.dir, { ...job.env, GITHUB_EVENT_NAME: 'schedule' }, reported);
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(res.outputs, { proceed: 'false' });
  assert.match(res.text, /already failed on this main, see issue #7/);
  assert.deepEqual(branches(), ['main']);
  // ...but one about another main, or another release, does not stop it.
  res = step('candidate.sh', job.dir, { ...job.env, GITHUB_EVENT_NAME: 'schedule' }, [{ number: 7, body: marker.replace(main0, '0'.repeat(40)) }, { number: 8, body: '' }]);
  assert.equal(res.status, 0, res.text);
  assert.equal(res.outputs.proceed, 'true');
  const first = res.outputs.sha;
  assert.equal(remote('rev-parse', 'upstream-sync'), first);

  // Issues turned off (as in a new fork): nothing is on record, the scheduled run goes on.
  job = staged();
  res = step('candidate.sh', job.dir, { ...job.env, GITHUB_EVENT_NAME: 'schedule', GH_FAKE_ISSUES_OFF: '1' }, reported);
  assert.equal(res.status, 0, res.text);
  assert.equal(res.outputs.proceed, 'true');
  assert.match(res.text, /Issues are turned off/);
  // Any other error of gh still stops it.
  job = staged();
  res = step('candidate.sh', job.dir, { ...job.env, GITHUB_EVENT_NAME: 'schedule', GH_FAKE_LIST_ERROR: '1' }, reported);
  assert.notEqual(res.status, 0);
  assert.match(res.text, /HTTP 502/);
  assert.deepEqual(res.outputs, {});

  // A run started by hand tries again whatever is on record, and replaces the candidate.
  job = staged();
  res = step('candidate.sh', job.dir, { ...job.env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, reported);
  assert.equal(res.status, 0, res.text);
  const { sha, base } = res.outputs;
  assert.equal(res.outputs.proceed, 'true');
  assert.equal(base, main0);
  assert.deepEqual(res.gh, [], 'no question to GitHub when started by hand');
  assert.deepEqual(branches(), ['main', 'upstream-sync']);
  assert.equal(remote('rev-parse', 'upstream-sync'), sha);
  assert.equal(remote('rev-parse', 'main'), main0, 'main is not touched before the tests have passed');
  assert.equal(remote('rev-parse', `${sha}^`), main0);
  assert.equal(remote('log', '-1', '--format=%an <%ae>|%s', sha), 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>|Sync with upstream bpc_uploads (3.0.1)');
  assert.deepEqual(remote('diff', '--name-only', main0, sha).split('\n').sort(), ['bypass-paywalls-chrome-clean-master.zip', 'bypass-paywalls-firefox-clean-master.zip', 'release-hashes.txt']);

  // The last job: main moves to the candidate, the candidate branch goes.
  res = step('promote.sh', checkout(sha, 2), { SHA: sha, BASE: base, PUSH_URL: origin });
  assert.equal(res.status, 0, res.text);
  assert.equal(remote('rev-parse', 'main'), sha);
  assert.deepEqual(branches(), ['main']);
  // And then there is nothing left to sync.
  assert.equal(planSync({ dir: checkout('main'), upstream, fetch: noRetry }).changed, false);

  // A rehearsal: every step with an empty commit.
  job = staged();
  assert.equal(job.plan.changed, false);
  res = step('candidate.sh', job.dir, { ...job.env, GITHUB_EVENT_NAME: 'workflow_dispatch' });
  assert.equal(res.status, 0, res.text);
  assert.equal(remote('log', '-1', '--format=%s', res.outputs.sha), 'Rehearsal of the upstream sync (no changes)');
  assert.equal(remote('diff', '--name-only', sha, res.outputs.sha), '');
  const rehearsal = res.outputs.sha;
  res = step('promote.sh', checkout(rehearsal, 2), { SHA: rehearsal, BASE: res.outputs.base, PUSH_URL: origin });
  assert.equal(res.status, 0, res.text);
  assert.equal(remote('rev-parse', 'main'), rehearsal);

  // --- What the last job refuses ---
  const commitOn = (ref, files, branch) => {
    const dir = checkout(ref);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'change');
    // (the candidate branch is replaced, as the first job replaces it)
    git(dir, 'push', '-q', ...(branch === 'main' ? [] : ['--force']), origin, `HEAD:refs/heads/${branch}`);
    return git(dir, 'rev-parse', 'HEAD').trim();
  };
  // A candidate with anything but release files in it.
  const tampered = commitOn('main', { 'release-hashes.txt': 'x\n', 'safari/build.mjs': '// not ours\n', '.github/workflows/evil.yml': 'on: push\n' }, 'upstream-sync');
  res = step('promote.sh', checkout(tampered, 2), { SHA: tampered, BASE: rehearsal, PUSH_URL: origin });
  assert.equal(res.status, 1, res.text);
  assert.match(res.text, /changes more than release files/);
  assert.match(res.text, /^\.github\/workflows\/evil\.yml$/m);
  assert.match(res.text, /^safari\/build\.mjs$/m);
  assert.equal(remote('rev-parse', 'main'), rehearsal);
  // A candidate that is not one commit on top of the main it was made on.
  const second = commitOn(tampered, { 'release-hashes.txt': 'y\n' }, 'upstream-sync');
  res = step('promote.sh', checkout(second, 2), { SHA: second, BASE: rehearsal, PUSH_URL: origin });
  assert.equal(res.status, 1, res.text);
  assert.match(res.text, /not one commit on top of/);
  // Another commit than the candidate in the checkout.
  res = step('promote.sh', checkout('main', 2), { SHA: second, BASE: rehearsal, PUSH_URL: origin });
  assert.equal(res.status, 1, res.text);
  assert.match(res.text, /The checkout is not the candidate/);
  // main moved while the tests ran: nothing is overwritten.
  const good = commitOn('main', { 'release-hashes.txt': 'hashes 3.0.2\n' }, 'upstream-sync');
  const moved = commitOn('main', { 'README.md': 'our readme, edited\n' }, 'main');
  res = step('promote.sh', checkout(good, 2), { SHA: good, BASE: rehearsal, PUSH_URL: origin });
  assert.notEqual(res.status, 0, res.text);
  assert.equal(remote('rev-parse', 'main'), moved);
});

test('workflow steps: the issue about a failed sync is opened, updated and closed', { skip: haveTools ? false : 'bash, jq, zip or unzip is missing' }, () => {
  const sha = 'a'.repeat(40), base = 'b'.repeat(40), upstream = 'c'.repeat(40);
  const env = { VERSION: '3.0.1', UPSTREAM: upstream, BASE: base, SHA: sha, RUN_URL: 'https://github.example/run/1', FAILURES: '' };
  const calls = (res) => res.gh.map((c) => c.args.slice(0, 2).join(' '));
  const none = { TEST: 'skipped', ENGINE: 'skipped', PROMOTE: 'skipped' };

  // Nothing new upstream, nothing on record.
  let res = step('report.sh', tmp, { ...env, ...none, CHANGED: 'false', PROCEED: '' });
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(calls(res), ['issue list']);
  // Nothing new upstream any more: an earlier failure is over (someone synced by hand).
  res = step('report.sh', tmp, { ...env, ...none, CHANGED: 'false', PROCEED: '' }, [{ number: 7 }, { number: 9 }]);
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(res.gh.slice(1).map((c) => c.args.slice(0, 3).join(' ')), ['issue close 7', 'issue close 9']);
  // (as the first job calls it, with nothing about an attempt)
  res = step('report.sh', tmp, { CHANGED: 'false', PROMOTE: 'skipped', VERSION: '3.0.1', RUN_URL: env.RUN_URL }, [{ number: 7 }]);
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(res.gh.slice(1).map((c) => c.args.slice(0, 3).join(' ')), ['issue close 7']);
  // The release was accepted: the same.
  res = step('report.sh', tmp, { ...env, CHANGED: 'true', PROCEED: 'true', TEST: 'success', ENGINE: 'success', PROMOTE: 'success' }, [{ number: 7 }]);
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(res.gh.slice(1).map((c) => c.args.slice(0, 3).join(' ')), ['issue close 7']);
  assert.match(res.gh[1].args.join(' '), /3\.0\.1/);
  // A failure that is on record and was not tried again: the issue stays as it is.
  res = step('report.sh', tmp, { ...env, ...none, CHANGED: 'true', PROCEED: 'false' }, [{ number: 7 }]);
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(calls(res), ['issue list']);

  // The tests failed: an issue is opened, for the owner.
  const failures = 'build failed: sites.js: expected 1 match(es), found 0\nnot ok 3 - a test `with` markup, @someone and ' + 'x'.repeat(400);
  res = step('report.sh', tmp, { ...env, CHANGED: 'true', PROCEED: 'true', TEST: 'failure', ENGINE: 'skipped', PROMOTE: 'skipped', FAILURES: failures });
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(calls(res), ['issue list', 'label create', 'issue create']);
  const created = res.gh[2];
  assert.deepEqual(created.args.slice(2, 4), ['--title', '上游同步失败：3.0.1']);
  assert.deepEqual(created.args.slice(-4), ['--label', 'upstream-sync', '--assignee', 'owner']);
  assert.match(created.body, /上游发布了 \*\*3\.0\.1\*\*/);
  assert.match(created.body, /\| 构建和 Node 测试 \| failure \|\n\| WebKit 引擎和 Safari 测试 \| skipped \|\n\| 合入 main \| skipped \|/);
  assert.match(created.body, /https:\/\/github\.example\/run\/1/);
  assert.match(created.body, /候选提交：`aaaaaaa`，在分支 `upstream-sync` 上/);
  assert.match(created.body, /```text\nbuild failed: sites\.js: expected 1 match\(es\), found 0\nnot ok 3 - a test with markup, \(at\)someone and x+\n```/);
  assert.ok(created.body.split('\n').every((l) => l.length <= 320), 'long lines are cut');
  // What the first job looks for before it tries a release again.
  assert.ok(created.body.includes(`<!-- upstream=${upstream} base=${base} -->`));
  // Where the owner cannot be assigned, the issue is opened without.
  res = step('report.sh', tmp, { ...env, CHANGED: 'true', PROCEED: 'true', TEST: 'success', ENGINE: 'failure', PROMOTE: 'skipped', GH_FAKE_NO_ASSIGNEE: '1' });
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(calls(res), ['issue list', 'label create', 'issue create', 'issue create']);
  assert.ok(!res.gh[3].args.includes('--assignee'));
  assert.ok(!res.gh[3].body.includes('```'), 'no empty block when the tests said nothing');
  // An issue is open already: it is brought up to date instead.
  res = step('report.sh', tmp, { ...env, CHANGED: 'true', PROCEED: 'true', TEST: 'success', ENGINE: 'success', PROMOTE: 'failure' }, [{ number: 7 }, { number: 9 }]);
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(res.gh.slice(1).map((c) => c.args.slice(0, 3).join(' ')), ['issue edit 7', 'issue comment 7']);
  assert.match(res.gh[1].body, /\| 合入 main \| failure \|/);
});

test('workflow steps: with Issues turned off, a failed sync is in the summary of the run, which fails', { skip: haveTools ? false : 'bash, jq, zip or unzip is missing' }, () => {
  const sha = 'a'.repeat(40), base = 'b'.repeat(40), upstream = 'c'.repeat(40);
  const env = { VERSION: '3.0.1', UPSTREAM: upstream, BASE: base, SHA: sha, RUN_URL: 'https://github.example/run/1', FAILURES: '', GH_FAKE_ISSUES_OFF: '1' };
  const calls = (res) => res.gh.map((c) => c.args.slice(0, 2).join(' '));

  // Nothing new upstream (as the first job calls it): nothing to close, the step passes.
  let res = step('report.sh', tmp, { CHANGED: 'false', PROMOTE: 'skipped', VERSION: '3.0.1', RUN_URL: env.RUN_URL, GH_FAKE_ISSUES_OFF: '1' });
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(calls(res), ['issue list']);
  assert.equal(res.summary, '');
  // The release was accepted: the same.
  res = step('report.sh', tmp, { ...env, CHANGED: 'true', PROCEED: 'true', TEST: 'success', ENGINE: 'success', PROMOTE: 'success' });
  assert.equal(res.status, 0, res.text);
  assert.deepEqual(calls(res), ['issue list']);
  // A failure: no issue, the report goes to the summary and the step fails.
  res = step('report.sh', tmp, { ...env, CHANGED: 'true', PROCEED: 'true', TEST: 'failure', ENGINE: 'skipped', PROMOTE: 'skipped', FAILURES: 'build failed: sites.js: expected 1 match(es), found 0' });
  assert.equal(res.status, 1, res.text);
  assert.deepEqual(calls(res), ['issue list']);
  assert.match(res.text, /::error::上游同步失败：3\.0\.1/);
  assert.match(res.summary, /^## 上游同步失败：3\.0\.1\n/);
  assert.match(res.summary, /关闭了 Issues/);
  assert.match(res.summary, /\| 构建和 Node 测试 \| failure \|/);
  assert.match(res.summary, /expected 1 match\(es\), found 0/);
  assert.match(res.summary, /https:\/\/github\.example\/run\/1/);
  assert.ok(!res.summary.includes('<!--'));
  // Any other error of gh still stops the step, without a report.
  res = step('report.sh', tmp, { ...env, GH_FAKE_ISSUES_OFF: '', GH_FAKE_LIST_ERROR: '1', CHANGED: 'true', PROCEED: 'true', TEST: 'failure', ENGINE: 'skipped', PROMOTE: 'skipped' });
  assert.notEqual(res.status, 0);
  assert.match(res.text, /HTTP 502/);
  assert.equal(res.summary, '');
});
