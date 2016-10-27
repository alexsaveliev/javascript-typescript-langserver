# JavaScript/TypeScript language server

This is a language server for JavaScript and TypeScript that adheres to the [Language Server Protocol (LSP)](https://github.com/Microsoft/language-server-protocol/blob/master/protocol.md). It uses [TypeScript's](http://www.typescriptlang.org/) LanguageService to perform source code analysis.

## Getting started

1. `npm install`
1. `node_modules/.bin/tsc`
1. `node build/language-server.js`

To try it in [Visual Studio Code](https://code.visualstudio.com), install the [vscode-client](https://github.com/sourcegraph/langserver/tree/master/vscode-client) extension and then open up a `.ts` file.

## Development

Run `node_modules/.bin/tsc --watch`.

## Tests

Run `npm test` or `yarn test`.

## Command line arguments 

* `-p, --port` specifies port to use, default one is `2089`
* `-s, --strict` enables strict mode where server expects all files to be receives in `didOpen` notification requests.

## Supported LSP requests

### `initialize`
In strict mode we expect `rootPath` to be equal `file:///` while in non-strict mode VSCode usually sends absolute file URL. In both modes does not track existence of calling process.
### `exit`
Implementation closes underlying communication channel
### `shutdown`
Does nothing opposite to LSP specification that expects server to exit
### `textDocument/hover`
### `textDocument/definition`
### `textDocument/references`
### `workspace/symbols`
Introduces `limit` parameter to limit number of symbols to return

## Differences from LSP protocol specification
In strict mode LSP server does not touches underlying file system, instead it uses addition to LSP protocol to fetch information about workspace structure and files content by sending proprietary `fs/...` requests back to the caller (`fs/readDir`, `fs/readFile`) and keeping results in memory.

## Custom TypeScript compiler
We are using forked copy of TypeScript compiler to achieve the following goals:
* Add ability to append files on demand. Instead of parsing and analyzing the whole workspace, we are adding files on demand. For example, to extract hover information we only need to add explicitly one file (compiler will implicitly add all the imports and references)
* Allow searching for workspace symbols without a query string specified. Standard TypeScript's method returns no results for empty query while our modification returns first N symbols.
We are working to propose our changes into TypeScript upstream repository.

## Known issues

* You need to disable VSCode's built-in TypeScript support to avoid weird conflicts on TypeScript files (double hover tooltips, etc.). There's a hacky way to do this: add the setting `{"typescript.tsdk": "/dev/null"}` to your VSCode user or workspace settings.

