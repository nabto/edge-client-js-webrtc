const ERROR = 2;

module.exports = {
    root: true,
    env: {
        node: true
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/strict"
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: { "project": ["./tsconfig.json"] },
    plugins: [
        "@typescript-eslint"
    ],
    rules: {
        "@typescript-eslint/strict-boolean-expressions": [ERROR, {
            "allowString": false,
            "allowNumber": false
        }],
        "@typescript-eslint/switch-exhaustiveness-check": [ERROR]
    },
    ignorePatterns: ["test/*", "dist/*", "esm/*", "*.js"]
};
