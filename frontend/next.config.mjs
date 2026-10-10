import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    // The workspace packages ship TypeScript source, not built output, and their
    // internal imports use the ESM convention of a `.js` specifier pointing at a
    // `.ts` file. Webpack does not resolve that on its own, so two things are set
    // up here: the packages are transpiled, and `.js` is aliased back to `.ts`.
    //
    // Without this the build fails on `@mandat/protocol`'s own internal imports,
    // which look wrong but are correct for a Node ESM consumer.
    transpilePackages: ['@mandat/protocol', '@mandat/three-light'],
    webpack: (config) => {
        config.resolve.alias['@'] = path.resolve(__dirname);
        config.resolve.extensionAlias = {
            ...config.resolve.extensionAlias,
            '.js': ['.ts', '.tsx', '.js'],
        };
        return config;
    },
};

export default nextConfig;