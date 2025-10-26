export interface FormattingOptions {
    insertSpaces?: boolean;
    tabSize?: number;
    eol?: string;
}

export interface ModifyOptions {
    formattingOptions?: FormattingOptions;
}

export interface Edit {
    offset: number;
    length: number;
    content: string;
}

export type JSONPath = (string | number)[];

export function modify(text: string, path: JSONPath, value: unknown, options?: ModifyOptions): Edit[];
export function applyEdits(text: string, edits: Edit[]): string;
export function parse(text: string): unknown;
