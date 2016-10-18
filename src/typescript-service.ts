/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { IConnection, Position, Location } from 'vscode-languageserver';

import * as util from './util';
import ProjectManager from './project-manager';

import ExportedSymbolsProvider from './exported-symbols-provider'
import ExternalRefsProvider from './external-refs-provider';
import WorkspaceSymbolsProvider from './workspace-symbols-provider';

var sanitizeHtml = require('sanitize-html');
var JSONPath = require('jsonpath-plus');

export default class TypeScriptService {

    projectManager: ProjectManager;
    root: string;

    private externalRefs = null;
    private exportedEnts = null;
    private topLevelDecls = null;
    private exportedSymbolProvider: ExportedSymbolsProvider;
    private externalRefsProvider: ExternalRefsProvider;
    private workspaceSymbolProvider: WorkspaceSymbolsProvider;

    private envDefs = [];

    constructor(root: string, strict: boolean, connection: IConnection) {
        this.root = root;
        this.projectManager = new ProjectManager(root, strict, connection);

        this.initEnvDefFiles();

        //initialize providers 
        this.exportedSymbolProvider = new ExportedSymbolsProvider(this);
        this.externalRefsProvider = new ExternalRefsProvider(this);
        this.workspaceSymbolProvider = new WorkspaceSymbolsProvider(this);
    }

    initEnvDefFiles() {
        try {
            this.envDefs.push(JSON.parse(fs.readFileSync(path.join(__dirname, '../src/defs/node.json'), 'utf8')));
            this.envDefs.push(JSON.parse(fs.readFileSync(path.join(__dirname, '../src/defs/ecmascript.json'), 'utf8')));
        } catch (error) {
            console.error("error", error.stack || error);
        }
    }

    lookupEnvDef(property, container) {
        let results = [];
        if (this.envDefs && this.envDefs.length > 0) {
            this.envDefs.forEach(envDef => {
                let res = JSONPath({ json: envDef, path: `$..${property}` });
                if (res) {
                    results = results.concat(res);
                }
            });
        }

        if (results.length > 1) {
            let result = results.find(info => {
                if (info['!url'] && container && info['!url'].indexOf(container) > -1) {
                    return true;
                }
            });
            return result ? result : results[0];
        }

        if (results) {
            return results[0];
        }
    }

    getExternalRefs() {
        if (this.externalRefs === null) {
            this.externalRefs = this.externalRefsProvider.collectExternals();
        }
        return this.externalRefs;
    }

    getExportedEnts() {
        if (this.exportedEnts === null) {
            this.exportedEnts = this.exportedSymbolProvider.collectExportedEntities();
        }
        return this.exportedEnts;
    }

    doc(node: ts.Node): string {
        let text = node.getSourceFile().getFullText();
        let comments1 = (ts as any).getLeadingCommentRanges(text, node.getFullStart());
        let comments2 = (ts as any).getTrailingCommentRanges(text, node.getEnd());
        let comments = [];
        if (!comments1 && !comments2) {
            let parents = util.collectAllParents(node, []);
            for (let i = 0; i < parents.length; i++) {
                let parent = parents[i];
                let comments1 = (ts as any).getLeadingCommentRanges(text, parent.getFullStart());
                let comments2 = (ts as any).getTrailingCommentRanges(text, parent.getEnd());
                if (comments1) {
                    comments = comments.concat(comments1);
                }
                if (comments2) {
                    comments = comments.concat(comments2);
                }
                if (comments1 || comments2) break;
            }
        } else {
            comments = comments1 || comments2;
        }

        let res = "";
        if (comments) {
            comments.forEach(comment => {
                res = res + sanitizeHtml(`<p>${text.substring(comment.pos + 2, comment.end)}</p>`);
            });
        }
        return res;
    }

    getDefinition(uri: string, line: number, column: number): Location[] {
        try {
            const fileName: string = util.uri2path(uri);

            const service: ts.LanguageService = this.getService(fileName);
            const sourceFile = this.getSourceFile(service, fileName);
            if (!sourceFile) {
                return [];
            }

            const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
            const defs: ts.DefinitionInfo[] = service.getDefinitionAtPosition(fileName, offset);
            const ret = [];
            if (defs) {
                for (let def of defs) {
                    const sourceFile = service.getProgram().getSourceFile(def.fileName);
                    const start = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
                    const end = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start + def.textSpan.length);
                    ret.push(Location.create(util.path2uri(this.root, def.fileName), {
                        start: start,
                        end: end
                    }));
                }
            }
            return ret;
        } catch (exc) {
            console.error("Exception occurred", exc.stack || exc);
        }
    }

    getExternalDefinition(uri: string, line: number, column: number) {
        const fileName: string = util.uri2path(uri);

        const service: ts.LanguageService = this.getService(fileName);

        const sourceFile = this.getSourceFile(service, fileName);
        if (!sourceFile) {
            return;
        }

        const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
        return this.getExternalRefs().find(ref => {
            if (ref.file == fileName && ref.pos == offset) {
                return true;
            }
        });
    }

    getTopLevelDeclarations(limit?: number) {
        if (this.topLevelDecls === null || (limit && this.topLevelDecls.length < limit)) {
            this.topLevelDecls = this.workspaceSymbolProvider.collectTopLevelInterface(limit);
        }

        return limit ? this.topLevelDecls.slice(0, limit) : this.topLevelDecls;
    }


    getHover(uri: string, line: number, column: number): ts.QuickInfo {
        try {
            const fileName: string = util.uri2path(uri);
            const service: ts.LanguageService = this.getService(fileName);
            const sourceFile = this.getSourceFile(service, fileName);
            if (!sourceFile) {
                return null;
            }
            const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
            return service.getQuickInfoAtPosition(fileName, offset);
        } catch (exc) {
            console.error("Exception occurred", exc.stack || exc);
        }
    }

    getReferences(uri: string, line: number, column: number): Location[] {
        try {
            const fileName: string = util.uri2path(uri);

            const service: ts.LanguageService = this.getService(fileName);

            const sourceFile = this.getSourceFile(service, fileName);
            if (!sourceFile) {
                return [];
            }

            this.projectManager.prepareService(fileName);

            const offset: number = ts.getPositionOfLineAndCharacter(sourceFile, line, column);
            // const offset: number = this.offset(fileName, line, column);
            const refs = service.getReferencesAtPosition(fileName, offset);
            const ret = [];
            if (refs) {
                for (let ref of refs) {
                    const sourceFile = service.getProgram().getSourceFile(ref.fileName);
                    let start = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start);
                    let end = ts.getLineAndCharacterOfPosition(sourceFile, ref.textSpan.start + ref.textSpan.length);
                    ret.push(Location.create(util.path2uri(this.root, ref.fileName), {
                        start: start,
                        end: end
                    }));
                }
            }
            return ret;
        } catch (exc) {
            console.error("Exception occurred", exc.stack || exc);
        }
    }

    getWorkspaceSymbols(query: string, limit?: number): ts.NavigateToItem[] {
        // TODO: multiple projects?
        const service: ts.LanguageService = this.projectManager.getAnyService();
        return service.getNavigateToItems(query, limit);
    }

    getPositionFromOffset(fileName: string, offset: number): Position {

        const service: ts.LanguageService = this.getService(fileName);
        const sourceFile = this.getSourceFile(service, fileName);
        if (!sourceFile) {
            return null;
        }
        let res = ts.getLineAndCharacterOfPosition(sourceFile, offset);
        return Position.create(res.line, res.character);
    }

    private getSourceFile(service: ts.LanguageService, fileName: string): ts.SourceFile {
        if (!this.projectManager.hasFile(fileName)) {
            return null;
        }
        const sourceFile = service.getProgram().getSourceFile(fileName);
        if (sourceFile) {
            return sourceFile;
        }
        // HACK (alexsaveliev) using custom method to add a file
        service.getProgram().addFile(fileName);
        return service.getProgram().getSourceFile(fileName);
    }

    private getService(fileName: string): ts.LanguageService {
        return this.projectManager.getService(fileName);
    }
}
