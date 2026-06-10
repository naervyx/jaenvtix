/**
 * Handlers invoked by `scanXml` as it walks an XML document. The scanner owns
 * tokenization only; all semantic state (tag stacks, captures) lives in the
 * caller's handlers.
 */
export interface XmlScanHandlers {
    /** Called for every opening tag. Self-closing tags trigger this, then `onCloseTag`. */
    onOpenTag(tagName: string): void;
    /** Called for every closing tag, including the synthetic close of a self-closing tag. */
    onCloseTag(tagName: string): void;
    /** Called with raw text between tags and with the contents of CDATA sections. */
    onText(text: string): void;
    /** Optional early-exit probe checked before each token; return `true` to stop scanning. */
    isDone?(): boolean;
}

function getLocalName(qualifiedName: string): string {
    const separatorIndex = qualifiedName.lastIndexOf(':');
    if (separatorIndex < 0) {return qualifiedName;}
    return qualifiedName.slice(separatorIndex + 1);
}

function findTagEndIndex(xml: string, fromIndex: number): number {
    let openQuote: number | 0 = 0;

    for (let index = fromIndex; index < xml.length; index++) {
        const code = xml.charCodeAt(index);

        if (openQuote) {
            if (code === openQuote) {openQuote = 0;}
            continue;
        }

        if (code === 34 || code === 39) {
            openQuote = code;
            continue;
        }

        if (code === 62) {return index;}
    }

    return -1;
}

function readTagLocalName(xml: string, startIndex: number, endIndex: number): string {
    if (startIndex >= endIndex) {return '';}

    let index = startIndex;

    while (index < endIndex) {
        const code = xml.charCodeAt(index);
        if (code <= 32 || code === 47) {break;}
        index++;
    }

    return getLocalName(xml.slice(startIndex, index));
}

function isSelfClosingTag(xml: string, gtIndex: number): boolean {
    if (gtIndex <= 0) {return false;}
    return xml.charCodeAt(gtIndex - 1) === 47;
}

/**
 * Minimal, dependency-free streaming XML scanner shared by the `pom.xml`
 * parsers (`javaVersion.ts` and `javaLaunchInfo.ts`).
 *
 * Business rules:
 * - Namespace prefixes are stripped: `<m:version>` is reported as `version`.
 * - Comments, processing instructions (`<?...?>`), and `<!...>` declarations
 *   are skipped without handler callbacks.
 * - CDATA contents are delivered through `onText`, like regular text.
 * - Self-closing tags (`<tag/>`) produce an `onOpenTag` immediately followed
 *   by an `onCloseTag`, so callers can treat both tag forms uniformly.
 * - Attribute values are respected when finding a tag's closing `>` (a `>`
 *   inside a quoted attribute does not terminate the tag).
 */
export function scanXml(xml: string, handlers: XmlScanHandlers): void {
    let cursor = 0;

    while (cursor < xml.length && !handlers.isDone?.()) {
        const ltIndex = xml.indexOf('<', cursor);
        if (ltIndex < 0) {break;}

        if (ltIndex > cursor) {handlers.onText(xml.slice(cursor, ltIndex));}
        cursor = ltIndex;

        if (xml.startsWith('<!--', cursor)) {
            const end = xml.indexOf('-->', cursor + 4);
            cursor = end >= 0 ? end + 3 : xml.length;
            continue;
        }

        if (xml.startsWith('<?', cursor)) {
            const end = xml.indexOf('?>', cursor + 2);
            cursor = end >= 0 ? end + 2 : xml.length;
            continue;
        }

        if (xml.startsWith('<![CDATA[', cursor)) {
            const end = xml.indexOf(']]>', cursor + 9);
            if (end < 0) {break;}
            handlers.onText(xml.slice(cursor + 9, end));
            cursor = end + 3;
            continue;
        }

        if (xml.startsWith('<!', cursor)) {
            const gtIndex = findTagEndIndex(xml, cursor + 2);
            cursor = gtIndex >= 0 ? gtIndex + 1 : xml.length;
            continue;
        }

        const gtIndex = findTagEndIndex(xml, cursor + 1);
        if (gtIndex < 0) {break;}

        if (xml.startsWith('</', cursor)) {
            const closingName = readTagLocalName(xml, cursor + 2, gtIndex);
            cursor = gtIndex + 1;

            if (!closingName) {continue;}
            handlers.onCloseTag(closingName);
            continue;
        }

        const openingName = readTagLocalName(xml, cursor + 1, gtIndex);
        const selfClosing = isSelfClosingTag(xml, gtIndex);
        cursor = gtIndex + 1;

        if (!openingName) {continue;}

        handlers.onOpenTag(openingName);
        if (selfClosing) {handlers.onCloseTag(openingName);}
    }
}
