import torch
from train import CNN

model = CNN()
model.load_state_dict(torch.load("../models/model.pt"))
model.eval()

dummy = torch.randn(1,1,28,28)

onnx_program = torch.onnx.export(
    model,
    dummy,
    input_names=["input"],
    output_names=["output"],
    dynamo=True
)

onnx_program.save("../frontend/public/model.onnx")
onnx_program.save("../models/model.onnx")