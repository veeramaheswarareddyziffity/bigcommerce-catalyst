import { Command } from 'commander';

import PACKAGE_INFO from '../../package.json';
import { consola } from '../lib/logger';

export const version = new Command('version')
  .description('Display detailed version information.')
  .action(() => {
    consola.log('Version Information:');
    consola.log(`CLI Version: ${PACKAGE_INFO.version}`);
    consola.log(`Node Version: ${process.version}`);
    consola.log(`Platform: ${process.platform} (${process.arch})`);
  });
