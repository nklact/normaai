"""
Contract Generation API Endpoints
Flask routes for contract download and management.
"""

import os
import uuid
from flask import Blueprint, send_file, jsonify, request
from werkzeug.exceptions import NotFound, BadRequest

from ..utils.docx_generator import ContractDocxGenerator
from ..utils.file_cleanup import get_scheduler


# Create blueprint
contracts_bp = Blueprint('contracts', __name__, url_prefix='/api/contracts')

# Initialize generator (configure your temp directory)
CONTRACTS_TEMP_DIR = os.getenv('CONTRACTS_TEMP_DIR', '/tmp/contracts')
generator = ContractDocxGenerator(temp_dir=CONTRACTS_TEMP_DIR)

# Get cleanup scheduler
scheduler = get_scheduler(
    temp_dir=CONTRACTS_TEMP_DIR,
    expiry_hours=int(os.getenv('CONTRACTS_EXPIRY_HOURS', '24'))
)


def is_valid_uuid(val: str) -> bool:
    """Validate UUID format for security."""
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, AttributeError):
        return False


@contracts_bp.route('/<file_id>', methods=['GET'])
def download_contract(file_id: str):
    """
    Download a generated contract file.

    URL: GET /api/contracts/<file_id>

    Returns:
        .docx file for download
    """
    # Security: Validate file_id is a valid UUID
    if not is_valid_uuid(file_id):
        return jsonify({
            'error': 'Invalid file ID format'
        }), 400

    # Check if file exists
    if not generator.file_exists(file_id):
        return jsonify({
            'error': 'File not found or expired',
            'message': 'Ugovor nije pronađen ili je istekao. Molimo regenerišite ugovor.'
        }), 404

    try:
        # Get file path
        filepath = generator.get_file_path(file_id)

        # Get friendly filename from metadata if available
        # For now, use a generic filename
        filename = f"Ugovor_{file_id[:8]}.docx"

        # Send file
        return send_file(
            filepath,
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            as_attachment=True,
            download_name=filename
        )

    except Exception as e:
        print(f"Error serving contract file {file_id}: {e}")
        return jsonify({
            'error': 'Failed to download file',
            'message': 'Greška pri preuzimanju ugovora. Molimo pokušajte ponovo.'
        }), 500


@contracts_bp.route('/<file_id>/metadata', methods=['GET'])
def get_contract_metadata(file_id: str):
    """
    Get metadata for a contract file (optional endpoint for debugging).

    URL: GET /api/contracts/<file_id>/metadata

    Returns:
        JSON with file metadata
    """
    if not is_valid_uuid(file_id):
        return jsonify({'error': 'Invalid file ID format'}), 400

    if not generator.file_exists(file_id):
        return jsonify({
            'error': 'File not found',
            'exists': False
        }), 404

    try:
        filepath = generator.get_file_path(file_id)
        file_stats = os.stat(filepath)

        return jsonify({
            'file_id': file_id,
            'exists': True,
            'size_bytes': file_stats.st_size,
            'created_at': file_stats.st_ctime,
            'modified_at': file_stats.st_mtime
        })

    except Exception as e:
        print(f"Error getting contract metadata {file_id}: {e}")
        return jsonify({'error': 'Failed to get metadata'}), 500


@contracts_bp.route('/cleanup/status', methods=['GET'])
def get_cleanup_status():
    """
    Get cleanup scheduler status (admin endpoint).

    URL: GET /api/contracts/cleanup/status

    Returns:
        JSON with cleanup queue statistics
    """
    # Optional: Add authentication check here
    # if not is_admin(request):
    #     return jsonify({'error': 'Unauthorized'}), 401

    return jsonify({
        'queue_size': scheduler.get_queue_size(),
        'expired_count': scheduler.get_expired_count(),
        'temp_dir': CONTRACTS_TEMP_DIR
    })


@contracts_bp.route('/cleanup/force', methods=['POST'])
def force_cleanup():
    """
    Force immediate cleanup of expired files (admin endpoint).

    URL: POST /api/contracts/cleanup/force

    Returns:
        JSON with cleanup results
    """
    # Optional: Add authentication check here
    # if not is_admin(request):
    #     return jsonify({'error': 'Unauthorized'}), 401

    before_count = scheduler.get_queue_size()
    scheduler.force_cleanup_now()
    after_count = scheduler.get_queue_size()

    return jsonify({
        'success': True,
        'cleaned_count': before_count - after_count,
        'remaining_count': after_count
    })


# Error handlers
@contracts_bp.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({
        'error': 'Not found',
        'message': 'Traženi resurs nije pronađen.'
    }), 404


@contracts_bp.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({
        'error': 'Internal server error',
        'message': 'Došlo je do greške na serveru. Molimo pokušajte ponovo.'
    }), 500


# Helper function to register blueprint
def register_contracts_routes(app):
    """
    Register contract routes with Flask app.

    Usage in main app:
        from routes.contracts import register_contracts_routes
        register_contracts_routes(app)
    """
    app.register_blueprint(contracts_bp)
    print(f"✓ Contract routes registered at {contracts_bp.url_prefix}")
