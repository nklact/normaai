"""
Enhanced Question Handler with Contract Generation
Handles LLM responses and contract generation.
"""

import os
from typing import Dict, Any, Optional
from datetime import datetime

from ..utils.contract_detector import ContractDetector
from ..utils.docx_generator import ContractDocxGenerator
from ..utils.contract_type_detector import ContractTypeDetector
from ..utils.file_cleanup import get_scheduler


class QuestionHandler:
    """Handles question processing with contract generation support."""

    def __init__(
        self,
        api_base_url: str = None,
        temp_dir: str = "/tmp/contracts"
    ):
        """
        Initialize the handler.

        Args:
            api_base_url: Base URL for API (e.g., https://norma-ai.fly.dev)
            temp_dir: Directory for temporary contract files
        """
        self.api_base_url = api_base_url or os.getenv('API_BASE_URL', 'https://norma-ai.fly.dev')
        self.temp_dir = temp_dir

        # Initialize utilities
        self.contract_detector = ContractDetector()
        self.contract_generator = ContractDocxGenerator(temp_dir=temp_dir)
        self.type_detector = ContractTypeDetector()
        self.cleanup_scheduler = get_scheduler(temp_dir=temp_dir)

    def process_llm_response(
        self,
        llm_response: str,
        user_status: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Process LLM response and generate contract if present.

        Args:
            llm_response: Raw response from LLM
            user_status: User status dict with access_type, etc.

        Returns:
            Response dict with answer, law_quotes, law_name, and generated_contract
        """
        # Detect if response contains a contract
        has_contract, contract_content, clean_response = \
            self.contract_detector.detect_contract(llm_response)

        # Build base response
        response_data = {
            "answer": clean_response,
            "law_quotes": self._extract_law_quotes(clean_response),
            "law_name": self._extract_law_name(clean_response),
            "generated_contract": None
        }

        # If contract was generated, create file
        if has_contract:
            # Validate contract
            if not self.contract_detector.validate_contract(contract_content):
                print("Warning: Generated contract failed validation")
                return response_data

            # Check user access (optional - you may want to check this earlier)
            has_access, error_msg = self._check_contract_access(user_status)
            if not has_access:
                print(f"User doesn't have contract access: {error_msg}")
                # You could append this to the answer
                response_data["answer"] += f"\n\n⚠️ {error_msg}"
                return response_data

            # Generate contract file
            try:
                contract_metadata = self._generate_contract_file(
                    contract_content,
                    user_status
                )
                response_data["generated_contract"] = contract_metadata

            except Exception as e:
                print(f"Error generating contract file: {e}")
                response_data["answer"] += "\n\n⚠️ Došlo je do greške pri generisanju fajla. Pokušajte ponovo."

        return response_data

    def _generate_contract_file(
        self,
        contract_content: str,
        user_status: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate contract .docx file and return metadata."""
        # Detect contract type
        contract_type = self.type_detector.detect_type(contract_content)

        # Generate .docx file
        file_id, filepath, filename = self.contract_generator.generate_contract(
            contract_content,
            contract_type
        )

        # Schedule cleanup
        self.cleanup_scheduler.schedule_cleanup(file_id, hours=24)

        # Get preview text
        preview_text = self.type_detector.get_preview_text(contract_content)

        # Build download URL
        download_url = f"{self.api_base_url}/api/contracts/{file_id}"

        # Return metadata for frontend
        return {
            "filename": filename,
            "download_url": download_url,
            "contract_type": contract_type,
            "preview_text": preview_text
        }

    def _check_contract_access(
        self,
        user_status: Dict[str, Any]
    ) -> tuple[bool, str]:
        """
        Check if user has access to contract generation.

        Returns:
            (has_access, error_message)
        """
        access_type = user_status.get('access_type', 'trial_unregistered')

        # Trial users: No access
        if access_type in ['trial_unregistered', 'trial_registered']:
            return False, "Generisanje ugovora zahteva najmanje Individual plan. Molimo nadogradite svoj nalog."

        # Individual users: Limited access (5 per month)
        if access_type == 'individual':
            # You would need to track this in your database
            contracts_this_month = self._get_contracts_count_this_month(
                user_status.get('user_id')
            )
            if contracts_this_month >= 5:
                return False, "Dostigli ste mesečni limit generisanja ugovora (5/mesec na Individual planu). Nadogradite na Professional za neograničen pristup."
            return True, ""

        # Professional, Team, Premium: Unlimited
        if access_type in ['professional', 'team', 'premium']:
            return True, ""

        return False, "Nepoznat tip naloga"

    def _get_contracts_count_this_month(self, user_id: Optional[int]) -> int:
        """
        Get count of contracts generated this month for user.

        TODO: Implement database query
        """
        # Placeholder - implement your database query here
        # Example:
        # from datetime import date
        # first_day = date.today().replace(day=1)
        # count = db.query(GeneratedContracts).filter(
        #     GeneratedContracts.user_id == user_id,
        #     GeneratedContracts.created_at >= first_day
        # ).count()
        # return count
        return 0

    def _extract_law_quotes(self, response: str) -> list:
        """Extract law quotes from response (your existing logic)."""
        # Implement your existing law quote extraction logic
        # This is a placeholder
        quotes = []

        if "Reference:" in response or "Citat iz zakona:" in response:
            parts = response.split("Reference:")
            if len(parts) > 1:
                quote_section = parts[1].strip()
                # Extract articles
                import re
                articles = re.findall(r'\*\*Član\s+\d+[^*]*\*\*[^\n]*', quote_section)
                quotes = articles[:5]  # Limit to 5

        return quotes

    def _extract_law_name(self, response: str) -> Optional[str]:
        """Extract law name from response (your existing logic)."""
        # Implement your existing law name extraction logic
        # This is a placeholder
        if "Reference:" in response:
            parts = response.split("Reference:")
            if len(parts) > 1:
                first_line = parts[1].strip().split('\n')[0]
                return first_line if first_line else None

        return None


# Example usage
if __name__ == "__main__":
    # Sample LLM response with contract
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

    # Sample user status
    user_status = {
        "user_id": 123,
        "email": "user@example.com",
        "access_type": "professional"
    }

    # Initialize handler
    handler = QuestionHandler(
        api_base_url="http://localhost:5000",
        temp_dir="./test_contracts"
    )

    # Process response
    result = handler.process_llm_response(sample_response, user_status)

    print("Response:")
    print(f"  Answer: {result['answer'][:100]}...")
    print(f"  Has Contract: {result['generated_contract'] is not None}")

    if result['generated_contract']:
        print(f"  Contract Type: {result['generated_contract']['contract_type']}")
        print(f"  Filename: {result['generated_contract']['filename']}")
        print(f"  Download URL: {result['generated_contract']['download_url']}")
