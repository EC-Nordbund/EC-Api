import esbuild from 'rollup-plugin-esbuild'
import commonJS from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";

export default {
  input: './src/index.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs'
  },
  plugins: [
    esbuild(),
    commonJS(),
    nodeResolve({
      preferBuiltins: false
    }),
    json()
  ],
  external: [
    'assert', 'async_hooks', 'buffer',
    'child_process', 'cluster', 'console',
    'constants', 'crypto', 'dgram',
    'dns', 'domain', 'events',
    'fs', 'http', 'http2',
    'https', 'inspector', 'module',
    'net', 'os', 'path',
    'perf_hooks', 'process', 'punycode',
    'querystring', 'readline', 'repl',
    'stream', 'string_decoder', 'sys',
    'timers', 'tls', 'trace_events',
    'tty', 'url', 'util',
    'v8', 'vm', 'worker_threads',
    'zlib',
    'docx-templates',
    'apollo-server-express',
    'compression',
    'cors',
    'express',
    'graphql',
    'graphql-subscriptions',
    'js-sha3',
    'nodemailer',
    'promise-mysql',
  ]
}