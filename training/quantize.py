import numpy as np
from onnxruntime.quantization import (
    quantize_static,
    QuantFormat,
    QuantType
)
from train import load_data  # or move function into shared module

X, y = load_data("../data-capture/public/dataset.json", save_debug=False)


class RealCalibrationDataReader:
    def __init__(self, X, num_samples=300):
        self.data = []
        X = X[:num_samples]  # or random subset

        for i in range(len(X)):
            self.data.append({
                "input": X[i:i+1].numpy().astype(np.float32)
            })

        self.index = 0

    def get_next(self):
        if self.index >= len(self.data):
            return None
        item = self.data[self.index]
        self.index += 1
        return item

dr = RealCalibrationDataReader(X, num_samples=300)
quantize_static(
    model_input="../models/model.onnx",
    model_output="../models/model.int8.qdq.onnx",
    calibration_data_reader=dr,
    quant_format=QuantFormat.QDQ,
    activation_type=QuantType.QUInt8,
    weight_type=QuantType.QInt8,
)

dr = RealCalibrationDataReader(X, num_samples=300)
quantize_static(
    model_input="../models/model.onnx",
    model_output="../frontend/public/model.int8.qdq.onnx",
    calibration_data_reader=dr,
    quant_format=QuantFormat.QDQ,
    activation_type=QuantType.QUInt8,
    weight_type=QuantType.QInt8,
)