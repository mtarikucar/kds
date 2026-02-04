#!/usr/bin/env python3
"""Model evaluation and benchmarking script.

Provides comprehensive evaluation of trained person detection models
including accuracy metrics, speed benchmarks, and edge device compatibility.
"""

import argparse
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import structlog
from ultralytics import YOLO

logger = structlog.get_logger(__name__)


@dataclass
class EvaluationMetrics:
    """Evaluation metrics container."""

    # Accuracy metrics
    precision: float
    recall: float
    f1_score: float
    mAP50: float
    mAP50_95: float

    # Speed metrics (in milliseconds)
    inference_time_mean: float
    inference_time_std: float
    inference_time_min: float
    inference_time_max: float
    fps: float

    # Model info
    model_size_mb: float
    input_size: tuple[int, int]
    num_classes: int

    # Edge device compatibility
    jetson_compatible: bool
    raspberry_pi_compatible: bool
    onnx_available: bool

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return asdict(self)


class ModelEvaluator:
    """Comprehensive model evaluation."""

    def __init__(
        self,
        model_path: Path,
        dataset_path: Path | None = None,
        device: str = "cpu",
    ) -> None:
        """Initialize evaluator.

        Args:
            model_path: Path to YOLO model
            dataset_path: Path to dataset YAML (for accuracy evaluation)
            device: Inference device
        """
        self.model_path = model_path
        self.dataset_path = dataset_path
        self.device = device

        self.model = YOLO(str(model_path))

    def evaluate_accuracy(self) -> dict[str, float]:
        """Evaluate model accuracy on dataset.

        Returns:
            Accuracy metrics dictionary
        """
        if self.dataset_path is None:
            logger.warning("No dataset provided, skipping accuracy evaluation")
            return {}

        logger.info("Evaluating accuracy", dataset=str(self.dataset_path))

        results = self.model.val(
            data=str(self.dataset_path),
            device=self.device,
            verbose=False,
        )

        metrics = {
            "precision": float(results.results_dict.get("metrics/precision(B)", 0)),
            "recall": float(results.results_dict.get("metrics/recall(B)", 0)),
            "mAP50": float(results.results_dict.get("metrics/mAP50(B)", 0)),
            "mAP50_95": float(results.results_dict.get("metrics/mAP50-95(B)", 0)),
        }

        # Calculate F1 score
        if metrics["precision"] + metrics["recall"] > 0:
            metrics["f1_score"] = (
                2 * metrics["precision"] * metrics["recall"]
                / (metrics["precision"] + metrics["recall"])
            )
        else:
            metrics["f1_score"] = 0.0

        logger.info("Accuracy evaluation complete", **metrics)

        return metrics

    def benchmark_speed(
        self,
        num_iterations: int = 100,
        warmup: int = 10,
        input_size: tuple[int, int] = (640, 640),
    ) -> dict[str, float]:
        """Benchmark inference speed.

        Args:
            num_iterations: Number of inference iterations
            warmup: Number of warmup iterations
            input_size: Input image size (width, height)

        Returns:
            Speed metrics dictionary
        """
        logger.info(
            "Benchmarking speed",
            iterations=num_iterations,
            input_size=input_size,
        )

        # Create dummy input
        dummy_input = np.random.randint(
            0, 255,
            (input_size[1], input_size[0], 3),
            dtype=np.uint8,
        )

        # Warmup
        for _ in range(warmup):
            self.model.predict(
                dummy_input,
                device=self.device,
                verbose=False,
            )

        # Benchmark
        times: list[float] = []

        for _ in range(num_iterations):
            start = time.perf_counter()
            self.model.predict(
                dummy_input,
                device=self.device,
                verbose=False,
            )
            end = time.perf_counter()
            times.append((end - start) * 1000)  # Convert to ms

        times_array = np.array(times)

        metrics = {
            "inference_time_mean": float(np.mean(times_array)),
            "inference_time_std": float(np.std(times_array)),
            "inference_time_min": float(np.min(times_array)),
            "inference_time_max": float(np.max(times_array)),
            "fps": 1000.0 / float(np.mean(times_array)),
        }

        logger.info("Speed benchmark complete", **metrics)

        return metrics

    def get_model_info(self) -> dict:
        """Get model information.

        Returns:
            Model info dictionary
        """
        model_size = self.model_path.stat().st_size / (1024 * 1024)  # MB

        # Check for ONNX version
        onnx_path = self.model_path.with_suffix(".onnx")
        onnx_available = onnx_path.exists()

        # Estimate edge device compatibility
        # Jetson: Generally supports CUDA models
        # Raspberry Pi: Needs small models, preferably ONNX
        jetson_compatible = True  # YOLOv8 supports Jetson
        raspberry_pi_compatible = model_size < 50 and onnx_available

        info = {
            "model_size_mb": model_size,
            "input_size": (640, 640),  # Default YOLO input size
            "num_classes": 1,  # Person only
            "jetson_compatible": jetson_compatible,
            "raspberry_pi_compatible": raspberry_pi_compatible,
            "onnx_available": onnx_available,
        }

        logger.info("Model info", **info)

        return info

    def run_full_evaluation(
        self,
        output_path: Path | None = None,
    ) -> EvaluationMetrics:
        """Run full evaluation.

        Args:
            output_path: Optional path to save results

        Returns:
            Complete evaluation metrics
        """
        logger.info("Running full evaluation", model=str(self.model_path))

        # Get all metrics
        accuracy = self.evaluate_accuracy()
        speed = self.benchmark_speed()
        info = self.get_model_info()

        # Combine metrics
        metrics = EvaluationMetrics(
            precision=accuracy.get("precision", 0.0),
            recall=accuracy.get("recall", 0.0),
            f1_score=accuracy.get("f1_score", 0.0),
            mAP50=accuracy.get("mAP50", 0.0),
            mAP50_95=accuracy.get("mAP50_95", 0.0),
            inference_time_mean=speed["inference_time_mean"],
            inference_time_std=speed["inference_time_std"],
            inference_time_min=speed["inference_time_min"],
            inference_time_max=speed["inference_time_max"],
            fps=speed["fps"],
            model_size_mb=info["model_size_mb"],
            input_size=info["input_size"],
            num_classes=info["num_classes"],
            jetson_compatible=info["jetson_compatible"],
            raspberry_pi_compatible=info["raspberry_pi_compatible"],
            onnx_available=info["onnx_available"],
        )

        # Save results
        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)

            results = {
                "model": str(self.model_path),
                "timestamp": datetime.now().isoformat(),
                "device": self.device,
                "metrics": metrics.to_dict(),
            }

            with open(output_path, "w") as f:
                json.dump(results, f, indent=2)

            logger.info("Results saved", path=str(output_path))

        return metrics


def main() -> None:
    """Entry point for evaluation."""
    parser = argparse.ArgumentParser(description="Evaluate person detection model")
    parser.add_argument(
        "--model",
        "-m",
        type=Path,
        required=True,
        help="Path to YOLO model",
    )
    parser.add_argument(
        "--dataset",
        "-d",
        type=Path,
        help="Dataset configuration YAML",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        help="Inference device",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Output path for results JSON",
    )
    parser.add_argument(
        "--benchmark-only",
        action="store_true",
        help="Only run speed benchmark",
    )
    parser.add_argument(
        "--iterations",
        "-n",
        type=int,
        default=100,
        help="Number of benchmark iterations",
    )

    args = parser.parse_args()

    evaluator = ModelEvaluator(
        model_path=args.model,
        dataset_path=args.dataset,
        device=args.device,
    )

    if args.benchmark_only:
        evaluator.benchmark_speed(num_iterations=args.iterations)
    else:
        evaluator.run_full_evaluation(output_path=args.output)


if __name__ == "__main__":
    main()
