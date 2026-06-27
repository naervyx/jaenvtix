/**
 * A `jaenvtix.*` setting seeded into a freshly-configured `settings.json` so
 * every knob is visible (and editable) without the user having to know it
 * exists. The accepted values are documented natively via `enumDescriptions`
 * in `package.json` (shown in the Settings UI and settings.json autocomplete),
 * so no in-file comments are needed.
 */
export interface DefaultSetting {
    key: string;
    default: unknown;
}

/**
 * The canonical `jaenvtix.*` settings with their defaults. These MUST mirror
 * `package.json` `contributes.configuration` — a drift test guards it.
 * Ordered by how likely a user is to change each one.
 */
export const JAENVTIX_DEFAULT_SETTINGS: readonly DefaultSetting[] = [
    {key: 'jaenvtix.preferredJdkVendor', default: 'auto'},
    {key: 'jaenvtix.autoUpdatePatches', default: true},
    {key: 'jaenvtix.downloadMaxRetries', default: 3},
    {key: 'jaenvtix.isolatedMavenPerProject', default: true},
    {key: 'jaenvtix.discoverFromToolchainsXml', default: true},
    {key: 'jaenvtix.configureOptionalExtensions', default: true},
    {key: 'jaenvtix.applyJavaTunings', default: true},
    {key: 'jaenvtix.enableRuntimePathFix', default: true},
];
