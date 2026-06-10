import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import type {JdkVendor} from './javaUrl';
import {parseJdkVendor} from './toolchainsXml';

/**
 * Metadata Jaenvtix keeps next to each cached JDK so later runs can decide
 * whether a newer security patch is available.
 */
export interface VersionInfo {
    /** Exact runtime version of the cached JDK, e.g. `'21.0.5+11'`. */
    fullVersion: string;
    /** Unix timestamp (ms) of the last update check. `0` forces a check. */
    checkedAt: number;
    vendor: JdkVendor;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Dotfile inside the JDK cache slot. Deliberately NOT `version.txt`, which
 * some vendors ship themselves at the JDK root.
 */
export function getVersionFilePath(jdkHome: string): string {
    return join(jdkHome, '.jaenvtix-version.json');
}

/** Reads the slot's version metadata; a missing or corrupt file yields `null`. */
export function readVersionInfo(jdkHome: string): VersionInfo | null {
    const filePath = getVersionFilePath(jdkHome);
    if (!existsSync(filePath)) {
        return null;
    }

    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<VersionInfo>;
        if (typeof parsed.fullVersion !== 'string' || typeof parsed.checkedAt !== 'number' || typeof parsed.vendor !== 'string') {
            return null;
        }
        return parsed as VersionInfo;
    } catch {
        return null;
    }
}

/** Persists the slot's version metadata. Best-effort: a write failure never throws. */
export function writeVersionInfo(jdkHome: string, info: VersionInfo): void {
    try {
        writeFileSync(getVersionFilePath(jdkHome), JSON.stringify(info, null, 2), 'utf-8');
    } catch {
        // A read-only cache dir must not break the pipeline; the check simply
        // repeats next run.
    }
}

/** `true` when no metadata exists or the last check is older than 24 hours. */
export function shouldCheckForUpdate(info: VersionInfo | null, nowMs: number = Date.now()): boolean {
    if (!info) {
        return true;
    }
    return (nowMs - info.checkedAt) > CHECK_INTERVAL_MS;
}

/** Re-stamps `checkedAt` so the next check is rate-limited to 24h from now. */
export function touchLastChecked(jdkHome: string, info: VersionInfo, nowMs: number = Date.now()): void {
    writeVersionInfo(jdkHome, {...info, checkedAt: nowMs});
}

function numericSegments(version: string): number[] {
    return (version.match(/\d+/g) ?? []).map((segment) => Number.parseInt(segment, 10));
}

/**
 * `true` only when `latest` is strictly newer than `current`, comparing the
 * numeric segments of each string (`'21.0.8+9'` → `[21, 0, 8, 9]`). Strict
 * comparison avoids redownload loops on format differences and never
 * triggers a downgrade.
 */
export function isNewerVersion(latest: string, current: string): boolean {
    const latestParts = numericSegments(latest);
    const currentParts = numericSegments(current);
    if (latestParts.length === 0 || currentParts.length === 0) {
        return false;
    }

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
        const a = latestParts[i] ?? 0;
        const b = currentParts[i] ?? 0;
        if (a !== b) {
            return a > b;
        }
    }
    return false;
}

/** Maps the `release` file's IMPLEMENTOR (as parsed by `parseJdkVendor`) to a vendor ID. */
function vendorFromImplementor(implementor: string): JdkVendor | null {
    if (implementor.startsWith('amazon')) {return 'corretto';}
    if (implementor.startsWith('eclipse') || implementor.startsWith('adoptium')) {return 'temurin';}
    if (implementor.startsWith('oracle')) {return 'oracle';}
    if (implementor.startsWith('bellsoft')) {return 'liberica';}
    if (implementor.startsWith('azul')) {return 'zulu';}
    if (implementor.startsWith('ibm') || implementor.startsWith('international')) {return 'semeru';}
    if (implementor.startsWith('microsoft')) {return 'microsoft';}
    return null;
}

/**
 * Bootstraps `VersionInfo` from the JDK's own `release` file, for slots
 * downloaded before version tracking existed (or right after extraction).
 *
 * Business rules:
 * - `JAVA_RUNTIME_VERSION` (full, e.g. `21.0.5+11-LTS`) is preferred over
 *   `JAVA_VERSION` (no build number).
 * - Returns `null` when the release file is missing/unreadable or the
 *   implementor maps to no known vendor — callers must then skip the update
 *   check rather than guess.
 */
export function buildVersionInfoFromDisk(jdkHome: string, checkedAt: number = Date.now()): VersionInfo | null {
    let releaseContent: string;
    try {
        releaseContent = readFileSync(join(jdkHome, 'release'), 'utf-8');
    } catch {
        return null;
    }

    const runtimeVersion = /^JAVA_RUNTIME_VERSION="([^"]+)"/m.exec(releaseContent)?.[1]
        ?? /^JAVA_VERSION="([^"]+)"/m.exec(releaseContent)?.[1];
    if (!runtimeVersion) {
        return null;
    }

    const vendor = vendorFromImplementor(parseJdkVendor(releaseContent));
    if (!vendor) {
        return null;
    }

    return {fullVersion: runtimeVersion, checkedAt, vendor};
}
