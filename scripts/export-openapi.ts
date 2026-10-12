// Writes the OpenAPI spec to docs/openapi.json (for Postman, code generators
// or sharing):  npm run openapi:export
import { writeFileSync } from 'node:fs';
import { openApiSpec } from '../src/lib/openapi/spec';

writeFileSync('docs/openapi.json', `${JSON.stringify(openApiSpec(), null, 2)}\n`);
console.log('Wrote docs/openapi.json');
