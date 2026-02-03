#!/usr/bin/env python3
"""
Export YOLOv8 model to ONNX format for TensorRT deployment.

This script exports trained YOLOv8 models to ONNX format optimized for
TensorRT inference on NVIDIA Jetson devices.

Usage:
    python export_onnx.py --model best.pt --output yolov8n.onnx --imgsz 640
    python export_onnx.py --model yolov8n.pt --output yolov8n.onnx --fp16
    python export_onnx.py --model best.pt --output yolov8n.onnx --int8 --calibration-data data/calibration
"""

import argparse
import os
import sys
from pathlib import Path

try:
    from ultralytics import YOLO
    import onnx
    import torch
except ImportError as e:
    print(f"Missing required package: {e}")
    print("Install with: pip install ultralytics onnx torch")
    sys.exit(1)


def export_to_onnx(
    model_path: str,
    output_path: str,
    imgsz: int = 640,
    batch_size: int = 1,
    simplify: bool = True,
    opset: int = 17,
    dynamic: bool = False,
) -> str:
    """
    Export YOLOv8 model to ONNX format.

    Args:
        model_path: Path to the trained .pt model
        output_path: Path for the output .onnx file
        imgsz: Input image size
        batch_size: Batch size (1 for static, -1 for dynamic)
        simplify: Apply ONNX simplification
        opset: ONNX opset version
        dynamic: Enable dynamic input shapes

    Returns:
        Path to the exported ONNX file
    """
    print(f"Loading model: {model_path}")
    model = YOLO(model_path)

    print(f"Exporting to ONNX (opset {opset})...")
    export_path = model.export(
        format="onnx",
        imgsz=imgsz,
        batch=batch_size,
        simplify=simplify,
        opset=opset,
        dynamic=dynamic,
    )

    # Move to desired output path
    if export_path != output_path:
        import shutil
        shutil.move(export_path, output_path)
        print(f"Moved to: {output_path}")

    # Verify the exported model
    print("Verifying ONNX model...")
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)
    print("ONNX model is valid!")

    # Print model info
    print(f"\nModel Info:")
    print(f"  Input: {onnx_model.graph.input[0].name}")
    input_shape = [d.dim_value for d in onnx_model.graph.input[0].type.tensor_type.shape.dim]
    print(f"  Input shape: {input_shape}")
    print(f"  Output: {onnx_model.graph.output[0].name}")

    return output_path


def quantize_onnx(
    onnx_path: str,
    output_path: str,
    quantization_type: str = "int8",
    calibration_data_path: str = None,
) -> str:
    """
    Quantize ONNX model for faster inference.

    Args:
        onnx_path: Path to the ONNX model
        output_path: Path for the quantized model
        quantization_type: "int8" or "uint8"
        calibration_data_path: Path to calibration images (for INT8)

    Returns:
        Path to the quantized model
    """
    try:
        from onnxruntime.quantization import (
            quantize_dynamic,
            quantize_static,
            CalibrationDataReader,
            QuantType,
        )
        import numpy as np
        from PIL import Image
    except ImportError as e:
        print(f"Missing package for quantization: {e}")
        print("Install with: pip install onnxruntime pillow")
        return onnx_path

    print(f"Quantizing model to {quantization_type}...")

    # Determine quantization type
    quant_type = QuantType.QInt8 if quantization_type == "int8" else QuantType.QUInt8

    if calibration_data_path and os.path.exists(calibration_data_path):
        # Static quantization with calibration data
        print(f"Using calibration data from: {calibration_data_path}")

        class YOLOCalibrationDataReader(CalibrationDataReader):
            def __init__(self, data_path: str, input_size: int = 640):
                self.data_path = Path(data_path)
                self.input_size = input_size
                self.images = list(self.data_path.glob("*.jpg")) + \
                              list(self.data_path.glob("*.png"))
                self.index = 0
                print(f"Found {len(self.images)} calibration images")

            def get_next(self):
                if self.index >= len(self.images):
                    return None

                img_path = self.images[self.index]
                self.index += 1

                # Load and preprocess image
                img = Image.open(img_path).convert("RGB")
                img = img.resize((self.input_size, self.input_size))
                img_array = np.array(img).astype(np.float32) / 255.0
                img_array = np.transpose(img_array, (2, 0, 1))  # HWC -> CHW
                img_array = np.expand_dims(img_array, axis=0)   # Add batch dim

                return {"images": img_array}

        calibration_reader = YOLOCalibrationDataReader(calibration_data_path)
        quantize_static(
            onnx_path,
            output_path,
            calibration_reader,
            weight_type=quant_type,
        )
    else:
        # Dynamic quantization (no calibration data needed)
        print("Using dynamic quantization (no calibration data)")
        quantize_dynamic(
            onnx_path,
            output_path,
            weight_type=quant_type,
        )

    print(f"Quantized model saved to: {output_path}")

    # Compare file sizes
    original_size = os.path.getsize(onnx_path) / (1024 * 1024)
    quantized_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Original size: {original_size:.2f} MB")
    print(f"Quantized size: {quantized_size:.2f} MB")
    print(f"Compression ratio: {original_size / quantized_size:.2f}x")

    return output_path


def convert_to_tensorrt_trtexec(
    onnx_path: str,
    output_path: str,
    fp16: bool = True,
    int8: bool = False,
    workspace_size_gb: int = 1,
) -> str:
    """
    Generate TensorRT conversion command using trtexec.

    Note: This generates a shell command to run on the target Jetson device.
    TensorRT engines are architecture-specific and must be built on the target.

    Args:
        onnx_path: Path to the ONNX model
        output_path: Path for the TensorRT engine
        fp16: Enable FP16 precision
        int8: Enable INT8 precision
        workspace_size_gb: Workspace size in GB

    Returns:
        trtexec command string
    """
    cmd = [
        "trtexec",
        f"--onnx={onnx_path}",
        f"--saveEngine={output_path}",
        f"--workspace={workspace_size_gb * 1024}",  # Convert to MB
        "--verbose",
    ]

    if fp16:
        cmd.append("--fp16")

    if int8:
        cmd.append("--int8")
        # Note: INT8 requires calibration cache or calibration data

    command = " ".join(cmd)

    print("\n" + "=" * 60)
    print("TensorRT Engine Build Command")
    print("=" * 60)
    print("\nRun this command on your Jetson device:")
    print(f"\n  {command}\n")
    print("Or use the C++ application's --build-engine flag:")
    print(f"\n  ./kds_edge_device --build-engine {onnx_path}\n")
    print("=" * 60)

    # Save command to file
    script_path = output_path.replace(".engine", "_build.sh")
    with open(script_path, "w") as f:
        f.write("#!/bin/bash\n")
        f.write(f"# TensorRT engine build script for {os.path.basename(onnx_path)}\n")
        f.write(f"# Run this on your NVIDIA Jetson device\n\n")
        f.write(f"{command}\n")

    print(f"Build script saved to: {script_path}")

    return command


def main():
    parser = argparse.ArgumentParser(
        description="Export YOLOv8 model to ONNX for TensorRT deployment"
    )
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Path to YOLOv8 model (.pt file)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output ONNX file path",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Input image size (default: 640)",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=1,
        help="Batch size (default: 1)",
    )
    parser.add_argument(
        "--opset",
        type=int,
        default=17,
        help="ONNX opset version (default: 17)",
    )
    parser.add_argument(
        "--simplify",
        action="store_true",
        default=True,
        help="Simplify ONNX model (default: True)",
    )
    parser.add_argument(
        "--dynamic",
        action="store_true",
        help="Enable dynamic input shapes",
    )
    parser.add_argument(
        "--quantize",
        type=str,
        choices=["int8", "uint8"],
        help="Quantize model (int8 or uint8)",
    )
    parser.add_argument(
        "--calibration-data",
        type=str,
        help="Path to calibration images for static quantization",
    )
    parser.add_argument(
        "--tensorrt",
        action="store_true",
        help="Generate TensorRT build command",
    )
    parser.add_argument(
        "--fp16",
        action="store_true",
        help="Enable FP16 for TensorRT",
    )

    args = parser.parse_args()

    # Determine output path
    if args.output is None:
        base = Path(args.model).stem
        args.output = f"{base}.onnx"

    print(f"\nYOLOv8 to ONNX Export Tool")
    print("=" * 40)
    print(f"Input model: {args.model}")
    print(f"Output ONNX: {args.output}")
    print(f"Image size: {args.imgsz}")
    print(f"Batch size: {args.batch}")
    print(f"Opset: {args.opset}")
    print("=" * 40 + "\n")

    # Export to ONNX
    onnx_path = export_to_onnx(
        model_path=args.model,
        output_path=args.output,
        imgsz=args.imgsz,
        batch_size=args.batch,
        simplify=args.simplify,
        opset=args.opset,
        dynamic=args.dynamic,
    )

    # Optional quantization
    if args.quantize:
        quant_output = args.output.replace(".onnx", f"_{args.quantize}.onnx")
        onnx_path = quantize_onnx(
            onnx_path=onnx_path,
            output_path=quant_output,
            quantization_type=args.quantize,
            calibration_data_path=args.calibration_data,
        )

    # Generate TensorRT command
    if args.tensorrt:
        engine_path = onnx_path.replace(".onnx", ".engine")
        convert_to_tensorrt_trtexec(
            onnx_path=onnx_path,
            output_path=engine_path,
            fp16=args.fp16,
        )

    print(f"\nExport complete!")
    print(f"ONNX model: {onnx_path}")
    print(f"Size: {os.path.getsize(onnx_path) / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    main()
