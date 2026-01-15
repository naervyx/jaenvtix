import {PlatformType} from "./type/platformType";
import {ArchitectureType} from "./type/architectureType";

export interface JdkDistribution {
    readonly name: string;
    readonly url: string;
    readonly extension: string;
}

export interface VendorConfig {
    readonly baseUrl: string;
    readonly buildPath: (version: string, os: string, arch: string, ext: string) => string;
    readonly osNames: Readonly<Record<PlatformType, string | undefined>>;
    readonly archNames: Readonly<Record<ArchitectureType, string | undefined>>;
}