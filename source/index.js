/* @flow */
/* eslint-disable no-use-before-define */
import url from 'url';
import path from 'path';
import {values, entries} from 'lodash';
import less, {FileManager} from 'less';
import resolve from 'resolve';

const defaults = {opts: {}, plugins: {}};

export default function lessTransformFactory(): Function {
	return async function (file: File, _: File, configuration: Config): Promise<File> {
		const config: Config = {...defaults, ...configuration};

		const source = Buffer.isBuffer(file.buffer) ?
			file.buffer.toString('utf-8') :
			file.buffer;

		const pluginEntries: [string, PluginConfig][] = entries(config.plugins);

		const pluginJobs = pluginEntries
			.filter(entry => entry[1].enabled)
			.map(async entry => {
				const [name, config] = entry;
				const resolved = resolve.sync(`less-plugin-${name}`);
				const Plugin = require(resolved); // eslint-disable-line import/no-dynamic-require
				return new Plugin(config.opts || {});
			});

		const plugins = await Promise.all(pluginJobs);

		config.opts.plugins = [
			getImporter(file),
			...plugins
		];

		config.opts.filename = file.path;
		file.buffer = (await less.render(source, config.opts)).css;
		return file;
	};
}

function getImporter(file: File): LessPlugin {
	const pool = flatten(file);
	const load = getLoader(file, pool);

	return {
		install(_, pluginManager) {
			const manager = new FileManager();

			manager.supports = (filePath, dirName) => {
				try {
					const parsed = url.parse(filePath || '');
					return !parsed.protocol && !dirName.includes('node_modules');
				} catch (err) {
					return false;
				}
			};

			manager.supportsSync = () => true;

			manager.loadFile = async (...args) => {
				return load(...args);
			};

			manager.loadFileSync = (...args) => {
				return load(...args);
			};

			manager.tryAppendLessExtension = path => path;
			manager.tryAppendExtension = path => path;

			pluginManager.addFileManager(manager);
		}
	};
}

function getLoader(file: File, pool: File[]): (fileName: string, dirName: string) => LessFile {
	return (fileName, dirName): LessFile => {
		const base = dirName ? getBase(dirName, pool) : file;

		if (!base) {
			throw new Error(`Could not determine pattern for ${dirName}. Most likely this is a bug in patternplate-transform-less. Available: ${pool.map(i => i.path)}`);
		}

		if (!(fileName in base.dependencies)) {
			throw new Error(`Could not find less dependency "${fileName}" for pattern ${base.pattern.id}:${base.path}: Available: ${Object.keys(base.dependencies).join(', ')}`);
		}

		const dependency = base.dependencies[fileName];

		const contents = dependency.buffer.toString();
		return {contents, filename: dependency.path};
	};
}

/** Get file matching <dirName> from a pool of <File>[] */
function getBase(dirName: string, pool: File[]): ?File {
	return pool.find(item => path.normalize(`${path.dirname(item.path)}/`) === path.normalize(dirName));
}

/** Flatten a file.dependencies tree into a pool of available files */
function flatten(file: File, seed = []): File[] {
	return [file, ...values(file.dependencies)
		.reduce((pool, dependency) => [
			...pool,
			...flatten(dependency, pool)
		], seed)];
}

/** patternplate-transform-less configuration */
type Config = { // eslint-disable-line no-undef
	opts: {
		[key: string]: any;
	},
	plugins: {
		[key: string]: PluginConfig;
	}
};

/** patternplate-transform-less less-plugin configuration */
type PluginConfig = { // eslint-disable-line no-undef
	enabled: boolean;
	opts?: {
		[key: string]: any;
	};
}

/** A patternplate file object with attached meta data */
type File = {
	buffer: Buffer;
	dependencies: FileDependencies;
	path: string;
};

/** Map of dependencies available to a file */
type FileDependencies = {
	[localName: string]: File;
}

type LessFile = { // eslint-disable-line no-undef
	contents: string;
	filename: string;
}

type LessPlugin = { // eslint-disable-line no-undef
	install: Function;
};
