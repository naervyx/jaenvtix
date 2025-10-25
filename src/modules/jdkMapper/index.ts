import * as vscode from "vscode";

import type {
    NormalizedArchitecture,
    NormalizedOperatingSystem,
} from "../platformInfo";

export type JdkVendorId = "oracle" | "corretto";

export interface JdkDownloadDescriptor {
    readonly url: string;
    readonly checksum?: string;
}

interface VendorVersionManifest {
    readonly downloads: Partial<
        Record<
            NormalizedOperatingSystem,
            Partial<Record<NormalizedArchitecture, JdkDownloadDescriptor>>
        >
    >;
}

interface VendorManifest {
    readonly license: string;
    readonly versions: Record<string, VendorVersionManifest>;
}

interface JdkDistributionConfiguration {
    get<T>(section: string): T | undefined;
}

export interface ResolveJdkDistributionParameters {
    readonly version: string;
    readonly os: NormalizedOperatingSystem;
    readonly arch: NormalizedArchitecture;
    readonly configuration?: JdkDistributionConfiguration;
}

export interface JdkDistribution {
    readonly vendor: JdkVendorId;
    readonly version: string;
    readonly os: NormalizedOperatingSystem;
    readonly arch: NormalizedArchitecture;
    readonly url: string;
    readonly checksum?: string;
    readonly license: string;
}

const DEFAULT_VENDOR_PRIORITY: readonly JdkVendorId[] = [
    "oracle",
    "corretto",
];

const LTS_VERSIONS = new Set([8, 11, 17, 21, 25]);

const VENDORS: Record<JdkVendorId, VendorManifest> = {
    oracle: {
        license: "Oracle No-Fee Terms and Conditions",
        versions: {
            "21": {
                downloads: {
                    windows: {
                        x64: {
                            url: "https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.zip",
                            checksum: "6c7ac726d7cf8b1a08b263e208ab7091",
                        },
                    },
                    macos: {
                        x64: {
                            url: "https://download.oracle.com/java/21/latest/jdk-21_macos-x64_bin.tar.gz",
                        },
                        arm64: {
                            url: "https://download.oracle.com/java/21/latest/jdk-21_macos-aarch64_bin.tar.gz",
                        },
                    },
                    linux: {
                        x64: {
                            url: "https://download.oracle.com/java/21/latest/jdk-21_linux-x64_bin.tar.gz",
                            checksum: "8f1c873bd9cd68f61d4dddc5c89cc5ae",
                        },
                        arm64: {
                            url: "https://download.oracle.com/java/21/latest/jdk-21_linux-aarch64_bin.tar.gz",
                        },
                    },
                },
            },
            "25": {
                downloads: {
                    windows: {
                        x64: {
                            url: "https://download.oracle.com/java/25/latest/jdk-25_windows-x64_bin.zip",
                        },
                    },
                    macos: {
                        x64: {
                            url: "https://download.oracle.com/java/25/latest/jdk-25_macos-x64_bin.tar.gz",
                        },
                        arm64: {
                            url: "https://download.oracle.com/java/25/latest/jdk-25_macos-aarch64_bin.tar.gz",
                        },
                    },
                    linux: {
                        x64: {
                            url: "https://download.oracle.com/java/25/latest/jdk-25_linux-x64_bin.tar.gz",
                        },
                        arm64: {
                            url: "https://download.oracle.com/java/25/latest/jdk-25_linux-aarch64_bin.tar.gz",
                        },
                    },
                },
            },
        },
    },
    corretto: {
        license: "Amazon Software License",
        versions: {
            "8": {
                downloads: {
                    windows: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-8-x64-windows-jdk.zip",
                        },
                    },
                    macos: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-8-x64-macos-jdk.tar.gz",
                        },
                    },
                    linux: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-8-x64-linux-jdk.tar.gz",
                        },
                    },
                },
            },
            "11": {
                downloads: {
                    windows: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-11-x64-windows-jdk.zip",
                        },
                    },
                    macos: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-11-x64-macos-jdk.tar.gz",
                        },
                        arm64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-11-aarch64-macos-jdk.tar.gz",
                        },
                    },
                    linux: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-11-x64-linux-jdk.tar.gz",
                        },
                        arm64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-11-aarch64-linux-jdk.tar.gz",
                        },
                    },
                },
            },
            "17": {
                downloads: {
                    windows: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-17-x64-windows-jdk.zip",
                        },
                    },
                    macos: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-17-x64-macos-jdk.tar.gz",
                        },
                        arm64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-17-aarch64-macos-jdk.tar.gz",
                        },
                    },
                    linux: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-17-x64-linux-jdk.tar.gz",
                        },
                        arm64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-17-aarch64-linux-jdk.tar.gz",
                        },
                    },
                },
            },
            "21": {
                downloads: {
                    windows: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-21-x64-windows-jdk.zip",
                        },
                    },
                    macos: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-21-x64-macos-jdk.tar.gz",
                        },
                        arm64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-21-aarch64-macos-jdk.tar.gz",
                        },
                    },
                    linux: {
                        x64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-21-x64-linux-jdk.tar.gz",
                        },
                        arm64: {
                            url: "https://corretto.aws/downloads/latest/amazon-corretto-21-aarch64-linux-jdk.tar.gz",
                        },
                    },
                },
            },
        },
    },
};

export function resolveJdkDistribution({
    version,
    os,
    arch,
    configuration,
}: ResolveJdkDistributionParameters): JdkDistribution {
    const reader = configuration ?? vscode.workspace.getConfiguration();
    const majorVersion = parseMajorVersion(version);
    const normalizedVersion = String(majorVersion);

    enforcePreviewPolicy(reader, majorVersion);

    const preferOracle = reader.get<boolean>("jaenvtix.preferOracle") ?? true;
    const fallbackVendor = normalizeVendor(reader.get<string>("jaenvtix.fallbackVendor"));

    const vendorOrder = buildVendorOrder(preferOracle, fallbackVendor);

    for (const vendor of vendorOrder) {
        const manifest = VENDORS[vendor];
        const versionManifest = manifest?.versions[normalizedVersion];
        const osManifest = versionManifest?.downloads[os];
        const descriptor = osManifest?.[arch];

        if (!descriptor) {
            continue;
        }

        return {
            vendor,
            version: normalizedVersion,
            os,
            arch,
            url: descriptor.url,
            checksum: descriptor.checksum,
            license: manifest.license,
        };
    }

    throw new Error(
        `No supported JDK distribution for version "${version}" on ${os}/${arch}.`,
    );
}

function enforcePreviewPolicy(
    configuration: JdkDistributionConfiguration,
    majorVersion: number,
): void {
    if (LTS_VERSIONS.has(majorVersion)) {
        return;
    }

    const allowPreview = configuration.get<boolean>(
        "jaenvtix.allowPreviewJdk",
    );

    if (!allowPreview) {
        throw new Error(
            `Preview JDK version ${majorVersion} is not permitted by configuration.`,
        );
    }
}

function parseMajorVersion(version: string): number {
    const match = /^(\d+)/u.exec(version.trim());

    if (!match) {
        throw new Error(`Unable to determine major version from "${version}".`);
    }

    return Number.parseInt(match[1]!, 10);
}

function normalizeVendor(candidate: string | undefined): JdkVendorId {
    if (!candidate) {
        return "corretto";
    }

    const normalized = candidate.trim().toLowerCase();

    if (isVendorId(normalized)) {
        return normalized;
    }

    return "corretto";
}

function isVendorId(candidate: string): candidate is JdkVendorId {
    return (DEFAULT_VENDOR_PRIORITY as readonly string[]).includes(candidate);
}

function buildVendorOrder(
    preferOracle: boolean,
    fallbackVendor: JdkVendorId,
): readonly JdkVendorId[] {
    const ordered = new Set<JdkVendorId>();
    const prioritizedVendors = preferOracle
        ? DEFAULT_VENDOR_PRIORITY
        : DEFAULT_VENDOR_PRIORITY.filter((vendor) => vendor !== "oracle");

    if (preferOracle) {
        ordered.add("oracle");
    }

    for (const vendor of prioritizedVendors) {
        ordered.add(vendor);
    }

    if (ordered.has(fallbackVendor)) {
        ordered.delete(fallbackVendor);
    }

    ordered.add(fallbackVendor);

    return Array.from(ordered);
}
