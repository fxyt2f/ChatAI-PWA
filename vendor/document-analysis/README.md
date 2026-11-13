# Document analysis dependencies

The app serves these files from its own origin and verifies the runtime assets in the Service Worker shell.

- PDF.js 6.5.438 (Apache-2.0). The legacy browser build's ESM files are distributed as .js for static hosts. The resources JSON contains the package's packed Adobe CMaps and standard font files, as base64 grouped by the PDF.js resource kind. The app uses the PDF text-content API and supplies resources from this file.
- The text parser module is an esbuild 0.28.2 browser ESM bundle of yaml 2.9.1 (ISC), htmlparser2 12.0.0 (MIT), saxes 6.0.0 (ISC) and fflate 0.8.3 (MIT). It exports yaml's parseAllDocuments, htmlparser2's Parser as HTMLParser, saxes' SaxesParser and fflate's unzipSync.

See [LICENSES.txt](LICENSES.txt) for the original notices, bundled dependency versions and font and CMap licenses. The bundles are only loaded for document operations.
