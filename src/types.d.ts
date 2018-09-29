declare module "rollup-plugin-commonjs" {
  import { PluginImpl } from "rollup";
  const commonjs: PluginImpl;
  export default commonjs;
}
declare module "rollup-plugin-node-resolve" {
  import { PluginImpl } from "rollup";
  const resolve: PluginImpl;
  export default resolve;
}
declare module "rollup-plugin-json" {
  import { PluginImpl } from "rollup";
  const json: PluginImpl;
  export default json;
}
