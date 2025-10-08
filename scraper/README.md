# ICARUS.RS Document Scraper

A Python web scraper to download PDF, Word, and Excel files from icarus.rs website.

## Features

- Downloads PDF, Word (.doc, .docx), and Excel (.xls, .xlsx, .xlsm) files
- Organizes files into folders based on URL slug (e.g., `fiskalna-kasa`, `odluke`, etc.)
- Re-downloads all files on each run
- Progress tracking and error handling

## Installation

1. Make sure you have Python 3.7+ installed

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

Run the scraper:
```bash
python scraper.py
```

The scraper will:
1. Download files from all configured URLs
2. Save them to `scraper/downloads/{slug}/` folders
3. Display progress and summary

## Download Structure

Files will be organized as follows:
```
scraper/
  downloads/
    fiskalna-kasa/
      file1.pdf
      file2.docx
    odluke/
      file1.pdf
      file2.xlsx
    obrasci/
      ...
    (etc.)
```

## Scraped URLs

- https://icarus.rs/fiskalna-kasa/
- https://icarus.rs/odluke/
- https://icarus.rs/obrasci/
- https://icarus.rs/obracuni/
- https://icarus.rs/pdv/
- https://icarus.rs/pib-i-m4-obrasci/
- https://icarus.rs/poreske-prijave/
- https://icarus.rs/registracione-prijave-osnivanja/
- https://icarus.rs/ugovori/
- https://icarus.rs/zahtevi/

## Configuration

To add or modify URLs, edit the `URLS` list in `scraper.py`.

To add or modify file extensions, edit the `FILE_EXTENSIONS` list in `scraper.py`.

## Notes

- Files are re-downloaded on each run (no duplicate checking)
- A 0.5-second delay is added between downloads to be polite to the server
- All errors are logged to the console
