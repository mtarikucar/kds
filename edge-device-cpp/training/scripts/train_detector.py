#!/usr/bin/env python3
"""YOLOv8 fine-tuning script for restaurant person detection.

Fine-tunes a pre-trained YOLOv8 model on restaurant-specific data
to improve detection accuracy for seated, standing, and moving persons.
"""

import argparse
from datetime import datetime
from pathlib import Path

import structlog
import yaml
from ultralytics import YOLO

logger = structlog.get_logger(__name__)


class PersonDetectorTrainer:
    """Trains YOLOv8 model for restaurant person detection."""

    def __init__(
        self,
        config_path: Path,
        dataset_path: Path,
        output_dir: Path,
    ) -> None:
        """Initialize trainer.

        Args:
            config_path: Path to training configuration YAML
            dataset_path: Path to dataset configuration YAML
            output_dir: Output directory for checkpoints
        """
        self.config_path = config_path
        self.dataset_path = dataset_path
        self.output_dir = output_dir

        with open(config_path) as f:
            self.config = yaml.safe_load(f)

        self.output_dir.mkdir(parents=True, exist_ok=True)

    def train(self) -> Path:
        """Run training.

        Returns:
            Path to best model checkpoint
        """
        training_config = self.config["training"]

        # Load base model
        model_name = training_config.get("model", "yolov8n.pt")
        logger.info("Loading base model", model=model_name)

        model = YOLO(model_name)

        # Prepare training arguments
        train_args = {
            "data": str(self.dataset_path),
            "epochs": training_config.get("epochs", 100),
            "batch": training_config.get("batch", 16),
            "imgsz": training_config.get("imgsz", 640),
            "patience": training_config.get("patience", 20),
            "device": training_config.get("device", "cpu"),
            "workers": training_config.get("workers", 8),
            "project": str(self.output_dir),
            "name": f"train_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "exist_ok": True,
            "pretrained": True,
            "optimizer": training_config.get("optimizer", "auto"),
            "verbose": True,
            "seed": 42,
            "deterministic": True,
            "single_cls": True,  # Single class (person) detection
            "lr0": training_config.get("lr0", 0.01),
            "lrf": training_config.get("lrf", 0.01),
            "momentum": training_config.get("momentum", 0.937),
            "weight_decay": training_config.get("weight_decay", 0.0005),
            "warmup_epochs": training_config.get("warmup_epochs", 3.0),
            "warmup_momentum": training_config.get("warmup_momentum", 0.8),
            "warmup_bias_lr": training_config.get("warmup_bias_lr", 0.1),
        }

        # Add augmentation settings
        augmentation = training_config.get("augmentation", {})
        for key, value in augmentation.items():
            train_args[key] = value

        logger.info("Starting training", **train_args)

        # Train model
        results = model.train(**train_args)

        # Get best model path
        best_model_path = Path(results.save_dir) / "weights" / "best.pt"

        logger.info("Training complete", best_model=str(best_model_path))

        return best_model_path

    def evaluate(self, model_path: Path) -> dict:
        """Evaluate trained model.

        Args:
            model_path: Path to trained model

        Returns:
            Evaluation metrics
        """
        logger.info("Evaluating model", model=str(model_path))

        model = YOLO(str(model_path))

        eval_config = self.config.get("evaluation", {})

        results = model.val(
            data=str(self.dataset_path),
            conf=eval_config.get("conf", 0.25),
            iou=eval_config.get("iou", 0.6),
            max_det=eval_config.get("max_det", 100),
            device=self.config["training"].get("device", "cpu"),
        )

        metrics = {
            "precision": float(results.results_dict.get("metrics/precision(B)", 0)),
            "recall": float(results.results_dict.get("metrics/recall(B)", 0)),
            "mAP50": float(results.results_dict.get("metrics/mAP50(B)", 0)),
            "mAP50-95": float(results.results_dict.get("metrics/mAP50-95(B)", 0)),
        }

        logger.info("Evaluation complete", **metrics)

        return metrics

    def export(self, model_path: Path) -> list[Path]:
        """Export model to various formats.

        Args:
            model_path: Path to trained model

        Returns:
            List of exported model paths
        """
        logger.info("Exporting model", model=str(model_path))

        model = YOLO(str(model_path))

        export_config = self.config.get("export", {})
        formats = export_config.get("formats", ["onnx"])

        exported_paths: list[Path] = []

        for fmt in formats:
            export_args = {
                "format": fmt,
                "simplify": export_config.get("simplify", True),
                "opset": export_config.get("opset", 12),
                "dynamic": export_config.get("dynamic", False),
            }

            result = model.export(**export_args)
            exported_paths.append(Path(result))
            logger.info("Exported model", format=fmt, path=result)

        return exported_paths


def main() -> None:
    """Entry point for training."""
    parser = argparse.ArgumentParser(description="Train YOLOv8 person detector")
    parser.add_argument(
        "--config",
        "-c",
        type=Path,
        default=Path("../configs/training_config.yaml"),
        help="Training configuration YAML",
    )
    parser.add_argument(
        "--dataset",
        "-d",
        type=Path,
        default=Path("../configs/restaurant_dataset.yaml"),
        help="Dataset configuration YAML",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("../models/checkpoints"),
        help="Output directory for checkpoints",
    )
    parser.add_argument(
        "--evaluate-only",
        action="store_true",
        help="Only evaluate existing model",
    )
    parser.add_argument(
        "--model",
        "-m",
        type=Path,
        help="Model to evaluate (for --evaluate-only)",
    )
    parser.add_argument(
        "--export",
        action="store_true",
        help="Export model after training",
    )

    args = parser.parse_args()

    trainer = PersonDetectorTrainer(
        config_path=args.config,
        dataset_path=args.dataset,
        output_dir=args.output,
    )

    if args.evaluate_only:
        if not args.model:
            parser.error("--model required with --evaluate-only")
        trainer.evaluate(args.model)
    else:
        best_model = trainer.train()
        trainer.evaluate(best_model)

        if args.export:
            trainer.export(best_model)


if __name__ == "__main__":
    main()
