"""
Contract Type Detection Utility
Identifies the type of contract from its content.
"""

from typing import Dict, List


class ContractTypeDetector:
    """Detects contract types based on content analysis."""

    # Common Serbian contract types and their keywords
    CONTRACT_TYPES: Dict[str, List[str]] = {
        "Ugovor o radu": [
            "zaposleni", "poslodavac", "radno mesto", "zarada",
            "radni odnos", "radno vreme", "godišnji odmor"
        ],
        "Ugovor o delu": [
            "izvršilac", "nalogodavac", "delo", "izvršenje dela",
            "autorski rad", "naknada za delo"
        ],
        "Ugovor o zakupu": [
            "zakupodavac", "zakupac", "zakupnina", "predmet zakupa",
            "iznajmljivanje", "poslovni prostor", "stan"
        ],
        "Ugovor o zajmu": [
            "zajmodavac", "zajmoprimac", "kamata", "kamatna stopa",
            "vraćanje zajma", "kredit"
        ],
        "Ugovor o pozajmici": [
            "pozajmilac", "pozajmoprimac", "pozajmljena stvar",
            "vraćanje stvari", "beskamatna"
        ],
        "Ugovor o kupoprodaji": [
            "prodavac", "kupac", "kupoprodajna cena", "prenos vlasništva",
            "prodaja", "kupovina"
        ],
        "Ugovor o davanju usluga": [
            "pružalac usluga", "korisnik usluga", "usluga",
            "obavljanje usluga", "servis"
        ],
        "Ugovor o autorskom delu": [
            "autor", "naručilac", "autorsko delo", "autorska prava",
            "intelektualna svojina", "honorar"
        ],
        "Ugovor o poslovnoj saradnji": [
            "saradnja", "poslovni partneri", "zajednički projekat",
            "poslovna koordinacija"
        ],
        "Ugovor o cesiji": [
            "cedent", "cesionar", "potraživanje", "prenos potraživanja",
            "cesija"
        ],
        "Ugovor o asignaciji": [
            "asignant", "asignatar", "asignant", "preuzimanje obaveze"
        ],
        "Ugovor o pristupanju": [
            "pristupanje", "priključivanje", "pridruživanje"
        ]
    }

    @classmethod
    def detect_type(cls, contract_content: str) -> str:
        """
        Detect the type of contract from its content.

        Args:
            contract_content: The full contract text

        Returns:
            Contract type name (e.g., "Ugovor o radu")
        """
        content_lower = contract_content.lower()

        # First try to extract from title/first line
        first_lines = contract_content.split('\n')[:3]
        for line in first_lines:
            line_stripped = line.strip()
            if 'ugovor' in line_stripped.lower():
                # Check if it matches any known types
                for contract_type in cls.CONTRACT_TYPES.keys():
                    if contract_type.lower() in line_stripped.lower():
                        return contract_type

        # Score each contract type based on keyword matches
        scores = {}
        for contract_type, keywords in cls.CONTRACT_TYPES.items():
            score = sum(1 for keyword in keywords if keyword in content_lower)
            if score > 0:
                scores[contract_type] = score

        # Return type with highest score
        if scores:
            best_match = max(scores.items(), key=lambda x: x[1])
            # Only return if score is reasonable (at least 2 matches)
            if best_match[1] >= 2:
                return best_match[0]

        # Fallback: extract from first line if it contains "ugovor"
        for line in first_lines:
            if 'ugovor' in line.lower():
                # Clean up and title case
                cleaned = line.strip().title()
                if len(cleaned) < 100:  # Reasonable length for title
                    return cleaned

        # Ultimate fallback
        return "Ugovor"

    @classmethod
    def get_preview_text(cls, contract_content: str, max_length: int = 200) -> str:
        """
        Generate a preview text from contract content.

        Args:
            contract_content: The full contract text
            max_length: Maximum length of preview

        Returns:
            Preview text
        """
        # Remove excessive whitespace
        lines = [line.strip() for line in contract_content.split('\n') if line.strip()]

        # Skip the title line (usually the first)
        content_lines = lines[1:] if len(lines) > 1 else lines

        # Join first few lines
        preview = " ".join(content_lines[:5])

        # Truncate if too long
        if len(preview) > max_length:
            preview = preview[:max_length - 3] + "..."

        return preview

    @classmethod
    def is_employment_contract(cls, contract_content: str) -> bool:
        """Check if contract is an employment contract."""
        return cls.detect_type(contract_content) == "Ugovor o radu"

    @classmethod
    def is_service_contract(cls, contract_content: str) -> bool:
        """Check if contract is a service contract."""
        detected_type = cls.detect_type(contract_content)
        return detected_type in ["Ugovor o delu", "Ugovor o davanju usluga"]


# Example usage
if __name__ == "__main__":
    sample_contracts = [
        """
        UGOVOR O RADU

        Zaključen između poslodavca i zaposlenog.
        Zaposleni će obavljati poslove na radnom mestu Software Developer.
        Zarada iznosi 150,000 RSD mesečno.
        """,
        """
        UGOVOR O ZAKUPU POSLOVNOG PROSTORA

        Zaključen između zakupodavca i zakupca.
        Predmet zakupa je poslovni prostor površine 50m2.
        Zakupnina iznosi 500 EUR mesečno.
        """,
        """
        UGOVOR O ZAJMU

        Zajmodavac daje zajmoprimcu kredit u iznosu od 10,000 EUR.
        Kamatna stopa iznosi 5% godišnje.
        Vraćanje zajma vrši se u 24 rate.
        """
    ]

    detector = ContractTypeDetector()

    for i, contract in enumerate(sample_contracts, 1):
        contract_type = detector.detect_type(contract)
        preview = detector.get_preview_text(contract)

        print(f"\nContract {i}:")
        print(f"  Type: {contract_type}")
        print(f"  Preview: {preview}")
        print(f"  Is Employment: {detector.is_employment_contract(contract)}")
        print(f"  Is Service: {detector.is_service_contract(contract)}")
