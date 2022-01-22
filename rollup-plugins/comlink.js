import { writeFileSync } from 'fs';

const comlinkTSD = []
const _ = new Set()

export function comlink({ type = 'web', types = './src/shim-worker.d.ts' } = {}) {
  const importPrefix = 'comlink:';
  return {
    name: 'comlink',
    async resolveId(id, importer) {
      if (id.startsWith(importPrefix)) {
        const res = await this.resolve(id.slice(importPrefix.length).split('?')[0], importer);
        if (!res) { return }

        if (id.split('?').length === 1 && !_.has(id)) {

          const tsd = `
declare module "${id}" {
  const worker: import('comlink').Remote<typeof import(${JSON.stringify(res.id.split('.')[0].split(/\\|\//).map((v, i) => i === 0 ? v.toLowerCase() : v).join('/'))}).default>
  export default worker
}
              `;

          comlinkTSD.push(tsd);
          _.add(id)
        }

        return importPrefix + res.id + '?' + (id.split('?')[1] || '');
      }
    },
    async load(id) {
      if (id.startsWith(importPrefix)) {
        const status = id.split('?')[1];

        if (status === '') {
          const fileID = this.emitFile({
            type: 'chunk',
            id: id.split('?')[0] + '?worker'
          });

          return `
                ${type === 'node' ? `
                import { Worker } from 'worker_threads'
                import nodeEndpoint from 'comlink/dist/esm/node-adapter'` : ''}
                import { wrap } from 'comlink'

                const worker = new Worker(import.meta.ROLLUP_FILE_URL_${fileID});

                const api = wrap(${type === 'node' ? `nodeEndpoint(worker)` : 'worker'});

                export default api
              `;
        } else if (status === 'worker') {
          return `
                ${type === 'node' ? `
                import { parentPort } from 'worker_threads'
                import nodeEndpoint from 'comlink/dist/esm/node-adapter'` : ''}
                import { expose } from 'comlink'

                import api from ${JSON.stringify(id.slice(importPrefix.length).split('?')[0])}
                
                expose(api${type === 'node' ? ', nodeEndpoint(parentPort)' : ''})
              `;
        }
      }
    },
    generateBundle() {
      writeFileSync(types, '/* eslint-disable */' + comlinkTSD.join(''));
    }
  };
}
