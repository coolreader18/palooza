import globby from "globby";
import { rollup, Plugin as RollupPlugin, RollupFileOptions } from "rollup";
import path from "path";
import { WritableStream } from "htmlparser2";
import fs from "fs-extra";
import postcss, { Plugin as PostCSSPlugin } from "postcss";
import rollupCommonjs from "rollup-plugin-commonjs";
import rollupNodeResolve from "rollup-plugin-node-resolve";
import rollupJSON from "rollup-plugin-json";

const defaultRollupPlugins = (): RollupPlugin[] => [
  rollupNodeResolve({
    jsnext: true
  }),
  rollupCommonjs()
];

export interface Configuration {
  rollupPlugins?: RollupPlugin[];
  postCSSPlugins?: PostCSSPlugin<any>[];
  srcDir?: string;
  outDir?: string;
}

interface NodeModuleCompile extends NodeModule {
  _compile(code: string, filename: string): any;
}

export const readConfig = async (filename: string): Promise<Configuration> => {
  const plugins: RollupPlugin[] = [rollupJSON({ namedExports: false })];
  try {
    const ts = require("rollup-plugin-typescript2");
    plugins.push(ts());
  } catch (e) {}
  const build = await rollup({
    input: filename,
    plugins,
    external: (id: string) =>
      (id[0] !== "." && !path.isAbsolute(id)) ||
      id.slice(-5, id.length) === ".json"
  });
  const chunk = await build.generate({ format: "cjs" });
  const defaultLoader = require.extensions[".js"];
  require.extensions[".js"] = (module: NodeModuleCompile, file: string) => {
    if (file === filename) {
      module._compile(chunk.code, file);
    } else {
      defaultLoader(module, file);
    }
  };
  const config = require(filename);
  require.extensions[".js"] = defaultLoader;
  return config;
};

export const runPalooza = async ({
  srcDir = "site",
  outDir = "site-out",
  rollupPlugins,
  postCSSPlugins
}: Configuration) => {
  srcDir = path.resolve(srcDir);
  outDir = path.resolve(outDir);

  const htmlFiles = globby.sync("**/*.html", { cwd: srcDir, absolute: true });

  const processed = new Set<string>();

  const processes = htmlFiles.map(async html => {
    const processing: Promise<void>[] = [];
    const parser = new WritableStream({
      onopentag: (name, { src, rel, href }) => {
        switch (name) {
          case "script": {
            if (!src) return;
            const processorOpts = genProcessorOpts({
              srcDir,
              outDir,
              request: src,
              requester: html
            });
            if (processed.has(processorOpts.absPath)) return;
            processing.push(processJS(processorOpts, rollupPlugins));
            return;
          }
          case "link": {
            if (rel !== "stylesheet" || !href) return;
            const processorOpts = genProcessorOpts({
              srcDir,
              outDir,
              request: href,
              requester: html
            });
            if (processed.has(processorOpts.absPath)) return;
            processing.push(processCSS(processorOpts, postCSSPlugins));
            return;
          }
        }
      }
    });
    const outHtml = path.resolve(outDir, path.relative(srcDir, html));
    const done = Promise.all([
      fs.mkdirp(path.dirname(outHtml)).then(() => fs.copy(html, outHtml)),
      new Promise(res => {
        parser.on("finish", res);
        parser.on("error", res);
      }).then(() => Promise.all(processing))
    ]);
    fs.createReadStream(html, "utf8").pipe(parser);
    await done;
  });

  await Promise.all(processes);
};

const genProcessorOpts = (input: {
  srcDir: string;
  outDir: string;
  request: string;
  requester: string;
}): ProcessorOpts => {
  const absPath = path.resolve(path.dirname(input.requester), input.request);
  const relPath = path.relative(input.srcDir, absPath);
  return {
    ...input,
    absPath,
    outPath: path.resolve(input.outDir, relPath),
    relPath
  };
};

interface ProcessorOpts {
  srcDir: string;
  outDir: string;
  request: string;
  requester: string;
  absPath: string;
  outPath: string;
  relPath: string;
}

const processJS = async (
  { outDir, absPath, relPath }: ProcessorOpts,
  plugins?: RollupPlugin[]
) => {
  const build = await rollup({
    input: absPath,
    plugins: [...defaultRollupPlugins(), ...plugins]
  });
  await build.write({
    dir: outDir,
    file: relPath,
    format: "iife",
    assetFileNames: "rollup-assets/[name]-[hash][extname]"
  });
};

const processCSS = async (
  { absPath, outPath }: ProcessorOpts,
  plugins?: PostCSSPlugin<any>[]
) => {
  if (!plugins || !plugins.length) {
    await fs.copy(absPath, outPath);
    return;
  }
  const processor = postcss(plugins || []);
  const content = await fs.readFile(absPath, "utf8");
  const res = await processor.process(content, {
    from: absPath,
    to: outPath,
    map: { annotation: `./${path.basename(outPath)}.map` }
  });
  const proms = [
    fs.writeFile(outPath, res.css),
    res.map && fs.writeFile(outPath + ".map", res.map.toString())
  ];
  await Promise.all(proms);
};
