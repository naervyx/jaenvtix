import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
    {
        files: ["**/*.ts"],
    },
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
        },

        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: ["./tsconfig.json"],
                tsconfigRootDir: process.cwd(),
            },
            ecmaVersion: 2022,
            sourceType: "module",
        },

        rules: {
            "@typescript-eslint/consistent-type-definitions": ["warn", "interface"],
            "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
            "@typescript-eslint/naming-convention": [
                "warn",
                {
                    selector: "default",
                    format: ["camelCase"],
                    leadingUnderscore: "allow",
                    trailingUnderscore: "allow",
                },
                {
                    selector: "variable",
                    format: ["camelCase", "UPPER_CASE"],
                    leadingUnderscore: "allow",
                    trailingUnderscore: "allow",
                },
                {
                    selector: "function",
                    format: ["camelCase", "PascalCase"],
                },
                {
                    selector: "typeLike",
                    format: ["PascalCase"],
                },
                {
                    selector: "enumMember",
                    format: ["PascalCase", "UPPER_CASE"],
                },
                {
                    selector: "variable",
                    types: ["boolean"],
                    format: ["PascalCase", "camelCase"],
                    prefix: ["is", "has", "should", "can", "did", "will"],
                },
            ],
            "@typescript-eslint/no-duplicate-type-constituents": "warn",
            "@typescript-eslint/no-duplicate-enum-values": "error",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-require-imports": "error",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/prefer-readonly": "warn",
            "@typescript-eslint/switch-exhaustiveness-check": "warn",

            complexity: ["warn", 10],
            curly: "warn",
            eqeqeq: "warn",
            "max-depth": ["warn", 4],
            "max-params": ["warn", 4],
            "no-duplicate-imports": "error",
            "no-throw-literal": "warn",
            "padding-line-between-statements": [
                "warn",
                { blankLine: "always", prev: "directive", next: "*" },
                { blankLine: "always", prev: "*", next: "return" },
                { blankLine: "always", prev: "import", next: "*" },
                { blankLine: "any", prev: "import", next: "import" },
            ],
            semi: "warn",
            "sort-imports": [
                "warn",
                {
                    ignoreCase: false,
                    ignoreDeclarationSort: false,
                    ignoreMemberSort: false,
                    memberSyntaxSortOrder: ["none", "all", "multiple", "single"],
                    allowSeparatedGroups: true,
                },
            ],
        },
    },
];
