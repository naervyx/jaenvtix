import * as assert from "assert";

import { detectPlatform } from "../modules/platformInfo";

interface ConfigurationReader {
    get<T>(section: string): T | undefined;
}

class TestConfiguration implements ConfigurationReader {
    public constructor(private readonly values: Record<string, unknown> = {}) {}

    public get<T>(section: string): T | undefined {
        return this.values[section] as T | undefined;
    }
}

suite("platformInfo", () => {
    const overrideKey = "jaenvtix.platform.override";

    test("detectPlatform normalizes node platform values", () => {
        const configuration = new TestConfiguration();
        const result = detectPlatform({
            platform: "win32",
            arch: "ia32",
            configuration,
        });

        assert.deepStrictEqual(result, {
            os: "windows",
            arch: "x86",
        });
    });

    test("detectPlatform prefers configuration overrides", () => {
        const configuration = new TestConfiguration({
            [overrideKey]: {
                os: "macOS",
                arch: "amd64",
            },
        });

        const result = detectPlatform({
            platform: "linux",
            arch: "arm64",
            configuration,
        });

        assert.deepStrictEqual(result, {
            os: "macos",
            arch: "x64",
        });
    });

    test("detectPlatform falls back to detected architecture when override missing", () => {
        const configuration = new TestConfiguration({
            [overrideKey]: {
                os: "Linux",
            },
        });

        const result = detectPlatform({
            platform: "linux",
            arch: "arm64",
            configuration,
        });

        assert.deepStrictEqual(result, {
            os: "linux",
            arch: "arm64",
        });
    });

    test("detectPlatform ignores invalid override values", () => {
        const configuration = new TestConfiguration({
            [overrideKey]: {
                os: "beos",
                arch: "mips64",
            },
        });

        const result = detectPlatform({
            platform: "darwin",
            arch: "x64",
            configuration,
        });

        assert.deepStrictEqual(result, {
            os: "macos",
            arch: "x64",
        });
    });
});
