import { readFile, writeFile } from 'fs';
import Fuse from 'fuse.js';
import { join, resolve } from 'path';
import { promisify } from 'util';
import type { GTFSData } from '../shared/gtfs-types';
import { createApiData } from './parse';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

function writeJson(path: string, json: unknown) {
  const str = JSON.stringify(json);
  return writeFileAsync(path, str, { encoding: 'utf8' });
}

async function generateIndexes(api: GTFSData) {
  const routes = Object.values(api.routes);
  const stops = Object.values(api.stops);

  const routeIndex = Fuse.createIndex(['route_long_name'], routes);
  const stopIndex = Fuse.createIndex(['stop_name'], stops);

  return {
    routes: routeIndex.toJSON(),
    stops: stopIndex.toJSON(),
  };
}

/**
 * Generate an API file from the given GTFS zip path.
 * @param gtfsZipPath
 */
async function generateApi(
  gtfsZipPath: string,
  apiFolder: string,
): Promise<void> {
  const zipData = await readFileAsync(gtfsZipPath, { encoding: null });
  const api = await createApiData(zipData);
  const indexes = await generateIndexes(api);

  await Promise.all([
    writeJson(join(apiFolder, 'api.json'), api),
    writeJson(join(apiFolder, 'indexes.json'), indexes),
  ]);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    throw new TypeError(`should pass 2 arguments, not ${args.length}.`);
  }

  const [gtfsZipPath, apiFolder] = args.map((path) => resolve(path));

  generateApi(gtfsZipPath, apiFolder)
    .then(() => {
      console.log('Wrote API files');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
