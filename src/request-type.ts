import * as vscode from 'vscode-languageserver';

import * as fs from './fs';

export namespace GlobalRefsRequest {
	export const type: vscode.RequestType<vscode.WorkspaceSymbolParams, vscode.SymbolInformation[], any> = {
		get method() {
			return 'textDocument/global-refs';
		}
	};
}

export namespace InitializeRequest {
	export const type: vscode.RequestType<vscode.InitializeParams, vscode.InitializeResult, any> = {
		get method() {
			return 'initialize';
		}
	};
}

export namespace ShutdownRequest {
	export const type = {
		get method() {
			return 'shutdown';
		}
	};
}

export namespace ExitRequest {
	export const type = {
		get method() {
			return 'exit';
		}
	};
}

export namespace ReadDirRequest {
	export const type: vscode.RequestType<string, fs.FileInfo[], any> = {
		get method() {
			return 'fs/readDir';
		}
	};
}

export namespace ReadFileRequest {
	export const type: vscode.RequestType<string, string, any> = {
		get method() {
			return 'fs/readFile';
		}
	};
}

export namespace DefinitionRequest {
	export const type: vscode.RequestType<vscode.TextDocumentPositionParams, vscode.Location[], any> = {
		get method() {
			return 'textDocument/definition';
		}
	};
}

export namespace HoverRequest {
	export const type: vscode.RequestType<vscode.TextDocumentPositionParams, vscode.Hover, any> = {
		get method() {
			return 'textDocument/hover';
		}
	};
}

export namespace ReferencesRequest {
	export const type: vscode.RequestType<vscode.ReferenceParams, vscode.Location[], any> = {
		get method() {
			return 'textDocument/references';
		}
	};
}

export interface WorkspaceSymbolParamsWithLimit {
	query: string;
	limit: number;
}

export namespace WorkspaceSymbolsRequest {
	export const type: vscode.RequestType<WorkspaceSymbolParamsWithLimit, vscode.SymbolInformation[], any> = {
		get method() {
			return 'workspace/symbol';
		}
	};
}

export namespace WorkspaceReferenceRequest {
	export const type: vscode.RequestType<WorkspaceReferenceParams, ReferenceInformation[], any> = {
		get method() {
			return 'workspace/reference';
		}
	};
}

/*
 * WorkspaceReferenceParams holds parameters for the
 * workspace/reference endpoint (an extension of the original LSP
 * spec).
 */
export interface WorkspaceReferenceParams { }

/*
 * ReferenceInformation enapsulates the metadata for a symbol
 * reference in code.
 */
export interface ReferenceInformation {
	location: vscode.Location;
	name: string;
	containerName: string;
	uri: string;
}

export namespace DocumentSymbolRequest {
	export const type: vscode.RequestType<vscode.DocumentSymbolParams, vscode.SymbolInformation[], any> = {
		get method() {
			return "textDocument/documentSymbol";
		}
	};
}

export namespace TextDocumentDidOpenNotification {
	export const type: vscode.NotificationType<vscode.DidOpenTextDocumentParams> = {
		get method() {
			return 'textDocument/didOpen';
		}
	};
}

export namespace TextDocumentDidCloseNotification {
	export const type: vscode.NotificationType<vscode.DidCloseTextDocumentParams> = {
		get method() {
			return 'textDocument/didClose';
		}
	};
}

export namespace TextDocumentDidSaveNotification {
	export const type: vscode.NotificationType<vscode.DidSaveTextDocumentParams> = {
		get method() {
			return 'textDocument/didSave';
		}
	};
}

export namespace TextDocumentDidChangeNotification {
	export const type: vscode.NotificationType<vscode.DidChangeTextDocumentParams> = {
		get method() {
			return 'textDocument/didChange';
		}
	};
}
