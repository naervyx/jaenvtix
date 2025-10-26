import * as assert from "assert";

import { type ResolveJdkDistributionParameters, resolveJdkDistribution } from "../modules/jdkMapper";

class TestConfiguration {
    public constructor(private readonly values: Record<string, unknown> = {}) {}

    public get<T>(section: string): T | undefined {
        return this.values[section] as T | undefined;
    }
}

suite("jdkMapper", () => {
    function resolveWith(
        overrides: Partial<ResolveJdkDistributionParameters> = {},
        configurationValues: Record<string, unknown> = {},
    ) {
        const parameters: ResolveJdkDistributionParameters = {
            version: "21",
            os: "windows",
            arch: "x64",
            ...overrides,
            configuration: new TestConfiguration(configurationValues),
        };

        return resolveJdkDistribution(parameters);
    }

    test("prefers Oracle when available and configured", () => {
        const distribution = resolveWith();

        assert.strictEqual(distribution.vendor, "oracle");
        assert.strictEqual(distribution.license, "Oracle No-Fee Terms and Conditions");
        assert.match(distribution.url, /jdk-21_windows-x64/);
    });

    test("falls back to Corretto when Oracle is unavailable", () => {
        const distribution = resolveWith({ version: "8" });

        assert.strictEqual(distribution.vendor, "corretto");
        assert.match(distribution.url, /corretto-8/);
    });

    test("honors preference flag to skip Oracle when disabled", () => {
        const distribution = resolveWith(
            {},
            { "jaenvtix.preferOracle": false },
        );

        assert.strictEqual(distribution.vendor, "corretto");
        assert.match(distribution.url, /corretto-21/);
    });

    test("supports Temurin fallback vendor", () => {
        const distribution = resolveWith(
            { version: "25", os: "linux", arch: "x64" },
            {
                "jaenvtix.preferOracle": false,
                "jaenvtix.fallbackVendor": "temurin",
            },
        );

        assert.strictEqual(distribution.vendor, "temurin");
        assert.match(distribution.url, /temurin25/i);
    });

    test("rejects preview versions unless enabled", () => {
        assert.throws(() => {
            resolveWith({ version: "23" });
        }, /Preview JDK version/);
    });

    test("allows preview versions when setting enabled", () => {
        assert.throws(() => {
            resolveWith(
                { version: "23", os: "linux", arch: "x64" },
                { "jaenvtix.allowPreviewJdk": true },
            );
        }, /No supported JDK distribution/);
    });

    test("normalizes legacy 1.x version scheme", () => {
        const distribution = resolveWith({ version: "1.8.0_202" });

        assert.strictEqual(distribution.version, "8");
        assert.strictEqual(distribution.vendor, "corretto");
        assert.match(distribution.url, /corretto-8/);
    });
});
