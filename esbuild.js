const fs = require("fs");
const path = require("path");

const esbuild = require("esbuild");

const sharedAlias = "@shared";

/**
 * @type {import('esbuild').Plugin}
 */
const aliasPlugin = {
        name: "alias-resolver",

        setup(build) {
                const sharedDir = path.join(__dirname, "src", "shared");

                const resolveSharedPath = (requestedSubPath) => {
                        const normalizedSubPath = requestedSubPath.replace(/^\//, "");
                        const initialPath = normalizedSubPath ? path.join(sharedDir, normalizedSubPath) : path.join(sharedDir, "index");
                        const candidateFiles = [];

                        if (fs.existsSync(initialPath) && fs.statSync(initialPath).isFile()) {
                                return initialPath;
                        }

                        if (!path.extname(initialPath)) {
                                [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].forEach((extension) => {
                                        candidateFiles.push(`${initialPath}${extension}`);
                                });
                        }

                        if (fs.existsSync(initialPath) && fs.statSync(initialPath).isDirectory()) {
                                ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"].forEach((fileName) => {
                                        candidateFiles.push(path.join(initialPath, fileName));
                                });
                        }

                        for (const candidate of candidateFiles) {
                                if (fs.existsSync(candidate)) {
                                        return candidate;
                                }
                        }

                        return initialPath;
                };

                build.onResolve({ filter: /^@shared(?:\/.*)?$/ }, (args) => {
                        const subPath = args.path.slice(sharedAlias.length);

                        return {
                                path: resolveSharedPath(subPath),
                        };
                });

                build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
                        path: path.join(__dirname, "vendor", "jsonc-parser", "index.js"),
                }));
        },
};

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
                plugins: [
                        aliasPlugin,
                        /* add to the end of plugins array */
                        esbuildProblemMatcherPlugin,
                ],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
