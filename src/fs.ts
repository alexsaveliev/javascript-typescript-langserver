import {
    RequestType, IConnection, TextDocumentIdentifier
} from 'vscode-languageserver';

import * as fs from 'fs';
import * as path_ from 'path';
import * as glob from 'glob';
import * as async from 'async';
import * as _ from 'lodash';

import * as rt from './request-type';
import * as util from './util';

export interface FileInfo {
    name: string
    size: number
    dir: boolean
}

export interface FileSystem {
    readDir(path: string, callback: (err: Error, result?: FileInfo[]) => void)
    readFile(path: string, callback: (err: Error, result?: string) => void)
    findFiles(patterns: string[], callback: (err: Error, result?: TextDocumentIdentifier[]) => void)
}

namespace ReadDirRequest {
    export const type: RequestType<string, FileInfo[], any> = { get method() { return 'fs/readDir'; } };
}

namespace ReadFileRequest {
    export const type: RequestType<string, string, any> = { get method() { return 'fs/readFile'; } };
}

export class RemoteFileSystem implements FileSystem {

    private connection: IConnection;

    constructor(connection: IConnection) {
        this.connection = connection
    }

    readDir(path: string, callback: (err: Error, result?: FileInfo[]) => void) {
        this.connection.sendRequest(ReadDirRequest.type, path).then((f: FileInfo[]) => {
            return callback(null, f)
        }, (err: Error) => {
            return callback(err)
        })
    }

    findFiles(patterns: string[], callback: (err: Error, result?: TextDocumentIdentifier[]) => void) {
        this.connection.sendRequest(rt.WorkspaceGlobRequest.type, { patterns: patterns }).then((result: TextDocumentIdentifier[]) => {
            return callback(null, result);
        }, (err: Error) => {
            return callback(err);
        })
    }

    readFile(path: string, callback: (err: Error, result?: string) => void) {
        this.connection.sendRequest(ReadFileRequest.type, path).then((content: string) => {
            return callback(null, Buffer.from(content, 'base64').toString())
        }, (err: Error) => {
            return callback(err)
        })
    }

}

export class LocalFileSystem implements FileSystem {

    private root: string;

    constructor(root: string) {
        this.root = root
    }

    readDir(path: string, callback: (err: Error, result?: FileInfo[]) => void) {
        path = path_.resolve(this.root, path);
        fs.readdir(path, (err: Error, files: string[]) => {
            if (err) {
                return callback(err)
            }
            let ret: FileInfo[] = [];
            files.forEach((f) => {
                const stats: fs.Stats = fs.statSync(path_.resolve(path, f));
                ret.push({
                    name: f,
                    size: stats.size,
                    dir: stats.isDirectory()
                })
            });
            return callback(null, ret)
        });
    }

    readFile(path: string, callback: (err: Error, result?: string) => void) {
        path = path_.resolve(this.root, path);
        fs.readFile(path, (err: Error, buf: Buffer) => {
            if (err) {
                return callback(err)
            }
            return callback(null, buf.toString())
        });
    }

    findFiles(patterns: string[], callback: (err: Error, result?: TextDocumentIdentifier[]) => void) {
        const tasks = [];

        const fetch = (pattern: string): AsyncFunction<string[]> => {
            return (callback: (err?: Error, data?: string[]) => void) => {
                glob(pattern, callback);
            };
        }
        patterns.forEach((pattern) => {
            tasks.push(fetch(pattern));
        });

        async.parallel(tasks, (err: Error, matches: string[][]) => {
            if (err) {
                return callback(err);
            }
            callback(null, _.flattenDepth(matches).map((match: string) => {
                return {
                    uri: util.path2uri('', match)
                };
            }));        
        });
    }

}