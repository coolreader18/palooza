#!/usr/bin/env node
import yargs, { Arguments } from "yargs";
import { readConfig, Configuration, runPalooza } from ".";
import { getConfigFile } from "./read-config";

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
    async ({ config: configOpt, input, output }: BuildArgs) => {
      let configFile = configOpt !== false ? getConfigFile(configOpt) : false;
      if (configFile === undefined) {
        throw new Error(
          "Couldn't find config file, please specify it explicitly."
        );
      }
      let config: Configuration = {};
      if (configFile) config = await readConfig(configFile);
      if (input) config.srcDir = input;
      if (output) config.outDir = output;
      await runPalooza(config);
    }
  )
  .demandCommand()
  .strict()
  .showHelpOnFail(true)
  .help().argv;

interface BuildArgs extends Arguments {
  config?: string | false;
  input?: string;
  output?: string;
}
