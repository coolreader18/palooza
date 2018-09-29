import yargs from "yargs";
import fs from "fs-extra";
import { readConfig, Configuration, runPalooza } from ".";
import path from "path";

yargs
  .usage("$0 <cmd> [args]")
  .command(
    "build [input]",
    "Build the site",
    yargs =>
      yargs
        .option("config", {
          alias: ["c"],
          type: "string",
          normalize: true
        })
        .positional("input", {
          alias: ["i"],
          type: "string",
          normalize: true
        })
        .option("output", {
          alias: ["o"],
          type: "string",
          normalize: true
        }),
    async ({ config: configOpt, input, output }) => {
      let configFile: string | undefined = undefined;
      if (configOpt !== undefined) {
        if (configOpt === ".") {
          configFile = fs
            .readdirSync(process.cwd())
            .find(filename => !!filename.match(/palooza\.config\.[a-zA-Z]+$/));
        } else {
          configFile = configOpt;
        }
        configFile = path.resolve(configFile);
      }
      let config: Configuration = {};
      if (configFile) config = await readConfig(configFile);
      if (input) config.srcDir = input;
      if (output) config.outDir = output;
      await runPalooza(config);
    }
  )
  .demandCommand(1, "")
  .strict()
  .showHelpOnFail(true)
  .help().argv;
