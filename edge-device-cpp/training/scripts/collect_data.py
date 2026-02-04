#!/usr/bin/env python3
"""Data collection script for restaurant person detection training.

This script captures frames from RTSP camera streams and organizes
them for annotation. Implements smart sampling to ensure diverse
training data.
"""

import argparse
import hashlib
import random
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import structlog

logger = structlog.get_logger(__name__)


class DataCollector:
    """Collects and organizes training data from camera streams."""

    def __init__(
        self,
        camera_url: str,
        output_dir: Path,
        sample_interval: float = 1.0,
        min_change_threshold: float = 0.05,
    ) -> None:
        """Initialize data collector.

        Args:
            camera_url: RTSP stream URL
            output_dir: Output directory for frames
            sample_interval: Minimum seconds between samples
            min_change_threshold: Minimum frame difference to save
        """
        self.camera_url = camera_url
        self.output_dir = output_dir
        self.sample_interval = sample_interval
        self.min_change_threshold = min_change_threshold

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._prev_frame: np.ndarray | None = None
        self._frame_count = 0
        self._saved_count = 0

    def _frame_hash(self, frame: np.ndarray) -> str:
        """Compute frame hash for deduplication."""
        small = cv2.resize(frame, (32, 32))
        return hashlib.md5(small.tobytes()).hexdigest()

    def _frame_difference(self, frame1: np.ndarray, frame2: np.ndarray) -> float:
        """Calculate normalized difference between frames."""
        if frame1 is None or frame2 is None:
            return 1.0

        # Convert to grayscale
        gray1 = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)

        # Resize to same size
        h, w = 256, 256
        gray1 = cv2.resize(gray1, (w, h))
        gray2 = cv2.resize(gray2, (w, h))

        # Calculate difference
        diff = cv2.absdiff(gray1, gray2)
        return float(np.mean(diff)) / 255.0

    def _should_save_frame(self, frame: np.ndarray) -> bool:
        """Determine if frame should be saved based on content change."""
        diff = self._frame_difference(frame, self._prev_frame)
        return diff >= self.min_change_threshold

    def _save_frame(self, frame: np.ndarray) -> Path:
        """Save frame to disk with metadata."""
        timestamp = datetime.now()
        date_dir = self.output_dir / timestamp.strftime("%Y-%m-%d")
        date_dir.mkdir(exist_ok=True)

        filename = f"frame_{timestamp.strftime('%H%M%S')}_{self._frame_count:06d}.jpg"
        filepath = date_dir / filename

        # Save with quality setting
        cv2.imwrite(str(filepath), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])

        self._saved_count += 1
        logger.info("Frame saved", path=str(filepath), count=self._saved_count)

        return filepath

    def collect(self, duration: float | None = None, max_frames: int | None = None) -> None:
        """Start data collection.

        Args:
            duration: Collection duration in seconds (None = indefinite)
            max_frames: Maximum frames to collect (None = indefinite)
        """
        logger.info(
            "Starting data collection",
            camera=self.camera_url,
            output=str(self.output_dir),
        )

        cap = cv2.VideoCapture(self.camera_url)

        if not cap.isOpened():
            raise RuntimeError(f"Failed to open camera: {self.camera_url}")

        start_time = time.time()
        last_sample_time = 0.0

        try:
            while True:
                # Check termination conditions
                if duration and (time.time() - start_time) >= duration:
                    break
                if max_frames and self._saved_count >= max_frames:
                    break

                ret, frame = cap.read()
                if not ret:
                    logger.warning("Failed to read frame, retrying...")
                    time.sleep(1)
                    continue

                self._frame_count += 1
                current_time = time.time()

                # Rate limiting
                if current_time - last_sample_time < self.sample_interval:
                    continue

                # Check if frame is worth saving
                if self._should_save_frame(frame):
                    self._save_frame(frame)
                    self._prev_frame = frame.copy()
                    last_sample_time = current_time

        except KeyboardInterrupt:
            logger.info("Collection interrupted by user")
        finally:
            cap.release()

        logger.info(
            "Collection complete",
            total_frames=self._frame_count,
            saved_frames=self._saved_count,
        )

    def collect_random_samples(
        self,
        duration: float,
        sample_count: int,
    ) -> list[Path]:
        """Collect random samples over a time period.

        Args:
            duration: Total collection duration in seconds
            sample_count: Number of samples to collect

        Returns:
            List of saved frame paths
        """
        # Calculate random sample times
        sample_times = sorted(random.sample(range(int(duration)), sample_count))

        logger.info(
            "Collecting random samples",
            duration=duration,
            samples=sample_count,
        )

        cap = cv2.VideoCapture(self.camera_url)
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open camera: {self.camera_url}")

        saved_paths: list[Path] = []
        start_time = time.time()
        sample_idx = 0

        try:
            while sample_idx < len(sample_times):
                ret, frame = cap.read()
                if not ret:
                    time.sleep(0.1)
                    continue

                elapsed = time.time() - start_time

                if elapsed >= sample_times[sample_idx]:
                    path = self._save_frame(frame)
                    saved_paths.append(path)
                    sample_idx += 1

                if elapsed >= duration:
                    break

        finally:
            cap.release()

        return saved_paths


def main() -> None:
    """Entry point for data collection."""
    parser = argparse.ArgumentParser(description="Collect training data from camera")
    parser.add_argument("--camera", "-c", required=True, help="RTSP camera URL")
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("../data/raw"),
        help="Output directory",
    )
    parser.add_argument(
        "--duration",
        "-d",
        type=float,
        help="Collection duration in seconds",
    )
    parser.add_argument(
        "--max-frames",
        "-m",
        type=int,
        help="Maximum frames to collect",
    )
    parser.add_argument(
        "--interval",
        "-i",
        type=float,
        default=1.0,
        help="Minimum seconds between samples",
    )
    parser.add_argument(
        "--threshold",
        "-t",
        type=float,
        default=0.05,
        help="Minimum frame change threshold",
    )

    args = parser.parse_args()

    collector = DataCollector(
        camera_url=args.camera,
        output_dir=args.output,
        sample_interval=args.interval,
        min_change_threshold=args.threshold,
    )

    collector.collect(duration=args.duration, max_frames=args.max_frames)


if __name__ == "__main__":
    main()
