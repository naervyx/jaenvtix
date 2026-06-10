/** Destination for one log line. */
export type LogSink = (message: string) => void;

/**
 * Pluggable sink for the structured progress messages in `Messages.Log`.
 *
 * Defaults to `console.log` so every module stays loadable under plain Node
 * in unit tests. `activate()` swaps the sink for the "Jaenvtix" output
 * channel, making the messages visible to users — the extension-host console
 * is only reachable through developer tools.
 */
let sink: LogSink = (message) => console.log(message);

/** Replaces the active sink. Wired by `activate()` to the output channel. */
export function setLogSink(nextSink: LogSink): void {
    sink = nextSink;
}

/** Writes one structured message (see `Messages.Log`) to the active sink. */
export function log(message: string): void {
    sink(message);
}
