import fs from "fs";
import path from "path";
import { build } from "esbuild"
import { preprocess, compile } from "svelte/compiler";
import sveltePreprocess from 'svelte-preprocess';
import copy from "recursive-copy";
import serve, { error, log } from 'create-serve';
// GET ARGS
import { Command } from 'commander/esm.mjs';

const program = new Command();
program
    .option('-d, --debug', 'debug mode active')
    .option('--port <port>', 'serving port', 5000)
    .option('--servedir <path>', 'serving path')
    .parse(process.argv);

const options = program.opts();

// CONSTANTS
const BUILD_DIR = "dist/app"
const STATIC_DIR = "public"

/**
 *  ---  ESBUILD SERVER OPTIONS  ----------------------
 */

let serveOptions = {
    port: options.port,
    root: options.servedir,
    live: true,
}

/**
 *  ---  CUSTOM ESBUILD PLUGIN for SVELTE  ----------------------
 */

let sveltePlugin = options => {
    return {
        name: "svelte",
        setup(build) {
            build.onLoad({ filter: /\.svelte$/ }, async (args) => {
                // This converts a message in Svelte"s format to esbuild"s format
                let convertMessage = ({ message, start, end }) => {
                    let location
                    if (start && end) {
                        let lineText = source.split(/\r\n|\r|\n/g)[start.line - 1]
                        let lineEnd = start.line === end.line ? end.column : lineText.length
                        location = {
                            file: filename,
                            line: start.line,
                            column: start.column,
                            length: lineEnd - start.column,
                            lineText,
                        }
                    }
                    return { text: message, location }
                }

                // Load the file from the file system
                let source = await fs.promises.readFile(args.path, "utf8")
                let filename = path.relative(process.cwd(), args.path)

                // Convert Svelte syntax to JavaScript
                try {
                    //do preprocessor stuff if it exists
                    if (options?.preprocess) {
                        let preprocessResult = await preprocess(source, options.preprocess, {
                            filename,
                        });
                        source = preprocessResult.code;

                        // if caching then we need to store the modifcation times for all dependencies
                        if (options?.cache === true) {
                            preprocessResult.dependencies?.forEach((entry) => {
                                dependencyModifcationTimes.set(entry, statSync(entry).mtime);
                            });
                        }
                    }

                    // begin compile
                    let { js, warnings } = compile(source, { filename })
                    let contents = js.code + `//# sourceMappingURL=` + js.map.toUrl()
                    return { contents, warnings: warnings.map(convertMessage) }
                } catch (e) {
                    return { errors: [convertMessage(e)] }
                }
            })
        }
    }
}


/**
 *  ---  ESBUILD - CUSTOM MULTIPLE CONFIGS  ----------------------
 */

const myConfigs = [
    // MAIN BUNDLE CONFIG -----------------------
    {
        entryPoints: ["./src/main.ts"],
        // outdir: "./dist/app", // either "outfile" or "outdir". not both!
        // splitting: true, // if you want code splitting choose "outdir"
        outfile: `./${BUILD_DIR}/bundle.js`,
    },
    // // CODE SPLITTING EXAMPLE -----------------------
    // {
    //     entryPoints: [
    //         "./src/main.ts",
    //         "./src/another.ts",
    //     ],
    //     outdir: `./${BUILD_DIR}`,
    //     splitting: true,
    //     // chunkNames: 'chunks/[name]',
    // },
]

// common config if multiple files to compile.
const commonConfig = {
    format: "esm",
    bundle: true,
    minify: options.debug ? false : true,
    /**
     * credits: watch for serve
     * custom implementation from esbuild-serve repo
     * https://github.com/nativew/esbuild-serve
     * owner: antoineboulanger
     * so much appreciated ❤️
     */
    watch: options.debug ? true && {
        onRebuild(err) {
            serve.update();
            err ? error('× Failed') : log('✓ Updated');
        }
    } : false, // watch changes and recompile
    sourcemap: options.debug ? "inline" : false,
    plugins: [sveltePlugin({
        preprocess: sveltePreprocess(),
    })],
}

// define multiple build function
const buildMultipleConfigs = async configs => {
    return await Promise.all(configs.map(config => build({ ...commonConfig, ...config }))).catch(console.error); // ortak ayarlar + tekil ayar
}

// init build
buildMultipleConfigs(myConfigs)
    // copy static folder
    .then(() => {
        copy(STATIC_DIR, BUILD_DIR, {
            overwrite: true,    // without this, if file exists gives error.
            expand: true,
            dot: true,          // copy files like .env, .config etc
            junk: true,         // copy files like .DS_STORE
        }).then(results => {
            if (results.length > 1) {
                console.info('"' + STATIC_DIR + '" folder copy done: ' + (results.length - 1) + " files");
            } else {
                console.info(STATIC_DIR + " folder is empty. No copy for now.");
            }
            options.debug && console.log("Autocompile active! Listening changes...")
        })
            .then(() => {
                if (options.servedir) {
                    serve.start(serveOptions);
                }
            })
            .catch(console.error);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
