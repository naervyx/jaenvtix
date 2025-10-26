"use strict";

function stripComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s+)\/\/.*$/gm, (match, prefix) => (prefix !== undefined ? prefix : ""));
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

    const content = stripComments(text);
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
