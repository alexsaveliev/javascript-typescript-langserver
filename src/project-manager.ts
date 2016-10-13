/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>
/// <reference path="../typings/async/async.d.ts"/>

import * as path_ from 'path';

import * as ts from 'typescript';
import { IConnection } from 'vscode-languageserver';
import * as async from 'async';

import * as FileSystem from './fs';
import * as util from './util';

export default class ProjectsManager {

    private root: string;
    private strict: boolean;
    private entries: Map<string, string>;
    private fs: FileSystem.FileSystem;

    private defaultService: ts.LanguageService;
    private services: Map<string, ts.LanguageService>;

    constructor(root: string, strict: boolean, connection: IConnection) {
        this.root = util.normalizePath(root);
        this.strict = strict;
        this.entries = new Map<string, string>();
        this.services = new Map<string, ts.LanguageService>();

        if (strict) {
            this.fs = new FileSystem.RemoteFileSystem(connection)
        } else {
            this.fs = new FileSystem.LocalFileSystem(root)
        }
        this.defaultService = ts.createLanguageService(new InMemoryLanguageServiceHost(root, {
            module: ts.ModuleKind.CommonJS,
            allowNonTsExtensions: false,
            allowJs: false
        }, this.entries), ts.createDocumentRegistry());
    }

    initialize(): Promise<void> {

        let self = this;

        let done = false;

        return new Promise<void>(function (resolve, reject) {
            self.getFiles(self.root, function (err, files) {
                // HACK (callback is called twice) 
                if (done) {
                    return;
                }
                done = true;
                if (err) {
                    console.error('An error occurred while collecting files', err);
                    return reject(err);
                }
                self.fetchContent(files, function (err) {
                    if (err) {
                        console.error('An error occurred while fetching files content', err);
                        return reject(err);
                    }

                    self.processProjects(function () {
                        return resolve();
                    });

                });
            });
        });
    }

    hasFile(name) {
        return this.entries.has(name);
    }

    getService(fileName: string): ts.LanguageService {        
        let dir = path_.posix.dirname(fileName);
        let service;
        while (dir && dir != this.root) {            
            service = this.services.get(dir);
            if (service) {
                return service;
            }
            dir = path_.posix.dirname(dir);
            if (dir == '.') {
                dir = '';
            }            
        }
        service = this.services.get(dir);
        return service || this.defaultService;
    }

    getAnyService(): ts.LanguageService {
        let service = null;
        this.services.forEach(function(v, k) {
            if (!service) {
                service = v;
            }
        });
        return service || this.defaultService;
    }

    private fetchDir(path: string): AsyncFunction<FileSystem.FileInfo[]> {
        let self = this;
        return function (callback: (err?: Error, result?: FileSystem.FileInfo[]) => void) {
            self.fs.readDir(path, (err?: Error, result?: FileSystem.FileInfo[]) => {
                if (result) {
                    result.forEach(function (fi) {
                        fi.Name_ = path_.posix.join(path, fi.Name_)
                    })
                }
                return callback(err, result)
            });
        }
    }

    getFiles(path: string, callback: (err: Error, result?: string[]) => void) {

        const start = new Date().getTime();

        let self = this;
        let files: string[] = [];
        let counter: number = 0;

        let cb = function (err: Error, result?: FileSystem.FileInfo[]) {
            if (err) {
                console.error('got error while reading dir', err);
                return callback(err)
            }
            let tasks = [];
            result.forEach(function (fi) {
                if (fi.Name_.indexOf('/.') >= 0) {
                    return
                }
                if (fi.Dir_) {
                    counter++;
                    tasks.push(self.fetchDir(fi.Name_))
                } else {
                    if (/\.tsx?$/.test(fi.Name_) || /(^|\/)tsconfig\.json$/.test(fi.Name_)) {
                        files.push(fi.Name_)
                    }
                }
            });
            async.parallel(tasks, function (err: Error, result?: FileSystem.FileInfo[][]) {
                if (err) {
                    return callback(err)
                }
                result.forEach((items) => {
                    counter--;
                    cb(null, items)
                });
                if (counter == 0) {
                    console.error(files.length + ' found, fs scan complete in', (new Date().getTime() - start) / 1000.0);
                    callback(null, files)
                }
            })
        };
        this.fetchDir(path)(cb)
    }

    private fetchContent(files: string[], callback: (err?: Error) => void) {        
        let tasks = [];
        const self = this;
        const fetch = function (path: string): AsyncFunction<string> {
            return function (callback: (err?: Error, result?: string) => void) {
                self.fs.readFile(path, (err?: Error, result?: string) => {
                    if (err) {
                        console.error('Unable to fetch content of ' + path, err);
                        return callback(err)
                    }
                    const rel = path_.posix.relative(self.root, path);
                    self.entries.set(rel, result);
                    return callback()
                })
            }
        };
        files.forEach(function (path) {
            tasks.push(fetch(path))
        });
        const start = new Date().getTime();
        async.parallelLimit(tasks, 100, function (err) {
            console.error('files fetched in', (new Date().getTime() - start) / 1000.0);
            return callback(err);
        });
    }

    private processProjects(callback: (err?: Error) => void) {
        let tasks = [];
        const self = this;
        this.entries.forEach(function (v, k) {            
            if (!/(^|\/)tsconfig\.json$/.test(k)) {
                return;
            }
            if (/(^|\/)node_modules\//.test(k)) {
                return;
            }
            tasks.push(self.processProject(k, v));
        });
        async.parallel(tasks, callback);
    }

    private processProject(tsConfigPath: string, tsConfigContent: string): AsyncFunction<void> {
        const self = this;
        return function (callback: (err?: Error) => void) {
            const jsonConfig = ts.parseConfigFileTextToJson(tsConfigPath, tsConfigContent);
            if (jsonConfig.error) {
                console.error('Cannot parse ' + tsConfigPath + ': ' + jsonConfig.error.messageText);
                return callback(new Error('Cannot parse ' + tsConfigPath + ': ' + jsonConfig.error.messageText));
            }
            const configObject = jsonConfig.config;
            // TODO: VFS - add support of includes/excludes
            let dir = path_.posix.dirname(tsConfigPath);
            if (dir == '.') {
                dir = '';
            }
            const base = dir || self.root;
            const configParseResult = ts.parseJsonConfigFileContent(configObject, NoopParseConfigHost, base);
            console.error('Added project', tsConfigPath, dir);
            self.services.set(dir, ts.createLanguageService(new InMemoryLanguageServiceHost(self.root,
                configParseResult.options,
                self.entries),
                ts.createDocumentRegistry()));
            callback();
        }
    }
}

class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {

    private root: string;
    private options: ts.CompilerOptions;
    private entries: Map<string, string>;

    constructor(root: string, options: ts.CompilerOptions, entries: Map<string, string>) {
        this.root = root;
        this.options = options;
        this.entries = entries;
    }

    getCompilationSettings(): ts.CompilerOptions {
        return this.options;
    }

    getScriptFileNames(): string[] {
        return [];
    }

    getScriptVersion(fileName: string): string {
        const entry = this.getScriptSnapshot(fileName);
        return entry ? "1" : undefined;
    }

    getScriptSnapshot(fileName: string): ts.IScriptSnapshot {
        let entry = this.entries.get(fileName);
        if (!entry) {
            fileName = path_.posix.relative(this.root, fileName);
            entry = this.entries.get(fileName);
        }
        if (!entry) {
            return undefined;
        }
        return ts.ScriptSnapshot.fromString(entry);
    }

    getCurrentDirectory(): string {
        return this.root;
    }

    getDefaultLibFileName(options: ts.CompilerOptions): string {
        return ts.getDefaultLibFilePath(options);
    }
}

const NoopParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readDirectory: function (): string[] {
        return []
    },
    fileExists: function (): boolean {
        return false
    },
    readFile: function (): string {
        return ''
    }
};

