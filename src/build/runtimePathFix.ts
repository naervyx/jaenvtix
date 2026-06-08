import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';

function hasJavac(homePath: string, os: NodeJS.Platform): boolean {
    const binary = os === 'win32' ? 'javac.exe' : 'javac';
    return existsSync(join(homePath, 'bin', binary));
}

/**
 * Given a path that is NOT a valid JDK home (no bin/javac[.exe]), attempt to
 * recover the correct home by searching nearby locations.
 *
 * Covers common user mistakes:
 *   - bin/ instead of the JDK root         → goes up 1 level
 *   - bin/javac pointed directly            → goes up 2 levels
 *   - macOS .jdk bundle (Contents/Home)     → descends into Contents/Home or Home
 *
 * Search is bounded to 2 levels up. Symlinks are not followed recursively.
 * Returns the corrected absolute path, or undefined if no valid home was found.
 */
export function fixPath(homePath: string, os: NodeJS.Platform): string | undefined {
    // Guard: dirname(root) === root on every OS ('/' on Unix, 'C:\' on Windows).
    // Never report a filesystem root as a valid JDK home — on CI runners Java is
    // often installed system-wide, so /bin/javac exists and a shallow path like
    // '/nonexistent' would otherwise traverse up to '/' and match spuriously.

    const upOne = dirname(homePath);
    if (dirname(upOne) !== upOne && hasJavac(upOne, os)) {
        return upOne;
    }

    const upTwo = dirname(upOne);
    if (dirname(upTwo) !== upTwo && hasJavac(upTwo, os)) {
        return upTwo;
    }

    if (os === 'darwin') {
        const contentsHome = join(homePath, 'Contents', 'Home');
        if (hasJavac(contentsHome, os)) {
            return contentsHome;
        }
        const home = join(homePath, 'Home');
        if (hasJavac(home, os)) {
            return home;
        }
    }

    return undefined;
}
