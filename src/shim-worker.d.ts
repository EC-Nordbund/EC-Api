/* eslint-disable */
declare module "comlink:../workers/generation" {
  const worker: import('comlink').Remote<typeof import("./workers/generation").default>
  export default worker
}
              