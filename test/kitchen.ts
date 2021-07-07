import chalk = require('chalk');
import * as cp from 'child_process';
import * as fs from 'fs-extra';
import * as tmp from 'tmp';
import * as assert from 'assert';
import * as path from 'path';
import {describe, it, before, after} from 'mocha';

import spawn = require('cross-spawn');
import execa = require('execa');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json');
const keep = !!process.env.GTS_KEEP_TEMPDIRS;
const stagingDir = tmp.dirSync({keep, unsafeCleanup: true});
const stagingPath = stagingDir.name;
const execOpts: Pick<
  cp.SpawnSyncOptionsWithStringEncoding,
  'cwd' | 'encoding'
> = {
  cwd: `${stagingPath}${path.sep}kitchen`,
  encoding: 'utf8',
};

describe('🚰 kitchen sink', () => {
  const fixturesPath = path.join('test', 'fixtures');
  const gtsPath = path.join('node_modules', '.bin', 'gts');
  const kitchenPath = path.join(stagingPath, 'kitchen');

  // Create a staging directory with temp fixtures used to test on a fresh application.
  before(() => {
    console.log(`${chalk.blue(`${__filename} staging area: ${stagingPath}`)}`);
    cp.execSync('npm pack');
    const tarball = `${pkg.name}-${pkg.version}.tgz`;
    fs.renameSync(tarball, 'gts.tgz');
    const targetPath = path.resolve(stagingPath, 'gts.tgz');
    console.log('moving packed tar to ', targetPath);
    fs.moveSync('gts.tgz', targetPath);
    fs.copySync(fixturesPath, path.join(stagingPath, path.sep));
  });
  // CLEAN UP - remove the staging directory when done.
  after('cleanup staging', () => {
    if (!keep) {
      stagingDir.removeCallback();
    }
  });

  it('it should run init', () => {
    const args = [
      '-p',
      path.resolve(stagingPath, 'gts.tgz'),
      '--ignore-existing',
      'gts',
      'init',
      // It's important to use `-n` here because we don't want to overwrite
      // the version of gts installed, as it will trigger the npm install.
      '-n',
    ];

    const res = spawn.sync('npx', args, execOpts);
    console.log('out: ', res.stdout + '');
    console.log('error: ', res.stderr + '');

    // Ensure config files got generated.
    fs.accessSync(path.join(kitchenPath, 'tsconfig.json'));
    fs.accessSync(path.join(kitchenPath, '.eslintrc.json'));
    fs.accessSync(path.join(kitchenPath, '.eslintignore'));
    fs.accessSync(path.join(kitchenPath, '.prettierrc.js'));
    fs.accessSync(path.join(kitchenPath, '.editorconfig'));

    // Compilation shouldn't have happened. Hence no `build` directory.
    const dirContents = fs.readdirSync(kitchenPath);
    assert.strictEqual(dirContents.indexOf('build'), -1);
  });

  it('should use as a non-locally installed module', () => {
    // Use from a directory different from where we have locally installed. This
    // simulates use as a globally installed module.
    const GTS = path.resolve(stagingPath, 'kitchen/node_modules/.bin/gts');
    const tmpDir = tmp.dirSync({keep, unsafeCleanup: true});
    const opts = {cwd: path.join(tmpDir.name, 'kitchen')};

    // Copy test files.
    fs.copySync(fixturesPath, tmpDir.name);
    // Test package.json expects a gts tarball from ../gts.tgz.
    fs.copySync(
      path.join(stagingPath, 'gts.tgz'),
      path.join(tmpDir.name, 'gts.tgz')
    );
    // It's important to use `-n` here because we don't want to overwrite
    // the version of gts installed, as it will trigger the npm install.
    spawn.sync(GTS, ['init', '-n'], opts);

    // The `extends` field must use the local gts path.
    const tsconfigJson = fs.readFileSync(
      path.join(tmpDir.name, 'kitchen', 'tsconfig.json'),
      'utf8'
    );
    const tsconfig = JSON.parse(tsconfigJson);
    assert.deepStrictEqual(
      tsconfig.extends,
      './node_modules/gts/tsconfig-google.json'
    );

    // server.ts has a lint error. Should error.
    assert.throws(() => cp.execSync(`${GTS} lint src/server.ts`, opts));

    if (!keep) {
      tmpDir.removeCallback();
    }
  });

  it('should terminate generated files with newline', () => {
    const GTS = path.resolve(stagingPath, gtsPath);
    spawn.sync(GTS, ['init', '-y'], execOpts);
    assert.ok(
      fs
        .readFileSync(path.join(kitchenPath, 'package.json'), 'utf8')
        .endsWith('\n')
    );
    assert.ok(
      fs
        .readFileSync(path.join(kitchenPath, 'tsconfig.json'), 'utf8')
        .endsWith('\n')
    );
    assert.ok(
      fs
        .readFileSync(path.join(kitchenPath, '.eslintrc.json'), 'utf8')
        .endsWith('\n')
    );
    assert.ok(
      fs
        .readFileSync(path.join(kitchenPath, '.eslintignore'), 'utf8')
        .endsWith('\n')
    );
    assert.ok(
      fs
        .readFileSync(path.join(kitchenPath, '.prettierrc.js'), 'utf8')
        .endsWith('\n')
    );
  });

  it('should lint before fix', async () => {
    const res = await execa(
      'npm',
      ['run', 'lint'],
      Object.assign({}, {reject: false}, execOpts)
    );
    assert.strictEqual(res.exitCode, 1);
    assert.ok(res.stdout.includes('assigned a value but'));
  });

  it('should fix', () => {
    const preFix = fs
      .readFileSync(path.join(kitchenPath, 'src', 'server.ts'), 'utf8')
      .split(/[\n\r]+/);

    cp.execSync('npm run fix', execOpts);
    const postFix = fs
      .readFileSync(path.join(kitchenPath, 'src', 'server.ts'), 'utf8')
      .split(/[\n\r]+/);
    assert.strictEqual(preFix[0].trim() + ';', postFix[0]); // fix should have added a semi-colon
  });

  it('should lint after fix', () => {
    cp.execSync('npm run lint', execOpts);
  });

  it('should build', () => {
    cp.execSync('npm run compile', execOpts);
    fs.accessSync(path.join(kitchenPath, 'build', 'src', 'server.js'));
    fs.accessSync(path.join(kitchenPath, 'build', 'src', 'server.js.map'));
    fs.accessSync(path.join(kitchenPath, 'build', 'src', 'server.d.ts'));
  });

  // Verify the `gts clean` command actually removes the output dir
  it('should clean', () => {
    cp.execSync('npm run clean', execOpts);
    assert.throws(() => fs.accessSync(path.join(kitchenPath, 'build')));
  });
});
