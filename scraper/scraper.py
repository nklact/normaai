#!/usr/bin/env python3
"""
Web scraper for downloading PDF, Word, and Excel files from icarus.rs
"""

import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import time

# URLs to scrape
URLS = [
    "https://icarus.rs/fiskalna-kasa/",
    "https://icarus.rs/odluke/",
    "https://icarus.rs/obrasci/",
    "https://icarus.rs/obracuni/",
    "https://icarus.rs/pdv/",
    "https://icarus.rs/pib-i-m4-obrasci/",
    "https://icarus.rs/poreske-prijave/",
    "https://icarus.rs/registracione-prijave-osnivanja/",
    "https://icarus.rs/ugovori/",
    "https://icarus.rs/zahtevi/",
]

# File extensions to download
FILE_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm']

# Base download directory
BASE_DIR = os.path.join(os.path.dirname(__file__), 'downloads')

# Headers to mimic a real browser
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
}


def get_slug_from_url(url):
    """Extract slug from URL (e.g., 'fiskalna-kasa' from 'https://icarus.rs/fiskalna-kasa/')"""
    path = urlparse(url).path.strip('/')
    return path if path else 'root'


def download_file(url, folder_path, filename):
    """Download a file from URL to the specified folder"""
    try:
        response = requests.get(url, headers=HEADERS, stream=True, timeout=30)
        response.raise_for_status()

        filepath = os.path.join(folder_path, filename)

        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        print(f"  ✓ Downloaded: {filename}")
        return True
    except Exception as e:
        print(f"  ✗ Failed to download {filename}: {str(e)}")
        return False


def scrape_page(url):
    """Scrape a page and download all document files"""
    slug = get_slug_from_url(url)
    folder_path = os.path.join(BASE_DIR, slug)

    # Create folder if it doesn't exist
    os.makedirs(folder_path, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Scraping: {url}")
    print(f"Folder: {slug}")
    print(f"{'='*60}")

    try:
        # Fetch the page
        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()

        # Parse HTML
        soup = BeautifulSoup(response.content, 'html.parser')

        # Find all links
        links = soup.find_all('a', href=True)

        downloaded_count = 0
        skipped_count = 0

        for link in links:
            href = link['href']

            # Check if link ends with any of our target extensions
            if any(href.lower().endswith(ext) for ext in FILE_EXTENSIONS):
                # Convert relative URLs to absolute
                file_url = urljoin(url, href)

                # Extract filename from URL
                filename = os.path.basename(urlparse(file_url).path)

                if download_file(file_url, folder_path, filename):
                    downloaded_count += 1
                else:
                    skipped_count += 1

                # Small delay to be polite to the server
                time.sleep(0.5)

        print(f"\nSummary for {slug}:")
        print(f"  Downloaded: {downloaded_count} files")
        if skipped_count > 0:
            print(f"  Failed: {skipped_count} files")

        return downloaded_count, skipped_count

    except Exception as e:
        print(f"✗ Error scraping {url}: {str(e)}")
        return 0, 0


def main():
    """Main function to run the scraper"""
    print("="*60)
    print("ICARUS.RS Document Scraper")
    print("="*60)
    print(f"Download directory: {BASE_DIR}")

    total_downloaded = 0
    total_failed = 0

    for url in URLS:
        downloaded, failed = scrape_page(url)
        total_downloaded += downloaded
        total_failed += failed

    print("\n" + "="*60)
    print("FINAL SUMMARY")
    print("="*60)
    print(f"Total files downloaded: {total_downloaded}")
    if total_failed > 0:
        print(f"Total files failed: {total_failed}")
    print(f"Files saved to: {BASE_DIR}")
    print("="*60)


if __name__ == "__main__":
    main()
