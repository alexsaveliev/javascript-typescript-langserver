/// <reference path="../typings/node/node.d.ts"/>
///// <reference path="../typings/typescript/typescript.d.ts"/>
/// <reference path="../typings/async/async.d.ts"/>

import * as path_ from 'path';

import * as ts from 'typescript';
import { IConnection } from 'vscode-languageserver';
import * as async from 'async';

import * as FileSystem from './fs';
import * as util from './util';
import * as match from './match-files';

export default class ProjectsManager {

    private root: string;
    private strict: boolean;

    private defaultService: ts.LanguageService;
    private services: Map<string, ts.LanguageService>;
    private hosts: Map<string, InMemoryLanguageServiceHost>;

    private remoteFs: FileSystem.FileSystem;
    private localFs: InMemoryFileSystem;

    constructor(root: string, strict: boolean, connection: IConnection) {
        this.root = util.normalizePath(root);
        this.strict = strict;
        this.services = new Map<string, ts.LanguageService>();
        this.hosts = new Map<string, InMemoryLanguageServiceHost>();
        this.localFs = new InMemoryFileSystem(this.root);

        if (strict) {
            this.remoteFs = new FileSystem.RemoteFileSystem(connection)
        } else {
            this.remoteFs = new FileSystem.LocalFileSystem(root)
        }
        this.defaultService = ts.createLanguageService(new InMemoryLanguageServiceHost(root, {
            module: ts.ModuleKind.CommonJS,
            allowNonTsExtensions: false,
            allowJs: false
        }, this.localFs, []), ts.createDocumentRegistry());
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
        return this.localFs.fileExists(name);
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

    prepareService(fileName: string) {

        const self = this;

        let dir = path_.posix.dirname(fileName);
        let host: InMemoryLanguageServiceHost;
        let service;
        while (dir && dir != this.root) {
            host = this.hosts.get(dir);
            if (host) {
                service = this.services.get(dir);
                break;
            }
            dir = path_.posix.dirname(dir);
            if (dir == '.') {
                dir = '';
            }
        }
        if (!host) {
            host = this.hosts.get(dir);
            if (!host) {
                return;
            }
            service = this.services.get(dir);
        }
        if (host.complete) {
            return;
        }
        (host.getExpectedFiles() || []).forEach(function (fileName) {
            const sourceFile = service.getProgram().getSourceFile(fileName);
            if (!sourceFile) {
                service.getProgram().addFile(fileName, self.localFs.readFile(fileName));
            }
        });
        host.complete = true;
    }

    getAnyService(): ts.LanguageService {
        let service = null;
        this.services.forEach(function (v) {
            if (!service) {
                service = v;
            }
        });
        return service || this.defaultService;
    }

    private fetchDir(path: string): AsyncFunction<FileSystem.FileInfo[]> {
        let self = this;
        return function (callback: (err?: Error, result?: FileSystem.FileInfo[]) => void) {
            self.remoteFs.readDir(path, (err?: Error, result?: FileSystem.FileInfo[]) => {
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
                self.remoteFs.readFile(path, (err?: Error, result?: string) => {
                    if (err) {
                        console.error('Unable to fetch content of ' + path, err);
                        return callback(err)
                    }
                    const rel = path_.posix.relative(self.root, path);
                    self.localFs.addFile(rel, result);
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
        Object.keys(this.localFs.entries).forEach(function (k) {
            if (!/(^|\/)tsconfig\.json$/.test(k)) {
                return;
            }
            if (/(^|\/)node_modules\//.test(k)) {
                return;
            }
            tasks.push(self.processProject(k, self.localFs.entries[k]));
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
            let dir = path_.posix.dirname(tsConfigPath);
            if (dir == '.') {
                dir = '';
            }
            const base = dir || self.root;
            const configParseResult = ts.parseJsonConfigFileContent(configObject, self.localFs, base);
            console.error('Added project', tsConfigPath, dir);
            const host = new InMemoryLanguageServiceHost(self.root,
                configParseResult.options,
                self.localFs,
                configParseResult.fileNames);
            self.hosts.set(dir, host);
            self.services.set(dir, ts.createLanguageService(host, ts.createDocumentRegistry()));
            callback();
        }
    }
}

class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {

    complete: boolean;

    private root: string;
    private options: ts.CompilerOptions;
    private fs: InMemoryFileSystem;
    private expectedFiles: string[];

    constructor(root: string, options: ts.CompilerOptions, fs: InMemoryFileSystem, expectedFiles: string[]) {
        this.root = root;
        this.options = options;
        this.fs = fs;
        this.expectedFiles = expectedFiles;
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
        let entry = this.fs.readFile(fileName);
        if (!entry) {
            fileName = path_.posix.relative(this.root, fileName);
            entry = this.fs.readFile(fileName);
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

    getExpectedFiles() {
        return this.expectedFiles;
    }
}

class InMemoryFileSystem implements ts.ParseConfigHost {

    entries: any;

    useCaseSensitiveFileNames: boolean;

    private path: string;
    private rootNode: any;

    constructor(path: string) {
        this.path = path;
        this.entries = {};
        this.rootNode = {};
    }

    addFile(path: string, content: string) {
        this.entries[path] = content;
        let node = this.rootNode;
        path.split('/').forEach(function (component, i, components) {
            const n = node[component];
            if (!n) {
                node[component] = i == components.length - 1 ? '*' : {};
                node = node[component];
            } else {
                node = n;
            }
        });
    }

    fileExists(path: string): boolean {
        return !!this.entries[path];
    }

    readFile(path: string): string {
        return this.entries[path];
    }

    readDirectory(rootDir: string, extensions: string[], excludes: string[], includes: string[]): string[] {
        const self = this;
        return match.matchFiles(rootDir,
            extensions,
            excludes,
            includes,
            true,
            this.path,
            function () {
                return self.getFileSystemEntries.apply(self, arguments);
            });
    }

    getFileSystemEntries(path: string): match.FileSystemEntries {        
        path = path_.posix.relative(this.path, path);        
        const ret = { files: [], directories: [] };
        let node = this.rootNode;
        const components = path.split('/');
        if (components.length != 1 || components[0]) {
            components.forEach(function (component) {                
                const n = node[component];
                if (!n) {
                    return ret;
                }
                node = n;
            });
        }
        Object.keys(node).forEach(function (name) {
            if (typeof node[name] == 'string') {
                ret.files.push(name);
            } else {
                ret.directories.push(name);
            }
        });        
        return ret;
    }
}
