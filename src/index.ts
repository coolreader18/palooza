import globby from "globby";
import { rollup, Plugin as RollupPlugin } from "rollup";
import path from "path";
import fs from "fs-extra";
import postcss, { Plugin as PostCSSPlugin } from "postcss";
import rollupCommonjs from "rollup-plugin-commonjs";
import rollupNodeResolve from "rollup-plugin-node-resolve";
import rollupJSON from "rollup-plugin-json";
import Trumpet from "trumpet";

// Module ids and options for the default plugins
const _optionalRollupPlugins = Object.entries({
  "rollup-plugin-typescript2": {}
});

const optionalRollupPlugins = (plugins: RollupPlugin[]) =>
  _optionalRollupPlugins
    .filter(([plugin]) => {
      try {
        // Check to see if the plugin is anywhere in the node path
        require.resolve(plugin);
        // Check that the user hasn't put it in the config
        return !plugins.some(cur => cur.name === plugin);
      } catch {
        return false;
      }
    })
    .map(([plugin, opts]): RollupPlugin => require(plugin)(opts));

export const defaultRollupPlugins = (
  plugins: RollupPlugin[] = []
): RollupPlugin[] => [
  rollupNodeResolve({ jsnext: true }),
  rollupCommonjs(),
  rollupJSON({ namedExports: false }),
  ...optionalRollupPlugins(plugins),
  ...plugins
];

export { readConfig, getConfigFile } from "./read-config";

export interface Configuration {
  rollupPlugins?: RollupPlugin[];
  useDefaultRollupPlugins?: boolean;
  postCSSPlugins?: PostCSSPlugin<any>[];
  srcDir?: string;
  outDir?: string;
}

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
    const tr = new Trumpet();

    tr.selectAll("script", elem => {
      const { src } = elem.getAttributes();
      if (!src) return;
      const processorOpts = genProcessorOpts({
        srcDir,
        outDir,
        request: src,
        requester: html
      });
      if (processed.has(processorOpts.absPath)) return;
      processing.push(processJS(processorOpts, rollupPlugins));
    });

    tr.selectAll("link", elem => {
      const { rel, href } = elem.getAttributes();
      if (rel !== "stylesheet") return;
      const processorOpts = genProcessorOpts({
        srcDir,
        outDir,
        request: href,
        requester: html
      });
      if (processed.has(processorOpts.absPath)) return;
      processing.push(processCSS(processorOpts, postCSSPlugins));
    });

    const outHtml = path.resolve(outDir, path.relative(srcDir, html));
    await fs.mkdirp(path.dirname(outHtml));
    fs.createReadStream(html, "utf8")
      .pipe(tr)
      .pipe(fs.createWriteStream(outHtml, "utf8"));
    await new Promise(res => {
      tr.on("finish", res);
      tr.on("error", res);
    }).then(() => Promise.all(processing));
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
    plugins: defaultRollupPlugins(plugins)
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
