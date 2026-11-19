const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github/workflows/fork-validation.yml');
const workflowSource = fs.readFileSync(workflowPath, 'utf8');
const workflow = yaml.load(workflowSource);
const steps = workflow.jobs.validate.steps;
const find = name => steps.find(step => step.name === name);

test('fork no longer includes an automatic release tag workflow', () => {
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/auto-tag.yml')), false);
  assert.match(workflowSource, /^\s*on:\s*$/m);
  assert.match(workflowSource, /^\s+pull_request:\s*$/m);
  assert.match(workflowSource, /^\s+push:\s*$/m);
  assert.doesNotMatch(workflowSource, /^ {2}(tags|workflow_dispatch):/m);
});

test('fork validation never authenticates to or publishes to a container registry', () => {
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.validate['timeout-minutes'], 60);
  const source = JSON.stringify(workflow);
  for (const prohibited of [
    'secrets.', 'docker/login-action', 'push-by-digest', 'action-gh-release',
    'docker buildx imagetools create', 'docker push', 'git push',
  ]) {
    assert(!source.includes(prohibited), 'Unexpected publish capability: ' + prohibited);
  }
  const builds = steps.filter(step => step.uses?.startsWith('docker/build-push-action@'));
  assert.equal(builds.length, 2);
  for (const build of builds) {
    assert.equal(build.with.push, false);
    assert.equal(build.with.load, true);
  }
});

test('lint, all unit tests and both Docker platform contracts are retained', () => {
  const install = find('Install dependencies').run;
  for (const command of ['npm ci', 'npm ci --prefix backend', 'npm ci --prefix frontend']) {
    assert(install.includes(command));
  }
  const checks = find('Lint and unit tests').run;
  for (const command of ['npm run lint', 'npm test -- --runInBand', 'npm run test:release', 'npm run test:frontend']) {
    assert(checks.includes(command));
  }
  assert.equal(find('Verify Docker build context').run.trim(), 'npm run test:context');
  assert.equal(find('Build AMD64 test image locally').with.platforms, 'linux/amd64');
  assert.equal(find('Build AMD64 test image locally').with.tags, 'portracker:ci');
  assert.equal(find('Build ARM64 test image locally').with.platforms, 'linux/arm64');
  assert.equal(find('Build ARM64 test image locally').with.tags, 'portracker:ci-arm64');
  const contracts = find('Run Docker image contracts on both architectures').run;
  assert(contracts.includes('for architecture in amd64 arm64'));
  assert(contracts.includes('npm run test:image -- "$test_image" "linux/$architecture"'));
  const evidence = find('Retain regression evidence');
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with['if-no-files-found'], 'warn');
});

test('every validation shell block parses without executing network operations', () => {
  for (const step of steps.filter(step => step.run)) {
    execFileSync('bash', ['-n'], {
      input: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'placeholder'),
    });
  }
});

const runner = fs.readFileSync(path.join(root, 'scripts/image-contracts.mjs'), 'utf8');
const selectTrueNAS = runner.match(/async function selectTrueNAS\(\) \{[\s\S]*?\n\}/)[0];
async function selectFixturePlatform({ writable = true, present = true } = {}) {
  let platform = 'auto';
  let closed = false;
  const updates = [];
  await vm.runInNewContext(selectTrueNAS + '\nselectTrueNAS();', {
    app: 'contract-app', assert,
    docker: args => {
      assert.deepEqual(Array.from(args.slice(0, 4)), ['exec', 'contract-app', 'node', '-e']);
      assert.equal(args.length, 5);
      vm.runInNewContext(args[4], {
        require: name => {
          assert.equal(name, './db');
          return {
            updateLocalServerPlatformType: value => { updates.push(value); if (writable) platform = value; },
            close: () => { closed = true; },
          };
        },
      }, { timeout: 1000 });
    },
    request: async (route, options = {}) => {
      assert.equal(route, '/api/servers');
      assert.equal(options.method || 'GET', 'GET');
      return { status: 200, body: present ? [{ id: 'local', platform_type: platform }] : [] };
    },
  }, { timeout: 1000 });
  return { platform, closed, updates };
}
test('TrueNAS fixture uses the internal platform updater without changing the user edit contract', async () => {
  assert.deepEqual(await selectFixturePlatform(), { platform: 'truenas', closed: true, updates: ['truenas'] });
});
test('TrueNAS fixture rejects an unchanged or missing local platform before scanning', async () => {
  for (const options of [{ writable: false }, { present: false }]) {
    await assert.rejects(selectFixturePlatform(options), /TrueNAS fixture platform setup failed/);
  }
});
const resolver = runner.match(/function resolvePlatformImage\(reference\) \{[\s\S]*?\n\}/)[0];
const indexReference = 'registry.invalid/portracker@sha256:' + 'a'.repeat(64);
const manifests = ['amd64', 'arm64'].map((architecture, index) => ({ platform: { os: 'linux', architecture }, digest: 'sha256:' + String(index + 1).repeat(64) }));
function resolveImage(reference, platform, index) {
  return vm.runInNewContext(resolver + '\nresolvePlatformImage(reference);', {
    reference, platform, assert,
    docker: args => {
      assert.equal(args.join(' '), `buildx imagetools inspect --raw ${reference}`);
      assert(index, 'Local tags must not be queried in a registry');
      return JSON.stringify(index);
    },
  }, { timeout: 1000 });
}
test('immutable indexes resolve to distinct child digests for classic image stores', () => {
  for (const entry of manifests) {
    assert.equal(resolveImage(indexReference, `linux/${entry.platform.architecture}`, { manifests }), 'registry.invalid/portracker@' + entry.digest);
  }
  assert(runner.indexOf('image = resolvePlatformImage(image);') < runner.indexOf('const nativeCode ='));
  assert(runner.indexOf('baseline = resolvePlatformImage(baseline);') < runner.indexOf('const nativeCode ='));
});
test('local PR tags and single-platform digests retain their exact identity', () => {
  assert.equal(resolveImage('portracker:ci-arm64', 'linux/arm64'), 'portracker:ci-arm64');
  assert.equal(resolveImage(indexReference, 'linux/arm64', { schemaVersion: 2, config: {} }), indexReference);
});
test('missing, ambiguous and malformed platform manifests are rejected', () => {
  for (const entries of [[], [manifests[0]], [manifests[1], manifests[1]], [{ ...manifests[1], digest: 'mutable-tag' }]]) {
    assert.throws(() => resolveImage(indexReference, 'linux/arm64', { manifests: entries }), { code: 'ERR_ASSERTION' });
  }
});

const noticeChangelog = '## [1.3.15] - 2026-10-30\n## [1.3.14] - 2026-09-14\n';
const noticeConfig = { ignoreVersions: [], maxVersionsOnFirstOpen: 1 };
async function noticePlan(changelog, version, visible, config = noticeConfig) {
  const { pathToFileURL } = require('node:url');
  const { releaseNoticePlan } = await import(pathToFileURL(path.join(root, 'scripts/browser-contracts.mjs')).href);
  return releaseNoticePlan(changelog, version, candidate => visible.includes(candidate) ? '- **Visible**: User-facing change.\n' : '## Release\n', config);
}
test('visible current releases keep the current-version notice assertion', async () => {
  assert.deepEqual(await noticePlan(noticeChangelog, '1.3.15', ['1.3.15', '1.3.14']), { freshVersion: '1.3.15', previousVersion: '1.3.14', currentVisible: true });
});
test('hidden current releases select the latest curated history for fresh browsers', async () => {
  assert.deepEqual(await noticePlan(noticeChangelog, '1.3.15', ['1.3.14']), { freshVersion: '1.3.14', previousVersion: '1.3.14', currentVisible: false });
});
test('fully hidden histories require no notice and preserve upgrade checks', async () => {
  assert.deepEqual(await noticePlan(noticeChangelog, '1.3.15', []), { freshVersion: null, previousVersion: '1.3.14', currentVisible: false });
});
test('notice expectations honor ignored versions and first-open limits', async () => {
  assert.equal((await noticePlan(noticeChangelog, '1.3.15', ['1.3.15', '1.3.14'], { ignoreVersions: ['1.3.15'], maxVersionsOnFirstOpen: 1 })).freshVersion, '1.3.14');
  assert.equal((await noticePlan(noticeChangelog, '1.3.15', ['1.3.15', '1.3.14'], { ignoreVersions: [], maxVersionsOnFirstOpen: 2 })).freshVersion, '1.3.14 - 1.3.15');
});
test('notice expectations reject missing current versions and duplicate sections', async () => {
  await assert.rejects(noticePlan(noticeChangelog, '1.3.16', []), /newest changelog version/);
  await assert.rejects(noticePlan(noticeChangelog + '## [1.3.15] - 2026-10-30\n', '1.3.15', []), /Duplicate changelog version/);
});
test('notice expectations order numeric versions and support an initial release', async () => {
  assert.equal((await noticePlan('## [1.3.9]\n## [1.3.10]\n', '1.3.10', ['1.3.9', '1.3.10'])).freshVersion, '1.3.10');
  assert.deepEqual(await noticePlan('## [1.0.0]\n', '1.0.0', ['1.0.0']), { freshVersion: '1.0.0', previousVersion: null, currentVisible: true });
});
