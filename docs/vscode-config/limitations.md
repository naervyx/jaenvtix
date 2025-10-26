# VS Code Workspace Configuration — Known Limitations

- **Managed keys are overwritten**: Custom values for `java.jdt.ls.java.home`, `maven.executable.path`, and `maven.terminal.useJavaHome` are replaced each time provisioning runs. Consumers that need different values must fork the module.
- **No validation of paths**: The updater blindly writes the provided `JAVA_HOME` and Maven wrapper locations. Callers must guarantee the paths exist and are readable on the target machine.
- **Settings file must stay valid JSONC**: The writer expects `settings.json` to remain parseable by `jsonc-parser`. Syntax errors, trailing text after the JSON object, or unsupported encodings will cause the update to fail.
