# Jaenvtix

Jaenvtix provisions JDK and Maven automatically inside the current workspace by executing a Python helper script bundled with the extension. Use it to prepare Java toolchains quickly in fresh projects.

## Commands

* **Jaenvtix: Setup JDK and Maven** (`jaenvtix.setup`): runs the Python setup script in the root of the open workspace and reports progress in the **Jaenvtix** output channel.

## Configuration

The extension contributes settings under `Jaenvtix`:

* `jaenvtix.pythonPath` — executable used to run the helper script (default `python`).
* `jaenvtix.setupTimeout` — maximum wait time in seconds for the setup script to finish.
* `jaenvtix.logLevel` — verbosity for emitted logs (`error`, `warn`, `info`, `debug`).

## Building and debugging

1. Install dependencies: `npm install`
2. Start a development build that recompiles on save: `npm run watch`
3. Press **F5** in VS Code to open an Extension Development Host and execute `Jaenvtix: Setup JDK and Maven` from the command palette.

To produce an optimized bundle for publishing, use `npm run package`.

## Packaging for installation

1. Generate a VSIX package: `npm run vsix`
2. Install the generated archive in VS Code: `code --install-extension jaenvtix.vsix`

## Tests

Run the integration tests with `npm test`. The suite uses the VS Code test runner and stubs the Python process to avoid external dependencies.
