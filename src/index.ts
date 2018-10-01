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
  inputPlugins: ConfigRollupPlugin[] = []
): RollupPlugin[] => {
  const plugins = inputPlugins.map(
    plugin =>
      Array.isArray(plugin) ? getExtModule(plugin[0])(plugin[1]) : plugin
  );
  return [
    rollupNodeResolve({ jsnext: true }),
    rollupCommonjs(),
    rollupJSON({ namedExports: false }),
    ...optionalRollupPlugins(plugins),
    ...plugins
  ];
};

const getExtModule = (id: string) => {
  try {
    return require(id);
  } catch {
    throw new Error(`External module \`${id}\` not found`);
  }
};

export { readConfig, getConfigFile } from "./read-config";

type ConfigRollupPlugin = RollupPlugin | [string, object?];
type ConfigPostCSSPlugin = PostCSSPlugin<any> | [string, any?];
export interface Configuration {
  rollupPlugins?: ConfigRollupPlugin[];
  useDefaultRollupPlugins?: boolean;
  postCSSPlugins?: ConfigPostCSSPlugin[];
  plugins?: Plugin[];
  srcDir?: string;
  outDir?: string;
}

interface Plugin {
  name: string;
  processor: Processor | Processor[];
}

interface Processor {
  target: Readonly<{
    name: string;
    attrs?: Readonly<{
      [name: string]: boolean | string | ((attr: string) => boolean);
    }>;
    requestAttr: string;
  }>;
  transformElem?: (elem: Trumpet.Element) => void;
  process: (
    ctx: ProcessorContext,
    elem: Trumpet.Element
  ) => void | Promise<void>;
}

export const runPalooza = async ({
  srcDir = "site",
  outDir = "site-out",
  rollupPlugins,
  postCSSPlugins,
  plugins: inputPlugins
}: Configuration) => {
  srcDir = path.resolve(srcDir);
  outDir = path.resolve(outDir);

  const htmlFiles = globby.sync("**/*.html", { cwd: srcDir, absolute: true });

  const processed = new Set<string>();

  const processes = htmlFiles.map(async html => {
    const processing: Promise<void>[] = [];
    const tr = new Trumpet();
    const plugins: Plugin[] = [
      jsPlugin(rollupPlugins),
      cssPlugin(postCSSPlugins)
    ];
    if (inputPlugins) {
      plugins.splice(0, 0, ...inputPlugins);
    }

    interface ToProcess extends Processor {
      name: string;
    }
    const toProcess: { [name: string]: ToProcess[] } = {};
    for (const plugin of plugins) {
      for (const processor of Array<Processor>().concat(plugin.processor)) {
        const { name } = processor.target;
        const toBeProcessed: ToProcess = {
          ...processor,
          name: plugin.name
        };
        if (!toProcess[name]) {
          toProcess[name] = [toBeProcessed];
        } else {
          toProcess[name].push(toBeProcessed);
        }
      }
    }

    for (const [name, processors] of Object.entries(toProcess)) {
      tr.selectAll(name, elem => {
        const attrs = elem.getAttributes();
        curProcessor: for (const processor of processors) {
          const { target } = processor;
          if (target.attrs) {
            for (const [attr, val] of Object.entries(target.attrs)) {
              if (typeof val === "string") {
                if (attrs[attr] !== val) continue curProcessor;
              } else if (typeof val === "boolean") {
                if (!!attrs[attr] !== val) continue curProcessor;
              } else if (typeof val === "function") {
                if (!val(attrs[attr])) continue curProcessor;
              }
            }
          }
          if (!attrs[target.requestAttr]) continue curProcessor;
          const processorOpts = genProcessorOpts({
            srcDir,
            outDir,
            request: attrs[target.requestAttr],
            requester: html
          });
          if (processor.transformElem) processor.transformElem(elem);
          if (processed.has(processorOpts.absPath)) return;
          processor.process(processorOpts, elem);
        }
      });
    }

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
}): ProcessorContext => {
  const absPath = path.resolve(path.dirname(input.requester), input.request);
  const relPath = path.relative(input.srcDir, absPath);
  return {
    ...input,
    absPath,
    outPath: path.resolve(input.outDir, relPath),
    relPath
  };
};

interface ProcessorContext {
  srcDir: string;
  outDir: string;
  request: string;
  requester: string;
  absPath: string;
  outPath: string;
  relPath: string;
}

export const jsPlugin = (plugins?: ConfigRollupPlugin[]): Plugin => ({
  name: "js",
  processor: {
    target: {
      name: "script",
      requestAttr: "src"
    },
    process: async ({ outDir, absPath, relPath }) => {
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
    }
  }
});

export const cssPlugin = (inputPlugins?: ConfigPostCSSPlugin[]): Plugin => ({
  name: "css",
  processor: {
    target: {
      name: "link",
      attrs: { rel: "stylesheet" },
      requestAttr: "href"
    },
    process: async ({ absPath, outPath }: ProcessorContext) => {
      if (!inputPlugins || !inputPlugins.length) {
        await fs.copy(absPath, outPath);
        return;
      }
      const plugins = inputPlugins.map(
        (plugin): PostCSSPlugin<any> => {
          if (!Array.isArray(plugin)) return plugin;
          const plug = getExtModule(plugin[0]);
          if (typeof plug === "function" && plug[1]) return plug(plugin[1]);
          return plug;
        }
      );
      const processor = postcss(plugins);
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
    }
  }
});
