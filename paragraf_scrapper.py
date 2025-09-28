import requests
from bs4 import BeautifulSoup
import pandas as pd
import re

url = "https://www.paragraf.rs/propisi.html"
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
    'Accept-Charset': 'utf-8'
}
response = requests.get(url, headers=headers)
response.raise_for_status()

# Check the actual encoding from the response
print(f"DEBUG: Response encoding detected: {response.encoding}")
print(f"DEBUG: Response apparent encoding: {response.apparent_encoding}")

# Force UTF-8 encoding
response.encoding = 'utf-8'

soup = BeautifulSoup(response.content, "html.parser", from_encoding='utf-8')

# Laws already included in get_top_common_laws() - exclude these from scraping (25 total)
EXCLUDED_LAWS = {
    "Zakon O Bezbednosti Saobraćaja Na Putevima",
    "Carinski Zakon", 
    "Krivični Zakonik",
    "Zakon O Krivičnom Postupku",
    "Zakon O Parničnom Postupku",
    "Zakon O Privrednim Društvima",
    "Zakon O Radu",
    "Zakon O Porezu Na Dohodak Građana",
    "Zakon O Porezu Na Dodatu Vrednost",
    "Zakon O Obvezama I Osnovama Svojinsko-Pravnih Odnosa",
    "Porodični Zakon",
    "Zakon O Nasleđivanju",
    "Zakon O Izvršenju I Obezbeđenju",
    "Zakon O Stečaju",
    "Zakon O Privrednim Prestupima",
    "Zakon O Prekršajima",
    "Zakon O Planiranju I Izgradnji",
    "Zakon O Državnim Službenicima",
    "Zakon O Javnim Nabavkama",
    "Zakon O Zaštiti Podataka O Ličnosti",
    "Zakon O Elektronskim Komunikacijama",
    "Zakon O Zaštiti Potrošača",
    "Zakon O Javnim Preduzećima",
    "Zakon O Zdravstvenoj Zaštiti"
}

laws = []
id_counter = 26  # Start from 26 since IDs 1-25 are reserved for top common laws

print("DEBUG: Looking for links...")
all_links = soup.find_all("a", href=True)
print(f"DEBUG: Found {len(all_links)} total links")

propisi_links = 0
html_links = 0

for a in all_links:
    href = a["href"]
    text = a.get_text(strip=True)
    
    # Debug output - look for propisi/ (relative) or /propisi/ (absolute)  
    if "propisi/" in href and href.endswith(".html"):
        propisi_links += 1
        if propisi_links <= 10:  # Only show first 10
            print(f"DEBUG: propisi link: {href} | text: '{text}'")

    # Only keep propisi/ links that end with .html
    if "propisi/" in href and href.endswith(".html") and text:
        # Make full URL
        if href.startswith("/"):
            href = "https://www.paragraf.rs" + href
        elif href.startswith("propisi/"):
            href = "https://www.paragraf.rs/" + href

        # Remove citation parts (everything in parentheses with "Sl. glasnik", "Sl. list", etc.)
        text = re.sub(r'\("?Sl\. .*?\)', '', text)
        text = text.strip()
        
        # Convert from UPPERCASE to Title Case (capitalize properly)
        text = text.title()
        
        # Skip laws that are already in get_top_common_laws()
        if text in EXCLUDED_LAWS:
            print(f"SKIPPED (already in top common laws): {text}")
            continue
        
        # Clean up text (escape quotes)
        text = text.replace('"', '\\"')
        
        # Format as requested
        entry = f'SerbianLaw {{ id: {id_counter}, name: "{text}".to_string(), url: "{href}".to_string() }},'
        laws.append(entry)
        print(f"ADDED: {text}")
        id_counter += 1

print(f"DEBUG: Found {propisi_links} /propisi/ links, {html_links} .html links, {len(laws)} final laws")

# Save to CSV so you can easily copy-paste into api.rs
df = pd.DataFrame(laws, columns=["RustStruct"])
df.to_csv("serbian_laws.csv", index=False, encoding="utf-8-sig")  # UTF-8 with BOM

# Also save as plain text file for easier copying
with open("serbian_laws.txt", "w", encoding="utf-8") as f:
    for law in laws:
        f.write(law + "\n")

print("✅ Saved serbian_laws.csv and serbian_laws.txt with all formatted laws.")
