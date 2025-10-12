"""
Contract Detection Utility
Detects generated contracts in LLM responses using markers.
"""

from typing import Tuple


class ContractDetector:
    """Detects and extracts contracts from LLM responses."""

    START_MARKER = "[CONTRACT_START]"
    END_MARKER = "[CONTRACT_END]"

    @classmethod
    def detect_contract(cls, llm_response: str) -> Tuple[bool, str, str]:
        """
        Detect if LLM response contains a generated contract.

        Args:
            llm_response: The raw response from the LLM

        Returns:
            Tuple of (has_contract, contract_content, clean_response)
            - has_contract: Whether a contract was found
            - contract_content: The extracted contract text
            - clean_response: Response with contract markers removed
        """
        if cls.START_MARKER not in llm_response or cls.END_MARKER not in llm_response:
            return False, "", llm_response

        try:
            # Find marker positions
            start_idx = llm_response.index(cls.START_MARKER) + len(cls.START_MARKER)
            end_idx = llm_response.index(cls.END_MARKER)

            # Extract contract content
            contract_content = llm_response[start_idx:end_idx].strip()

            # Remove contract markers from response
            clean_response = (
                llm_response[:llm_response.index(cls.START_MARKER)] +
                llm_response[end_idx + len(cls.END_MARKER):]
            ).strip()

            # Clean up excessive whitespace
            clean_response = "\n".join(
                line for line in clean_response.split("\n") if line.strip()
            )

            return True, contract_content, clean_response

        except (ValueError, IndexError) as e:
            # Markers found but extraction failed - return original
            print(f"Contract detection error: {e}")
            return False, "", llm_response

    @classmethod
    def validate_contract(cls, contract_content: str) -> bool:
        """
        Validate that contract content is reasonable.

        Args:
            contract_content: The extracted contract text

        Returns:
            True if contract appears valid, False otherwise
        """
        if not contract_content or len(contract_content.strip()) < 100:
            return False

        # Check for common contract elements (Serbian)
        contract_indicators = [
            "ugovor",
            "član",
            "strana",
            "zaključen",
            "sporazum"
        ]

        content_lower = contract_content.lower()
        matches = sum(1 for indicator in contract_indicators if indicator in content_lower)

        # Should have at least 2 contract indicators
        return matches >= 2


# Example usage
if __name__ == "__main__":
    # Test with sample LLM response
    sample_response = """
    Odlično! Napravila sam ugovor o radu sa svim potrebnim podacima.

    [CONTRACT_START]
    UGOVOR O RADU NA NEODREĐENO VREME

    Zaključen dana _____________ između:

    1. TECH DOO, sa sedištem u Beogradu
    (u daljem tekstu: Poslodavac)

    i

    2. Marko Marković, sa prebivalištem u ____________
    (u daljem tekstu: Zaposleni)

    Član 1.
    Poslodavac zaključuje sa Zaposlenim ugovor o radu na neodređeno vreme...
    [CONTRACT_END]

    Ugovor je spreman za preuzimanje. Pre potpisa preporučujem pravni pregled.
    """

    has_contract, content, clean = ContractDetector.detect_contract(sample_response)
    print(f"Has contract: {has_contract}")
    print(f"Contract length: {len(content)} chars")
    print(f"Valid: {ContractDetector.validate_contract(content)}")
    print(f"\nClean response:\n{clean}")
