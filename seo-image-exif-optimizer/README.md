# SEO Image EXIF Optimizer

A small offline browser tool for injecting SEO-focused image metadata.

## Use

Open `index.html` in a browser, upload an image, fill the metadata fields, and download the optimized file. JPEG, PNG, WebP, AVIF, GIF, BMP, and other browser-decodable image formats are accepted. Output can be JPEG or WebP.

For Vercel deployment, deploy the `seo-image-exif-optimizer` folder. The app includes a serverless endpoint at `api/ai-keywords.js`, so no paid AI key is required.

For local testing:

```powershell
npm start
```

Then open `http://localhost:4173`.

Optional local-only image understanding uses Ollama. This does not run inside Vercel. Install Ollama, pull a vision model such as `llava`, and keep Ollama running:

```powershell
ollama pull llava
$env:OLLAMA_MODEL="llava"
npm start
```

## Supported output

- JPEG output: writes a fresh EXIF APP1 segment with title, subject, keywords, comment, description, artist, copyright, software, and timestamp fields.
- WebP output: converts through the browser WebP encoder. EXIF metadata is not embedded in WebP output.
- Converted output flattens transparency onto a white background.

The tool suggests a clean keyword-based filename without adding a forced suffix.

The SEO score is a simple completeness score. It checks whether an image is loaded, keywords are present, title is filled, alt text exists and is a useful length, description is filled, subject is filled, creator or brand is filled, and keyword count stays reasonable.

The marketplace research button does not use paid AI. On Vercel, it uses free public search-result pages filtered to the selected marketplace domains and fills the metadata fields from listing titles/snippets. In local development only, `server.js` can optionally use Ollama for image understanding before searching.

## Notes

Search engines may use filenames, alt text, page context, structured data, and surrounding copy more reliably than image metadata. Treat embedded EXIF/PNG metadata as one part of an image SEO workflow, not the whole strategy.
