#!/usr/bin/env node
/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as meow from 'meow';
import * as updateNotifier from 'update-notifier';
import {init} from './init';
import {clean} from './clean';

export interface Logger {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  dir: (obj: any, options?: any) => void;
}

export interface Options {
  dryRun: boolean;
  gtsRootDir: string;
  targetRootDir: string;
  yes: boolean;
  logger: Logger;
}

export type VerbFunction = (options: Options, fix?: boolean) =>
    Promise<boolean>;

const logger: Logger = console;

const cli = meow(`
	Usage
	  $ gts <verb> [options]

    Verb can be:
      init        Adds default npm scripts to your package.json.
      check       Checks code for formatting and lint issues.
      fix         Fixes formatting and linting issues (if possible).
      clean       Removes all files generated by the build.

  Options
    --help        Prints this help message.
    -y, --yes     Assume a yes answer for every prompt.
    --dry-run     Don't make any acutal changes.

	Examples
    $ gts init -y
    $ gts check
    $ gts fix
    $ gts clean
`);

function usage(msg?: string): void {
  if (msg) {
    logger.error(msg);
  }
  cli.showHelp(1);
}

async function run(verb: string): Promise<boolean> {
  const options: Options = {
    dryRun: cli.flags.dryRun || false,
    gtsRootDir: `${process.cwd()}/node_modules/gts`,
    targetRootDir: process.cwd(),
    yes: cli.flags.yes || cli.flags.y || false,
    logger: logger
  };
  // Linting/formatting depend on typescript. We don't want to load the
  // typescript module during init, since it might not exist.
  // See: https://github.com/google/ts-style/issues/48
  if (verb === 'init') {
    return await init(options);
  }
  const lint: VerbFunction = require('./lint').lint;
  const format: VerbFunction = require('./format').format;
  switch (verb) {
    case 'check':
      return (await lint(options) && await format(options));
    case 'fix':
      return (await lint(options, true) && await format(options, true));
    case 'clean':
      return await clean(options);
    default:
      usage(`Unknown verb: ${verb}`);
      return false;
  }
}

updateNotifier({pkg: cli.pkg}).notify();

if (cli.input.length !== 1) {
  usage();
}

run(cli.input[0]).then(success => {
  if (!success) {
    process.exit(1);
  }
});
