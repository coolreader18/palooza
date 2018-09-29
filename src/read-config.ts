import rollupJSON from "rollup-plugin-json";
import { Plugin as RollupPlugin, rollup } from "rollup";
import { Configuration, defaultRollupPlugins } from ".";
import path from "path";
import fs from "fs";

export const getConfigFile = (input: string = ".") => {
  input = path.resolve(input);
  if (!fs.statSync(input).isDirectory()) return input;
  const filename = fs
    .readdirSync(process.cwd())
    .find(filename => !!filename.match(/palooza\.config\.[a-zA-Z]+$/));
  return filename && path.resolve(filename);
};

export const readConfig = async (filename: string): Promise<Configuration> => {
  const build = await rollup({
    input: filename,
    plugins: defaultRollupPlugins(),
    external: (id: string) =>
      (id[0] !== "." && !path.isAbsolute(id)) ||
      id.slice(-5, id.length) === ".json"
  });
  const { code } = await build.generate({ format: "cjs" });
  return loadModule(filename, code);
};

const loadModule = (id: string, content: string) => {
  const defaultLoader = require.extensions[".js"];
  require.extensions[".js"] = (module, filename) => {
    if (filename === id) {
      // @ts-ignore
      module._compile(content, id);
    } else {
      defaultLoader(module, filename);
    }
  };
  const exports = require(id);
  require.extensions[".js"] = defaultLoader;
  return exports;
};
