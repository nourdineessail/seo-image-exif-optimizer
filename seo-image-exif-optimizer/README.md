# SEO Image EXIF Optimizer

A small offline browser tool for injecting SEO-focused image metadata.

## Use

Open `index.html` in a browser, upload a JPEG or PNG, fill the metadata fields, and download the optimized JPEG.

## Supported output

- JPEG input: writes a fresh EXIF APP1 segment with title, subject, keywords, comment, description, artist, copyright, software, and timestamp fields.
- PNG input: converts to JPEG first, flattening transparency onto a white background, then writes the EXIF fields.

The tool suggests a clean keyword-based filename without adding a forced suffix.

The SEO score is a simple completeness score. It checks whether an image is loaded, keywords are present, title is filled, alt text exists and is a useful length, description is filled, subject is filled, creator or brand is filled, and keyword count stays reasonable.

## Notes

Search engines may use filenames, alt text, page context, structured data, and surrounding copy more reliably than image metadata. Treat embedded EXIF/PNG metadata as one part of an image SEO workflow, not the whole strategy.
