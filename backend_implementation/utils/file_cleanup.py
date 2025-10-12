"""
File Cleanup Scheduler
Automatically deletes expired contract files.
"""

import os
import time
import threading
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import json


class FileCleanupScheduler:
    """Manages automatic cleanup of temporary contract files."""

    def __init__(
        self,
        temp_dir: str = "/tmp/contracts",
        cleanup_queue_file: str = "/tmp/contracts/cleanup_queue.json",
        expiry_hours: int = 24
    ):
        """
        Initialize the cleanup scheduler.

        Args:
            temp_dir: Directory where contract files are stored
            cleanup_queue_file: File to persist cleanup queue
            expiry_hours: Hours before a file expires (default 24)
        """
        self.temp_dir = temp_dir
        self.cleanup_queue_file = cleanup_queue_file
        self.expiry_hours = expiry_hours
        self.cleanup_queue: Dict[str, str] = {}  # file_id -> expiry_timestamp
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Create temp dir if needed
        os.makedirs(temp_dir, exist_ok=True)

        # Load existing queue
        self._load_queue()

    def schedule_cleanup(self, file_id: str, hours: Optional[int] = None):
        """
        Schedule a file for cleanup after specified hours.

        Args:
            file_id: The unique file identifier
            hours: Hours until cleanup (uses default if None)
        """
        hours = hours or self.expiry_hours
        expiry_time = datetime.now() + timedelta(hours=hours)

        with self._lock:
            self.cleanup_queue[file_id] = expiry_time.isoformat()
            self._save_queue()

        print(f"Scheduled cleanup for {file_id} at {expiry_time}")

    def cancel_cleanup(self, file_id: str):
        """Cancel scheduled cleanup for a file."""
        with self._lock:
            if file_id in self.cleanup_queue:
                del self.cleanup_queue[file_id]
                self._save_queue()
                print(f"Cancelled cleanup for {file_id}")

    def start(self):
        """Start the cleanup scheduler in a background thread."""
        if self._running:
            print("Cleanup scheduler already running")
            return

        self._running = True
        self._thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._thread.start()
        print("Cleanup scheduler started")

    def stop(self):
        """Stop the cleanup scheduler."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        print("Cleanup scheduler stopped")

    def _cleanup_loop(self):
        """Main cleanup loop - runs in background thread."""
        while self._running:
            try:
                self._cleanup_expired_files()
                # Check every hour
                time.sleep(3600)
            except Exception as e:
                print(f"Error in cleanup loop: {e}")
                time.sleep(60)  # Wait a bit before retrying

    def _cleanup_expired_files(self):
        """Delete files that have expired."""
        now = datetime.now()
        expired_files: List[str] = []

        with self._lock:
            # Find expired files
            for file_id, expiry_str in list(self.cleanup_queue.items()):
                try:
                    expiry_time = datetime.fromisoformat(expiry_str)
                    if now >= expiry_time:
                        expired_files.append(file_id)
                except (ValueError, TypeError) as e:
                    print(f"Invalid expiry time for {file_id}: {e}")
                    expired_files.append(file_id)  # Clean up invalid entries

        # Delete expired files (outside lock to avoid blocking)
        deleted_count = 0
        for file_id in expired_files:
            if self._delete_file(file_id):
                deleted_count += 1

            # Remove from queue
            with self._lock:
                if file_id in self.cleanup_queue:
                    del self.cleanup_queue[file_id]

        # Save updated queue
        if expired_files:
            with self._lock:
                self._save_queue()
            print(f"Cleaned up {deleted_count}/{len(expired_files)} expired files")

    def _delete_file(self, file_id: str) -> bool:
        """Delete a contract file."""
        filepath = os.path.join(self.temp_dir, f"{file_id}.docx")

        if os.path.exists(filepath):
            try:
                os.remove(filepath)
                print(f"Deleted expired file: {file_id}")
                return True
            except Exception as e:
                print(f"Error deleting file {filepath}: {e}")
                return False
        else:
            print(f"File already deleted: {file_id}")
            return True  # Consider already-deleted as success

    def _load_queue(self):
        """Load cleanup queue from disk."""
        if os.path.exists(self.cleanup_queue_file):
            try:
                with open(self.cleanup_queue_file, 'r') as f:
                    self.cleanup_queue = json.load(f)
                print(f"Loaded {len(self.cleanup_queue)} items from cleanup queue")
            except Exception as e:
                print(f"Error loading cleanup queue: {e}")
                self.cleanup_queue = {}
        else:
            self.cleanup_queue = {}

    def _save_queue(self):
        """Save cleanup queue to disk."""
        try:
            with open(self.cleanup_queue_file, 'w') as f:
                json.dump(self.cleanup_queue, f)
        except Exception as e:
            print(f"Error saving cleanup queue: {e}")

    def get_queue_size(self) -> int:
        """Get the number of files scheduled for cleanup."""
        with self._lock:
            return len(self.cleanup_queue)

    def get_expired_count(self) -> int:
        """Get the number of files that are currently expired."""
        now = datetime.now()
        count = 0

        with self._lock:
            for expiry_str in self.cleanup_queue.values():
                try:
                    expiry_time = datetime.fromisoformat(expiry_str)
                    if now >= expiry_time:
                        count += 1
                except (ValueError, TypeError):
                    count += 1  # Count invalid entries as expired

        return count

    def force_cleanup_now(self):
        """Force immediate cleanup of all expired files (for testing)."""
        print("Forcing immediate cleanup...")
        self._cleanup_expired_files()


# Singleton instance
_scheduler_instance: Optional[FileCleanupScheduler] = None


def get_scheduler(
    temp_dir: str = "/tmp/contracts",
    cleanup_queue_file: str = "/tmp/contracts/cleanup_queue.json",
    expiry_hours: int = 24
) -> FileCleanupScheduler:
    """Get or create the singleton scheduler instance."""
    global _scheduler_instance

    if _scheduler_instance is None:
        _scheduler_instance = FileCleanupScheduler(
            temp_dir=temp_dir,
            cleanup_queue_file=cleanup_queue_file,
            expiry_hours=expiry_hours
        )
        _scheduler_instance.start()

    return _scheduler_instance


# Example usage
if __name__ == "__main__":
    # Create scheduler
    scheduler = FileCleanupScheduler(
        temp_dir="./test_contracts",
        cleanup_queue_file="./test_contracts/cleanup_queue.json",
        expiry_hours=24
    )

    # Schedule some test files
    scheduler.schedule_cleanup("test-file-1", hours=1)
    scheduler.schedule_cleanup("test-file-2", hours=2)
    scheduler.schedule_cleanup("test-file-3", hours=24)

    print(f"Queue size: {scheduler.get_queue_size()}")
    print(f"Expired count: {scheduler.get_expired_count()}")

    # Start scheduler
    scheduler.start()

    # Keep running
    try:
        print("Scheduler running... Press Ctrl+C to stop")
        while True:
            time.sleep(10)
            print(f"Queue: {scheduler.get_queue_size()} | Expired: {scheduler.get_expired_count()}")
    except KeyboardInterrupt:
        print("\nStopping...")
        scheduler.stop()
