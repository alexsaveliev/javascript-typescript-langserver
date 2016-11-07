import * as https from 'https';
import * as url from 'url';

const gunzip = require('gunzip-maybe');
const tar = require('tar-stream');
const npm = require('npm');

/**
 * DependencyFetcher fetches distribution tarball from NPM registry for a given package name and version and extracts
 * all the .d.ts files found there  
 */
class DependencyFetcher {

    private initialized: Promise<void>;

    private initialize(): Promise<void> {
        if (!this.initialized) {
            this.initialized = new Promise<void>((resolve, reject) => {
                npm.load({ loglevel: 'silent', progress: false }, (err?: Error) => {
                    return err ? reject(err) : resolve();
                });
            });
        }
        return this.initialized;
    }

    /**
     * Asynchronously fetches dependency's tarball and calls callback function passing error encountered (if any)
     * and map of (file name => file content) of all the .d.ts files found
     */
    fetch(dependency: string, version: string, callback: (err: Error, files?: Map<string, string>) => void) {
        const files = new Map<string, string>();
        this.initialize().then(() => {
            npm.commands.view([dependency + '@' + version, 'dist.tarball'], true, (err?: Error, result?: string) => {
                if (err) {
                    return callback(err);
                }
                const opts = <any>url.parse(result[version]['dist.tarball']);
                opts.rejectUnhauthorized = false;
                https.get(opts, (stream) => {
                    const extract = tar.extract();
                    extract.on('entry', function (header, stream, next) {
                        const accept = header.type == 'file' && header.name.endsWith('.d.ts');
                        const buffers = [];
                        if (accept) {
                            stream.on('data', function (buffer) {
                                buffers.push(buffer);
                            });
                        }
                        stream.on('end', function () {
                            if (accept) {
                                const content = Buffer.concat(buffers).toString();
                                files.set(header.name, content);
                            }
                            next();
                        });
                        stream.resume();
                    });
                    extract.on('finish', () => {
                        callback(null, files);
                    });
                    stream.pipe(gunzip()).pipe(extract);
                }).on('error', (err: Error) => {
                    callback(err);
                });
            });
        }, (err: Error) => {
            callback(err);
        })
    }
}

//const fetcher = new DependencyFetcher();
//fetcher.fetch('@types/async', '2.0.32', (err: Error, files: Map<string, string>) => { console.log(files); });