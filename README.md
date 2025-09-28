# Norma AI - Pravni Asistent za Srpsko Zakonodavstvo

Norma AI je desktop aplikacija koja koristi veštačku inteligenciju za pomoć advokatima pri radu sa srpskim zakonima i propisima. Aplikacija omogućava brzu pretragu i analizu zakonskog sadržaja sa preciznim odgovorima na srpskom jeziku.

## 🚀 Ključne funkcionalnosti

- **💬 Prirodan razgovor**: Postavite pitanja prirodnim srpskim jezikom
- **⚖️ 25+ zakona**: Pristup širokom spektru srpskih zakona i propisa
- **📝 Precizni odgovori**: Odgovori bazirani na aktuelnom zakonskom sadržaju
- **💾 Istorija konverzacija**: Čuvanje i upravljanje prethodnim razgovorima
- **🌙 Tamna/svetla tema**: Prilagodljiv interfejs
- **🔄 Keširanje sadržaja**: Hibridni pristup za brzinu i aktuelnost
- **📱 Moderni UI**: ChatGPT-like interfejs optimizovan za pravni rad

## 🛠️ Tehnologije

- **Frontend**: React, Vite, JavaScript, CSS
- **Backend**: Rust, Tauri
- **AI**: OpenRouter API (Google Gemini 2.0 Flash)
- **Baza podataka**: SQLite (planirana)
- **Web scraping**: Rust Scraper za paragraf.rs

## 📋 Prerekviziti

- Node.js (v16 ili noviji)
- Rust (najnovija stabilna verzija)
- OpenRouter API ključ

## 🔧 Instalacija

1. **Kloniranje projekta**

   ```bash
   git clone <repository-url>
   cd norma-ai
   ```

2. **Instaliranje zavisnosti**

   ```bash
   npm install
   ```

3. **Rust dependencies** (automatski se instaliraju tokom build procesa)

## ▶️ Pokretanje

### Razvojna verzija

```bash
npm run tauri dev
```

### Buildovanje produkcijske verzije

```bash
npm run tauri build
```

## ⚙️ Konfiguracija

### OpenRouter API Ključ

1. Registrujte se na [OpenRouter](https://openrouter.ai/)
2. Napravite API ključ
3. U aplikaciji idite na Settings (⚙️ ikona)
4. Unesite API ključ i sačuvajte

### Dostupni zakoni

Aplikacija trenutno podržava sledeće zakone:

- Zakon o bezbednosti saobraćaja na putevima
- Carinski zakon
- Krivični zakonik
- Zakon o krivičnom postupku
- Zakon o parničnom postupku
- Zakon o privrednim društvima
- Zakon o radu
- Porodični zakon
- I još 15+ zakona...

## 📖 Korišćenje

1. **Pokretanje aplikacije**
2. **Odabir zakona** iz dropdown menija
3. **Nova konverzacija** klikom na "Nova konverzacija"
4. **Postavljanje pitanja** u srpskom jeziku
5. **Pregled odgovora** sa citiranim delovima zakona

### Primer pitanja

- "Koja je kazna za prekršaj prelaska na crveno svetlo?"
- "Koji su uslovi za zaključivanje braka u Srbiji?"
- "Kakva je procedura za osnivanje d.o.o.?"

## 🏗️ Struktura projekta

```
norma-ai/
├── src/                    # React frontend
│   ├── components/         # React komponente
│   ├── constants/          # Konstante (lista zakona)
│   ├── contexts/           # React konteksti (tema)
│   └── App.jsx            # Glavna aplikacija
├── src-tauri/             # Rust backend
│   ├── src/               # Rust kod
│   │   ├── api.rs        # OpenRouter API integracija
│   │   ├── database.rs   # Database operacije
│   │   └── scraper.rs    # Web scraping
│   └── Cargo.toml        # Rust dependencies
└── package.json          # Node.js dependencies
```

## 🔮 Planirane funkcionalnosti

- [ ] Punu SQLite integraciju
- [ ] Izvoz konverzacija
- [ ] Korisničku autentifikaciju
- [ ] Offline režim rada
- [ ] Proširena podrška za dokumente
- [ ] Mobile verziju

## 🤝 Doprinos

Doprinosi su dobrodošli! Molimo:

1. Forkujte projekat
2. Napravite feature branch
3. Commitujte izmene
4. Pushujte na branch
5. Otvorite Pull Request

## 📄 Licenca

Ovaj projekat je pod MIT licencom.

## 📞 Podrška

Za pitanja ili probleme otvorite Issue na GitHub-u.

---

**Napomena**: Ova aplikacija je namenjena za pomoć pri pravnom radu, ali ne zamenjuje profesionalno pravno savetovanje. Uvek konsultujte kvalifikovanog advokata za važne pravne odluke.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
