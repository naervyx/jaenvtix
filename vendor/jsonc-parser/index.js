"use strict";

function stripComments(text) {
    let result = "";
    let inString = false;
    let escaping = false;
    let inSingleLineComment = false;
    let inMultiLineComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const nextChar = index + 1 < text.length ? text[index + 1] : "";

        if (inSingleLineComment) {
            if (char === "\n" || char === "\r") {
                inSingleLineComment = false;
                result += char;
            }

            continue;
        }

        if (inMultiLineComment) {
            if (char === "*" && nextChar === "/") {
                inMultiLineComment = false;
                index += 1;
            }

            continue;
        }

        if (inString) {
            result += char;

            if (escaping) {
                escaping = false;
            } else if (char === "\\") {
                escaping = true;
            } else if (char === "\"") {
                inString = false;
            }

            continue;
        }

        if (char === "\"") {
            inString = true;
            result += char;
            continue;
        }

        if (char === "/" && nextChar === "/") {
            inSingleLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && nextChar === "*") {
            inMultiLineComment = true;
            index += 1;
            continue;
        }

        result += char;
    }

    return result;
}

function stripTrailingCommas(text) {
    let result = "";
    let inString = false;
    let escaping = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            result += char;

            if (escaping) {
                escaping = false;
            } else if (char === "\\") {
                escaping = true;
            } else if (char === "\"") {
                inString = false;
            }

            continue;
        }

        if (char === "\"") {
            inString = true;
            result += char;
            continue;
        }

        if (char === ",") {
            let lookahead = index + 1;

            while (lookahead < text.length) {
                const lookaheadChar = text[lookahead];

                if (lookaheadChar === " " || lookaheadChar === "\t" || lookaheadChar === "\r" || lookaheadChar === "\n") {
                    lookahead += 1;
                    continue;
                }

                if (lookaheadChar === "}" || lookaheadChar === "]") {
                    // Skip the trailing comma and continue scanning.
                    break;
                }

                result += char;
                break;
            }

            if (lookahead >= text.length) {
                // Trailing commas at EOF should be removed as well.
                continue;
            }

            if (lookahead < text.length && (text[lookahead] === "}" || text[lookahead] === "]")) {
                continue;
            }
        }

        result += char;
    }

    return result;
}

function normalizeOptions(options) {
    const formatting = options && options.formattingOptions ? options.formattingOptions : undefined;
    const insertSpaces = formatting?.insertSpaces !== false;
    const tabSize = typeof formatting?.tabSize === "number" ? formatting.tabSize : 4;
    const eol = typeof formatting?.eol === "string" ? formatting.eol : "\n";

    return { insertSpaces, tabSize, eol };
}

function parseDocument(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return {};
    }

    const content = stripTrailingCommas(stripComments(text));
    if (content.trim().length === 0) {
        return {};
    }

    try {
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Unable to parse JSONC content: ${(error && error.message) || error}`);
    }
}

function cloneObject(value) {
    return JSON.parse(JSON.stringify(value));
}

function parse(text) {
    return parseDocument(text);
}

function modify(text, path, value, options = {}) {
    if (!Array.isArray(path) || path.length !== 1 || typeof path[0] !== "string") {
        throw new Error("jsonc-parser shim only supports single-segment property paths");
    }

    const key = path[0];
    const document = parseDocument(text);
    const nextDocument = cloneObject(document);

    if (nextDocument[key] === value) {
        return [];
    }

    nextDocument[key] = value;

    const formatting = normalizeOptions(options);
    const indentation = formatting.insertSpaces ? " ".repeat(formatting.tabSize) : "\t";
    const raw = JSON.stringify(nextDocument, null, indentation);
    const withEol = raw.replace(/\n/g, formatting.eol);

    return [
        {
            offset: 0,
            length: text.length,
            content: withEol,
        },
    ];
}

function applyEdits(text, edits) {
    if (!Array.isArray(edits) || edits.length === 0) {
        return text;
    }

    const sorted = edits
        .slice()
        .sort((a, b) => a.offset - b.offset);
    let result = "";
    let lastOffset = 0;

    for (const edit of sorted) {
        const start = edit.offset;
        const end = start + (edit.length ?? 0);
        result += text.slice(lastOffset, start);
        result += edit.content ?? "";
        lastOffset = end;
    }

    result += text.slice(lastOffset);

    return result;
}

module.exports = { applyEdits, modify, parse };
